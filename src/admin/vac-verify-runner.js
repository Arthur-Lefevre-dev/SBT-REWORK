/**
 * VAC verification job: scrape Steam profile pages (no API) for profiles
 * that have vac_banned = 0 to detect new VAC bans. Updates DB when a ban is found.
 * Fast mode: up to 50 requests per second, new proxy session (IP) every 500 verifications.
 */

import { getVacBanFromProfilePage } from "../steam/profile-scrape.js";
import { getPlayerBans } from "../steam/api.js";
import {
  getProfilesWithoutVacBan,
  updateProfileVacStatus,
  getSetting,
  getStats,
} from "../db/index.js";
import {
  isDecodoProxyEnabled,
  getCurrentProxyIp,
  checkAndLogProxyIpChange,
} from "../proxy.js";

const CONCURRENCY = 50; // max 50 requests in flight ≈ 50 actions/sec
const IP_ROTATE_EVERY = 100; // new Decodo session (new IP) every N verifications
const FETCH_BATCH = 1000; // DB batch size
const MAX_LOG_LINES = 150;

let state = {
  status: "idle", // 'idle' | 'running' | 'stopping'
  startTime: null,
  endTime: null,
  error: null,
  totalToVerify: 0, // set at job start for progress %
  stats: {
    checked: 0,
    updated: 0,
    errors: 0,
  },
};

let logLines = [];
let controller = null;
let runPromise = null;
let broadcastFn = null;

export function addLog(msg) {
  if (typeof msg !== "string") return;
  if (msg.trim()) {
    const RESET = "\x1b[0m";
    const CYAN = "\x1b[36m";
    const GREEN = "\x1b[32m";
    const RED = "\x1b[31m";
    const prefix = `${CYAN}[VAC Verify]${RESET}`;
    const lower = msg.toLowerCase();
    const color =
      lower.includes("erreur") || lower.includes("error") ? RED : GREEN;
    // eslint-disable-next-line no-console
    console.log(prefix, `${color}${msg}${RESET}`);
  }
  logLines.push({ t: new Date().toISOString(), msg });
  if (logLines.length > MAX_LOG_LINES)
    logLines = logLines.slice(-MAX_LOG_LINES);
  if (broadcastFn) broadcastFn(getVacVerifyState());
}

function getController() {
  if (controller) return controller;
  controller = {
    _aborted: false,
    get aborted() {
      return this._aborted;
    },
    set aborted(v) {
      this._aborted = !!v;
    },
  };
  return controller;
}

export function getVacVerifyState() {
  return {
    status: state.status,
    startTime: state.startTime,
    endTime: state.endTime,
    error: state.error,
    totalToVerify: state.totalToVerify,
    stats: { ...state.stats },
    log: logLines.slice(-80).map((e) => ({ t: e.t, msg: e.msg })),
  };
}

export function setBroadcast(fn) {
  broadcastFn = fn;
}

export function isVacVerifyRunning() {
  return state.status === "running" || state.status === "stopping";
}

export function stopVacVerify() {
  if (!controller) return false;
  controller.aborted = true;
  state.status = "stopping";
  addLog("Arrêt de la vérification VAC demandé…");
  if (broadcastFn) broadcastFn(getVacVerifyState());
  return true;
}

/** Concurrency gate: at most CONCURRENCY in flight; waitForSlot resolves when a slot is free. */
function createPool(concurrency) {
  let inFlight = 0;
  const waitQueue = [];
  return {
    async acquire() {
      if (inFlight < concurrency) {
        inFlight++;
        return;
      }
      await new Promise((r) => waitQueue.push(r));
      inFlight++;
    },
    release() {
      inFlight--;
      const next = waitQueue.shift();
      if (next) next();
    },
  };
}

export async function startVacVerify(options = {}) {
  if (isVacVerifyRunning()) {
    return { ok: false, error: "Une vérification VAC est déjà en cours." };
  }

  const limit =
    options.limit != null ? Math.max(1, parseInt(options.limit, 10) || 0) : 0;
  const ctrl = getController();
  ctrl.aborted = false;
  state.status = "running";
  state.startTime = new Date().toISOString();
  state.endTime = null;
  state.error = null;
  state.stats = { checked: 0, updated: 0, errors: 0 };
  state.totalToVerify = 0;
  logLines = [];
  if (broadcastFn) broadcastFn(getVacVerifyState());

  const pool = createPool(CONCURRENCY);

  runPromise = (async () => {
    let offset = 0;
    let requestIndex = 0;
    let useProxySession = true;
    try {
      if (isDecodoProxyEnabled()) {
        addLog("Vérification de la connexion proxy Decodo…");
        const ip = await getCurrentProxyIp();
        if (!ip) {
          state.status = "idle";
          state.error =
            "Proxy Decodo: connexion échouée (407 ou identifiants invalides). Vérifiez DECODO_PROXY_USER / DECODO_PROXY_PASSWORD.";
          addLog(state.error);
          if (broadcastFn) broadcastFn(getVacVerifyState());
          return;
        }
        addLog("Proxy Decodo (sans session): OK.");
        const ipSession = await getCurrentProxyIp({ sessionId: "vac-0" });
        if (!ipSession) {
          addLog(
            "Proxy Decodo: 407 avec session — rotation d’IP désactivée, scraping sans session.",
          );
          useProxySession = false;
        } else {
          await checkAndLogProxyIpChange({ onLog: addLog });
          addLog(
            "Proxy Decodo: connexion OK (session vac-0), démarrage du scraping.",
          );
        }
      }

      const stats = await getStats();
      state.totalToVerify = Math.max(
        0,
        (stats.totalProfiles ?? 0) - (stats.vacBannedCount ?? 0),
      );
    } catch (_) {
      state.totalToVerify = 0;
    }
    addLog(
      `Vérification VAC démarrée — ${CONCURRENCY} requêtes/s max, nouvelle IP tous les ${IP_ROTATE_EVERY} vérifications.`,
    );
    if (state.totalToVerify > 0)
      addLog(`${state.totalToVerify} profil(s) à vérifier.`);
    if (broadcastFn) broadcastFn(getVacVerifyState());

    const apiKey =
      options.steamApiKey ||
      (await getSetting(undefined, "steam_api_key")) ||
      process.env.STEAM_API_KEY ||
      "";
    const useApi = !!apiKey;
    if (useApi) addLog("Confirmation VAC via API Steam avant mise à jour DB.");
    else
      addLog(
        "Aucune clé API Steam : mise à jour uniquement depuis le scraping (sans confirmation).",
      );

    try {
      while (true) {
        if (ctrl.aborted) break;
        const rows = await getProfilesWithoutVacBan(
          undefined,
          FETCH_BATCH,
          offset,
        );
        if (!rows || rows.length === 0) break;
        offset += rows.length;

        const batchPromises = [];
        for (const row of rows) {
          if (ctrl.aborted) break;
          await pool.acquire();
          if (ctrl.aborted) {
            pool.release();
            break;
          }
          const idx = requestIndex++;
          if (useProxySession && idx > 0 && idx % IP_ROTATE_EVERY === 0) {
            addLog(
              `[Proxy Decodo] Nouvelle session (nouvelle IP) — tous les ${IP_ROTATE_EVERY} vérifications.`,
            );
          }
          const steamid64 = String(row.steamid64);
          const sessionId = useProxySession
            ? `vac-${Math.floor(idx / IP_ROTATE_EVERY)}`
            : undefined;

          const p = (async () => {
            try {
              const result = await getVacBanFromProfilePage(steamid64, {
                delayMs: 0,
                sessionId,
              });
              state.stats.checked++;
              if (state.stats.checked % 500 === 0) {
                addLog(
                  `[${state.stats.checked}] Vérifiés: ${state.stats.checked}, nouveaux VAC: ${state.stats.updated}`,
                );
              }
              if (broadcastFn) broadcastFn(getVacVerifyState());

              if (result && result.vacBanned) {
                let vacBanned = true;
                let vacCount = result.vacCount ?? 1;
                let daysSinceLastBan = result.daysSinceLastBan ?? null;
                let lastBanDate = result.lastBanDate ?? null;

                if (useApi) {
                  try {
                    const apiPlayers = await getPlayerBans(apiKey, [steamid64]);
                    const player =
                      apiPlayers && apiPlayers[0] ? apiPlayers[0] : null;
                    if (player && player.VACBanned) {
                      vacCount = player.NumberOfVACBans ?? vacCount;
                      daysSinceLastBan =
                        player.DaysSinceLastBan ?? daysSinceLastBan;
                      if (daysSinceLastBan != null && daysSinceLastBan >= 0) {
                        lastBanDate = new Date(
                          Date.now() - daysSinceLastBan * 24 * 60 * 60 * 1000,
                        ).toISOString();
                      }
                    } else {
                      vacBanned = false;
                    }
                  } catch (apiErr) {
                    const status = apiErr?.response?.status;
                    const msg =
                      status === 429 || status === 503
                        ? "API Steam rate limit (" + status + ")"
                        : status === 403
                          ? "API Steam forbidden (403)"
                          : status === 401
                            ? "API Steam clé invalide (401)"
                            : status != null
                              ? "API Steam HTTP " + status
                              : apiErr?.code === "ECONNABORTED" ||
                                  apiErr?.code === "ETIMEDOUT"
                                ? "API Steam timeout"
                                : "API Steam indisponible";
                    addLog(steamid64 + " — " + msg + ", mise à jour ignorée.");
                    pool.release();
                    return;
                  }
                }

                if (vacBanned) {
                  await updateProfileVacStatus(undefined, steamid64, {
                    vac_banned: true,
                    vac_count: vacCount,
                    days_since_last_ban: daysSinceLastBan,
                    last_ban_date: lastBanDate,
                  });
                  state.stats.updated++;
                  addLog(
                    "VAC confirmé (API): " +
                      steamid64 +
                      " (vac_count=" +
                      vacCount +
                      ").",
                  );
                }
              }
            } catch (err) {
              state.stats.errors++;
              state.stats.checked++;
              addLog(
                "Erreur profil " +
                  steamid64 +
                  ": " +
                  (err?.message || String(err)),
              );
              if (broadcastFn) broadcastFn(getVacVerifyState());
            } finally {
              pool.release();
            }
          })();
          batchPromises.push(p);
        }

        await Promise.all(batchPromises);
        if (limit > 0 && state.stats.checked >= limit) break;
        if (rows.length < FETCH_BATCH) break;
      }

      state.status = "idle";
      state.endTime = new Date().toISOString();
      addLog(
        "Vérification VAC terminée — " +
          state.stats.checked +
          " vérifiés, " +
          state.stats.updated +
          " nouveau(x) VAC.",
      );
    } catch (err) {
      state.status = "idle";
      state.error = err?.message || String(err);
      state.endTime = new Date().toISOString();
      addLog("Vérification VAC arrêtée (erreur): " + state.error);
    } finally {
      controller = null;
      if (broadcastFn) broadcastFn(getVacVerifyState());
    }
  })();

  return { ok: true, message: "Vérification VAC démarrée." };
}

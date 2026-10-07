import {
  getProfilesWithoutVacBan,
  getSetting,
  updateProfileVacStatus,
} from "../db/queries.js";
import { env } from "../env.js";
import { getVacBanFromProfilePage } from "../scraper/profile-html.js";
import { getPlayerBans } from "../scraper/steam-api.js";

type VacState = {
  status: "idle" | "running" | "stopping";
  checked: number;
  found: number;
  limit: number;
  error: string | null;
  log: { t: string; msg: string }[];
};

let state: VacState = {
  status: "idle",
  checked: 0,
  found: 0,
  limit: 0,
  error: null,
  log: [],
};

let aborted = false;
let broadcastFn: (() => void) | null = null;

function addLog(msg: string) {
  state.log.push({ t: new Date().toISOString(), msg });
  if (state.log.length > 100) state.log = state.log.slice(-100);
  broadcastFn?.();
}

export function getVacVerifyState() {
  return { ...state, log: state.log.slice(-50) };
}

export function setBroadcast(fn: () => void) {
  broadcastFn = fn;
}

export function stopVacVerify() {
  if (state.status !== "running") return false;
  aborted = true;
  state.status = "stopping";
  addLog("VAC verify stopping...");
  return true;
}

export async function startVacVerify(body: {
  limit?: number;
  confirmWithApi?: boolean;
  skipProxy?: boolean;
}) {
  if (state.status === "running") {
    return { ok: false, error: "Already running" };
  }
  const limit = Math.min(Math.max(body.limit ?? 100, 1), 10_000);
  const confirmWithApi = !!body.confirmWithApi;
  const useProxy = !body.skipProxy;
  aborted = false;
  state = {
    status: "running",
    checked: 0,
    found: 0,
    limit,
    error: null,
    log: [],
  };
  addLog(`VAC verify start (limit=${limit})`);
  broadcastFn?.();

  void (async () => {
    try {
      const apiKey =
        (await getSetting("steam_api_key")) || env.STEAM_API_KEY || "";
      let offset = 0;
      while (!aborted && state.checked < limit) {
        const batch = await getProfilesWithoutVacBan(
          Math.min(50, limit - state.checked),
          offset,
        );
        if (!batch.length) break;
        for (const { steamid64 } of batch) {
          if (aborted || state.checked >= limit) break;
          try {
            const vac = await getVacBanFromProfilePage(steamid64, {
              delayMs: 200,
              useProxy,
            });
            state.checked++;
            if (vac?.vacBanned) {
              let ok = true;
              if (confirmWithApi && apiKey) {
                const bans = await getPlayerBans(apiKey, [steamid64]);
                ok = !!bans[0]?.VACBanned;
              }
              if (ok) {
                await updateProfileVacStatus(steamid64, {
                  vac_banned: 1,
                  vac_count: vac.vacCount,
                  days_since_last_ban: vac.daysSinceLastBan ?? null,
                  last_ban_date: vac.lastBanDate ?? null,
                });
                state.found++;
                addLog(`VAC found: ${steamid64} (count=${vac.vacCount})`);
              }
            }
          } catch (e) {
            state.checked++;
            addLog(
              `Error ${steamid64}: ${e instanceof Error ? e.message : e}`,
            );
          }
          broadcastFn?.();
        }
        offset += batch.length;
      }
      state.status = "idle";
      addLog(`Done. checked=${state.checked} found=${state.found}`);
    } catch (e) {
      state.status = "idle";
      state.error = e instanceof Error ? e.message : String(e);
      addLog("Fatal: " + state.error);
    }
    broadcastFn?.();
  })();

  return { ok: true };
}

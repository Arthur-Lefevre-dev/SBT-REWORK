import {
  getProfilesWithoutVacBan,
  getSetting,
  setSetting,
  updateProfileVacStatus,
} from "../db/queries.js";
import { env } from "../env.js";
import { pLimit, sleep } from "../shared/async.js";
import {
  getVacBanFromProfilePage,
  isProfileRateLimitError,
} from "../scraper/profile-html.js";
import { getPlayerBans } from "../scraper/steam-api.js";

const LAST_RUN_KEY = "vac_verify_last_run";
const DAY_MS = 24 * 60 * 60 * 1000;

type VacState = {
  status: "idle" | "running" | "stopping";
  checked: number;
  found: number;
  limit: number;
  concurrency: number;
  error: string | null;
  log: { t: string; msg: string }[];
  autoEnabled: boolean;
  lastAutoRun: string | null;
  nextAutoRun: string | null;
  rateLimitPauses: number;
};

let state: VacState = {
  status: "idle",
  checked: 0,
  found: 0,
  limit: 0,
  concurrency: 2,
  error: null,
  log: [],
  autoEnabled: false,
  lastAutoRun: null,
  nextAutoRun: null,
  rateLimitPauses: 0,
};

let aborted = false;
let broadcastFn: (() => void) | null = null;
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let scheduleStarted = false;

/** Shared cooldown so parallel workers wait after a 429. */
let cooldownUntil = 0;

function addLog(msg: string) {
  state.log.push({ t: new Date().toISOString(), msg });
  if (state.log.length > 100) state.log = state.log.slice(-100);
  console.log("[VAC]", msg);
  broadcastFn?.();
}

function intervalMs() {
  return Math.max(60_000, env.VAC_VERIFY_INTERVAL_MS || DAY_MS);
}

function autoConcurrency() {
  // Default 2 — Steam Community HTML rate-limits aggressively
  return Math.min(Math.max(env.VAC_VERIFY_CONCURRENCY || 2, 1), 8);
}

function autoLimit() {
  const n = env.VAC_VERIFY_LIMIT ?? 0;
  return n === 0 ? 10_000 : Math.min(Math.max(n, 1), 10_000);
}

function delayBetweenMs() {
  return Math.max(0, env.VAC_VERIFY_DELAY_MS ?? 800);
}

async function waitCooldown() {
  while (!aborted) {
    const wait = cooldownUntil - Date.now();
    if (wait <= 0) return;
    await sleep(Math.min(wait, 1000));
  }
}

function triggerCooldown(ms: number, reason: string) {
  const until = Date.now() + ms;
  if (until > cooldownUntil) {
    cooldownUntil = until;
    state.rateLimitPauses += 1;
    addLog(`${reason} — pause ${Math.round(ms / 1000)}s`);
    broadcastFn?.();
  }
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

async function checkOne(
  steamid64: string,
  opts: {
    confirmWithApi: boolean;
    useProxy: boolean;
    apiKey: string;
    delayMs: number;
  },
): Promise<"found" | "clean" | "rate_limit" | "error"> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (aborted) return "error";
    await waitCooldown();
    if (aborted) return "error";
    try {
      const vac = await getVacBanFromProfilePage(steamid64, {
        delayMs: opts.delayMs,
        useProxy: opts.useProxy,
      });
      if (!vac?.vacBanned) return "clean";

      let ok = true;
      if (opts.confirmWithApi && opts.apiKey) {
        const bans = await getPlayerBans(opts.apiKey, [steamid64]);
        ok = !!bans[0]?.VACBanned;
      }
      if (!ok) return "clean";

      await updateProfileVacStatus(steamid64, {
        vac_banned: 1,
        vac_count: vac.vacCount,
        days_since_last_ban: vac.daysSinceLastBan ?? null,
        last_ban_date: vac.lastBanDate ?? null,
      });
      return "found";
    } catch (e) {
      if (isProfileRateLimitError(e)) {
        const backoff = Math.min(180_000, 25_000 * attempt);
        triggerCooldown(backoff, `HTTP 429 on ${steamid64} (try ${attempt})`);
        if (attempt >= maxAttempts) return "rate_limit";
        continue;
      }
      addLog(`Error ${steamid64}: ${e instanceof Error ? e.message : e}`);
      return "error";
    }
  }
  return "rate_limit";
}

export async function startVacVerify(body: {
  limit?: number;
  confirmWithApi?: boolean;
  skipProxy?: boolean;
  concurrency?: number;
  scheduled?: boolean;
}) {
  if (state.status === "running") {
    return { ok: false, error: "Already running" };
  }

  const limit = Math.min(Math.max(body.limit ?? autoLimit(), 1), 10_000);
  let concurrency = Math.min(
    Math.max(body.concurrency ?? autoConcurrency(), 1),
    8,
  );
  const confirmWithApi = body.confirmWithApi !== false;
  const useProxy = !body.skipProxy;
  const delayMs = delayBetweenMs();
  aborted = false;
  cooldownUntil = 0;
  state = {
    ...state,
    status: "running",
    checked: 0,
    found: 0,
    limit,
    concurrency,
    error: null,
    log: [],
    rateLimitPauses: 0,
  };
  addLog(
    `VAC verify start (limit=${limit}, concurrency=${concurrency}, delay=${delayMs}ms${
      body.scheduled ? ", scheduled" : ""
    })`,
  );
  broadcastFn?.();

  void (async () => {
    try {
      const apiKey =
        (await getSetting("steam_api_key")) || env.STEAM_API_KEY || "";
      let afterId = "";
      let consecutiveRateLimited = 0;

      while (!aborted && state.checked < limit) {
        // Smaller batches when rate-limited recently
        const batchSize = Math.min(
          consecutiveRateLimited > 0 ? 8 : 20,
          limit - state.checked,
        );
        const batch = await getProfilesWithoutVacBan(batchSize, 0, afterId);
        if (!batch.length) break;

        const results = await pLimit(
          batch.map(
            ({ steamid64 }) =>
              () =>
                checkOne(steamid64, {
                  confirmWithApi,
                  useProxy,
                  apiKey,
                  delayMs,
                }),
          ),
          concurrency,
        );

        let rateLimitedInBatch = 0;
        let lastOkId = afterId;
        for (let i = 0; i < batch.length; i++) {
          const r = results[i];
          if (r === "rate_limit") {
            rateLimitedInBatch++;
            continue;
          }
          state.checked++;
          lastOkId = batch[i].steamid64;
          if (r === "found") {
            state.found++;
            addLog(`VAC found: ${batch[i].steamid64}`);
          }
        }

        if (rateLimitedInBatch > 0) {
          consecutiveRateLimited++;
          if (concurrency > 1) {
            concurrency = 1;
            state.concurrency = 1;
            addLog("Dropping concurrency to 1 after rate limits");
          }
          if (rateLimitedInBatch === batch.length) {
            triggerCooldown(60_000, "Whole batch rate-limited");
            await waitCooldown();
            // keep afterId — retry same window
          } else {
            // Advance only past successfully handled profiles
            afterId = lastOkId;
            triggerCooldown(30_000, "Partial batch rate-limited");
            await waitCooldown();
          }
        } else {
          consecutiveRateLimited = 0;
          afterId = batch[batch.length - 1].steamid64;
        }

        broadcastFn?.();
      }

      state.status = "idle";
      addLog(
        `Done. checked=${state.checked} found=${state.found} rl_pauses=${state.rateLimitPauses}`,
      );

      if (body.scheduled) {
        const now = new Date().toISOString();
        await setSetting(LAST_RUN_KEY, now);
        state.lastAutoRun = now;
      }
    } catch (e) {
      state.status = "idle";
      state.error = e instanceof Error ? e.message : String(e);
      addLog("Fatal: " + state.error);
    }
    broadcastFn?.();
  })();

  return { ok: true };
}

async function runScheduledPass() {
  if (!env.VAC_VERIFY_AUTO) return;
  if (state.status === "running") {
    addLog("Scheduled VAC verify skipped (already running)");
    scheduleNext(intervalMs());
    return;
  }
  addLog("Scheduled VAC verify (every 24h)…");
  await startVacVerify({
    limit: autoLimit(),
    concurrency: autoConcurrency(),
    confirmWithApi: true,
    scheduled: true,
  });
  scheduleNext(intervalMs());
}

function scheduleNext(delayMs: number) {
  if (scheduleTimer) clearTimeout(scheduleTimer);
  state.nextAutoRun = new Date(Date.now() + delayMs).toISOString();
  scheduleTimer = setTimeout(() => {
    void runScheduledPass();
  }, delayMs);
  broadcastFn?.();
}

/** Start 24h auto recheck of non-VAC profiles (no-op if VAC_VERIFY_AUTO=false). */
export async function startVacVerifyScheduler() {
  if (scheduleStarted) return;
  scheduleStarted = true;

  state.autoEnabled = !!env.VAC_VERIFY_AUTO;
  if (!env.VAC_VERIFY_AUTO) {
    console.log("[VAC] Auto verify disabled (VAC_VERIFY_AUTO≠true)");
    return;
  }

  const last = await getSetting(LAST_RUN_KEY);
  state.lastAutoRun = last;
  const elapsed = last ? Date.now() - new Date(last).getTime() : Infinity;
  const wait = Number.isFinite(elapsed)
    ? Math.max(5_000, intervalMs() - elapsed)
    : 15_000;

  state.nextAutoRun = new Date(Date.now() + wait).toISOString();
  console.log(
    `[VAC] Auto verify every ${Math.round(intervalMs() / 3_600_000)}h — next in ${Math.round(wait / 1000)}s (concurrency=${autoConcurrency()}, delay=${delayBetweenMs()}ms)`,
  );
  scheduleNext(wait);
}

import {
  getExistingSteamIds,
  getResumeHubIds,
  getSetting,
  saveGraph,
} from "../db/queries.js";
import { env } from "../env.js";
import { isDecodoProxyEnabled } from "../scraper/proxy.js";
import { scrape, type ScrapeController } from "../scraper/scrape.js";
import type { BotState } from "../shared/types.js";

const MAX_LOG_LINES = 200;

let state: Omit<BotState, "log"> = {
  status: "idle",
  startTime: null,
  endTime: null,
  error: null,
  stats: {
    profilesCount: 0,
    currentDepth: 0,
    batchCount: 0,
    lastSaveCount: 0,
    pendingSaves: 0,
    rateLimitPauses: 0,
    errors: [],
  },
};

let logLines: { t: string; msg: string }[] = [];
let controller: ScrapeController | null = null;
let broadcastFn: (() => void) | null = null;

export function addLog(msg: string) {
  if (!msg?.trim()) return;
  console.log("[BOT]", msg);
  logLines.push({ t: new Date().toISOString(), msg });
  if (logLines.length > MAX_LOG_LINES) logLines = logLines.slice(-MAX_LOG_LINES);
  broadcastFn?.();
}

export function getBotState(): BotState {
  return {
    ...state,
    stats: { ...state.stats },
    log: logLines.slice(-100),
  };
}

export function setBroadcast(fn: () => void) {
  broadcastFn = fn;
}

function getController(): ScrapeController {
  if (controller) return controller;
  controller = {
    paused: false,
    aborted: false,
    setStats(s) {
      if (!s) return;
      if (s.lastError) {
        state.stats.errors = [
          ...state.stats.errors,
          String(s.lastError),
        ].slice(-20);
      }
      if (s.rateLimitPauses != null) {
        state.stats.rateLimitPauses +=
          typeof s.rateLimitPauses === "number" ? s.rateLimitPauses : 1;
      }
      state.stats = {
        ...state.stats,
        ...Object.fromEntries(
          Object.entries(s).filter(
            ([k]) => !["lastError", "rateLimitPauses"].includes(k),
          ),
        ),
      } as BotState["stats"];
      broadcastFn?.();
    },
  };
  return controller;
}

export function pauseBot() {
  if (!controller) return false;
  controller.paused = true;
  state.status = "paused";
  addLog("Bot paused.");
  broadcastFn?.();
  return true;
}

export function resumeBot() {
  if (!controller) return false;
  controller.paused = false;
  state.status = "running";
  addLog("Bot resumed.");
  broadcastFn?.();
  return true;
}

export function stopBot() {
  if (!controller) return false;
  controller.aborted = true;
  controller.paused = false;
  state.status = "stopping";
  addLog("Bot stopping...");
  broadcastFn?.();
  return true;
}

export async function startBot(opts: {
  steamApiKey?: string;
  startSteamId64?: string;
  maxDepth?: number;
  maxProfiles?: number;
  turbo?: boolean;
}) {
  if (state.status === "running" || state.status === "paused") {
    return { ok: false, error: "Bot already running" };
  }

  const apiKey =
    opts.steamApiKey ||
    (await getSetting("steam_api_key")) ||
    env.STEAM_API_KEY;
  if (!apiKey) return { ok: false, error: "No Steam API key configured" };

  const start =
    opts.startSteamId64 ||
    (await getSetting("start_steamid64")) ||
    "76561198011775992";
  const maxDepthSetting = await getSetting("max_depth");
  const maxProfilesSetting = await getSetting("max_profiles");
  const turboSetting = await getSetting("turbo_mode");
  const maxDepth =
    opts.maxDepth ??
    (maxDepthSetting ? parseInt(maxDepthSetting, 10) : 2);
  const maxProfiles =
    opts.maxProfiles ??
    (maxProfilesSetting ? parseInt(maxProfilesSetting, 10) : 500);
  const turbo =
    opts.turbo ??
    (turboSetting === "1" || turboSetting === "true");

  controller = null;
  const ctrl = getController();
  ctrl.paused = false;
  ctrl.aborted = false;

  state = {
    status: "running",
    startTime: new Date().toISOString(),
    endTime: null,
    error: null,
    stats: {
      profilesCount: 0,
      currentDepth: 0,
      batchCount: 0,
      lastSaveCount: 0,
      pendingSaves: 0,
      rateLimitPauses: 0,
      errors: [],
    },
  };
  logLines = [];
  addLog(
    `Starting scrape from ${start} (depth=${maxDepth}, max=${maxProfiles}${
      turbo ? ", TURBO" : ""
    })${isDecodoProxyEnabled() ? " [proxy]" : ""}`,
  );
  broadcastFn?.();

  void (async () => {
    try {
      const knownIds = await getExistingSteamIds();
      // Keep start in knownIds so we never re-scrape it (resume via friend expand)
      const resumeExpandIds = knownIds.has(String(start))
        ? await getResumeHubIds(String(start), 12)
        : [];
      if (knownIds.has(String(start))) {
        addLog(
          `Start profile already scraped — resuming (${knownIds.size} known, ${resumeExpandIds.length} hubs)`,
        );
      }
      const graph = await scrape(apiKey, start, {
        maxDepth: maxDepth === 0 ? Infinity : maxDepth,
        maxProfiles: maxProfiles === 0 ? Infinity : maxProfiles,
        knownIds,
        resumeExpandIds,
        saveInterval: turbo ? 1200 : 800,
        onSave: (g) => saveGraph(g),
        controller: ctrl,
        onLog: addLog,
        turbo,
      });
      if (!ctrl.aborted) {
        await saveGraph(graph);
        addLog("Scrape finished, final save OK.");
      } else {
        addLog("Scrape aborted.");
      }
      state.status = "idle";
      state.endTime = new Date().toISOString();
    } catch (e) {
      state.status = "idle";
      state.error = e instanceof Error ? e.message : String(e);
      state.endTime = new Date().toISOString();
      addLog("Error: " + state.error);
    }
    broadcastFn?.();
  })();

  return { ok: true };
}

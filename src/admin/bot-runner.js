/**
 * Bot runner: start/pause/resume/stop the scraper from the server.
 * Runs in the same process; state and stats are broadcast via WebSocket to admin clients.
 */

import { scrape } from '../steam-scraper.js';
import { saveGraph, getExistingSteamIds, getSetting } from '../db/index.js';
import { isDecodoProxyEnabled, getCurrentProxyIp, checkAndLogProxyIpChange } from '../proxy.js';

const MAX_LOG_LINES = 200;

let state = {
  status: 'idle', // 'idle' | 'running' | 'paused' | 'stopping'
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

let logLines = [];

export function addLog(msg) {
  if (typeof msg !== 'string') return;
  // Mirror admin console logs to server CLI with basic ANSI colors
  // (only non-empty messages are logged).
  if (msg.trim()) {
    const RESET = '\x1b[0m';
    const CYAN = '\x1b[36m';
    const GREEN = '\x1b[32m';
    const YELLOW = '\x1b[33m';
    const RED = '\x1b[31m';
    const prefix = `${CYAN}[BOT]${RESET}`;
    const lower = msg.toLowerCase();
    let color = GREEN;
    if (lower.includes('erreur') || lower.includes('error') || lower.includes('échouée')) {
      color = RED;
    } else if (lower.includes('rate limit')) {
      color = YELLOW;
    } else if (msg.startsWith('[Proxy Decodo]')) {
      color = CYAN;
    }
    // eslint-disable-next-line no-console
    console.log(prefix, `${color}${msg}${RESET}`);
  }
  logLines.push({ t: new Date().toISOString(), msg });
  if (logLines.length > MAX_LOG_LINES) logLines = logLines.slice(-MAX_LOG_LINES);
  if (broadcastFn) broadcastFn(getBotState());
}

let controller = null;
let runPromise = null;
let broadcastFn = null;

function getController() {
  if (controller) return controller;
  controller = {
    _paused: false,
    _aborted: false,
    get paused() {
      return this._paused;
    },
    set paused(v) {
      this._paused = !!v;
    },
    get aborted() {
      return this._aborted;
    },
    set aborted(v) {
      this._aborted = !!v;
    },
    setStats(s) {
      if (s) {
        if (s.lastError) {
          state.stats.errors = [...(state.stats.errors || []), s.lastError].slice(-20);
          delete s.lastError;
        }
        if (s.rateLimitPauses != null) state.stats.rateLimitPauses = (state.stats.rateLimitPauses || 0) + (typeof s.rateLimitPauses === 'number' ? s.rateLimitPauses : 1);
        state.stats = { ...state.stats, ...s };
        if (broadcastFn) broadcastFn(getBotState());
      }
    },
  };
  return controller;
}

export function getBotState() {
  return {
    status: state.status,
    startTime: state.startTime,
    endTime: state.endTime,
    error: state.error,
    stats: { ...state.stats },
    log: logLines.slice(-100).map((e) => ({ t: e.t, msg: e.msg })),
  };
}

export function setBroadcast(fn) {
  broadcastFn = fn;
}

export function isRunning() {
  return state.status === 'running' || state.status === 'paused';
}

export function pauseBot() {
  if (!controller) return false;
  controller.paused = true;
  state.status = 'paused';
  addLog('Bot mis en pause.');
  if (broadcastFn) broadcastFn(getBotState());
  return true;
}

export function resumeBot() {
  if (!controller) return false;
  controller.paused = false;
  state.status = 'running';
  addLog('Bot repris.');
  if (broadcastFn) broadcastFn(getBotState());
  return true;
}

export function stopBot() {
  if (!controller) return false;
  controller.aborted = true;
  state.status = 'stopping';
  addLog('Arrêt du bot demandé…');
  if (broadcastFn) broadcastFn(getBotState());
  return true;
}

export async function startBot(options = {}) {
  if (isRunning()) {
    return { ok: false, error: 'Le bot est déjà en cours d’exécution.' };
  }

  const apiKey = options.steamApiKey || (await getSetting(undefined, 'steam_api_key')) || process.env.STEAM_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'Clé API Steam manquante (paramètre, settings ou .env).' };
  }

  const startSteamId64 = options.startSteamId64 || (await getSetting(undefined, 'start_steamid64')) || process.env.START_STEAMID64 || '76561198011775992';
  const maxDepth = options.maxDepth != null ? options.maxDepth : parseInt(await getSetting(undefined, 'max_depth'), 10) || 2;
  const maxProfiles = options.maxProfiles != null ? options.maxProfiles : parseInt(await getSetting(undefined, 'max_profiles'), 10) || 500;
  const saveInterval = options.saveInterval != null ? options.saveInterval : 800;

  const ctrl = getController();
  ctrl.paused = false;
  ctrl.aborted = false;
  state.status = 'running';
  state.startTime = new Date().toISOString();
  state.endTime = null;
  state.error = null;
  state.stats = {
    profilesCount: 0,
    currentDepth: 0,
    batchCount: 0,
    lastSaveCount: 0,
    pendingSaves: 0,
    rateLimitPauses: 0,
    errors: [],
  };
  logLines = [];
  addLog('Bot démarré — ' + startSteamId64 + ', maxDepth=' + (maxDepth === 0 ? '∞' : maxDepth) + ', maxProfiles=' + (maxProfiles === 0 ? '∞' : maxProfiles));
  if (broadcastFn) broadcastFn(getBotState());

  let knownIds = new Set();
  try {
    knownIds = await getExistingSteamIds();
    const startId = String(startSteamId64);
    if (knownIds.has(startId)) knownIds.delete(startId);
  } catch (e) {
    state.status = 'idle';
    state.error = e?.message || String(e);
    if (broadcastFn) broadcastFn(getBotState());
    return { ok: false, error: state.error };
  }

  runPromise = (async () => {
    try {
      if (isDecodoProxyEnabled()) {
        addLog('Vérification de la connexion proxy Decodo…');
        const ip = await getCurrentProxyIp();
        if (!ip) {
          state.status = 'idle';
          state.error = 'Proxy Decodo: connexion échouée (407 ou identifiants invalides). Vérifiez DECODO_PROXY_USER / DECODO_PROXY_PASSWORD.';
          addLog(state.error);
          if (broadcastFn) broadcastFn(getBotState());
          return null;
        }
        await checkAndLogProxyIpChange({ onLog: addLog });
        addLog('Proxy Decodo: connexion OK, démarrage du scraping.');
      }
      const graph = await scrape(apiKey, startSteamId64, {
        maxDepth: maxDepth === 0 ? Infinity : maxDepth,
        maxProfiles: maxProfiles === 0 ? Infinity : maxProfiles,
        knownIds,
        parallelBatches: 3,
        saveInterval,
        onSave: saveGraph,
        verbose: true,
        controller: ctrl,
        onLog: addLog,
      });
      const finalCount = graph.getAllNodes?.()?.length ?? Object.keys(graph.profiles ?? {}).length ?? 0;
      state.stats.profilesCount = finalCount;
      state.status = 'idle';
      state.endTime = new Date().toISOString();
      addLog('Bot terminé — ' + finalCount + ' profils.');
      if (broadcastFn) broadcastFn(getBotState());
      return graph;
    } catch (err) {
      state.status = 'idle';
      state.error = err?.message || String(err);
      state.endTime = new Date().toISOString();
      state.stats.errors.push(state.error);
      addLog('Bot arrêté (erreur): ' + state.error);
      if (broadcastFn) broadcastFn(getBotState());
      throw err;
    } finally {
      controller = null;
    }
  })();

  return { ok: true, message: 'Bot démarré.' };
}

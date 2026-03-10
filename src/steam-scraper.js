/**
 * Recursive Steam profile scraper - batched and parallelized
 * Fetches profiles, bans, friends and builds friendship graph.
 * Skips profiles already in knownIds (e.g. from DB).
 */

import {
  getPlayerSummaries,
  getPlayerBans,
  getFriendList,
  steamId64ToSteamId,
  isSteamRateLimitError,
} from "./steam/api.js";
import { getGameBanDaysFromProfile } from "./steam/profile-scrape.js";
import { FriendshipGraph } from "./friendship-graph.js";
import { isDecodoProxyEnabled, checkAndLogProxyIpChange } from "./proxy.js";

// Tuned for speed while respecting Steam/community rate limits
const BATCH_PROFILES = 50; // Steam API accepts up to 100 ids per summaries/bans call
const FRIEND_CONCURRENCY = 18; // Parallel friend-list fetches per batch
const DELAY_MS = 100; // Pause between batch rounds (ms)
const PARALLEL_BATCHES = 3; // Batches processed in parallel per round
const GAME_BAN_SCRAPE_CONCURRENCY = 4; // Parallel HTML scrapes for game ban dates
const GAME_BAN_SCRAPE_DELAY_MS = 80; // Delay between waves of game-ban scrapes

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pLimit(tasks, limit) {
  const executing = [];
  const results = [];
  for (const [i, fn] of tasks.entries()) {
    const p = Promise.resolve()
      .then(fn)
      .then((r) => {
        executing.splice(executing.indexOf(p), 1);
        return r;
      });
    results[i] = p;
    executing.push(p);
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

/**
 * Process a single batch: fetch summaries, bans, friend lists; return data to merge.
 * @param {string} apiKey
 * @param {Array<{ steamId64: string, depth: number }>} batch
 * @returns {Promise<{ profiles: Array, friendsData: Array<{ steamId64, depth, friendIds }> }>}
 */
async function processBatch(apiKey, batch) {
  if (batch.length === 0) {
    return { profiles: [], friendsData: [] };
  }
  const ids = batch.map((b) => b.steamId64);
  const [summaries, bans] = await Promise.all([
    getPlayerSummaries(apiKey, ids),
    getPlayerBans(apiKey, ids),
  ]);
  const summaryMap = new Map(summaries.map((s) => [String(s.steamid), s]));
  const banMap = new Map(bans.map((b) => [String(b.SteamId), b]));

  const friendTasks = batch.map(
    (b) => () => getFriendList(apiKey, b.steamId64),
  );
  const friendsResults = await pLimit(friendTasks, FRIEND_CONCURRENCY);

  const profiles = [];
  const friendsData = [];
  for (let i = 0; i < batch.length; i++) {
    const { steamId64, depth } = batch[i];
    const summary = summaryMap.get(String(steamId64));
    const ban = banMap.get(String(steamId64));
    const daysSinceLastBan = ban?.DaysSinceLastBan ?? null;
    const lastBanDate =
      daysSinceLastBan != null
        ? new Date(
            Date.now() - daysSinceLastBan * 24 * 60 * 60 * 1000,
          ).toISOString()
        : null;
    profiles.push({
      steamId64,
      steamId: steamId64ToSteamId(steamId64),
      personaName: summary?.personaname ?? "Unknown",
      profileUrl: summary?.profileurl ?? null,
      friendsPageUrl: `https://steamcommunity.com/profiles/${steamId64}/friends/`,
      avatar: summary?.avatarmedium ?? null,
      createdAt: summary?.timecreated
        ? new Date(summary.timecreated * 1000).toISOString()
        : null,
      ban: ban
        ? {
            communityBanned: ban.CommunityBanned,
            vacBanned: ban.VACBanned,
            numberOfVACBans: ban.NumberOfVACBans ?? 0,
            daysSinceLastBan,
            lastBanDate,
            numberOfGameBans: ban.NumberOfGameBans ?? 0,
            economyBan: ban.EconomyBan ?? "none",
          }
        : null,
    });
    friendsData.push({
      steamId64,
      depth,
      friendIds: friendsResults[i].map((f) => f.steamid),
    });
  }

  // Scrape profile HTML for Game ban "days since last ban" in parallel (API does not provide it)
  const gameBanProfiles = profiles.filter((p) => p.ban?.numberOfGameBans > 0);
  if (gameBanProfiles.length > 0) {
    const tasks = gameBanProfiles.map((p) => async () => {
      try {
        const extra = await getGameBanDaysFromProfile(p.steamId64, {
          delayMs: 0,
        });
        if (extra) {
          p.ban.gameBanDaysSinceLast = extra.gameBanDaysSinceLast;
          p.ban.gameLastBanDate = extra.gameLastBanDate;
        }
      } catch (_) {
        // ignore
      }
    });
    await pLimit(tasks, GAME_BAN_SCRAPE_CONCURRENCY);
    if (GAME_BAN_SCRAPE_DELAY_MS > 0) await sleep(GAME_BAN_SCRAPE_DELAY_MS);
  }

  return { profiles, friendsData };
}

/**
 * Pop up to batchSize items from queue that are not visited and not in knownIds.
 * Mutates queue and visited.
 */
function popBatch(queue, visited, knownIds, batchSize, maxProfiles, maxDepth) {
  const batch = [];
  while (
    batch.length < batchSize &&
    queue.length > 0 &&
    (maxProfiles === Infinity || visited.size + batch.length < maxProfiles)
  ) {
    const item = queue.shift();
    if (!item) continue;
    const id = String(item.steamId64);
    if (knownIds.has(id)) continue; // Skip already-crawled (e.g. from DB)
    if (visited.has(id)) continue;
    if (item.depth > maxDepth) continue;
    batch.push(item);
    visited.add(id);
  }
  return batch;
}

/**
 * @param {string} apiKey
 * @param {string} startSteamId64
 * @param {Object} options
 * @param {number} options.maxDepth
 * @param {number} options.maxProfiles
 * @param {number} options.batchSize
 * @param {number} options.delayMs
 * @param {number} options.parallelBatches - how many batches to run in parallel
 * @param {Set<string>} options.knownIds - steamid64 already in DB (skip crawling)
 * @param {number} options.saveInterval
 * @param {Function} options.onSave
 * @param {boolean} options.verbose
 * @param {{ paused: boolean, aborted: boolean, setStats: (s: object) => void }} options.controller - optional: pause/abort and live stats for admin panel
 * @param {(msg: string) => void} options.onLog - optional: callback for each log line (e.g. admin console)
 */
export async function scrape(apiKey, startSteamId64, options = {}) {
  const {
    maxDepth = 2,
    maxProfiles = 500,
    batchSize = BATCH_PROFILES,
    delayMs = DELAY_MS,
    parallelBatches = PARALLEL_BATCHES,
    knownIds: knownIdsOption = null,
    saveInterval = 0,
    onSave = null,
    verbose = true,
    controller = null,
    onLog = null,
  } = options;

  const knownIds = knownIdsOption instanceof Set ? knownIdsOption : new Set();
  const graph = new FriendshipGraph();
  const visited = new Set();
  const queue = [{ steamId64: String(startSteamId64), depth: 0 }];
  let lastSaveCount = 0;
  let pendingSavePromise = null;
  let pendingSaveCount = 0; // Number of saves in the chain (waiting or in progress)
  let batchRoundIndex = 0;
  const PROXY_IP_CHECK_EVERY_ROUNDS = 5; // Log proxy IP change every N batch rounds
  const MAX_PENDING_SAVES = 3; // Cap queue to avoid heap growth from long promise chains

  const log = verbose ? (...a) => console.log(...a) : () => {};
  const out = (msg) => {
    log(msg);
    if (onLog && typeof msg === 'string') onLog(msg);
  };

  while (
    queue.length > 0 &&
    (maxProfiles === Infinity || visited.size < maxProfiles)
  ) {
    if (controller?.aborted) break;
    while (controller?.paused) await sleep(1000);
    if (controller?.aborted) break;

    // Pop N batches in parallel (each batch is processed independently)
    const batches = [];
    for (let p = 0; p < parallelBatches; p++) {
      const batch = popBatch(
        queue,
        visited,
        knownIds,
        batchSize,
        maxProfiles,
        maxDepth,
      );
      if (batch.length > 0) batches.push(batch);
    }
    if (batches.length === 0) break;

    const totalInBatches = batches.reduce((s, b) => s + b.length, 0);
    const currentDepth = batches[0]?.[0]?.depth ?? 0;
    controller?.setStats?.({
      profilesCount: visited.size,
      currentDepth,
      batchCount: batchRoundIndex + 1,
      lastSaveCount,
      pendingSaves: pendingSaveCount,
    });
    out(
      `[${visited.size}${maxProfiles === Infinity ? "" : "/" + maxProfiles}] ${batches.length} batch(es) × ${totalInBatches} profiles (depth ${currentDepth})`,
    );

    try {
      const results = await Promise.all(
        batches.map((batch) => processBatch(apiKey, batch)),
      );

      for (const { profiles, friendsData } of results) {
        for (const profile of profiles) {
          graph.addProfile(profile.steamId64, profile);
        }
        for (const { steamId64, depth, friendIds } of friendsData) {
          graph.setFriends(steamId64, friendIds);
          for (const fid of friendIds) graph.addFriendship(steamId64, fid);
          if (depth < maxDepth) {
            for (const fid of friendIds) {
              const id = String(fid);
              if (!visited.has(id) && !knownIds.has(id)) {
                queue.push({ steamId64: id, depth: depth + 1 });
              }
            }
          }
        }
      }

      batchRoundIndex += 1;
      if (
        isDecodoProxyEnabled() &&
        batchRoundIndex % PROXY_IP_CHECK_EVERY_ROUNDS === 0
      ) {
        await checkAndLogProxyIpChange({ onLog });
      }

      while (
        saveInterval > 0 &&
        onSave &&
        visited.size >= lastSaveCount + saveInterval
      ) {
        // Throttle: don't queue more saves than MAX_PENDING_SAVES to limit memory from promise chain
        while (pendingSaveCount >= MAX_PENDING_SAVES) {
          await sleep(2000);
        }
        lastSaveCount += saveInterval;
        const count = visited.size;
        pendingSaveCount += 1;
        const queueLabel =
          pendingSaveCount > 1 ? ` (file: ${pendingSaveCount} en attente)` : "";
        out(
          `  → Sauvegarde DB (${count} profils) en arrière-plan${queueLabel}`,
        );
        const doSave = () =>
          onSave(graph)
            .then(() => {
              pendingSaveCount -= 1;
              out(
                `  → Sauvegarde DB OK (${count} profils) — file: ${pendingSaveCount} en attente`,
              );
            })
            .catch((err) => {
              pendingSaveCount -= 1;
              out(
                `  → Sauvegarde DB échouée: ${err?.message || err} — file: ${pendingSaveCount} en attente`,
              );
            });
        pendingSavePromise = pendingSavePromise
          ? pendingSavePromise.then(
              () => doSave(),
              () => doSave(),
            )
          : doSave();
      }

      await sleep(delayMs);
    } catch (err) {
      controller?.setStats?.({ lastError: err?.message || String(err) });
      const rateLimited = isSteamRateLimitError(err);
      if (rateLimited) {
        controller?.setStats?.({ rateLimitPauses: 1 });
        const pauseMs = 90000; // 90s pause then retry batch
        out(`  → Rate limit Steam API, pause ${pauseMs / 1000}s puis retry...`);
        await sleep(pauseMs);
        for (const batch of batches) {
          for (const { steamId64, depth } of batch) {
            visited.delete(steamId64);
            queue.unshift({ steamId64, depth });
          }
        }
      } else {
        out("Error batch: " + err.message);
        for (const batch of batches) {
          for (const { steamId64 } of batch) visited.delete(steamId64);
        }
      }
    }
  }

  if (pendingSavePromise) {
    await pendingSavePromise.catch((err) => {
      out(`  → Sauvegarde DB (finale) échouée: ${err?.message || err}`);
    });
  }
  return graph;
}

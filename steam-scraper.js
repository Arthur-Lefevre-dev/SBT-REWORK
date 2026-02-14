/**
 * Recursive Steam profile scraper - batched for speed
 * Fetches profiles, bans, friends and builds friendship graph
 */

import {
  getPlayerSummaries,
  getPlayerBans,
  getFriendList,
  steamId64ToSteamId
} from './steam-api.js';
import { FriendshipGraph } from './friendship-graph.js';

const BATCH_PROFILES = 15; // Profiles per batch (summaries + bans in 1 call each)
const FRIEND_CONCURRENCY = 8; // Parallel GetFriendList calls
const DELAY_MS = 250; // Delay between batches (reduced from 1000ms)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run async tasks with concurrency limit
 */
async function pLimit(tasks, limit) {
  const executing = [];
  const results = [];
  for (const [i, fn] of tasks.entries()) {
    const p = Promise.resolve().then(fn).then((r) => {
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
 * @param {string} apiKey
 * @param {string} startSteamId64
 * @param {Object} options
 * @param {number} options.maxDepth - Max recursion depth (default 2)
 * @param {number} options.maxProfiles - Max total profiles to fetch (default 500)
 * @param {number} options.batchSize - Profiles per batch (default 15)
 * @param {number} options.delayMs - Delay between batches in ms (default 250)
 * @param {boolean} options.verbose
 */
export async function scrape(apiKey, startSteamId64, options = {}) {
  const {
    maxDepth = 2,
    maxProfiles = 500,
    batchSize = BATCH_PROFILES,
    delayMs = DELAY_MS,
    verbose = true
  } = options;

  const graph = new FriendshipGraph();
  const visited = new Set();
  const queue = [{ steamId64: String(startSteamId64), depth: 0 }];

  const log = verbose ? (...a) => console.log(...a) : () => {};

  while (queue.length > 0 && (maxProfiles === Infinity || visited.size < maxProfiles)) {
    // Take a batch of profiles from queue
    const batch = [];
    while (batch.length < batchSize && queue.length > 0 && (maxProfiles === Infinity || visited.size + batch.length <= maxProfiles)) {
      const item = queue.shift();
      if (item && !visited.has(item.steamId64) && item.depth <= maxDepth) {
        batch.push(item);
      }
    }
    if (batch.length === 0) break;

    const ids = batch.map((b) => b.steamId64);
    for (const id of ids) visited.add(id);

    log(`[${visited.size}${maxProfiles === Infinity ? '' : '/' + maxProfiles}] Batch ${batch.length} @ depth ${batch[0].depth}`);

    try {
      // 1. Fetch summaries + bans for entire batch (2 API calls total)
      const [summaries, bans] = await Promise.all([
        getPlayerSummaries(apiKey, ids),
        getPlayerBans(apiKey, ids)
      ]);

      const summaryMap = new Map(summaries.map((s) => [String(s.steamid), s]));
      const banMap = new Map(bans.map((b) => [String(b.SteamId), b]));

      // 2. Fetch friend lists in parallel (with concurrency limit)
      const friendTasks = batch.map((b) => () => getFriendList(apiKey, b.steamId64));
      const friendsResults = await pLimit(friendTasks, FRIEND_CONCURRENCY);

      // 3. Build profiles and enqueue new friends
      for (let i = 0; i < batch.length; i++) {
        const { steamId64, depth } = batch[i];
        const summary = summaryMap.get(String(steamId64));
        const ban = banMap.get(String(steamId64));

        const daysSinceLastBan = ban?.DaysSinceLastBan ?? null;
        const lastBanDate = daysSinceLastBan != null
          ? new Date(Date.now() - daysSinceLastBan * 24 * 60 * 60 * 1000).toISOString()
          : null;

        const profile = {
          steamId64,
          steamId: steamId64ToSteamId(steamId64),
          personaName: summary?.personaname ?? 'Unknown',
          profileUrl: summary?.profileurl ?? null,
          friendsPageUrl: `https://steamcommunity.com/profiles/${steamId64}/friends/`,
          avatar: summary?.avatarmedium ?? null,
          createdAt: summary?.timecreated ? new Date(summary.timecreated * 1000).toISOString() : null,
          ban: ban ? {
            communityBanned: ban.CommunityBanned,
            vacBanned: ban.VACBanned,
            numberOfVACBans: ban.NumberOfVACBans ?? 0,
            daysSinceLastBan,
            lastBanDate,
            numberOfGameBans: ban.NumberOfGameBans ?? 0,
            economyBan: ban.EconomyBan ?? 'none'
          } : null
        };

        graph.addProfile(steamId64, profile);

        const friendIds = friendsResults[i].map((f) => f.steamid);
        graph.setFriends(steamId64, friendIds);
        for (const fid of friendIds) graph.addFriendship(steamId64, fid);

        if (depth < maxDepth) {
          for (const fid of friendIds) {
            if (!visited.has(fid)) {
              queue.push({ steamId64: fid, depth: depth + 1 });
            }
          }
        }
      }

      await sleep(delayMs);
    } catch (err) {
      log(`Error batch:`, err.message);
      for (const { steamId64 } of batch) visited.delete(steamId64);
    }
  }

  return graph;
}

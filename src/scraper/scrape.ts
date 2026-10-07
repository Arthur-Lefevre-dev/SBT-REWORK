import { pLimit, sleep } from "../shared/async.js";
import type { ScrapedProfile } from "../shared/types.js";
import { FriendshipGraph } from "./graph.js";
import { checkAndLogProxyIpChange, isDecodoProxyEnabled } from "./proxy.js";
import {
  getBansFromProfilePage,
  getGameBanDaysFromProfile,
  setProfileHtmlLogger,
} from "./profile-html.js";
import {
  getFriendList,
  getPlayerBans,
  getPlayerSummaries,
  isSteamRateLimitError,
  setSteamApiLogger,
  steamId64ToSteamId,
} from "./steam-api.js";

const BATCH_PROFILES = 50;
/** Friend fetches are serialized by the Steam API throttle; keep modest. */
const FRIEND_CONCURRENCY = 6;
const DELAY_MS = 150;
const PARALLEL_BATCHES = 2;
const GAME_BAN_SCRAPE_CONCURRENCY = 2;

/** Turbo: skip GetPlayerBans — ban status from Steam Community HTML only. */
const TURBO = {
  batchSize: 40,
  friendConcurrency: 6,
  delayMs: 80,
  parallelBatches: 2,
  /** Low concurrency without proxy — Steam Community 429s hard. */
  htmlConcurrency: 2,
  htmlDelayMs: 500,
} as const;

type BatchLog = ((msg: string) => void) | null;

async function processBatch(
  apiKey: string,
  batch: { steamId64: string; depth: number }[],
  opts: {
    turbo?: boolean;
    friendConcurrency?: number;
    onLog?: BatchLog;
    batchLabel?: string;
  } = {},
) {
  if (!batch.length) return { profiles: [] as ScrapedProfile[], friendsData: [] as { steamId64: string; depth: number; friendIds: string[] }[] };

  const turbo = !!opts.turbo;
  const friendConcurrency = opts.friendConcurrency ?? FRIEND_CONCURRENCY;
  const log = opts.onLog ?? (() => {});
  const label = opts.batchLabel ?? "batch";
  const ids = batch.map((b) => b.steamId64);

  log(`  → ${label}: summaries (${ids.length})…`);
  const summaries = await getPlayerSummaries(apiKey, ids);
  const bans = turbo ? [] : await getPlayerBans(apiKey, ids);
  if (!turbo) log(`  → ${label}: bans OK (${bans.length})`);
  const summaryMap = new Map(summaries.map((s) => [String(s.steamid), s]));
  const banMap = new Map(bans.map((b) => [String(b.SteamId), b]));

  let friendsDone = 0;
  const friendsResults = await pLimit(
    batch.map((b) => async () => {
      const friends = await getFriendList(apiKey, b.steamId64);
      friendsDone += 1;
      if (friendsDone === 1 || friendsDone === batch.length || friendsDone % 10 === 0) {
        log(`  → ${label}: friends ${friendsDone}/${batch.length}`);
      }
      return friends;
    }),
    friendConcurrency,
  );

  const profiles: ScrapedProfile[] = [];
  const friendsData: { steamId64: string; depth: number; friendIds: string[] }[] =
    [];

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

  if (turbo) {
    log(`  → ${label}: HTML bans (${profiles.length}, concurrency ${TURBO.htmlConcurrency})…`);
    let htmlDone = 0;
    let htmlOk = 0;
    await pLimit(
      profiles.map((p) => async () => {
        try {
          const { vac, game } = await getBansFromProfilePage(p.steamId64, {
            delayMs: TURBO.htmlDelayMs,
          });
          p.ban = {
            communityBanned: false,
            vacBanned: !!vac?.vacBanned,
            numberOfVACBans: vac?.vacCount ?? 0,
            daysSinceLastBan:
              vac?.daysSinceLastBan != null ? vac.daysSinceLastBan : null,
            lastBanDate: vac?.lastBanDate ?? null,
            numberOfGameBans: game ? 1 : 0,
            economyBan: "none",
            gameBanDaysSinceLast: game?.gameBanDaysSinceLast ?? null,
            gameLastBanDate: game?.gameLastBanDate ?? null,
          };
          htmlOk += 1;
        } catch {
          /* leave ban null — VAC recheck can retry later */
        } finally {
          htmlDone += 1;
          if (htmlDone === 1 || htmlDone === profiles.length || htmlDone % 5 === 0) {
            log(`  → ${label}: HTML ${htmlDone}/${profiles.length} (ok ${htmlOk})`);
          }
        }
      }),
      TURBO.htmlConcurrency,
    );
  } else {
    const gameBanProfiles = profiles.filter(
      (p) => (p.ban?.numberOfGameBans ?? 0) > 0,
    );
    if (gameBanProfiles.length) {
      log(`  → ${label}: game-ban HTML (${gameBanProfiles.length})…`);
      await pLimit(
        gameBanProfiles.map((p) => async () => {
          try {
            const extra = await getGameBanDaysFromProfile(p.steamId64, {
              delayMs: 400,
            });
            if (extra && p.ban) {
              p.ban.gameBanDaysSinceLast = extra.gameBanDaysSinceLast;
              p.ban.gameLastBanDate = extra.gameLastBanDate;
            }
          } catch {
            /* ignore */
          }
        }),
        GAME_BAN_SCRAPE_CONCURRENCY,
      );
    }
  }

  log(`  → ${label}: done`);
  return { profiles, friendsData };
}

function popBatch(
  queue: { steamId64: string; depth: number }[],
  visited: Set<string>,
  knownIds: Set<string>,
  batchSize: number,
  maxProfiles: number,
  maxDepth: number,
) {
  const batch: { steamId64: string; depth: number }[] = [];
  while (
    batch.length < batchSize &&
    queue.length > 0 &&
    (maxProfiles === Infinity || visited.size + batch.length < maxProfiles)
  ) {
    const item = queue.shift();
    if (!item) continue;
    const id = String(item.steamId64);
    if (knownIds.has(id) || visited.has(id) || item.depth > maxDepth) continue;
    batch.push(item);
    visited.add(id);
  }
  return batch;
}

export type ScrapeController = {
  paused: boolean;
  aborted: boolean;
  setStats?: (s: Record<string, unknown>) => void;
};

export type ScrapeOptions = {
  maxDepth?: number;
  maxProfiles?: number;
  batchSize?: number;
  delayMs?: number;
  parallelBatches?: number;
  knownIds?: Set<string> | null;
  /** Extra known profile IDs to expand (friend-list only) when resuming. */
  resumeExpandIds?: string[] | null;
  saveInterval?: number;
  onSave?: (graph: FriendshipGraph) => Promise<void>;
  verbose?: boolean;
  controller?: ScrapeController | null;
  onLog?: ((msg: string) => void) | null;
  /**
   * Faster crawl: skip GetPlayerBans (Steam API).
   * VAC / game bans come from Steam Community HTML instead.
   */
  turbo?: boolean;
};

/** Expand a known profile via GetFriendList only (no summaries/bans re-fetch). */
async function expandKnownProfile(
  apiKey: string,
  steamId64: string,
  knownIds: Set<string>,
  visited: Set<string>,
  depth: number,
): Promise<{ steamId64: string; depth: number }[]> {
  const friends = await getFriendList(apiKey, steamId64);
  const next: { steamId64: string; depth: number }[] = [];
  for (const f of friends) {
    const id = String(f.steamid);
    if (!knownIds.has(id) && !visited.has(id)) {
      next.push({ steamId64: id, depth });
    }
  }
  return next;
}

export async function scrape(
  apiKey: string,
  startSteamId64: string,
  options: ScrapeOptions = {},
) {
  const turbo = !!options.turbo;
  // Without proxy, one batch at a time avoids Steam Community 429 storms
  const defaultParallel =
    turbo && !isDecodoProxyEnabled()
      ? 1
      : turbo
        ? TURBO.parallelBatches
        : PARALLEL_BATCHES;
  const {
    maxDepth = 2,
    maxProfiles = 500,
    batchSize = turbo ? TURBO.batchSize : BATCH_PROFILES,
    delayMs = turbo ? TURBO.delayMs : DELAY_MS,
    parallelBatches = defaultParallel,
    knownIds: knownIdsOption = null,
    saveInterval = 0,
    onSave = null,
    verbose = true,
    controller = null,
    onLog = null,
    resumeExpandIds = null,
  } = options;
  const friendConcurrency = turbo
    ? TURBO.friendConcurrency
    : FRIEND_CONCURRENCY;

  const knownIds: Set<string> =
    knownIdsOption instanceof Set ? knownIdsOption : new Set<string>();
  const graph = new FriendshipGraph();
  const visited = new Set<string>();
  const start = String(startSteamId64);
  const queue: { steamId64: string; depth: number }[] = [];
  let lastSaveCount = 0;
  let pendingSavePromise: Promise<void> | null = null;
  let pendingSaveCount = 0;
  let batchRoundIndex = 0;
  const MAX_PENDING_SAVES = 3;

  const log = verbose ? (...a: unknown[]) => console.log(...a) : () => {};
  const out = (msg: string) => {
    log(msg);
    onLog?.(msg);
  };

  setSteamApiLogger(out);
  setProfileHtmlLogger(out);

  try {
    if (turbo) {
      out(
        "TURBO mode: no GetPlayerBans — VAC/game bans from profile HTML only",
      );
      if (!isDecodoProxyEnabled()) {
        out(
          "TURBO tip: no Decodo proxy — HTML is slower (rate-limits). Expect progress logs every few profiles.",
        );
      }
    }

    // Resume: never re-scrape profiles already in DB (avoids rate-limits / IP blocks)
    if (knownIds.has(start)) {
      out(
        `Resume: ${start} already in DB — skipping re-scrape, expanding friends…`,
      );
      try {
        const fromStart = await expandKnownProfile(
          apiKey,
          start,
          knownIds,
          visited,
          1,
        );
        queue.push(...fromStart);
        out(`  → ${fromStart.length} new friend(s) from start profile`);
      } catch (err) {
        out(
          `  → Friend expand failed for start: ${err instanceof Error ? err.message : err}`,
        );
      }

      // If start's friends are all known, expand a few other known hubs
      const hubs = (resumeExpandIds ?? [])
        .map(String)
        .filter((id) => id !== start && knownIds.has(id))
        .slice(0, 12);
      for (const hub of hubs) {
        if (controller?.aborted) break;
        if (queue.length >= batchSize) break;
        try {
          const more = await expandKnownProfile(
            apiKey,
            hub,
            knownIds,
            visited,
            1,
          );
          if (more.length) {
            queue.push(...more);
            out(`  → +${more.length} new from hub ${hub}`);
          }
          await sleep(delayMs);
        } catch {
          /* skip hub */
        }
      }

      if (!queue.length) {
        out("Resume: no unknown friends to crawl. Done.");
        return graph;
      }
    } else {
      queue.push({ steamId64: start, depth: 0 });
    }

    while (
      queue.length > 0 &&
      (maxProfiles === Infinity || visited.size < maxProfiles)
    ) {
      if (controller?.aborted) break;
      while (controller?.paused) await sleep(1000);
      if (controller?.aborted) break;

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
        if (batch.length) batches.push(batch);
      }
      if (!batches.length) break;

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
          batches.map((batch, i) =>
            processBatch(apiKey, batch, {
              turbo,
              friendConcurrency,
              onLog: out,
              batchLabel: `B${batchRoundIndex + 1}.${i + 1}`,
            }),
          ),
        );

        for (const { profiles, friendsData } of results) {
          for (const profile of profiles)
            graph.addProfile(profile.steamId64, profile);
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
        if (isDecodoProxyEnabled() && batchRoundIndex % 5 === 0) {
          await checkAndLogProxyIpChange({ onLog: onLog ?? undefined });
        }

        while (
          saveInterval > 0 &&
          onSave &&
          visited.size >= lastSaveCount + saveInterval
        ) {
          while (pendingSaveCount >= MAX_PENDING_SAVES) await sleep(2000);
          lastSaveCount += saveInterval;
          const count = visited.size;
          pendingSaveCount += 1;
          out(`  → DB save (${count} profiles) background`);
          const doSave = () =>
            onSave(graph)
              .then(() => {
                pendingSaveCount -= 1;
                out(`  → DB save OK (${count})`);
              })
              .catch((err: Error) => {
                pendingSaveCount -= 1;
                out(`  → DB save failed: ${err?.message || err}`);
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
        const message = err instanceof Error ? err.message : String(err);
        controller?.setStats?.({ lastError: message });
        if (isSteamRateLimitError(err)) {
          controller?.setStats?.({ rateLimitPauses: 1 });
          out("  → Steam rate limit, pause 90s then retry...");
          await sleep(90_000);
          for (const batch of batches) {
            for (const { steamId64, depth } of batch) {
              visited.delete(steamId64);
              queue.unshift({ steamId64, depth });
            }
          }
        } else {
          out("Batch error: " + message);
          for (const batch of batches) {
            for (const { steamId64 } of batch) visited.delete(steamId64);
          }
        }
      }
    }

    if (pendingSavePromise) {
      await pendingSavePromise.catch((err: Error) => {
        out(`  → Final DB save failed: ${err?.message || err}`);
      });
    }
    return graph;
  } finally {
    setSteamApiLogger(null);
    setProfileHtmlLogger(null);
  }
}

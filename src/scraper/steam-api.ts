import { env } from "../env.js";
import { sleep } from "../shared/async.js";
import { cacheGet, cacheSet, cacheStats } from "./steam-cache.js";

const BASE_URL = "https://api.steampowered.com";
const BACKOFF_MS = [20_000, 60_000, 120_000];
const MAX_RETRIES = 3;
/** Steam GetPlayerSummaries / GetPlayerBans max IDs per request */
const BATCH_MAX = 100;

/**
 * Steam Web API limits (Valve ToS + community observations):
 * - Soft quota: 100,000 calls / API key / day
 * - Burst: undocumented; aggressive concurrency → HTTP 429 (often Retry-After 60–120s)
 * - GetPlayerSummaries / GetPlayerBans: max 100 steamids per call
 *
 * We stay conservative: ~2.5 req/s default, single-flight queue, TTL cache.
 */
function minIntervalMs() {
  return Math.max(100, env.STEAM_API_MIN_INTERVAL_MS ?? 400);
}

function ttlSummariesMs() {
  return Math.max(60_000, env.STEAM_CACHE_TTL_SUMMARIES_MS ?? 6 * 3600_000);
}
function ttlBansMs() {
  return Math.max(60_000, env.STEAM_CACHE_TTL_BANS_MS ?? 3600_000);
}
function ttlFriendsMs() {
  return Math.max(60_000, env.STEAM_CACHE_TTL_FRIENDS_MS ?? 3600_000);
}
function ttlVanityMs() {
  return Math.max(60_000, env.STEAM_CACHE_TTL_VANITY_MS ?? 24 * 3600_000);
}

export class SteamRateLimitError extends Error {
  status: number;
  constructor(status: number) {
    super(`Steam rate limit ${status}`);
    this.status = status;
  }
}

export function isSteamRateLimitError(err: unknown): boolean {
  if (err instanceof SteamRateLimitError) return true;
  const status = (err as { status?: number })?.status;
  return status === 429 || status === 503;
}

/** Global queue: at most one in-flight request, spaced by minIntervalMs. */
let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
let cooldownUntil = 0;
let apiLogger: ((msg: string) => void) | null = null;

export function setSteamApiLogger(fn: ((msg: string) => void) | null) {
  apiLogger = fn;
}

function logApi(msg: string) {
  console.warn(msg);
  apiLogger?.(msg);
}

function enqueueSteam<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const now = Date.now();
    const waitCool = Math.max(0, cooldownUntil - now);
    const waitGap = Math.max(0, minIntervalMs() - (now - lastRequestAt));
    const wait = Math.max(waitCool, waitGap);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function setCooldown(ms: number) {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + ms);
}

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

async function steamGetRaw(
  url: string,
  params: Record<string, string>,
): Promise<unknown> {
  // Entire retry loop stays inside ONE queue slot — never re-enqueue (avoids deadlock)
  return enqueueSteam(async () => {
    for (let retryIndex = 0; retryIndex <= MAX_RETRIES; retryIndex++) {
      const now = Date.now();
      const waitCool = Math.max(0, cooldownUntil - now);
      if (waitCool > 0) await sleep(waitCool);

      const qs = new URLSearchParams(params);
      const res = await fetch(`${url}?${qs}`, {
        signal: AbortSignal.timeout(30_000),
      });
      lastRequestAt = Date.now();

      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : (BACKOFF_MS[retryIndex] ?? 120_000);
        setCooldown(waitMs);
        if (retryIndex < MAX_RETRIES) {
          logApi(
            `[Steam API] ${res.status} — pause ${Math.round(waitMs / 1000)}s (${retryIndex + 1}/${MAX_RETRIES}) cache=${JSON.stringify(cacheStats())}`,
          );
          await sleep(waitMs);
          continue;
        }
        throw new SteamRateLimitError(res.status);
      }

      if (!res.ok) {
        const err = new Error(`Steam API HTTP ${res.status}`) as Error & {
          status: number;
        };
        err.status = res.status;
        throw err;
      }
      return res.json();
    }
    throw new SteamRateLimitError(429);
  });
}

export function steamId64ToSteamId(steamId64: string | bigint): string {
  const id = BigInt(steamId64);
  const base = 76561197960265728n;
  const accountId = id - base;
  const Y = Number(accountId % 2n);
  const Z = Number(accountId / 2n);
  return `STEAM_1:${Y}:${Z}`;
}

export type PlayerSummary = {
  steamid: string;
  personaname?: string;
  profileurl?: string;
  avatarmedium?: string;
  timecreated?: number;
};

export type PlayerBan = {
  SteamId: string;
  CommunityBanned: boolean;
  VACBanned: boolean;
  NumberOfVACBans: number;
  DaysSinceLastBan: number;
  NumberOfGameBans: number;
  EconomyBan: string;
};

export async function getPlayerSummaries(apiKey: string, steamIds: string[]) {
  const unique = [...new Set(steamIds.map(String).filter(Boolean))];
  const out: PlayerSummary[] = [];
  const missing: string[] = [];

  for (const id of unique) {
    const hit = cacheGet<PlayerSummary>(`sum:${id}`);
    if (hit) out.push(hit);
    else missing.push(id);
  }

  for (const chunk of chunkIds(missing, BATCH_MAX)) {
    const data = (await steamGetRaw(
      `${BASE_URL}/ISteamUser/GetPlayerSummaries/v2/`,
      { key: apiKey, steamids: chunk.join(",") },
    )) as { response?: { players?: PlayerSummary[] } };
    const players = data.response?.players ?? [];
    const ttl = ttlSummariesMs();
    for (const p of players) {
      cacheSet(`sum:${p.steamid}`, p, ttl);
      out.push(p);
    }
  }
  return out;
}

export async function getPlayerBans(apiKey: string, steamIds: string[]) {
  const unique = [...new Set(steamIds.map(String).filter(Boolean))];
  const out: PlayerBan[] = [];
  const missing: string[] = [];

  for (const id of unique) {
    const hit = cacheGet<PlayerBan>(`ban:${id}`);
    if (hit) out.push(hit);
    else missing.push(id);
  }

  for (const chunk of chunkIds(missing, BATCH_MAX)) {
    const data = (await steamGetRaw(
      `${BASE_URL}/ISteamUser/GetPlayerBans/v1/`,
      { key: apiKey, steamids: chunk.join(",") },
    )) as { players?: PlayerBan[] };
    const players = data.players ?? [];
    const ttl = ttlBansMs();
    for (const p of players) {
      cacheSet(`ban:${p.SteamId}`, p, ttl);
      out.push(p);
    }
  }
  return out;
}

export async function resolveVanityUrl(
  apiKey: string,
  vanityUrl: string,
): Promise<string | null> {
  const vanity = vanityUrl.trim().toLowerCase();
  if (!vanity) return null;
  const cached = cacheGet<string | null>(`vanity:${vanity}`);
  if (cached !== undefined) return cached;

  try {
    const data = (await steamGetRaw(
      `${BASE_URL}/ISteamUser/ResolveVanityURL/v1/`,
      { key: apiKey, vanityurl: vanity },
    )) as { response?: { steamid?: string; success?: number } };
    const id =
      data.response?.success === 1 ? data.response.steamid ?? null : null;
    cacheSet(`vanity:${vanity}`, id, ttlVanityMs());
    return id;
  } catch {
    return null;
  }
}

export async function getFriendList(apiKey: string, steamId64: string) {
  const id = String(steamId64);
  const cached = cacheGet<{ steamid: string }[]>(`friends:${id}`);
  if (cached) return cached;

  try {
    const data = (await steamGetRaw(
      `${BASE_URL}/ISteamUser/GetFriendList/v1/`,
      {
        key: apiKey,
        steamid: id,
        relationship: "friend",
      },
    )) as { friendslist?: { friends?: { steamid: string }[] } | null };
    if (data?.friendslist === null) {
      cacheSet(`friends:${id}`, [], ttlFriendsMs());
      return [];
    }
    const friends = data?.friendslist?.friends ?? [];
    cacheSet(`friends:${id}`, friends, ttlFriendsMs());
    return friends;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 401) {
      cacheSet(`friends:${id}`, [], ttlFriendsMs());
      return [];
    }
    throw err;
  }
}

export function getSteamApiCacheStats() {
  return cacheStats();
}

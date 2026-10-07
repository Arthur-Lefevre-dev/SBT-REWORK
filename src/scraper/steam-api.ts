const BASE_URL = "https://api.steampowered.com";
const BACKOFF_MS = [15_000, 45_000, 90_000];
const MAX_RETRIES = 3;

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

async function steamGet(
  url: string,
  params: Record<string, string>,
  retryIndex = 0,
): Promise<unknown> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${url}?${qs}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if ((res.status === 429 || res.status === 503) && retryIndex < MAX_RETRIES) {
    const waitMs = BACKOFF_MS[retryIndex] ?? 90_000;
    console.warn(
      `[Steam API] Rate limit (${res.status}), retry in ${waitMs / 1000}s (${retryIndex + 1}/${MAX_RETRIES})`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
    return steamGet(url, params, retryIndex + 1);
  }
  if (res.status === 429 || res.status === 503) {
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

export function steamId64ToSteamId(steamId64: string | bigint): string {
  const id = BigInt(steamId64);
  const base = 76561197960265728n;
  const accountId = id - base;
  const Y = Number(accountId % 2n);
  const Z = Number(accountId / 2n);
  return `STEAM_1:${Y}:${Z}`;
}

export async function getPlayerSummaries(apiKey: string, steamIds: string[]) {
  const data = (await steamGet(`${BASE_URL}/ISteamUser/GetPlayerSummaries/v2/`, {
    key: apiKey,
    steamids: steamIds.join(","),
  })) as { response?: { players?: unknown[] } };
  return (data.response?.players ?? []) as Array<{
    steamid: string;
    personaname?: string;
    profileurl?: string;
    avatarmedium?: string;
    timecreated?: number;
  }>;
}

export async function getPlayerBans(apiKey: string, steamIds: string[]) {
  const data = (await steamGet(`${BASE_URL}/ISteamUser/GetPlayerBans/v1/`, {
    key: apiKey,
    steamids: steamIds.join(","),
  })) as { players?: unknown[] };
  return (data.players ?? []) as Array<{
    SteamId: string;
    CommunityBanned: boolean;
    VACBanned: boolean;
    NumberOfVACBans: number;
    DaysSinceLastBan: number;
    NumberOfGameBans: number;
    EconomyBan: string;
  }>;
}

export async function resolveVanityUrl(
  apiKey: string,
  vanityUrl: string,
): Promise<string | null> {
  const vanity = vanityUrl.trim();
  if (!vanity) return null;
  try {
    const data = (await steamGet(`${BASE_URL}/ISteamUser/ResolveVanityURL/v1/`, {
      key: apiKey,
      vanityurl: vanity,
    })) as { response?: { steamid?: string; success?: number } };
    return data.response?.success === 1 ? data.response.steamid ?? null : null;
  } catch {
    return null;
  }
}

export async function getFriendList(apiKey: string, steamId64: string) {
  try {
    const data = (await steamGet(`${BASE_URL}/ISteamUser/GetFriendList/v1/`, {
      key: apiKey,
      steamid: steamId64,
      relationship: "friend",
    })) as { friendslist?: { friends?: { steamid: string }[] } | null };
    if (data?.friendslist === null) return [];
    return data?.friendslist?.friends ?? [];
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 401) return [];
    throw err;
  }
}

/**
 * Steam Web API client - profile, bans, friends
 * Requires STEAM_API_KEY from https://steamcommunity.com/dev/apikey
 * Handles rate limits (429/503) with retry and exponential backoff.
 * Note: Steam Web API is not routed via Decodo proxy (Steam often returns 403 for proxy IPs).
 */

import axios from 'axios';

const BASE_URL = 'https://api.steampowered.com';

const RATE_LIMIT_BACKOFF_MS = [15000, 45000, 90000]; // 15s, 45s, 90s
const MAX_RETRIES = 3;

function isRateLimitError(err) {
  const status = err.response?.status;
  return status === 429 || status === 503;
}

/** For use by scraper: detect rate limit so it can pause before retrying. */
export function isSteamRateLimitError(err) {
  return isRateLimitError(err);
}

/**
 * GET with retry on rate limit (429/503/403). Logs and waits before retry.
 */
async function steamGet(url, params, retryIndex = 0) {
  try {
    const { data } = await axios.get(url, {
      params,
      timeout: 30000,
    });
    return data;
  } catch (err) {
    if (isRateLimitError(err) && retryIndex < MAX_RETRIES) {
      const waitMs = RATE_LIMIT_BACKOFF_MS[retryIndex] ?? 90000;
      console.warn(
        `[Steam API] Rate limit (${err.response?.status ?? '?'}), retry dans ${waitMs / 1000}s (${retryIndex + 1}/${MAX_RETRIES})`
      );
      await new Promise((r) => setTimeout(r, waitMs));
      return steamGet(url, params, retryIndex + 1);
    }
    throw err;
  }
}

/**
 * Convert SteamID64 to legacy SteamID format (STEAM_X:Y:Z)
 * @param {string|bigint} steamId64 - 64-bit Steam ID
 * @returns {string} STEAM_1:Y:Z format
 */
export function steamId64ToSteamId(steamId64) {
  const id = BigInt(steamId64);
  const base = 76561197960265728n;
  const accountId = id - base;
  const Y = Number(accountId % 2n);
  const Z = Number(accountId / 2n);
  return `STEAM_1:${Y}:${Z}`;
}

/**
 * Convert SteamID (STEAM_X:Y:Z) to SteamID64
 * @param {string} steamId - STEAM_1:Y:Z format
 * @returns {string} 64-bit Steam ID as string
 */
export function steamIdToSteamId64(steamId) {
  const match = steamId.match(/STEAM_[10]:([01]):(\d+)/);
  if (!match) throw new Error(`Invalid SteamID format: ${steamId}`);
  const [, Y, Z] = match.map(Number);
  const accountId = Z * 2 + Y;
  const base = 76561197960265728;
  return String(BigInt(base) + BigInt(accountId));
}

/**
 * Fetch player summaries (profile data)
 * @param {string} apiKey - Steam API key
 * @param {string[]} steamIds - Array of SteamID64
 */
export async function getPlayerSummaries(apiKey, steamIds) {
  const ids = Array.isArray(steamIds) ? steamIds.join(',') : steamIds;
  const data = await steamGet(`${BASE_URL}/ISteamUser/GetPlayerSummaries/v2/`, {
    key: apiKey,
    steamids: ids
  });
  return data.response?.players ?? [];
}

/**
 * Fetch player ban information (VAC, Community, Game bans)
 * @param {string} apiKey
 * @param {string[]} steamIds - Array of SteamID64
 */
export async function getPlayerBans(apiKey, steamIds) {
  const ids = Array.isArray(steamIds) ? steamIds.join(',') : steamIds;
  const data = await steamGet(`${BASE_URL}/ISteamUser/GetPlayerBans/v1/`, {
    key: apiKey,
    steamids: ids
  });
  return data.players ?? [];
}

/**
 * Resolve vanity URL (custom profile name) to SteamID64
 * @param {string} apiKey
 * @param {string} vanityUrl - custom profile name (e.g. "username" from steamcommunity.com/id/username)
 * @returns {Promise<string|null>} SteamID64 or null if not found
 */
export async function resolveVanityUrl(apiKey, vanityUrl) {
  const vanity = String(vanityUrl).trim();
  if (!vanity) return null;
  try {
    const data = await steamGet(`${BASE_URL}/ISteamUser/ResolveVanityURL/v1/`, {
      key: apiKey,
      vanityurl: vanity
    });
    const steamid = data?.response?.steamid;
    return steamid && data.response.success === 1 ? steamid : null;
  } catch (_) {
    return null;
  }
}

/**
 * Fetch friend list for a user
 * @param {string} apiKey
 * @param {string} steamId64
 */
export async function getFriendList(apiKey, steamId64) {
  try {
    const data = await steamGet(`${BASE_URL}/ISteamUser/GetFriendList/v1/`, {
      key: apiKey,
      steamid: steamId64,
      relationship: 'friend'
    });
    if (data?.friendslist === null) return [];
    return data?.friendslist?.friends ?? [];
  } catch (err) {
    if (err.response?.status === 401) return [];
    if (err.response?.data?.friendslist === null) return [];
    throw err;
  }
}

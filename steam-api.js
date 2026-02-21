/**
 * Steam Web API client - profile, bans, friends
 * Requires STEAM_API_KEY from https://steamcommunity.com/dev/apikey
 */

import axios from 'axios';

const BASE_URL = 'https://api.steampowered.com';

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
  const { data } = await axios.get(`${BASE_URL}/ISteamUser/GetPlayerSummaries/v2/`, {
    params: { key: apiKey, steamids: ids }
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
  const { data } = await axios.get(`${BASE_URL}/ISteamUser/GetPlayerBans/v1/`, {
    params: { key: apiKey, steamids: ids }
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
    const { data } = await axios.get(`${BASE_URL}/ISteamUser/ResolveVanityURL/v1/`, {
      params: { key: apiKey, vanityurl: vanity }
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
    const { data } = await axios.get(`${BASE_URL}/ISteamUser/GetFriendList/v1/`, {
      params: { key: apiKey, steamid: steamId64, relationship: 'friend' }
    });
    return data.friendslist?.friends ?? [];
  } catch (err) {
    if (err.response?.status === 401) return [];
    if (err.response?.data?.friendslist === null) return [];
    throw err;
  }
}

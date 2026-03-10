/**
 * Database layer: choice via .env DATABASE=sqlite | supabase.
 * For Supabase also set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { isSupabaseConfigured } from '../../lib/supabase.js';
import * as sqlite from './sqlite.js';
import * as supabase from './supabase.js';

function useSupabase() {
  const db = (process.env.DATABASE || 'sqlite').toLowerCase();
  return db === 'supabase' && isSupabaseConfigured();
}

/** Returns 'supabase' or 'sqlite' for logging. */
export function getDbBackend() {
  return useSupabase() ? 'supabase' : 'sqlite';
}

export function getDb() {
  return useSupabase() ? supabase.getDb() : sqlite.getDb();
}

export async function saveProfile(database, profile) {
  if (useSupabase()) return supabase.saveProfile(database, profile);
  sqlite.saveProfile(database || sqlite.getDb(), profile);
}

export async function saveFriendship(database, steamid64A, steamid64B) {
  if (useSupabase()) return supabase.saveFriendship(database, steamid64A, steamid64B);
  sqlite.saveFriendship(database || sqlite.getDb(), steamid64A, steamid64B);
}

export async function saveGraph(graph) {
  if (useSupabase()) return supabase.saveGraph(graph);
  return Promise.resolve(sqlite.saveGraph(graph));
}

export async function getExistingSteamIds(database) {
  if (useSupabase()) return supabase.getExistingSteamIds();
  return Promise.resolve(sqlite.getExistingSteamIds(database || sqlite.getDb()));
}

export async function getStats(database) {
  if (useSupabase()) return supabase.getStats();
  return Promise.resolve(sqlite.getStats(database || sqlite.getDb()));
}

export async function getTopFriends(database, limit) {
  if (useSupabase()) return supabase.getTopFriends(limit);
  return Promise.resolve(sqlite.getTopFriends(database || sqlite.getDb(), limit));
}

export async function getVacBanned(database, limit, offset) {
  if (useSupabase()) return supabase.getVacBanned(limit, offset);
  return Promise.resolve(sqlite.getVacBanned(database || sqlite.getDb(), limit, offset));
}

export async function getVacBannedCount(database) {
  if (useSupabase()) return supabase.getVacBannedCount();
  return Promise.resolve(sqlite.getVacBannedCount(database || sqlite.getDb()));
}

export async function getGameBanned(database, limit, offset) {
  if (useSupabase()) return supabase.getGameBanned(limit, offset);
  return Promise.resolve(sqlite.getGameBanned(database || sqlite.getDb(), limit, offset));
}

export async function getGameBannedCount(database) {
  if (useSupabase()) return supabase.getGameBannedCount();
  return Promise.resolve(sqlite.getGameBannedCount(database || sqlite.getDb()));
}

export async function getCommunityBanned(database, limit, offset) {
  if (useSupabase()) return supabase.getCommunityBanned(limit, offset);
  return Promise.resolve(sqlite.getCommunityBanned(database || sqlite.getDb(), limit, offset));
}

export async function getCommunityBannedCount(database) {
  if (useSupabase()) return supabase.getCommunityBannedCount();
  return Promise.resolve(sqlite.getCommunityBannedCount(database || sqlite.getDb()));
}

export async function getAllBanned(database, limit, offset, search) {
  if (useSupabase()) return supabase.getAllBanned(limit, offset, search);
  return Promise.resolve(sqlite.getAllBanned(database || sqlite.getDb(), limit, offset, search));
}

export async function getBannedCount(database, search) {
  if (useSupabase()) return supabase.getBannedCount(search);
  return Promise.resolve(sqlite.getBannedCount(database || sqlite.getDb(), search));
}

export async function getBanStatsOverTime(database, year) {
  if (useSupabase()) return supabase.getBanStatsOverTime(year);
  return Promise.resolve(sqlite.getBanStatsOverTime(database || sqlite.getDb(), year));
}

export async function getBanStatsYears(database) {
  if (useSupabase()) return supabase.getBanStatsYears();
  return Promise.resolve(sqlite.getBanStatsYears(database || sqlite.getDb()));
}

export async function getBanStatsByBanDate(database, year) {
  if (useSupabase()) return supabase.getBanStatsByBanDate(year);
  return Promise.resolve(sqlite.getBanStatsByBanDate(database || sqlite.getDb(), year));
}

export async function getBanStatsYearsByBanDate(database) {
  if (useSupabase()) return supabase.getBanStatsYearsByBanDate();
  return Promise.resolve(sqlite.getBanStatsYearsByBanDate(database || sqlite.getDb()));
}

export async function getProfiles(database, limit, offset, search) {
  if (useSupabase()) return supabase.getProfiles(limit, offset, search);
  return Promise.resolve(sqlite.getProfiles(database || sqlite.getDb(), limit, offset, search));
}

export async function getProfilesCount(database, search) {
  if (useSupabase()) return supabase.getProfilesCount(search);
  return Promise.resolve(sqlite.getProfilesCount(database || sqlite.getDb(), search));
}

export async function getSearchProfiles(database, query, limit) {
  if (useSupabase()) return supabase.getSearchProfiles(query, limit);
  return Promise.resolve(sqlite.getSearchProfiles(database || sqlite.getDb(), query, limit));
}

export async function getProfile(database, steamid64) {
  if (useSupabase()) return supabase.getProfile(steamid64);
  return Promise.resolve(sqlite.getProfile(database || sqlite.getDb(), steamid64));
}

export async function getFriendCount(database, steamid64) {
  if (useSupabase()) return supabase.getFriendCount(steamid64);
  return Promise.resolve(sqlite.getFriendCount(database || sqlite.getDb(), steamid64));
}

export async function getFriendBannedCount(database, steamid64) {
  if (useSupabase()) return supabase.getFriendBannedCount(steamid64);
  return Promise.resolve(sqlite.getFriendBannedCount(database || sqlite.getDb(), steamid64));
}

export async function getBannedFriends(database, steamid64) {
  if (useSupabase()) return supabase.getBannedFriends(steamid64);
  return Promise.resolve(sqlite.getBannedFriends(database || sqlite.getDb(), steamid64));
}

export async function getFriendshipPairs(database, limit) {
  if (useSupabase()) return supabase.getFriendshipPairs(limit);
  return Promise.resolve(sqlite.getFriendshipPairs(database || sqlite.getDb(), limit));
}

export async function getSetting(database, key) {
  if (useSupabase()) return supabase.getSetting(database, key);
  return Promise.resolve(sqlite.getSetting(database || sqlite.getDb(), key));
}

export async function setSetting(database, key, value) {
  if (useSupabase()) return supabase.setSetting(database, key, value);
  sqlite.setSetting(database || sqlite.getDb(), key, value);
  return Promise.resolve();
}

export { isSupabaseConfigured } from '../../lib/supabase.js';

/**
 * Supabase (PostgreSQL) implementation - async API
 */

import { getSupabase, isSupabaseConfigured } from '../../lib/supabase.js';

function sb() {
  return getSupabase();
}

function profileToRow(profile) {
  const b = profile.ban;
  return {
    steamid64: profile.steamId64,
    steamid: profile.steamId ?? null,
    persona_name: profile.personaName ?? 'Unknown',
    profile_url: profile.profileUrl ?? null,
    friends_page_url: profile.friendsPageUrl ?? null,
    avatar: profile.avatar ?? null,
    time_created: profile.createdAt ?? null,
    vac_banned: b?.vacBanned ? 1 : 0,
    vac_count: b?.numberOfVACBans ?? 0,
    days_since_last_ban: b?.daysSinceLastBan ?? null,
    last_ban_date: b?.lastBanDate ?? null,
    game_ban_count: b?.numberOfGameBans ?? 0,
    game_ban_days_since_last: b?.gameBanDaysSinceLast ?? null,
    game_last_ban_date: b?.gameLastBanDate ?? null,
    community_banned: b?.communityBanned ? 1 : 0,
    economy_ban: b?.economyBan ?? 'none',
  };
}

export function getDb() {
  return sb();
}

export async function saveProfile(database, profile) {
  const row = profileToRow(profile);
  await sb().from('profiles').upsert(row, { onConflict: 'steamid64' });
}

export async function saveFriendship(database, steamid64A, steamid64B) {
  const [a, b] = [String(steamid64A), String(steamid64B)].sort();
  if (a === b) return;
  await sb().from('friendships').upsert({ steamid64_a: a, steamid64_b: b }, { onConflict: 'steamid64_a,steamid64_b' });
}

const BATCH_PROFILES = 100;
const BATCH_FRIENDSHIPS = 500;

export async function saveGraph(graph) {
  const json = graph.toJSON();
  const profileIds = new Set(Object.keys(json.profiles ?? {}));
  const profiles = Object.values(json.profiles ?? {}).map((p) => profileToRow(p));

  for (let i = 0; i < profiles.length; i += BATCH_PROFILES) {
    const chunk = profiles.slice(i, i + BATCH_PROFILES);
    await sb().from('profiles').upsert(chunk, { onConflict: 'steamid64' });
  }

  const friendshipRows = [];
  const seen = new Set();
  for (const [steamid64, friends] of Object.entries(json.adjacency ?? {})) {
    for (const fid of friends) {
      if (!profileIds.has(String(fid))) continue;
      const [a, b] = [String(steamid64), String(fid)].sort();
      if (a === b) continue;
      const key = `${a}\t${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      friendshipRows.push({ steamid64_a: a, steamid64_b: b });
    }
  }

  for (let i = 0; i < friendshipRows.length; i += BATCH_FRIENDSHIPS) {
    const chunk = friendshipRows.slice(i, i + BATCH_FRIENDSHIPS);
    if (chunk.length > 0) {
      await sb().from('friendships').upsert(chunk, { onConflict: 'steamid64_a,steamid64_b' });
    }
  }
}

export async function getExistingSteamIds() {
  const { data } = await sb().from('profiles').select('steamid64');
  return new Set((data || []).map((r) => String(r.steamid64)));
}

export async function getStats() {
  const [{ count: profiles }, { count: friendships }, { count: vacBanned }, { count: gameBanned }, { count: communityBanned }] = await Promise.all([
    sb().from('profiles').select('*', { count: 'exact', head: true }),
    sb().from('friendships').select('*', { count: 'exact', head: true }),
    sb().from('profiles').select('*', { count: 'exact', head: true }).eq('vac_banned', 1),
    sb().from('profiles').select('*', { count: 'exact', head: true }).gt('game_ban_count', 0),
    sb().from('profiles').select('*', { count: 'exact', head: true }).eq('community_banned', 1),
  ]);
  return {
    totalProfiles: profiles ?? 0,
    totalFriendships: friendships ?? 0,
    vacBannedCount: vacBanned ?? 0,
    gameBannedCount: gameBanned ?? 0,
    communityBannedCount: communityBanned ?? 0,
  };
}

export async function getTopFriends(limit = 20) {
  const { data: profiles } = await sb().from('profiles').select('steamid64, steamid, persona_name, profile_url, friends_page_url');
  const { data: friendships } = await sb().from('friendships').select('steamid64_a, steamid64_b');
  if (!profiles || !friendships) return [];

  const count = {};
  for (const p of profiles) count[p.steamid64] = 0;
  for (const f of friendships) {
    if (count[f.steamid64_a] != null) count[f.steamid64_a]++;
    if (count[f.steamid64_b] != null) count[f.steamid64_b]++;
  }
  return profiles
    .map((p) => ({ ...p, friend_count: count[p.steamid64] ?? 0 }))
    .sort((a, b) => b.friend_count - a.friend_count)
    .slice(0, limit);
}

export async function getVacBanned(limit = 100, offset = 0) {
  const { data } = await sb()
    .from('profiles')
    .select('steamid64, steamid, persona_name, profile_url, friends_page_url, avatar, vac_count, days_since_last_ban, last_ban_date')
    .eq('vac_banned', 1)
    .order('days_since_last_ban', { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1);
  return data || [];
}

export async function getVacBannedCount() {
  const { count } = await sb().from('profiles').select('*', { count: 'exact', head: true }).eq('vac_banned', 1);
  return count ?? 0;
}

export async function getGameBanned(limit = 100, offset = 0) {
  const { data } = await sb()
    .from('profiles')
    .select('steamid64, steamid, persona_name, profile_url, friends_page_url, avatar, game_ban_count, game_ban_days_since_last, game_last_ban_date')
    .gt('game_ban_count', 0)
    .eq('vac_banned', 0)
    .order('game_ban_count', { ascending: false })
    .range(offset, offset + limit - 1);
  return data || [];
}

export async function getGameBannedCount() {
  const { count } = await sb()
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .gt('game_ban_count', 0)
    .eq('vac_banned', 0);
  return count ?? 0;
}

export async function getCommunityBanned(limit = 100, offset = 0) {
  const { data } = await sb()
    .from('profiles')
    .select('steamid64, steamid, persona_name, profile_url, friends_page_url, avatar')
    .eq('community_banned', 1)
    .order('persona_name', { ascending: true })
    .range(offset, offset + limit - 1);
  return data || [];
}

export async function getCommunityBannedCount() {
  const { count } = await sb().from('profiles').select('*', { count: 'exact', head: true }).eq('community_banned', 1);
  return count ?? 0;
}

export async function getAllBanned(limit = 100, offset = 0, search = null) {
  let q = sb()
    .from('profiles')
    .select('steamid64, steamid, persona_name, profile_url, friends_page_url, avatar, vac_banned, vac_count, days_since_last_ban, last_ban_date, game_ban_count, game_ban_days_since_last, game_last_ban_date, community_banned')
    .or('vac_banned.eq.1,game_ban_count.gt.0,community_banned.eq.1');
  if (search && search.trim()) {
    const pattern = '%' + search.trim().replace(/,/g, '') + '%';
    q = q.or(`persona_name.ilike.${pattern},steamid.ilike.${pattern},steamid64.ilike.${pattern}`);
  }
  const { data } = await q.order('vac_banned', { ascending: false }).order('days_since_last_ban', { ascending: true, nullsFirst: false }).range(offset, offset + limit - 1);
  return data || [];
}

export async function getBannedCount(search = null) {
  let q = sb()
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .or('vac_banned.eq.1,game_ban_count.gt.0,community_banned.eq.1');
  if (search && search.trim()) {
    const pattern = '%' + search.trim().replace(/,/g, '') + '%';
    q = q.or(`persona_name.ilike.${pattern},steamid.ilike.${pattern},steamid64.ilike.${pattern}`);
  }
  const { count } = await q;
  return count ?? 0;
}

export async function getBanStatsOverTime(year = null) {
  const { data } = await sb().from('profiles').select('scraped_at, vac_banned, game_ban_count, community_banned').not('scraped_at', 'is', null);
  if (!data || data.length === 0) return [];

  const byDay = {};
  const toNum = (v) => (v == null || v === '' ? 0 : Number(v));
  for (const r of data) {
    const day = r.scraped_at ? String(r.scraped_at).slice(0, 10) : null;
    if (!day || day.length < 10) continue;
    if (!byDay[day]) byDay[day] = { vac: 0, game: 0, community: 0 };
    byDay[day].vac += toNum(r.vac_banned) ? 1 : 0;
    byDay[day].game += toNum(r.game_ban_count) > 0 ? 1 : 0;
    byDay[day].community += toNum(r.community_banned) ? 1 : 0;
  }
  const days = Object.keys(byDay).filter((d) => d && d.length >= 10).sort();
  if (year != null && !Number.isNaN(year)) {
    const firstDay = `${year}-01-01`;
    let lastDay = `${year}-12-31`;
    const today = new Date().toISOString().slice(0, 10);
    if (lastDay > today) lastDay = today;
    const result = [];
    const d = new Date(firstDay + 'T12:00:00Z');
    const end = new Date(lastDay + 'T12:00:00Z');
    while (d <= end) {
      const day = d.toISOString().slice(0, 10);
      const v = byDay[day] ?? { vac: 0, game: 0, community: 0 };
      result.push({ day, vac: v.vac, game: v.game, community: v.community });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return result;
  }
  return days.map((day) => ({ day, ...byDay[day] }));
}

export async function getBanStatsYears() {
  const { data } = await sb().from('profiles').select('scraped_at').not('scraped_at', 'is', null);
  const years = new Set();
  for (const r of data || []) {
    const y = r.scraped_at ? String(r.scraped_at).slice(0, 4) : null;
    const n = parseInt(y, 10);
    if (!Number.isNaN(n) && n >= 2000 && n <= 2100) years.add(n);
  }
  return [...years].sort((a, b) => b - a);
}

export async function getBanStatsByBanDate(year = null) {
  const [vacRes, gameRes] = await Promise.all([
    sb().from('profiles').select('last_ban_date').eq('vac_banned', 1).not('last_ban_date', 'is', null),
    sb().from('profiles').select('game_last_ban_date').gt('game_ban_count', 0).not('game_last_ban_date', 'is', null),
  ]);
  const vacByDay = {};
  for (const r of vacRes.data || []) {
    const day = r.last_ban_date ? String(r.last_ban_date).slice(0, 10) : null;
    if (day && day.length >= 10) vacByDay[day] = (vacByDay[day] || 0) + 1;
  }
  const gameByDay = {};
  for (const r of gameRes.data || []) {
    const day = r.game_last_ban_date ? String(r.game_last_ban_date).slice(0, 10) : null;
    if (day && day.length >= 10) gameByDay[day] = (gameByDay[day] || 0) + 1;
  }
  const allDays = [...Object.keys(vacByDay), ...Object.keys(gameByDay)].filter((d) => d && d.length >= 10);
  if (allDays.length === 0) return [];
  const firstDay = allDays.sort()[0];
  const today = new Date().toISOString().slice(0, 10);
  let start = firstDay,
    end = today;
  if (year != null && !Number.isNaN(year)) {
    start = `${year}-01-01`;
    end = `${year}-12-31`;
    if (end > today) end = today;
  }
  const result = [];
  const d = new Date(start + 'T12:00:00Z');
  const endDate = new Date(end + 'T12:00:00Z');
  while (d <= endDate) {
    const day = d.toISOString().slice(0, 10);
    result.push({ day, vac: vacByDay[day] ?? 0, game: gameByDay[day] ?? 0, community: 0 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return result;
}

export async function getBanStatsYearsByBanDate() {
  const [vacRes, gameRes] = await Promise.all([
    sb().from('profiles').select('last_ban_date').eq('vac_banned', 1).not('last_ban_date', 'is', null),
    sb().from('profiles').select('game_last_ban_date').gt('game_ban_count', 0).not('game_last_ban_date', 'is', null),
  ]);
  const years = new Set();
  for (const r of vacRes.data || []) {
    const y = r.last_ban_date ? String(r.last_ban_date).slice(0, 4) : null;
    const n = parseInt(y, 10);
    if (!Number.isNaN(n) && n >= 2000 && n <= 2100) years.add(n);
  }
  for (const r of gameRes.data || []) {
    const y = r.game_last_ban_date ? String(r.game_last_ban_date).slice(0, 4) : null;
    const n = parseInt(y, 10);
    if (!Number.isNaN(n) && n >= 2000 && n <= 2100) years.add(n);
  }
  return [...years].sort((a, b) => b - a);
}

export async function getProfiles(limit = 100, offset = 0, search = null) {
  let q = sb().from('profiles').select('*').order('scraped_at', { ascending: false });
  if (search && search.trim()) {
    const pattern = '%' + search.trim().replace(/,/g, '') + '%';
    q = q.or(`persona_name.ilike.${pattern},steamid.ilike.${pattern},steamid64.ilike.${pattern}`);
  }
  const { data } = await q.range(offset, offset + limit - 1);
  return data || [];
}

export async function getProfilesCount(search = null) {
  let q = sb().from('profiles').select('*', { count: 'exact', head: true });
  if (search && search.trim()) {
    const pattern = '%' + search.trim().replace(/,/g, '') + '%';
    q = q.or(`persona_name.ilike.${pattern},steamid.ilike.${pattern},steamid64.ilike.${pattern}`);
  }
  const { count } = await q;
  return count ?? 0;
}

export async function getSearchProfiles(query = '', limit = 12) {
  const q = (query || '').trim();
  if (q.length === 0) return [];
  const pattern = '%' + q.replace(/,/g, '') + '%';
  const { data } = await sb()
    .from('profiles')
    .select('steamid64, steamid, persona_name, avatar')
    .or(`persona_name.ilike.${pattern},steamid.ilike.${pattern},steamid64.ilike.${pattern}`)
    .order('persona_name', { ascending: true })
    .limit(limit);
  return data || [];
}

export async function getProfile(steamid64) {
  const id = String(steamid64);
  const { data } = await sb().from('profiles').select('*').eq('steamid64', id).maybeSingle();
  return data || null;
}

export async function getFriendCount(steamid64) {
  const id = String(steamid64);
  const { count } = await sb()
    .from('friendships')
    .select('*', { count: 'exact', head: true })
    .or(`steamid64_a.eq.${id},steamid64_b.eq.${id}`);
  return count ?? 0;
}

export async function getFriendBannedCount(steamid64) {
  const id = String(steamid64);
  const { data: friends } = await sb()
    .from('friendships')
    .select('steamid64_a, steamid64_b')
    .or(`steamid64_a.eq.${id},steamid64_b.eq.${id}`);
  if (!friends || friends.length === 0) return 0;
  const fids = friends.map((f) => (f.steamid64_a === id ? f.steamid64_b : f.steamid64_a));
  const { count } = await sb()
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .in('steamid64', fids)
    .or('vac_banned.eq.1,game_ban_count.gt.0,community_banned.eq.1');
  return count ?? 0;
}

export async function getBannedFriends(steamid64) {
  const id = String(steamid64);
  const { data: friends } = await sb()
    .from('friendships')
    .select('steamid64_a, steamid64_b')
    .or(`steamid64_a.eq.${id},steamid64_b.eq.${id}`);
  if (!friends || friends.length === 0) return [];
  const fids = friends.map((f) => (f.steamid64_a === id ? f.steamid64_b : f.steamid64_a));
  const { data } = await sb()
    .from('profiles')
    .select('steamid64, steamid, persona_name, profile_url, avatar, vac_banned, vac_count, game_ban_count, community_banned, scraped_at')
    .in('steamid64', fids)
    .or('vac_banned.eq.1,game_ban_count.gt.0,community_banned.eq.1')
    .order('persona_name');
  return data || [];
}

export async function getFriendshipPairs(limit = 500) {
  const { data } = await sb()
    .from('friendships')
    .select('steamid64_a, steamid64_b')
    .order('steamid64_a')
    .limit(limit);
  if (!data || data.length === 0) return [];
  const ids = new Set(data.flatMap((f) => [f.steamid64_a, f.steamid64_b]));
  const { data: profs } = await sb().from('profiles').select('steamid64, persona_name').in('steamid64', [...ids]);
  const byId = Object.fromEntries((profs || []).map((p) => [p.steamid64, p.persona_name]));
  return data.map((f) => ({
    steamid64_a: f.steamid64_a,
    steamid64_b: f.steamid64_b,
    name_a: byId[f.steamid64_a] ?? null,
    name_b: byId[f.steamid64_b] ?? null,
  }));
}

export async function getSetting(database, key) {
  const { data } = await sb().from('settings').select('value').eq('key', String(key)).maybeSingle();
  return data?.value ?? null;
}

export async function setSetting(database, key, value) {
  await sb().from('settings').upsert({ key: String(key), value: value == null ? '' : String(value) }, { onConflict: 'key' });
}

export { isSupabaseConfigured };

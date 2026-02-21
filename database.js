/**
 * SQLite database for Steam profiles and friendships
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "steam-data.db");

let db = null;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      steamid64 TEXT PRIMARY KEY,
      steamid TEXT,
      persona_name TEXT,
      profile_url TEXT,
      friends_page_url TEXT,
      avatar TEXT,
      time_created TEXT,
      vac_banned INTEGER DEFAULT 0,
      vac_count INTEGER DEFAULT 0,
      days_since_last_ban INTEGER,
      last_ban_date TEXT,
      game_ban_count INTEGER DEFAULT 0,
      game_ban_days_since_last INTEGER,
      game_last_ban_date TEXT,
      community_banned INTEGER DEFAULT 0,
      economy_ban TEXT,
      scraped_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration: add game ban date columns if missing
  const cols = database.prepare("PRAGMA table_info(profiles)").all();
  const hasGameBanDays = cols.some((c) => c.name === "game_ban_days_since_last");
  if (!hasGameBanDays) {
    database.exec("ALTER TABLE profiles ADD COLUMN game_ban_days_since_last INTEGER");
    database.exec("ALTER TABLE profiles ADD COLUMN game_last_ban_date TEXT");
  }

  // Migration: drop old friendships table with FK constraints (SQLite can't alter them)
  const tableExists = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='friendships'",
    )
    .get();
  if (tableExists) {
    const fkList = database
      .prepare("PRAGMA foreign_key_list(friendships)")
      .all();
    if (fkList.length > 0) {
      database.exec("DROP TABLE friendships");
    }
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS friendships (
      steamid64_a TEXT NOT NULL,
      steamid64_b TEXT NOT NULL,
      PRIMARY KEY (steamid64_a, steamid64_b),
      CHECK (steamid64_a < steamid64_b)
    );

    CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(steamid64_a);
    CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(steamid64_b);
  `);
}

/**
 * Save a profile to the database
 */
export function saveProfile(database, profile) {
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO profiles (
      steamid64, steamid, persona_name, profile_url, friends_page_url,
      avatar, time_created, vac_banned, vac_count, days_since_last_ban,
      last_ban_date, game_ban_count, game_ban_days_since_last, game_last_ban_date,
      community_banned, economy_ban
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const b = profile.ban;
  stmt.run(
    profile.steamId64,
    profile.steamId,
    profile.personaName ?? "Unknown",
    profile.profileUrl ?? null,
    profile.friendsPageUrl ?? null,
    profile.avatar ?? null,
    profile.createdAt ?? null,
    b?.vacBanned ? 1 : 0,
    b?.numberOfVACBans ?? 0,
    b?.daysSinceLastBan ?? null,
    b?.lastBanDate ?? null,
    b?.numberOfGameBans ?? 0,
    b?.gameBanDaysSinceLast ?? null,
    b?.gameLastBanDate ?? null,
    b?.communityBanned ? 1 : 0,
    b?.economyBan ?? "none",
  );
}

/**
 * Save a friendship (a < b to avoid duplicates)
 */
export function saveFriendship(database, steamid64A, steamid64B) {
  const [a, b] = [String(steamid64A), String(steamid64B)].sort();
  if (a === b) return;
  const stmt = database.prepare(`
    INSERT OR IGNORE INTO friendships (steamid64_a, steamid64_b) VALUES (?, ?)
  `);
  stmt.run(a, b);
}

/**
 * Save entire graph to database
 * Only saves friendships where BOTH profiles were scraped (exist in graph)
 */
export function saveGraph(graph) {
  const database = getDb();
  const json = graph.toJSON();
  const profileIds = new Set(Object.keys(json.profiles ?? {}));

  const transact = database.transaction(() => {
    for (const [, profile] of Object.entries(json.profiles ?? {})) {
      saveProfile(database, profile);
    }
    for (const [steamid64, friends] of Object.entries(json.adjacency ?? {})) {
      for (const fid of friends) {
        if (profileIds.has(String(fid))) {
          saveFriendship(database, steamid64, fid);
        }
      }
    }
  });
  transact();
}

/**
 * Return Set of steamid64 already in DB (to avoid re-crawling)
 */
export function getExistingSteamIds(database = getDb()) {
  const rows = database.prepare("SELECT steamid64 FROM profiles").all();
  return new Set(rows.map((r) => String(r.steamid64)));
}

/**
 * Get stats from database
 */
export function getStats(database = getDb()) {
  const profiles = database
    .prepare("SELECT COUNT(*) as count FROM profiles")
    .get();
  const friendships = database
    .prepare("SELECT COUNT(*) as count FROM friendships")
    .get();
  const vacBanned = database
    .prepare("SELECT COUNT(*) as count FROM profiles WHERE vac_banned = 1")
    .get();
  const gameBanned = database
    .prepare("SELECT COUNT(*) as count FROM profiles WHERE game_ban_count > 0")
    .get();
  const communityBanned = database
    .prepare(
      "SELECT COUNT(*) as count FROM profiles WHERE community_banned = 1",
    )
    .get();

  return {
    totalProfiles: profiles.count,
    totalFriendships: friendships.count,
    vacBannedCount: vacBanned.count,
    gameBannedCount: gameBanned.count,
    communityBannedCount: communityBanned.count,
  };
}

/**
 * Get top profiles by friend count
 */
export function getTopFriends(database = getDb(), limit = 20) {
  const rows = database
    .prepare(
      `
    SELECT p.steamid64, p.steamid, p.persona_name, p.profile_url, p.friends_page_url,
           COUNT(f.steamid64_b) + COUNT(f2.steamid64_a) as friend_count
    FROM profiles p
    LEFT JOIN friendships f ON p.steamid64 = f.steamid64_a
    LEFT JOIN friendships f2 ON p.steamid64 = f2.steamid64_b
    GROUP BY p.steamid64
    ORDER BY friend_count DESC
    LIMIT ?
  `,
    )
    .all(limit);

  // Correct count: each friendship appears in one row (a,b) with a<b, so a's friends are in steamid64_a, b's in steamid64_b
  const corrected = database
    .prepare(
      `
    SELECT p.steamid64, p.steamid, p.persona_name, p.profile_url, p.friends_page_url,
           (SELECT COUNT(*) FROM friendships WHERE steamid64_a = p.steamid64 OR steamid64_b = p.steamid64) as friend_count
    FROM profiles p
    ORDER BY friend_count DESC
    LIMIT ?
  `,
    )
    .all(limit);

  return corrected;
}

/**
 * Get VAC banned profiles with details (paginated)
 */
export function getVacBanned(database = getDb(), limit = 100, offset = 0) {
  return database
    .prepare(
      `
    SELECT steamid64, steamid, persona_name, profile_url, friends_page_url, avatar,
           vac_count, days_since_last_ban, last_ban_date
    FROM profiles WHERE vac_banned = 1
    ORDER BY days_since_last_ban ASC
    LIMIT ? OFFSET ?
  `,
    )
    .all(limit, offset);
}

/**
 * Count VAC banned profiles
 */
export function getVacBannedCount(database = getDb()) {
  return database.prepare("SELECT COUNT(*) as count FROM profiles WHERE vac_banned = 1").get().count;
}

/**
 * Get Game banned profiles (no VAC) (paginated)
 */
export function getGameBanned(database = getDb(), limit = 100, offset = 0) {
  return database
    .prepare(
      `
    SELECT steamid64, steamid, persona_name, profile_url, friends_page_url, avatar,
           game_ban_count, game_ban_days_since_last, game_last_ban_date
    FROM profiles WHERE game_ban_count > 0 AND vac_banned = 0
    ORDER BY game_ban_count DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(limit, offset);
}

/**
 * Count Game banned profiles
 */
export function getGameBannedCount(database = getDb()) {
  return database
    .prepare("SELECT COUNT(*) as count FROM profiles WHERE game_ban_count > 0 AND vac_banned = 0")
    .get().count;
}

/**
 * Get Community banned profiles (paginated)
 */
export function getCommunityBanned(database = getDb(), limit = 100, offset = 0) {
  return database
    .prepare(
      `
    SELECT steamid64, steamid, persona_name, profile_url, friends_page_url, avatar
    FROM profiles WHERE community_banned = 1
    ORDER BY persona_name ASC
    LIMIT ? OFFSET ?
  `,
    )
    .all(limit, offset);
}

/**
 * Count Community banned profiles
 */
export function getCommunityBannedCount(database = getDb()) {
  return database.prepare("SELECT COUNT(*) as count FROM profiles WHERE community_banned = 1").get().count;
}

/**
 * Get ALL banned profiles (VAC, Game or Community) with ban type - paginated
 * @param {string} search - Optional search query (pseudo, steamid, steamid64)
 */
export function getAllBanned(database = getDb(), limit = 100, offset = 0, search = null) {
  let query = `
    SELECT steamid64, steamid, persona_name, profile_url, friends_page_url, avatar,
           vac_banned, vac_count, days_since_last_ban, last_ban_date,
           game_ban_count, game_ban_days_since_last, game_last_ban_date, community_banned
    FROM profiles WHERE vac_banned = 1 OR game_ban_count > 0 OR community_banned = 1
  `;
  const params = [];
  
  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query += ` AND (persona_name LIKE ? OR steamid LIKE ? OR steamid64 LIKE ?)`;
    params.push(s, s, s);
  }
  
  query += ` ORDER BY vac_banned DESC, days_since_last_ban ASC, game_ban_count DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  return database.prepare(query).all(...params);
}

/**
 * Count total banned profiles
 * @param {string} search - Optional search query
 */
export function getBannedCount(database = getDb(), search = null) {
  let query = `SELECT COUNT(*) as count FROM profiles WHERE vac_banned = 1 OR game_ban_count > 0 OR community_banned = 1`;
  const params = [];
  
  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query += ` AND (persona_name LIKE ? OR steamid LIKE ? OR steamid64 LIKE ?)`;
    params.push(s, s, s);
  }
  
  return database.prepare(query).get(...params).count;
}

/**
 * Get ban counts per day (by scraped_at). All three types: VAC, Game, Community.
 * Uses substr so any datetime format (YYYY-MM-DD...) works.
 * @param {number|null} year - If set, only that year (all days filled); else only days with data
 */
export function getBanStatsOverTime(database = getDb(), year = null) {
  const rows = database
    .prepare(
      `
    SELECT substr(scraped_at, 1, 10) as day,
           COALESCE(SUM(vac_banned), 0) as vac,
           COALESCE(SUM(CASE WHEN game_ban_count > 0 THEN 1 ELSE 0 END), 0) as game,
           COALESCE(SUM(community_banned), 0) as community
    FROM profiles
    WHERE scraped_at IS NOT NULL AND length(scraped_at) >= 10
    GROUP BY substr(scraped_at, 1, 10)
    ORDER BY day
  `,
    )
    .all();

  const toNum = (v) => (v == null || v === "" ? 0 : Number(v));
  const valid = rows.filter((r) => r.day && r.day.length >= 10);
  if (valid.length === 0) return [];

  if (year !== null && year !== undefined && !Number.isNaN(year)) {
    const byDay = Object.fromEntries(
      valid.map((r) => [
        r.day,
        {
          vac: toNum(r.vac),
          game: toNum(r.game),
          community: toNum(r.community),
        },
      ]),
    );
    const firstDay = `${year}-01-01`;
    let lastDay = `${year}-12-31`;
    const today = new Date().toISOString().slice(0, 10);
    if (lastDay > today) lastDay = today;

    const result = [];
    const d = new Date(firstDay + "T12:00:00Z");
    const end = new Date(lastDay + "T12:00:00Z");
    while (d <= end) {
      const day = d.toISOString().slice(0, 10);
      const v = byDay[day] ?? { vac: 0, game: 0, community: 0 };
      result.push({ day, vac: v.vac, game: v.game, community: v.community });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return result;
  }

  return valid.map((r) => ({
    day: String(r.day),
    vac: toNum(r.vac),
    game: toNum(r.game),
    community: toNum(r.community),
  }));
}

/**
 * Get list of years that have scraped data (for filter dropdown)
 * Uses substr so any datetime format works.
 */
export function getBanStatsYears(database = getDb()) {
  const rows = database
    .prepare(
      `
    SELECT DISTINCT substr(scraped_at, 1, 4) as y
    FROM profiles
    WHERE scraped_at IS NOT NULL AND length(scraped_at) >= 4
    ORDER BY y DESC
  `,
    )
    .all();
  const years = rows
    .map((r) => parseInt(r.y, 10))
    .filter((y) => !Number.isNaN(y) && y >= 2000 && y <= 2100);
  return [...new Set(years)];
}

/**
 * Get VAC and Game ban counts per day by ban date (last_ban_date, game_last_ban_date).
 * @param {number|null} year - If set, only that year; else from oldest ban date to today
 */
export function getBanStatsByBanDate(database = getDb(), year = null) {
  const vacRows = database
    .prepare(
      `
    SELECT substr(last_ban_date, 1, 10) as day, COUNT(*) as vac
    FROM profiles
    WHERE vac_banned = 1 AND last_ban_date IS NOT NULL AND length(last_ban_date) >= 10
    GROUP BY substr(last_ban_date, 1, 10)
    ORDER BY day
  `
    )
    .all();

  const gameRows = database
    .prepare(
      `
    SELECT substr(game_last_ban_date, 1, 10) as day, COUNT(*) as game
    FROM profiles
    WHERE game_ban_count > 0 AND game_last_ban_date IS NOT NULL AND length(game_last_ban_date) >= 10
    GROUP BY substr(game_last_ban_date, 1, 10)
    ORDER BY day
  `
    )
    .all();

  const vacByDay = Object.fromEntries(
    vacRows
      .filter((r) => r.day && r.day.length >= 10)
      .map((r) => [r.day, Number(r.vac) || 0])
  );
  const gameByDay = Object.fromEntries(
    gameRows
      .filter((r) => r.day && r.day.length >= 10)
      .map((r) => [r.day, Number(r.game) || 0])
  );

  const allDays = [
    ...Object.keys(vacByDay),
    ...Object.keys(gameByDay),
  ].filter((d) => d && d.length >= 10);
  if (allDays.length === 0) return [];

  const firstDay = allDays.sort()[0];
  const today = new Date().toISOString().slice(0, 10);

  let start = firstDay;
  let end = today;
  if (year !== null && year !== undefined && !Number.isNaN(year)) {
    start = `${year}-01-01`;
    end = `${year}-12-31`;
    if (end > today) end = today;
  }

  const result = [];
  const d = new Date(start + "T12:00:00Z");
  const endDate = new Date(end + "T12:00:00Z");
  while (d <= endDate) {
    const day = d.toISOString().slice(0, 10);
    result.push({
      day,
      vac: vacByDay[day] ?? 0,
      game: gameByDay[day] ?? 0,
      community: 0,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return result;
}

/**
 * Years that have ban dates (last_ban_date or game_last_ban_date) for the "by ban date" chart
 */
export function getBanStatsYearsByBanDate(database = getDb()) {
  const vacYears = database
    .prepare(
      `
    SELECT DISTINCT substr(last_ban_date, 1, 4) as y
    FROM profiles
    WHERE vac_banned = 1 AND last_ban_date IS NOT NULL AND length(last_ban_date) >= 4
  `
    )
    .all();
  const gameYears = database
    .prepare(
      `
    SELECT DISTINCT substr(game_last_ban_date, 1, 4) as y
    FROM profiles
    WHERE game_ban_count > 0 AND game_last_ban_date IS NOT NULL AND length(game_last_ban_date) >= 4
  `
    )
    .all();
  const years = [...vacYears, ...gameYears]
    .map((r) => parseInt(r.y, 10))
    .filter((y) => !Number.isNaN(y) && y >= 2000 && y <= 2100);
  return [...new Set(years)].sort((a, b) => b - a);
}

/**
 * Get all profiles (paginated)
 * @param {string} search - Optional search query (pseudo, steamid, steamid64)
 */
export function getProfiles(database = getDb(), limit = 100, offset = 0, search = null) {
  let query = `SELECT * FROM profiles`;
  const params = [];
  
  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query += ` WHERE persona_name LIKE ? OR steamid LIKE ? OR steamid64 LIKE ?`;
    params.push(s, s, s);
  }
  
  query += ` ORDER BY scraped_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  return database.prepare(query).all(...params);
}

/**
 * Count total profiles
 * @param {string} search - Optional search query
 */
export function getProfilesCount(database = getDb(), search = null) {
  let query = `SELECT COUNT(*) as count FROM profiles`;
  const params = [];
  
  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query += ` WHERE persona_name LIKE ? OR steamid LIKE ? OR steamid64 LIKE ?`;
    params.push(s, s, s);
  }
  
  return database.prepare(query).get(...params).count;
}

/**
 * Search profiles by persona_name, steamid or steamid64 (for search suggestions)
 */
export function getSearchProfiles(database = getDb(), query = "", limit = 12) {
  const q = (query || "").trim();
  if (q.length === 0) return [];
  const s = `%${q}%`;
  return database
    .prepare(
      `
    SELECT steamid64, steamid, persona_name, avatar
    FROM profiles
    WHERE persona_name LIKE ? OR steamid LIKE ? OR steamid64 LIKE ?
    ORDER BY persona_name ASC
    LIMIT ?
  `
    )
    .all(s, s, s, limit);
}

/**
 * Get one profile by steamid64 (for profile page)
 */
export function getProfile(database = getDb(), steamid64) {
  const id = String(steamid64);
  const row = database
    .prepare(
      `SELECT steamid64, steamid, persona_name, profile_url, friends_page_url, avatar,
              time_created, vac_banned, vac_count, days_since_last_ban, last_ban_date,
              game_ban_count, game_ban_days_since_last, game_last_ban_date,
              community_banned, economy_ban, scraped_at
       FROM profiles WHERE steamid64 = ?`
    )
    .get(id);
  return row || null;
}

/**
 * Get friend count for a profile (from friendships table)
 */
export function getFriendCount(database = getDb(), steamid64) {
  const id = String(steamid64);
  const row = database
    .prepare(
      `SELECT COUNT(*) as count FROM friendships
       WHERE steamid64_a = ? OR steamid64_b = ?`
    )
    .get(id, id);
  return row ? row.count : 0;
}

/**
 * Get count of friends who are banned (VAC, Game or Community)
 */
export function getFriendBannedCount(database = getDb(), steamid64) {
  const id = String(steamid64);
  const row = database
    .prepare(
      `SELECT COUNT(DISTINCT p.steamid64) as count
       FROM profiles p
       INNER JOIN (
         SELECT steamid64_b AS fid FROM friendships WHERE steamid64_a = ?
         UNION
         SELECT steamid64_a FROM friendships WHERE steamid64_b = ?
       ) f ON p.steamid64 = f.fid
       WHERE p.vac_banned = 1 OR p.game_ban_count > 0 OR p.community_banned = 1`
    )
    .get(id, id);
  return row ? row.count : 0;
}

/**
 * Get list of friends who are banned (VAC, Game or Community) for profile page
 */
export function getBannedFriends(database = getDb(), steamid64) {
  const id = String(steamid64);
  return database
    .prepare(
      `SELECT p.steamid64, p.steamid, p.persona_name, p.profile_url, p.avatar,
              p.vac_banned, p.vac_count, p.game_ban_count, p.community_banned
       FROM profiles p
       INNER JOIN (
         SELECT steamid64_b AS fid FROM friendships WHERE steamid64_a = ?
         UNION
         SELECT steamid64_a FROM friendships WHERE steamid64_b = ?
       ) f ON p.steamid64 = f.fid
       WHERE p.vac_banned = 1 OR p.game_ban_count > 0 OR p.community_banned = 1
       ORDER BY p.persona_name COLLATE NOCASE`
    )
    .all(id, id);
}

/**
 * Get friendship pairs (who is friend with whom)
 */
export function getFriendshipPairs(database = getDb(), limit = 500) {
  return database
    .prepare(
      `
    SELECT f.steamid64_a, f.steamid64_b,
           p1.persona_name as name_a, p2.persona_name as name_b
    FROM friendships f
    LEFT JOIN profiles p1 ON f.steamid64_a = p1.steamid64
    LEFT JOIN profiles p2 ON f.steamid64_b = p2.steamid64
    ORDER BY f.steamid64_a
    LIMIT ?
  `,
    )
    .all(limit);
}

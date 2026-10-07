import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { BanFilters, ScrapedProfile, StatsSummary } from "../shared/types.js";
import type { FriendshipGraph } from "../scraper/graph.js";
import { db } from "./index.js";
import { friendships, profiles, settings } from "./schema.js";
import { decryptSecret, encryptSecret, SECRET_KEYS } from "./secrets.js";

function profileToRow(p: ScrapedProfile) {
  const b = p.ban;
  return {
    steamid64: p.steamId64,
    steamid: p.steamId ?? null,
    personaName: p.personaName ?? "Unknown",
    profileUrl: p.profileUrl,
    friendsPageUrl: p.friendsPageUrl,
    avatar: p.avatar,
    timeCreated: p.createdAt,
    vacBanned: b?.vacBanned ? 1 : 0,
    vacCount: b?.numberOfVACBans ?? 0,
    daysSinceLastBan: b?.daysSinceLastBan ?? null,
    lastBanDate: b?.lastBanDate ?? null,
    gameBanCount: b?.numberOfGameBans ?? 0,
    gameBanDaysSinceLast: b?.gameBanDaysSinceLast ?? null,
    gameLastBanDate: b?.gameLastBanDate ?? null,
    communityBanned: b?.communityBanned ? 1 : 0,
    economyBan: b?.economyBan ?? "none",
    scrapedAt: new Date().toISOString(),
  };
}

export async function saveGraph(graph: FriendshipGraph): Promise<void> {
  const json = graph.toJSON();
  const profileIds = new Set(Object.keys(json.profiles));
  const rows = Object.values(json.profiles).map(profileToRow);

  const friendshipRows: { steamid64A: string; steamid64B: string }[] = [];
  const seen = new Set<string>();
  for (const [steamid64, friends] of Object.entries(json.adjacency)) {
    for (const fid of friends) {
      if (!profileIds.has(String(fid))) continue;
      const [a, b] = [String(steamid64), String(fid)].sort();
      if (a === b) continue;
      const key = `${a}\t${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      friendshipRows.push({ steamid64A: a, steamid64B: b });
    }
  }

  // Single transaction reduces Statement churn (important on Node 24)
  db.transaction((tx) => {
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      if (chunk.length) {
        tx.insert(profiles)
          .values(chunk)
          .onConflictDoUpdate({
            target: profiles.steamid64,
            set: {
              steamid: sql`excluded.steamid`,
              personaName: sql`excluded.persona_name`,
              profileUrl: sql`excluded.profile_url`,
              friendsPageUrl: sql`excluded.friends_page_url`,
              avatar: sql`excluded.avatar`,
              timeCreated: sql`excluded.time_created`,
              vacBanned: sql`excluded.vac_banned`,
              vacCount: sql`excluded.vac_count`,
              daysSinceLastBan: sql`excluded.days_since_last_ban`,
              lastBanDate: sql`excluded.last_ban_date`,
              gameBanCount: sql`excluded.game_ban_count`,
              gameBanDaysSinceLast: sql`excluded.game_ban_days_since_last`,
              gameLastBanDate: sql`excluded.game_last_ban_date`,
              communityBanned: sql`excluded.community_banned`,
              economyBan: sql`excluded.economy_ban`,
              scrapedAt: sql`excluded.scraped_at`,
            },
          })
          .run();
      }
    }

    for (let i = 0; i < friendshipRows.length; i += 500) {
      const chunk = friendshipRows.slice(i, i + 500);
      if (chunk.length) {
        tx.insert(friendships).values(chunk).onConflictDoNothing().run();
      }
    }
  });
}

export async function getExistingSteamIds(): Promise<Set<string>> {
  const rows = db.select({ id: profiles.steamid64 }).from(profiles).all();
  return new Set(rows.map((r) => String(r.id)));
}

export async function getStats(): Promise<StatsSummary> {
  const totalProfiles =
    db.select({ c: count() }).from(profiles).get()?.c ?? 0;
  const totalFriendships =
    db.select({ c: count() }).from(friendships).get()?.c ?? 0;
  const vacBannedCount =
    db
      .select({ c: count() })
      .from(profiles)
      .where(eq(profiles.vacBanned, 1))
      .get()?.c ?? 0;
  const gameBannedCount =
    db
      .select({ c: count() })
      .from(profiles)
      .where(gt(profiles.gameBanCount, 0))
      .get()?.c ?? 0;
  const communityBannedCount =
    db
      .select({ c: count() })
      .from(profiles)
      .where(eq(profiles.communityBanned, 1))
      .get()?.c ?? 0;
  return {
    totalProfiles,
    totalFriendships,
    vacBannedCount,
    gameBannedCount,
    communityBannedCount,
  };
}

function searchClause(search: string | null | undefined) {
  if (!search?.trim()) return undefined;
  const s = `%${search.trim()}%`;
  return or(
    like(profiles.personaName, s),
    like(profiles.steamid, s),
    like(profiles.steamid64, s),
  );
}

function vacFilterClauses(filters: BanFilters | null | undefined) {
  const parts = [eq(profiles.vacBanned, 1)];
  const s = searchClause(filters?.search);
  if (s) parts.push(s);
  if (filters?.minVacCount != null && !Number.isNaN(filters.minVacCount)) {
    parts.push(gte(profiles.vacCount, filters.minVacCount));
  }
  if (filters?.maxVacCount != null && !Number.isNaN(filters.maxVacCount)) {
    parts.push(lte(profiles.vacCount, filters.maxVacCount));
  }
  if (filters?.dateFrom) {
    parts.push(gte(profiles.lastBanDate, String(filters.dateFrom).slice(0, 10)));
  }
  if (filters?.dateTo) {
    parts.push(lte(profiles.lastBanDate, String(filters.dateTo).slice(0, 10)));
  }
  return and(...parts);
}

export async function getVacBanned(
  limit = 100,
  offset = 0,
  filters: BanFilters | null = null,
) {
  return db
    .select({
      steamid64: profiles.steamid64,
      steamid: profiles.steamid,
      persona_name: profiles.personaName,
      profile_url: profiles.profileUrl,
      friends_page_url: profiles.friendsPageUrl,
      avatar: profiles.avatar,
      vac_count: profiles.vacCount,
      days_since_last_ban: profiles.daysSinceLastBan,
      last_ban_date: profiles.lastBanDate,
    })
    .from(profiles)
    .where(vacFilterClauses(filters))
    .orderBy(asc(profiles.daysSinceLastBan))
    .limit(limit)
    .offset(offset)
    .all();
}

export async function getVacBannedCount(filters: BanFilters | null = null) {
  return (
    db
      .select({ c: count() })
      .from(profiles)
      .where(vacFilterClauses(filters))
      .get()?.c ?? 0
  );
}

export async function getGameBanned(limit = 100, offset = 0) {
  return db
    .select({
      steamid64: profiles.steamid64,
      steamid: profiles.steamid,
      persona_name: profiles.personaName,
      profile_url: profiles.profileUrl,
      friends_page_url: profiles.friendsPageUrl,
      avatar: profiles.avatar,
      game_ban_count: profiles.gameBanCount,
      game_ban_days_since_last: profiles.gameBanDaysSinceLast,
      game_last_ban_date: profiles.gameLastBanDate,
    })
    .from(profiles)
    .where(gt(profiles.gameBanCount, 0))
    .orderBy(asc(profiles.gameBanDaysSinceLast))
    .limit(limit)
    .offset(offset)
    .all();
}

export async function getGameBannedCount() {
  return (
    db
      .select({ c: count() })
      .from(profiles)
      .where(gt(profiles.gameBanCount, 0))
      .get()?.c ?? 0
  );
}

export async function getCommunityBanned(limit = 100, offset = 0) {
  return db
    .select({
      steamid64: profiles.steamid64,
      steamid: profiles.steamid,
      persona_name: profiles.personaName,
      profile_url: profiles.profileUrl,
      friends_page_url: profiles.friendsPageUrl,
      avatar: profiles.avatar,
    })
    .from(profiles)
    .where(eq(profiles.communityBanned, 1))
    .limit(limit)
    .offset(offset)
    .all();
}

export async function getCommunityBannedCount() {
  return (
    db
      .select({ c: count() })
      .from(profiles)
      .where(eq(profiles.communityBanned, 1))
      .get()?.c ?? 0
  );
}

export async function getAllBanned(
  limit = 100,
  offset = 0,
  search: string | null = null,
) {
  const banned = or(
    eq(profiles.vacBanned, 1),
    gt(profiles.gameBanCount, 0),
    eq(profiles.communityBanned, 1),
  )!;
  const s = searchClause(search);
  return db
    .select({
      steamid64: profiles.steamid64,
      steamid: profiles.steamid,
      persona_name: profiles.personaName,
      profile_url: profiles.profileUrl,
      friends_page_url: profiles.friendsPageUrl,
      avatar: profiles.avatar,
      vac_banned: profiles.vacBanned,
      vac_count: profiles.vacCount,
      days_since_last_ban: profiles.daysSinceLastBan,
      last_ban_date: profiles.lastBanDate,
      game_ban_count: profiles.gameBanCount,
      game_ban_days_since_last: profiles.gameBanDaysSinceLast,
      game_last_ban_date: profiles.gameLastBanDate,
      community_banned: profiles.communityBanned,
    })
    .from(profiles)
    .where(s ? and(banned, s) : banned)
    .orderBy(desc(profiles.scrapedAt))
    .limit(limit)
    .offset(offset)
    .all();
}

export async function getBannedCount(search: string | null = null) {
  const banned = or(
    eq(profiles.vacBanned, 1),
    gt(profiles.gameBanCount, 0),
    eq(profiles.communityBanned, 1),
  )!;
  const s = searchClause(search);
  return (
    db
      .select({ c: count() })
      .from(profiles)
      .where(s ? and(banned, s) : banned)
      .get()?.c ?? 0
  );
}

export async function getProfiles(
  limit = 100,
  offset = 0,
  search: string | null = null,
) {
  const s = searchClause(search);
  return db
    .select()
    .from(profiles)
    .where(s)
    .orderBy(desc(profiles.scrapedAt))
    .limit(limit)
    .offset(offset)
    .all()
    .map(mapProfileApi);
}

export async function getProfilesCount(search: string | null = null) {
  const s = searchClause(search);
  return (
    db.select({ c: count() }).from(profiles).where(s).get()?.c ?? 0
  );
}

export async function getSearchProfiles(query: string, limit = 12) {
  const s = `%${query.trim()}%`;
  return db
    .select({
      steamid64: profiles.steamid64,
      steamid: profiles.steamid,
      persona_name: profiles.personaName,
      avatar: profiles.avatar,
    })
    .from(profiles)
    .where(
      or(
        like(profiles.personaName, s),
        like(profiles.steamid, s),
        like(profiles.steamid64, s),
      ),
    )
    .limit(limit)
    .all();
}

function mapProfileApi(r: typeof profiles.$inferSelect) {
  return {
    steamid64: r.steamid64,
    steamid: r.steamid,
    persona_name: r.personaName,
    profile_url: r.profileUrl,
    friends_page_url: r.friendsPageUrl,
    avatar: r.avatar,
    time_created: r.timeCreated,
    vac_banned: r.vacBanned,
    vac_count: r.vacCount,
    days_since_last_ban: r.daysSinceLastBan,
    last_ban_date: r.lastBanDate,
    game_ban_count: r.gameBanCount,
    game_ban_days_since_last: r.gameBanDaysSinceLast,
    game_last_ban_date: r.gameLastBanDate,
    community_banned: r.communityBanned,
    economy_ban: r.economyBan,
    scraped_at: r.scrapedAt,
  };
}

export async function getProfile(steamid64: string) {
  const row = db
    .select()
    .from(profiles)
    .where(eq(profiles.steamid64, steamid64))
    .get();
  return row ? mapProfileApi(row) : null;
}

export async function getFriendCount(steamid64: string) {
  return (
    db
      .select({ c: count() })
      .from(friendships)
      .where(
        or(
          eq(friendships.steamid64A, steamid64),
          eq(friendships.steamid64B, steamid64),
        ),
      )
      .get()?.c ?? 0
  );
}

export async function getFriendBannedCount(steamid64: string) {
  const banned = or(
    eq(profiles.vacBanned, 1),
    gt(profiles.gameBanCount, 0),
    eq(profiles.communityBanned, 1),
  )!;
  const countB =
    db
      .select({ c: count() })
      .from(friendships)
      .innerJoin(profiles, eq(profiles.steamid64, friendships.steamid64B))
      .where(and(eq(friendships.steamid64A, steamid64), banned))
      .get()?.c ?? 0;
  const countA =
    db
      .select({ c: count() })
      .from(friendships)
      .innerJoin(profiles, eq(profiles.steamid64, friendships.steamid64A))
      .where(and(eq(friendships.steamid64B, steamid64), banned))
      .get()?.c ?? 0;
  return Number(countA) + Number(countB);
}

export async function getBannedFriends(steamid64: string) {
  const banned = or(
    eq(profiles.vacBanned, 1),
    gt(profiles.gameBanCount, 0),
    eq(profiles.communityBanned, 1),
  )!;

  // Friendships store ordered pairs (a < b); query both sides
  const asFriendB = db
    .select({ profile: profiles })
    .from(friendships)
    .innerJoin(profiles, eq(profiles.steamid64, friendships.steamid64B))
    .where(and(eq(friendships.steamid64A, steamid64), banned))
    .all();
  const asFriendA = db
    .select({ profile: profiles })
    .from(friendships)
    .innerJoin(profiles, eq(profiles.steamid64, friendships.steamid64A))
    .where(and(eq(friendships.steamid64B, steamid64), banned))
    .all();

  return [...asFriendB, ...asFriendA].map((r) => mapProfileApi(r.profile));
}

export async function getBanStatsOverTime(year: number | null = null) {
  const yearFilter =
    year != null
      ? sql`AND substr(scraped_at, 1, 4) = ${String(year)}`
      : sql``;
  const rows = db.all<{
    month: string;
    vac: number;
    game: number;
    community: number;
    total: number;
  }>(sql`
    SELECT substr(scraped_at, 1, 7) AS month,
      SUM(CASE WHEN vac_banned = 1 THEN 1 ELSE 0 END) AS vac,
      SUM(CASE WHEN game_ban_count > 0 THEN 1 ELSE 0 END) AS game,
      SUM(CASE WHEN community_banned = 1 THEN 1 ELSE 0 END) AS community,
      COUNT(*) AS total
    FROM profiles
    WHERE scraped_at IS NOT NULL ${yearFilter}
    GROUP BY month
    ORDER BY month
  `);
  return rows.map((r) => ({
    month: r.month,
    vac: Number(r.vac),
    game: Number(r.game),
    community: Number(r.community),
    total: Number(r.total),
  }));
}

export async function getBanStatsYears() {
  const rows = db.all<{ y: string }>(sql`
    SELECT DISTINCT substr(scraped_at, 1, 4) AS y
    FROM profiles
    WHERE scraped_at IS NOT NULL AND length(scraped_at) >= 4
    ORDER BY y DESC
  `);
  return rows
    .map((r) => parseInt(r.y, 10))
    .filter((y) => !Number.isNaN(y));
}

export async function getBanStatsByBanDate(year: number | null = null) {
  const yearFilterVac =
    year != null
      ? sql`AND substr(last_ban_date, 1, 4) = ${String(year)}`
      : sql``;
  const yearFilterGame =
    year != null
      ? sql`AND substr(game_last_ban_date, 1, 4) = ${String(year)}`
      : sql``;

  const vacRows = db.all<{ month: string; vac: number }>(sql`
    SELECT substr(last_ban_date, 1, 7) AS month, COUNT(*) AS vac
    FROM profiles
    WHERE vac_banned = 1 AND last_ban_date IS NOT NULL ${yearFilterVac}
    GROUP BY month
  `);
  const gameRows = db.all<{ month: string; game: number }>(sql`
    SELECT substr(game_last_ban_date, 1, 7) AS month, COUNT(*) AS game
    FROM profiles
    WHERE game_ban_count > 0 AND game_last_ban_date IS NOT NULL ${yearFilterGame}
    GROUP BY month
  `);

  const byMonth = new Map<string, { month: string; vac: number; game: number }>();
  for (const r of vacRows) {
    byMonth.set(r.month, { month: r.month, vac: Number(r.vac), game: 0 });
  }
  for (const r of gameRows) {
    const cur = byMonth.get(r.month) ?? { month: r.month, vac: 0, game: 0 };
    cur.game = Number(r.game);
    byMonth.set(r.month, cur);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export async function getBanStatsYearsByBanDate() {
  const rows = db.all<{ y: string }>(sql`
    SELECT DISTINCT substr(last_ban_date, 1, 4) AS y
    FROM profiles
    WHERE vac_banned = 1 AND last_ban_date IS NOT NULL AND length(last_ban_date) >= 4
    UNION
    SELECT DISTINCT substr(game_last_ban_date, 1, 4) AS y
    FROM profiles
    WHERE game_ban_count > 0 AND game_last_ban_date IS NOT NULL AND length(game_last_ban_date) >= 4
    ORDER BY y DESC
  `);
  return rows
    .map((r) => parseInt(r.y, 10))
    .filter((y) => !Number.isNaN(y))
    .sort((a, b) => b - a);
}

export async function getProfilesWithoutVacBan(limit = 100, offset = 0) {
  return db
    .select({ steamid64: profiles.steamid64 })
    .from(profiles)
    .where(eq(profiles.vacBanned, 0))
    .orderBy(asc(profiles.steamid64))
    .limit(limit)
    .offset(offset)
    .all();
}

export async function updateProfileVacStatus(
  steamid64: string,
  payload: {
    vac_banned: number;
    vac_count: number;
    days_since_last_ban?: number | null;
    last_ban_date?: string | null;
  },
) {
  db.update(profiles)
    .set({
      vacBanned: payload.vac_banned,
      vacCount: payload.vac_count,
      daysSinceLastBan: payload.days_since_last_ban ?? null,
      lastBanDate: payload.last_ban_date ?? null,
    })
    .where(eq(profiles.steamid64, steamid64))
    .run();
}

export async function getSetting(key: string): Promise<string | null> {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  const raw = row?.value ?? null;
  if (raw && SECRET_KEYS.has(key)) {
    return decryptSecret(raw) ?? raw;
  }
  return raw;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  let valueToStore = value;
  if (SECRET_KEYS.has(key) && value) {
    valueToStore = encryptSecret(value);
  }
  db.insert(settings)
    .values({ key, value: valueToStore })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: valueToStore },
    })
    .run();
}

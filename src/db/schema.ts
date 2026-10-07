import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * SQLite schema (default). Postgres uses the same logical model via drizzle push
 * / manual SQL in supabase/schema.sql.
 */
export const profiles = sqliteTable(
  "profiles",
  {
    steamid64: text("steamid64").primaryKey(),
    steamid: text("steamid"),
    personaName: text("persona_name"),
    profileUrl: text("profile_url"),
    friendsPageUrl: text("friends_page_url"),
    avatar: text("avatar"),
    timeCreated: text("time_created"),
    vacBanned: integer("vac_banned").default(0).notNull(),
    vacCount: integer("vac_count").default(0).notNull(),
    daysSinceLastBan: integer("days_since_last_ban"),
    lastBanDate: text("last_ban_date"),
    gameBanCount: integer("game_ban_count").default(0).notNull(),
    gameBanDaysSinceLast: integer("game_ban_days_since_last"),
    gameLastBanDate: text("game_last_ban_date"),
    communityBanned: integer("community_banned").default(0).notNull(),
    economyBan: text("economy_ban"),
    scrapedAt: text("scraped_at").default(sql`(datetime('now'))`),
  },
  (t) => [
    index("idx_profiles_vac").on(t.vacBanned),
    index("idx_profiles_game").on(t.gameBanCount),
    index("idx_profiles_community").on(t.communityBanned),
    index("idx_profiles_scraped").on(t.scrapedAt),
    index("idx_profiles_last_ban").on(t.lastBanDate),
    index("idx_profiles_game_last_ban").on(t.gameLastBanDate),
    index("idx_profiles_persona").on(t.personaName),
  ],
);

export const friendships = sqliteTable(
  "friendships",
  {
    steamid64A: text("steamid64_a").notNull(),
    steamid64B: text("steamid64_b").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.steamid64A, t.steamid64B] }),
    check("friendships_ordered", sql`${t.steamid64A} < ${t.steamid64B}`),
    index("idx_friendships_a").on(t.steamid64A),
    index("idx_friendships_b").on(t.steamid64B),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export type ProfileRow = typeof profiles.$inferSelect;
export type FriendshipRow = typeof friendships.$inferSelect;

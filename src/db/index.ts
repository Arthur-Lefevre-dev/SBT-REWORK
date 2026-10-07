import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../env.js";
import * as schema from "./schema.js";

let sqliteRaw: Database.Database | null = null;

export function getDbBackend(): "sqlite" {
  return "sqlite";
}

function getSqlite() {
  if (!sqliteRaw) {
    sqliteRaw = new Database(env.SQLITE_PATH);
    sqliteRaw.pragma("journal_mode = WAL");
    sqliteRaw.pragma("foreign_keys = ON");
    sqliteRaw.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        steamid64 TEXT PRIMARY KEY,
        steamid TEXT,
        persona_name TEXT,
        profile_url TEXT,
        friends_page_url TEXT,
        avatar TEXT,
        time_created TEXT,
        vac_banned INTEGER DEFAULT 0 NOT NULL,
        vac_count INTEGER DEFAULT 0 NOT NULL,
        days_since_last_ban INTEGER,
        last_ban_date TEXT,
        game_ban_count INTEGER DEFAULT 0 NOT NULL,
        game_ban_days_since_last INTEGER,
        game_last_ban_date TEXT,
        community_banned INTEGER DEFAULT 0 NOT NULL,
        economy_ban TEXT,
        scraped_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS friendships (
        steamid64_a TEXT NOT NULL,
        steamid64_b TEXT NOT NULL,
        PRIMARY KEY (steamid64_a, steamid64_b),
        CHECK (steamid64_a < steamid64_b)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_profiles_vac ON profiles(vac_banned);
      CREATE INDEX IF NOT EXISTS idx_profiles_game ON profiles(game_ban_count);
      CREATE INDEX IF NOT EXISTS idx_profiles_community ON profiles(community_banned);
      CREATE INDEX IF NOT EXISTS idx_profiles_scraped ON profiles(scraped_at);
      CREATE INDEX IF NOT EXISTS idx_profiles_last_ban ON profiles(last_ban_date);
      CREATE INDEX IF NOT EXISTS idx_profiles_game_last_ban ON profiles(game_last_ban_date);
      CREATE INDEX IF NOT EXISTS idx_profiles_persona ON profiles(persona_name);
      CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(steamid64_a);
      CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(steamid64_b);
    `);
  }
  return sqliteRaw;
}

export const db = drizzle(getSqlite(), { schema });

export async function pingDb(): Promise<void> {
  getSqlite().prepare("SELECT 1").get();
}

export function closeDb(): void {
  if (sqliteRaw) {
    try {
      sqliteRaw.close();
    } catch {
      /* ignore */
    }
    sqliteRaw = null;
  }
}

export { schema };

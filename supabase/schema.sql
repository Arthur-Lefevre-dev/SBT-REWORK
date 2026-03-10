-- Supabase (PostgreSQL) schema for Steam Ban Tracker
-- Run this in Supabase Dashboard > SQL Editor

-- Profiles table (same structure as SQLite)
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
  scraped_at TIMESTAMPTZ DEFAULT now()
);

-- Friendships table (unordered pairs, a < b)
CREATE TABLE IF NOT EXISTS friendships (
  steamid64_a TEXT NOT NULL,
  steamid64_b TEXT NOT NULL,
  PRIMARY KEY (steamid64_a, steamid64_b),
  CHECK (steamid64_a < steamid64_b)
);

CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(steamid64_a);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(steamid64_b);

-- Settings table (admin: Steam API key override, default starting profile, etc.)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Row Level Security: enabled on both tables. Backend using SUPABASE_SERVICE_ROLE_KEY bypasses RLS.
-- Without policies, anon/authenticated roles have no access (secure by default).
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Optional: allow public read-only for dashboard (uncomment if you use anon key from a client).
-- CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
-- CREATE POLICY "friendships_select" ON friendships FOR SELECT USING (true);

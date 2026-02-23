#!/usr/bin/env node
/**
 * Migrate data from SQLite (steam-data.db) to Supabase.
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env
 * Run: node scripts/migrate-sqlite-to-supabase.js
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'steam-data.db');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const BATCH_SIZE = 200;

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Check that Supabase tables exist (run supabase/schema.sql in SQL Editor first)
  const { error: tableError } = await supabase.from('profiles').select('steamid64').limit(1);
  if (tableError && tableError.code === 'PGRST205') {
    console.error('Tables not found in Supabase. Create them first:');
    console.error('  1. Open Supabase Dashboard → SQL Editor');
    console.error('  2. Copy/paste the content of supabase/schema.sql');
    console.error('  3. Run the query');
    console.error('  4. Run this migration again.');
    process.exit(1);
  }
  if (tableError && tableError.code !== 'PGRST116') {
    console.error('Supabase check error:', tableError);
    process.exit(1);
  }

  // 1. Migrate profiles
  const profiles = db.prepare('SELECT * FROM profiles').all();
  console.log(`Found ${profiles.length} profiles in SQLite.`);

  for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
    const batch = profiles.slice(i, i + BATCH_SIZE);
    const rows = batch.map((p) => ({
      steamid64: p.steamid64,
      steamid: p.steamid,
      persona_name: p.persona_name,
      profile_url: p.profile_url,
      friends_page_url: p.friends_page_url,
      avatar: p.avatar,
      time_created: p.time_created,
      vac_banned: p.vac_banned ?? 0,
      vac_count: p.vac_count ?? 0,
      days_since_last_ban: p.days_since_last_ban,
      last_ban_date: p.last_ban_date,
      game_ban_count: p.game_ban_count ?? 0,
      game_ban_days_since_last: p.game_ban_days_since_last ?? null,
      game_last_ban_date: p.game_last_ban_date ?? null,
      community_banned: p.community_banned ?? 0,
      economy_ban: p.economy_ban ?? null,
      scraped_at: p.scraped_at ?? new Date().toISOString(),
    }));
    const { error } = await supabase.from('profiles').upsert(rows, { onConflict: 'steamid64' });
    if (error) {
      console.error('Profiles batch error:', error);
      process.exit(1);
    }
    console.log(`  Profiles: ${Math.min(i + BATCH_SIZE, profiles.length)} / ${profiles.length}`);
  }

  // 2. Migrate friendships
  const friendships = db.prepare('SELECT steamid64_a, steamid64_b FROM friendships').all();
  console.log(`Found ${friendships.length} friendships in SQLite.`);

  for (let i = 0; i < friendships.length; i += BATCH_SIZE) {
    const batch = friendships.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('friendships').upsert(batch, {
      onConflict: 'steamid64_a,steamid64_b',
    });
    if (error) {
      console.error('Friendships batch error:', error);
      process.exit(1);
    }
    console.log(`  Friendships: ${Math.min(i + BATCH_SIZE, friendships.length)} / ${friendships.length}`);
  }

  db.close();
  console.log('Migration done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

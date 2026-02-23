/**
 * Supabase client (server-side). Use service role key for full access.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let client = null;

export function getSupabase() {
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) must be set');
  }
  if (!client) {
    client = createClient(url, key);
  }
  return client;
}

export function isSupabaseConfigured() {
  return Boolean(url && key);
}

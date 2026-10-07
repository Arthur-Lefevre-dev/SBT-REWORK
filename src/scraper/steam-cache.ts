/**
 * In-memory TTL cache for Steam Web API responses.
 * Cuts repeat calls during scrape / resume (friends, summaries, bans).
 */

type Entry = { value: unknown; expires: number };

const store = new Map<string, Entry>();
let hits = 0;
let misses = 0;

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) {
    misses++;
    return undefined;
  }
  if (Date.now() > e.expires) {
    store.delete(key);
    misses++;
    return undefined;
  }
  hits++;
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number) {
  store.set(key, { value, expires: Date.now() + ttlMs });
  // Soft cap to avoid unbounded growth
  if (store.size > 50_000) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (v.expires < now) store.delete(k);
      if (store.size <= 40_000) break;
    }
  }
}

export function cacheStats() {
  return { size: store.size, hits, misses };
}

export function cacheClear() {
  store.clear();
  hits = 0;
  misses = 0;
}

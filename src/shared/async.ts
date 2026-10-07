export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Run async tasks with a max concurrency limit. */
export async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const concurrency = Math.max(1, limit);
  const executing = new Set<Promise<unknown>>();
  const results: Promise<T>[] = [];
  for (const [i, fn] of tasks.entries()) {
    let p!: Promise<T>;
    p = Promise.resolve()
      .then(fn)
      .finally(() => {
        executing.delete(p);
      });
    results[i] = p;
    executing.add(p);
    if (executing.size >= concurrency) {
      // Ignore individual failures here — Promise.all below surfaces them
      await Promise.race(executing).catch(() => undefined);
    }
  }
  return Promise.all(results);
}

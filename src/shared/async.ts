export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Run async tasks with a max concurrency limit. */
export async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const executing: Promise<unknown>[] = [];
  const results: Promise<T>[] = [];
  for (const [i, fn] of tasks.entries()) {
    const p = Promise.resolve()
      .then(fn)
      .then((r) => {
        executing.splice(executing.indexOf(p), 1);
        return r;
      });
    results[i] = p;
    executing.push(p);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

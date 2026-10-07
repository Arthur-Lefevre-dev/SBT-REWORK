import assert from "node:assert/strict";
import { test } from "node:test";
import { pLimit, sleep } from "./async.js";

test("sleep waits at least the requested ms", async () => {
  const t0 = Date.now();
  await sleep(30);
  assert.ok(Date.now() - t0 >= 25);
});

test("pLimit respects concurrency", async () => {
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 6 }, (_, i) => async () => {
    active++;
    peak = Math.max(peak, active);
    await sleep(20);
    active--;
    return i;
  });
  const out = await pLimit(tasks, 2);
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5]);
  assert.ok(peak <= 2);
});

test("pLimit surfaces rejection without hanging", async () => {
  const tasks = [
    async () => 1,
    async () => {
      await sleep(10);
      throw new Error("boom");
    },
    async () => 3,
  ];
  await assert.rejects(() => pLimit(tasks, 2), /boom/);
});

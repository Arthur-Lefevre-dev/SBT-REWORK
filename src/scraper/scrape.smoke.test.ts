/**
 * Smoke test: one live Steam API summaries call + cache hit (needs STEAM_API_KEY).
 * Skips automatically when key is missing or Steam returns empty.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { env } from "../env.js";
import { FriendshipGraph } from "./graph.js";
import {
  getPlayerSummaries,
  getSteamApiCacheStats,
  steamId64ToSteamId,
} from "./steam-api.js";

const SAMPLE = "76561198148292752";

test("smoke: Steam summaries + cache (skip if no key / empty)", async (t) => {
  if (!env.STEAM_API_KEY) {
    t.skip("STEAM_API_KEY not set");
    return;
  }
  let a;
  try {
    a = await getPlayerSummaries(env.STEAM_API_KEY, [SAMPLE]);
  } catch (e) {
    t.skip(`Steam API error: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (!a.length) {
    t.skip("Steam returned no players (key/privacy?)");
    return;
  }
  assert.equal(a[0].steamid, SAMPLE);
  const before = getSteamApiCacheStats();
  const b = await getPlayerSummaries(env.STEAM_API_KEY, [SAMPLE]);
  const after = getSteamApiCacheStats();
  assert.equal(b[0].steamid, SAMPLE);
  assert.ok(after.hits > before.hits, "second call should hit cache");
});

test("FriendshipGraph + steamId helper still coherent", () => {
  const g = new FriendshipGraph();
  g.addProfile(SAMPLE, {
    steamId64: SAMPLE,
    steamId: steamId64ToSteamId(SAMPLE),
    personaName: "Test",
    profileUrl: null,
    friendsPageUrl: null,
    avatar: null,
    createdAt: null,
    ban: {
      communityBanned: false,
      vacBanned: true,
      numberOfVACBans: 1,
      daysSinceLastBan: 10,
      lastBanDate: null,
      numberOfGameBans: 0,
      economyBan: "none",
    },
  });
  g.addFriendship(SAMPLE, "76561198011775992");
  const json = g.toJSON();
  assert.ok(json.profiles[SAMPLE].ban?.vacBanned);
  assert.ok(json.adjacency[SAMPLE].includes("76561198011775992"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { isSteamRateLimitError, steamId64ToSteamId, SteamRateLimitError } from "./steam-api.js";

test("steamId64ToSteamId converts known account", () => {
  // Gabe Newell's public SteamID64 → STEAM_0/1 form (universe 1)
  assert.equal(steamId64ToSteamId("76561197960265728"), "STEAM_1:0:0");
  assert.equal(steamId64ToSteamId("76561198011775992"), "STEAM_1:0:25755132");
});

test("isSteamRateLimitError detects custom error and status", () => {
  assert.equal(isSteamRateLimitError(new SteamRateLimitError(429)), true);
  assert.equal(isSteamRateLimitError({ status: 503 }), true);
  assert.equal(isSteamRateLimitError(new Error("nope")), false);
});

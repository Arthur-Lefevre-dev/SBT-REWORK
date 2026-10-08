#!/usr/bin/env node
import { closeDb, getDbBackend } from "../db/index.js";
import {
  getExistingSteamIds,
  getResumeHubIds,
  getStats,
  saveGraph,
} from "../db/queries.js";
import { env } from "../env.js";
import { isProxyEnabled, verifyProxyPool } from "./proxy.js";
import { scrape } from "./scrape.js";
import { loadProxiesFromSettings } from "../server/load-proxies.js";

const apiKey = env.STEAM_API_KEY;
if (!apiKey) {
  console.error("STEAM_API_KEY is required");
  process.exit(1);
}

console.log(`Database: ${getDbBackend()} (${env.SQLITE_PATH})`);
await loadProxiesFromSettings();
if (isProxyEnabled()) {
  try {
    await verifyProxyPool();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

try {
  await getStats();
  console.log("DB connection OK\n");
} catch (e) {
  console.error("DB connection failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}

const startSteamId64 = process.argv[2] ?? "76561198011775992";
const maxDepthArg = parseInt(process.argv[3] ?? "2", 10);
const maxProfilesArg = parseInt(process.argv[4] ?? "100", 10);
const maxDepth = maxDepthArg === 0 ? Infinity : maxDepthArg;
const maxProfiles = maxProfilesArg === 0 ? Infinity : maxProfilesArg;

console.log(`Scraping from ${startSteamId64}`);
console.log(
  `Max depth: ${maxDepthArg === 0 ? "∞" : maxDepth} | Max profiles: ${maxProfilesArg === 0 ? "∞" : maxProfiles}`,
);

let knownIds = new Set<string>();
let resumeExpandIds: string[] = [];
try {
  knownIds = await getExistingSteamIds();
  if (knownIds.has(String(startSteamId64))) {
    resumeExpandIds = await getResumeHubIds(String(startSteamId64), 12);
    console.log(
      `Resume mode: start already in DB. ${knownIds.size} known, ${resumeExpandIds.length} expand hubs.\n`,
    );
  } else if (knownIds.size) {
    console.log(`${knownIds.size} profiles already in DB (skipped).\n`);
  }
} catch (e) {
  console.error("Failed to read existing IDs:", e instanceof Error ? e.message : e);
  process.exit(1);
}

const graph = await scrape(apiKey, startSteamId64, {
  maxDepth,
  maxProfiles,
  knownIds,
  resumeExpandIds,
  parallelBatches: 5,
  saveInterval: 800,
  onSave: async (g) => {
    await saveGraph(g);
  },
});

await saveGraph(graph);
const stats = await getStats();
console.log("\nDone.");
console.log(
  `Profiles: ${stats.totalProfiles} | Friendships: ${stats.totalFriendships} | VAC: ${stats.vacBannedCount}`,
);
closeDb();
process.exit(0);

#!/usr/bin/env node
/**
 * Steam profile scraper - entry point
 * Usage: STEAM_API_KEY=xxx node index.js [startSteamId64] [maxDepth] [maxProfiles]
 * Or: node index.js (uses .env for STEAM_API_KEY)
 */

import 'dotenv/config';
import { scrape } from './steam-scraper.js';
import { computeStats, printStats } from './stats.js';
import { saveGraph } from './database.js';
import fs from 'fs';
import path from 'path';

const apiKey = process.env.STEAM_API_KEY;

if (!apiKey) {
  console.error('Variable STEAM_API_KEY requise. Obtenez une clé sur https://steamcommunity.com/dev/apikey');
  process.exit(1);
}

// Default start: your own profile or a known test profile
const startSteamId64 = process.argv[2] ?? '76561198011775992'; // Example SteamID64
const maxDepthArg = parseInt(process.argv[3] ?? '2', 10);
const maxProfilesArg = parseInt(process.argv[4] ?? '100', 10);
// 0 0 = unlimited (never stops)
const maxDepth = maxDepthArg === 0 ? Infinity : maxDepthArg;
const maxProfiles = maxProfilesArg === 0 ? Infinity : maxProfilesArg;

console.log(`Démarrage du scraping depuis ${startSteamId64}`);
console.log(`Profondeur max: ${maxDepthArg === 0 ? '∞' : maxDepth} | Profils max: ${maxProfilesArg === 0 ? '∞' : maxProfiles}\n`);

const graph = await scrape(apiKey, startSteamId64, {
  maxDepth,
  maxProfiles,
  verbose: true
});

const stats = computeStats(graph);
printStats(stats);

// Save to SQLite
saveGraph(graph);
console.log('\nDonnées enregistrées dans steam-data.db');

// Export data (optional backup)
const outputDir = path.join(process.cwd(), 'output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const baseName = `steam-scrape-${timestamp}`;

fs.writeFileSync(
  path.join(outputDir, `${baseName}.json`),
  JSON.stringify(graph.toJSON(), null, 2),
  'utf8'
);
fs.writeFileSync(
  path.join(outputDir, `${baseName}-stats.json`),
  JSON.stringify(stats, null, 2),
  'utf8'
);

console.log(`\nExport JSON: ./output/${baseName}-stats.json`);

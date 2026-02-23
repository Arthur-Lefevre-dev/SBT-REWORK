#!/usr/bin/env node
/**
 * Steam profile scraper - entry point
 * Usage: STEAM_API_KEY=xxx node index.js [startSteamId64] [maxDepth] [maxProfiles]
 * Or: node index.js (uses .env for STEAM_API_KEY)
 */

import 'dotenv/config';
import { scrape } from './src/steam-scraper.js';
import { computeStats, printStats } from './src/stats.js';
import { saveGraph, getExistingSteamIds, getStats, getDbBackend } from './src/db/index.js';
import fs from 'fs';
import path from 'path';

const apiKey = process.env.STEAM_API_KEY;

if (!apiKey) {
  console.error('Variable STEAM_API_KEY requise. Obtenez une clé sur https://steamcommunity.com/dev/apikey');
  process.exit(1);
}

const dbBackend = getDbBackend();
console.log(`Base de données: ${dbBackend}`);

// Verify DB connection before starting (read test)
try {
  await getStats();
  console.log(`Connexion DB OK (${dbBackend}).\n`);
} catch (e) {
  console.error('Impossible de se connecter à la base de données:');
  console.error(e?.message || e);
  if (dbBackend === 'supabase') {
    console.error('Vérifiez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env');
    console.error('Et que les tables existent (exécutez supabase/schema.sql dans le SQL Editor).');
  } else {
    console.error('Vérifiez que le répertoire du projet est accessible (SQLite crée steam-data.db si besoin).');
  }
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
console.log(`Profondeur max: ${maxDepthArg === 0 ? '∞' : maxDepth} | Profils max: ${maxProfilesArg === 0 ? '∞' : maxProfiles}`);

let knownIds = new Set();
try {
  knownIds = await getExistingSteamIds();
  const startId = String(startSteamId64);
  if (knownIds.has(startId)) knownIds.delete(startId); // Always crawl start profile for fresh data + friends
  if (knownIds.size > 0) {
    console.log(`${knownIds.size} profils déjà en base (seront ignorés pour éviter de re-crawler).\n`);
  }
} catch (e) {
  console.error('Erreur lecture profils existants:', e?.message || e);
  process.exit(1);
}

const graph = await scrape(apiKey, startSteamId64, {
  maxDepth,
  maxProfiles,
  knownIds,
  parallelBatches: 3,
  saveInterval: 200,
  onSave: saveGraph,
  verbose: true
});

const stats = computeStats(graph);
printStats(stats);

// Save to database (SQLite or Supabase)
try {
  await saveGraph(graph);
  console.log('\nDonnées enregistrées.');
} catch (e) {
  console.error('\nErreur lors de la sauvegarde en base:', e?.message || e);
  process.exit(1);
}

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

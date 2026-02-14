#!/usr/bin/env node
/**
 * Compute and print stats from a previously saved graph JSON file
 * Usage: node stats-from-file.js output/steam-scrape-2024-01-01T12-00-00.json
 */

import { FriendshipGraph } from './friendship-graph.js';
import { computeStats, printStats, getFriendshipPairs } from './stats.js';
import fs from 'fs';
import path from 'path';

const filePath = process.argv[2];
if (!filePath || !fs.existsSync(filePath)) {
  console.error('Usage: node stats-from-file.js <path-to-graph.json>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const graph = FriendshipGraph.fromJSON(raw);
const stats = computeStats(graph);
printStats(stats);

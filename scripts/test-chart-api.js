#!/usr/bin/env node
/**
 * Test script: verify stats-over-time and stats-years APIs work.
 * Run from project root: node scripts/test-chart-api.js
 */

import { getBanStatsOverTime, getBanStatsYears, getDb } from '../database.js';

const db = getDb();
console.log('Testing chart data...\n');

const years = getBanStatsYears();
console.log('Years:', years);

const all = getBanStatsOverTime(db, null);
console.log('Stats (Toutes), rows:', all.length);
if (all.length > 0) {
  console.log('First 3:', all.slice(0, 3));
  console.log('Last 3:', all.slice(-3));
}

if (years.length > 0) {
  const oneYear = getBanStatsOverTime(db, years[0]);
  console.log('\nStats for year', years[0], ', rows:', oneYear.length);
  if (oneYear.length > 0) console.log('First 2:', oneYear.slice(0, 2));
}

console.log('\nDone.');

/**
 * Web server for Steam ban tracking dashboard
 * Run: npm run server
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getStats,
  getVacBanned,
  getGameBanned,
  getCommunityBanned,
  getAllBanned,
  getBannedCount,
  getProfiles,
  getProfilesCount,
  getBanStatsOverTime,
  getBanStatsYears,
  getBanStatsByBanDate,
  getBanStatsYearsByBanDate
} from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.static(path.join(__dirname, 'public')));

// API: summary stats
app.get('/api/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: all banned (VAC, Game, Community) - paginated
app.get('/api/banned', (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? '10', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const search = req.query.search || null;
    const rows = getAllBanned(undefined, limit, offset, search);
    const total = getBannedCount(undefined, search);
    res.json({ rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: VAC banned
app.get('/api/vac-banned', (req, res) => {
  try {
    const rows = getVacBanned();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Game banned
app.get('/api/game-banned', (req, res) => {
  try {
    const rows = getGameBanned();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Community banned
app.get('/api/community-banned', (req, res) => {
  try {
    const rows = getCommunityBanned();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: ban stats over time (for chart), optional ?year=2024&by=ban
// by=ban => by last_ban_date (VAC only, so bans from 135 days ago show at that date)
app.get('/api/stats-over-time', (req, res) => {
  try {
    const y = req.query.year;
    const year = y !== undefined && y !== '' ? parseInt(String(y), 10) : null;
    const byBan = req.query.by === 'ban';
    const rows = byBan
      ? getBanStatsByBanDate(undefined, Number.isNaN(year) ? null : year)
      : getBanStatsOverTime(undefined, Number.isNaN(year) ? null : year);
    res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error('/api/stats-over-time', err);
    res.status(500).json({ error: err.message });
  }
});

// API: available years for chart filter (by=ban for years with ban dates)
app.get('/api/stats-years', (req, res) => {
  try {
    const byBan = req.query.by === 'ban';
    const years = byBan ? getBanStatsYearsByBanDate() : getBanStatsYears();
    res.json(years);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: profiles (paginated)
app.get('/api/profiles', (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? '10', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const search = req.query.search || null;
    const rows = getProfiles(undefined, limit, offset, search);
    const total = getProfilesCount(undefined, search);
    res.json({ rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Interface stats: http://localhost:${PORT}`);
});

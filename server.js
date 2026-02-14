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
  getProfiles
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

// API: all banned (VAC, Game, Community)
app.get('/api/banned', (req, res) => {
  try {
    const rows = getAllBanned();
    res.json(rows);
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

// API: profiles (paginated)
app.get('/api/profiles', (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? '50', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const rows = getProfiles(undefined, limit, offset);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Interface stats: http://localhost:${PORT}`);
});

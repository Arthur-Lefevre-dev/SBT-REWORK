/**
 * Web server for Steam ban tracking dashboard
 * Run: npm run server
 */

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getStats,
  getVacBanned,
  getVacBannedCount,
  getGameBanned,
  getGameBannedCount,
  getCommunityBanned,
  getCommunityBannedCount,
  getAllBanned,
  getBannedCount,
  getProfiles,
  getProfilesCount,
  getSearchProfiles,
  getProfile,
  getFriendCount,
  getFriendBannedCount,
  getBannedFriends,
  getBanStatsOverTime,
  getBanStatsYears,
  getBanStatsByBanDate,
  getBanStatsYearsByBanDate
} from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 3000;

// Profile page (must be before static so /profile/:id is handled here)
app.get('/profile/:steamid64', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

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

// API: VAC banned (paginated)
app.get('/api/vac-banned', (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? '10', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const rows = getVacBanned(undefined, limit, offset);
    const total = getVacBannedCount();
    res.json({ rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Game banned (paginated)
app.get('/api/game-banned', (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? '10', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const rows = getGameBanned(undefined, limit, offset);
    const total = getGameBannedCount();
    res.json({ rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Community banned (paginated)
app.get('/api/community-banned', (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? '10', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const rows = getCommunityBanned(undefined, limit, offset);
    const total = getCommunityBannedCount();
    res.json({ rows, total });
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

// API: search profiles (suggestions for search bar)
app.get('/api/search', (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit ?? '12', 10), 20);
    const rows = q.length >= 2 ? getSearchProfiles(undefined, q, limit) : [];
    res.json(rows);
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

// API: single profile (for profile page), optionally with Faceit ELO
app.get('/api/profile/:steamid64', async (req, res) => {
  try {
    const steamid64 = req.params.steamid64;
    const profile = getProfile(undefined, steamid64);
    if (!profile) {
      return res.status(404).json({ error: 'Profil non trouvé' });
    }
    const friendCount = getFriendCount(undefined, steamid64);
    const friendBannedCount = getFriendBannedCount(undefined, steamid64);
    const friend_ban_percentage =
      friendCount > 0
        ? Math.round((friendBannedCount / friendCount) * 100)
        : null;
    const payload = {
      ...profile,
      friend_count: friendCount,
      friend_banned_count: friendBannedCount,
      friend_ban_percentage,
      friends_banned: getBannedFriends(undefined, steamid64)
    };
    const faceitKey = process.env.FACEIT_API_KEY;
    if (faceitKey) {
      try {
        const faceitRes = await fetch(
          `https://open.faceit.com/data/v4/players?game=cs2&game_player_id=${encodeURIComponent(steamid64)}`,
          { headers: { Authorization: `Bearer ${faceitKey}` } }
        );
        if (faceitRes.ok) {
          const faceit = await faceitRes.json();
          const cs2 = faceit.games?.cs2;
          if (cs2 != null) {
            payload.faceit_elo = cs2.faceit_elo ?? null;
            payload.faceit_skill_level = cs2.skill_level ?? null;
            let faceitUrl = faceit.faceit_url ?? null;
            // API returns URL with {lang} placeholder; normalize to /fr/players/ or /en/players/
            if (typeof faceitUrl === 'string') {
              faceitUrl = faceitUrl.replace(/\/\{lang\}\/?/g, '/').replace(/%7Blang%7D\/?/gi, '');
            }
            payload.faceit_url = faceitUrl;
          }
        }
      } catch (_) {
        // ignore Faceit errors
      }
    }
    // Leetify Public CS API (https://api-public-docs.cs-prod.leetify.com/)
    const leetifyKey = process.env.LEETIFY_API_KEY;
    const leetifyOpts = { headers: {} };
    if (leetifyKey) leetifyOpts.headers._leetify_key = leetifyKey;
    try {
      const profileUrl = `https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=${encodeURIComponent(steamid64)}`;
      const profileRes = await fetch(profileUrl, leetifyOpts);
      if (profileRes.ok) {
        const leetify = await profileRes.json();
        let recentMatches = Array.isArray(leetify.recent_matches) ? leetify.recent_matches.slice(0, 10) : [];
        if (recentMatches.length < 10) {
          try {
            const matchesUrl = `https://api-public.cs-prod.leetify.com/v3/profile/matches?steam64_id=${encodeURIComponent(steamid64)}`;
            const matchesRes = await fetch(matchesUrl, leetifyOpts);
            if (matchesRes.ok) {
              const matchesList = await matchesRes.json();
              if (Array.isArray(matchesList) && matchesList.length > 0) {
                recentMatches = matchesList.slice(0, 10);
              }
            }
          } catch (_) {}
        }
        payload.leetify = {
          profile_url: `https://leetify.com/app/profile/${steamid64}`,
          winrate: leetify.winrate != null ? Math.round(leetify.winrate * 100) : null,
          total_matches: leetify.total_matches ?? null,
          first_match_date: leetify.first_match_date ?? null,
          ranks: leetify.ranks
            ? {
                premier: leetify.ranks.premier ?? null,
                faceit: leetify.ranks.faceit ?? null,
                faceit_elo: leetify.ranks.faceit_elo ?? null,
                leetify_rating: leetify.ranks.leetify ?? null,
                wingman: leetify.ranks.wingman ?? null,
                renown: leetify.ranks.renown ?? null,
                competitive: leetify.ranks.competitive ?? []
              }
            : null,
          rating: leetify.rating
            ? {
                aim: leetify.rating.aim ?? null,
                positioning: leetify.rating.positioning ?? null,
                utility: leetify.rating.utility ?? null,
                clutch: leetify.rating.clutch ?? null,
                opening: leetify.rating.opening ?? null,
                ct_leetify: leetify.rating.ct_leetify ?? null,
                t_leetify: leetify.rating.t_leetify ?? null
              }
            : null,
          stats: leetify.stats
            ? {
                reaction_time_ms: leetify.stats.reaction_time_ms ?? null,
                accuracy_head: leetify.stats.accuracy_head ?? null,
                preaim: leetify.stats.preaim ?? null,
                spray_accuracy: leetify.stats.spray_accuracy ?? null
              }
            : null,
          recent_matches: recentMatches.map((m) => {
            let score = m.score;
            if ((!score || !Array.isArray(score)) && Array.isArray(m.team_scores) && m.team_scores.length >= 2) {
              score = [m.team_scores[0].score ?? 0, m.team_scores[1].score ?? 0];
            }
            return {
              id: m.id ?? null,
              finished_at: m.finished_at ?? null,
              data_source: m.data_source ?? null,
              outcome: m.outcome ?? null,
              map_name: m.map_name ?? null,
              score: score ?? null,
              leetify_rating: m.leetify_rating ?? null,
              rank: m.rank ?? null
            };
          })
        };
      }
    } catch (_) {
      // ignore Leetify errors
    }
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Interface stats: http://localhost:${PORT}`);
});

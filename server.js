/**
 * Web server for Steam ban tracking dashboard + admin panel
 * Run: npm run server
 */

import 'dotenv/config';
import http from 'http';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
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
  getBanStatsYearsByBanDate,
  getDbBackend,
  getSetting,
  setSetting,
} from './src/db/index.js';
import { resolveVanityUrl } from './src/steam/api.js';
import {
  getSessionMiddleware,
  getSteamAuth,
  isAdmin,
  requireAdmin,
  requireAdminPage,
} from './src/admin/auth.js';
import { createToken, consumeToken } from './src/admin/ws-tokens.js';
import {
  getBotState,
  setBroadcast,
  startBot,
  pauseBot,
  resumeBot,
  stopBot,
} from './src/admin/bot-runner.js';
import {
  getVacVerifyState,
  setBroadcast as setVacVerifyBroadcast,
  startVacVerify,
  stopVacVerify,
} from './src/admin/vac-verify-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(getSessionMiddleware());

// Verify DB connection before accepting requests; then start server
const dbBackend = getDbBackend();
let httpServer = null;

async function start() {
  try {
    await getStats();
    console.log(`DB: ${dbBackend} — Connexion OK`);
  } catch (e) {
    console.error(`DB: ${dbBackend} — Connexion échouée:`, e?.message || e);
    if (dbBackend === 'supabase') {
      console.error('→ Vérifiez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env');
      console.error('→ Avec RLS activé, le site doit utiliser la clé service_role (pas anon).');
    } else {
      console.error('→ Vérifiez que steam-data.db existe ou que le répertoire est accessible.');
    }
    process.exit(1);
  }

  const adminClients = new Set();
  const broadcastAdmin = () => {
    const payload = JSON.stringify({ bot: getBotState(), vacVerify: getVacVerifyState() });
    adminClients.forEach((ws) => {
      if (ws.readyState === 1) ws.send(payload);
    });
  };
  setBroadcast(broadcastAdmin);
  setVacVerifyBroadcast(broadcastAdmin);

  httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/admin/ws') {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get('token');
    const steamId = token ? consumeToken(token) : null;
    if (!steamId || !isAdmin(steamId)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
  wss.on('connection', (ws) => {
    adminClients.add(ws);
    ws.send(JSON.stringify({ bot: getBotState(), vacVerify: getVacVerifyState() }));
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.cmd === 'pause') pauseBot();
        else if (msg.cmd === 'resume') resumeBot();
        else if (msg.cmd === 'stop') stopBot();
        else if (msg.cmd === 'vacVerifyStop') stopVacVerify();
      } catch (_) {}
    });
    ws.on('close', () => adminClients.delete(ws));
  });

  httpServer.listen(PORT, () => {
    console.log(`Interface stats: http://localhost:${PORT}`);
    if (process.env.ADMIN_STEAM_IDS) console.log('Admin panel: http://localhost:' + PORT + '/admin');
  });
}

// Serve built frontend (dist) if present, else public (dev)
const staticDir = fs.existsSync(path.join(__dirname, 'dist')) ? 'dist' : 'public';

// Profile page (must be before static so /profile/:id is handled here)
app.get('/profile/:steamid64', (req, res) => {
  res.sendFile(path.join(__dirname, staticDir, 'profile.html'));
});

app.use(express.static(path.join(__dirname, staticDir)));

// ----- Admin: Steam OpenID login -----
const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

// Public config for login page (e.g. Turnstile site key)
app.get('/api/admin/login-config', (req, res) => {
  res.json({ turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '' });
});

// POST /admin/login: verify Turnstile then return Steam redirect URL (used when Turnstile is enabled)
app.post('/admin/login', async (req, res) => {
  try {
    const token = req.body?.turnstile_token || req.body?.['cf-turnstile-response'];
    const secret = process.env.TURNSTILE_SECRET_KEY;

    if (secret && token) {
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret,
          response: token,
          ...(req.ip && { remoteip: req.ip }),
        }),
      });
      const data = await verifyRes.json();
      if (!data.success) {
        return res.status(400).json({ error: 'Vérification Turnstile échouée', errorCodes: data['error-codes'] });
      }
    } else if (secret && !token) {
      return res.status(400).json({ error: 'Captcha requis' });
    }

    const steam = getSteamAuth(baseUrl);
    const redirectUrl = await steam.getRedirectUrl();
    res.json({ redirectUrl });
  } catch (err) {
    res.status(500).json({ error: 'Steam login error: ' + (err?.message || err) });
  }
});

app.get('/admin/login', async (req, res) => {
  try {
    const steam = getSteamAuth(baseUrl);
    const redirectUrl = await steam.getRedirectUrl();
    res.redirect(redirectUrl);
  } catch (err) {
    res.status(500).send('Steam login error: ' + (err?.message || err));
  }
});
app.get('/admin/callback', async (req, res) => {
  try {
    const steam = getSteamAuth(baseUrl);
    const user = await steam.authenticate(req);
    req.session.steamId = user.steamid;
    res.redirect('/admin');
  } catch (err) {
    res.redirect('/admin?error=auth');
  }
});
app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin'));
});

app.get('/admin/denied', (req, res) => {
  res.sendFile(path.join(__dirname, staticDir, 'admin-denied.html'));
});

app.get('/admin', (req, res) => {
  if (!req.session?.steamId) {
    return res.sendFile(path.join(__dirname, staticDir, 'admin-login.html'));
  }
  if (!isAdmin(req.session.steamId)) {
    return res.redirect('/admin/denied');
  }
  res.sendFile(path.join(__dirname, staticDir, 'admin.html'));
});

// ----- Admin API (require admin session) -----
app.get('/api/admin/ws-token', requireAdmin, (req, res) => {
  const token = createToken(req.session.steamId);
  res.json({ token });
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const steamApiKey = await getSetting(undefined, 'steam_api_key');
    const startSteamid64 = await getSetting(undefined, 'start_steamid64');
    const maxDepth = await getSetting(undefined, 'max_depth');
    const maxProfiles = await getSetting(undefined, 'max_profiles');
    res.json({
      steam_api_key: steamApiKey || '',
      start_steamid64: startSteamid64 || '',
      max_depth: maxDepth || '2',
      max_profiles: maxProfiles || '500',
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || err });
  }
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const { steam_api_key, start_steamid64, max_depth, max_profiles } = req.body || {};
    if (steam_api_key !== undefined) await setSetting(undefined, 'steam_api_key', steam_api_key);
    if (start_steamid64 !== undefined) await setSetting(undefined, 'start_steamid64', start_steamid64);
    if (max_depth !== undefined) await setSetting(undefined, 'max_depth', String(max_depth));
    if (max_profiles !== undefined) await setSetting(undefined, 'max_profiles', String(max_profiles));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || err });
  }
});

app.get('/api/admin/bot/state', requireAdmin, (req, res) => {
  res.json(getBotState());
});

app.post('/api/admin/bot/start', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await startBot({
      steamApiKey: body.steam_api_key,
      startSteamId64: body.start_steamid64,
      maxDepth: body.max_depth != null ? parseInt(body.max_depth, 10) : undefined,
      maxProfiles: body.max_profiles != null ? parseInt(body.max_profiles, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || err });
  }
});

app.post('/api/admin/bot/pause', requireAdmin, (req, res) => {
  res.json({ ok: pauseBot() });
});
app.post('/api/admin/bot/resume', requireAdmin, (req, res) => {
  res.json({ ok: resumeBot() });
});
app.post('/api/admin/bot/stop', requireAdmin, (req, res) => {
  res.json({ ok: stopBot() });
});

// VAC verification (scrape profile pages for profiles without VAC ban)
app.get('/api/admin/verify-vac/state', requireAdmin, async (req, res) => {
  try {
    const vacState = getVacVerifyState();
    const stats = await getStats();
    res.json({
      ...vacState,
      totalToVerify: Math.max(0, (stats.totalProfiles ?? 0) - (stats.vacBannedCount ?? 0)),
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || err });
  }
});
app.post('/api/admin/verify-vac/start', requireAdmin, async (req, res) => {
  try {
    const result = await startVacVerify(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || err });
  }
});
app.post('/api/admin/verify-vac/stop', requireAdmin, (req, res) => {
  res.json({ ok: stopVacVerify() });
});

// API: summary stats
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: all banned (VAC, Game, Community) - paginated
app.get('/api/banned', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? '10', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const search = req.query.search || null;
    const [rows, total] = await Promise.all([
      getAllBanned(undefined, limit, offset, search),
      getBannedCount(undefined, search)
    ]);
    res.json({ rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: VAC banned (paginated)
app.get('/api/vac-banned', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? '10', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const [rows, total] = await Promise.all([
      getVacBanned(undefined, limit, offset),
      getVacBannedCount()
    ]);
    res.json({ rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Game banned (paginated)
app.get('/api/game-banned', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? '10', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const [rows, total] = await Promise.all([
      getGameBanned(undefined, limit, offset),
      getGameBannedCount()
    ]);
    res.json({ rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Community banned (paginated)
app.get('/api/community-banned', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? '10', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const [rows, total] = await Promise.all([
      getCommunityBanned(undefined, limit, offset),
      getCommunityBannedCount()
    ]);
    res.json({ rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: ban stats over time (for chart), optional ?year=2024&by=ban
app.get('/api/stats-over-time', async (req, res) => {
  try {
    const y = req.query.year;
    const year = y !== undefined && y !== '' ? parseInt(String(y), 10) : null;
    const byBan = req.query.by === 'ban';
    const rows = byBan
      ? await getBanStatsByBanDate(undefined, Number.isNaN(year) ? null : year)
      : await getBanStatsOverTime(undefined, Number.isNaN(year) ? null : year);
    res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error('/api/stats-over-time', err);
    res.status(500).json({ error: err.message });
  }
});

// API: available years for chart filter
app.get('/api/stats-years', async (req, res) => {
  try {
    const byBan = req.query.by === 'ban';
    const years = byBan ? await getBanStatsYearsByBanDate() : await getBanStatsYears();
    res.json(years);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: search profiles (suggestions for search bar)
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit ?? '12', 10), 20);
    const rows = q.length >= 2 ? await getSearchProfiles(undefined, q, limit) : [];
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: resolve Steam vanity URL to SteamID64 (for search bar paste)
app.get('/api/resolve-vanity', async (req, res) => {
  try {
    const vanity = (req.query.vanity || req.query.vanityurl || "").trim();
    if (!vanity) {
      return res.status(400).json({ error: 'Paramètre vanity requis' });
    }
    const apiKey = process.env.STEAM_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Résolution d’URL personnalisée non configurée (STEAM_API_KEY)' });
    }
    const steamid64 = await resolveVanityUrl(apiKey, vanity);
    if (!steamid64) {
      return res.status(404).json({ error: 'Profil personnalisé non trouvé' });
    }
    res.json({ steamid64 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: profiles (paginated)
app.get('/api/profiles', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? '10', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const search = req.query.search || null;
    const [rows, total] = await Promise.all([
      getProfiles(undefined, limit, offset, search),
      getProfilesCount(undefined, search)
    ]);
    res.json({ rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: single profile (for profile page), optionally with Faceit ELO
app.get('/api/profile/:steamid64', async (req, res) => {
  try {
    const steamid64 = req.params.steamid64;
    const profile = await getProfile(undefined, steamid64);
    if (!profile) {
      return res.status(404).json({ error: 'Profil non trouvé' });
    }
    const [friendCount, friendBannedCount, friends_banned] = await Promise.all([
      getFriendCount(undefined, steamid64),
      getFriendBannedCount(undefined, steamid64),
      getBannedFriends(undefined, steamid64)
    ]);
    const friend_ban_percentage =
      friendCount > 0
        ? Math.round((friendBannedCount / friendCount) * 100)
        : null;
    const payload = {
      ...profile,
      friend_count: friendCount,
      friend_banned_count: friendBannedCount,
      friend_ban_percentage,
      friends_banned
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
              game_mode: m.game_mode ?? m.mode ?? null,
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

start();

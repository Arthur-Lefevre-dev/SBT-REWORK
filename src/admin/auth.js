/**
 * Admin auth: Steam OpenID + session. Only SteamIDs in ADMIN_STEAM_IDS can access admin.
 */

import session from 'express-session';
import SteamAuth from 'node-steam-openid';

const ADMIN_IDS = new Set(
  (process.env.ADMIN_STEAM_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

export function getSessionMiddleware() {
  const secret = process.env.SESSION_SECRET || 'steam-ban-tracker-secret-change-in-production';
  return session({
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 },
    name: 'sbt.sid',
  });
}

export function getSteamAuth(baseUrl) {
  const realm = baseUrl.replace(/\/$/, '');
  return new SteamAuth({
    realm,
    returnUrl: `${realm}/admin/callback`,
    apiKey: process.env.STEAM_API_KEY || '',
  });
}

export function isAdmin(steamId64) {
  return steamId64 && ADMIN_IDS.has(String(steamId64));
}

export function requireAdmin(req, res, next) {
  const steamId = req.session?.steamId;
  if (!steamId) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  if (!isAdmin(steamId)) {
    return res.status(403).json({ error: 'Accès admin refusé' });
  }
  next();
}

export function requireAdminPage(req, res, next) {
  const steamId = req.session?.steamId;
  if (!steamId) {
    return res.redirect('/admin/login');
  }
  if (!isAdmin(steamId)) {
    return res.redirect('/admin/denied');
  }
  next();
}

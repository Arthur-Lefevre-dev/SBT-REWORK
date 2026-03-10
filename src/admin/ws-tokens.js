/**
 * Short-lived tokens for WebSocket admin auth (no cookie access in WS).
 */

import crypto from 'crypto';

const tokens = new Map(); // token -> { steamId, expires }

const TTL_MS = 60 * 1000; // 1 minute

export function createToken(steamId) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, {
    steamId: String(steamId),
    expires: Date.now() + TTL_MS,
  });
  return token;
}

export function consumeToken(token) {
  const t = tokens.get(token);
  if (!t) return null;
  tokens.delete(token);
  if (Date.now() > t.expires) return null;
  return t.steamId;
}

import crypto from "node:crypto";

const tokens = new Map<string, { steamId: string; expires: number }>();
const TTL_MS = 60_000;

export function createToken(steamId: string) {
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, { steamId: String(steamId), expires: Date.now() + TTL_MS });
  return token;
}

export function consumeToken(token: string) {
  const t = tokens.get(token);
  if (!t) return null;
  tokens.delete(token);
  if (Date.now() > t.expires) return null;
  return t.steamId;
}

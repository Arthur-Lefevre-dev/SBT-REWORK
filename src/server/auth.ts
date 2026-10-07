import type { NextFunction, Request, Response } from "express";
import SteamAuth from "node-steam-openid";
import { env, getAdminIds } from "../env.js";

export function getSteamAuth(baseUrl: string) {
  const realm = baseUrl.replace(/\/$/, "");
  return new SteamAuth({
    realm,
    returnUrl: `${realm}/admin/callback`,
    apiKey: env.STEAM_API_KEY || "",
  });
}

export function isAdmin(steamId64: string | undefined | null) {
  return !!(steamId64 && getAdminIds().has(String(steamId64)));
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const steamId = (req.session as { steamId?: string } | null)?.steamId;
  if (!steamId) return res.status(401).json({ error: "Unauthenticated" });
  if (!isAdmin(steamId)) return res.status(403).json({ error: "Forbidden" });
  next();
}

import { Router } from "express";
import {
  getAllBanned,
  getBanStatsByBanDate,
  getBanStatsOverTime,
  getBanStatsYears,
  getBanStatsYearsByBanDate,
  getBannedCount,
  getBannedFriends,
  getCommunityBanned,
  getCommunityBannedCount,
  getFriendBannedCount,
  getFriendCount,
  getGameBanned,
  getGameBannedCount,
  getProfile,
  getProfiles,
  getProfilesCount,
  getSearchProfiles,
  getStats,
  getVacBanned,
  getVacBannedCount,
  getVacCloudGraph,
} from "../../db/queries.js";
import { getDbBackend, pingDb } from "../../db/index.js";
import { env } from "../../env.js";
import { getCurrentProxyIp, isDecodoProxyEnabled } from "../../scraper/proxy.js";
import { resolveVanityUrl } from "../../scraper/steam-api.js";
import { asyncHandler } from "../async-handler.js";
import { enrichProfile } from "../enrich.js";

export function publicRoutes() {
  const router = Router();

  router.get(
    "/api/health",
    asyncHandler(async (_req, res) => {
      await pingDb();
      let proxy = "not configured";
      if (isDecodoProxyEnabled()) {
        const ip = await getCurrentProxyIp();
        proxy = ip ? "ok" : "error";
      }
      res.json({ ok: true, db: "ok", backend: getDbBackend(), proxy });
    }),
  );

  router.get(
    "/api/stats",
    asyncHandler(async (_req, res) => {
      res.json(await getStats());
    }),
  );

  router.get(
    "/api/banned",
    asyncHandler(async (req, res) => {
      const limit = parseInt(String(req.query.limit ?? "10"), 10);
      const offset = parseInt(String(req.query.offset ?? "0"), 10);
      const search = (req.query.search as string) || null;
      const [rows, total] = await Promise.all([
        getAllBanned(limit, offset, search),
        getBannedCount(search),
      ]);
      res.json({ rows, total });
    }),
  );

  router.get(
    "/api/vac-banned",
    asyncHandler(async (req, res) => {
      const limit = parseInt(String(req.query.limit ?? "10"), 10);
      const offset = parseInt(String(req.query.offset ?? "0"), 10);
      const filters = {
        search: (req.query.search as string) || null,
        minVacCount:
          req.query.min_vac_count != null
            ? parseInt(String(req.query.min_vac_count), 10)
            : null,
        maxVacCount:
          req.query.max_vac_count != null
            ? parseInt(String(req.query.max_vac_count), 10)
            : null,
        dateFrom: (req.query.date_from as string) || null,
        dateTo: (req.query.date_to as string) || null,
      };
      const [rows, total] = await Promise.all([
        getVacBanned(limit, offset, filters),
        getVacBannedCount(filters),
      ]);
      res.json({ rows, total });
    }),
  );

  router.get(
    "/api/game-banned",
    asyncHandler(async (req, res) => {
      const limit = parseInt(String(req.query.limit ?? "10"), 10);
      const offset = parseInt(String(req.query.offset ?? "0"), 10);
      const [rows, total] = await Promise.all([
        getGameBanned(limit, offset),
        getGameBannedCount(),
      ]);
      res.json({ rows, total });
    }),
  );

  router.get(
    "/api/community-banned",
    asyncHandler(async (req, res) => {
      const limit = parseInt(String(req.query.limit ?? "10"), 10);
      const offset = parseInt(String(req.query.offset ?? "0"), 10);
      const [rows, total] = await Promise.all([
        getCommunityBanned(limit, offset),
        getCommunityBannedCount(),
      ]);
      res.json({ rows, total });
    }),
  );

  router.get(
    "/api/stats-over-time",
    asyncHandler(async (req, res) => {
      const y = req.query.year;
      const year =
        y !== undefined && y !== "" ? parseInt(String(y), 10) : null;
      const byBan = req.query.by === "ban";
      const rows = byBan
        ? await getBanStatsByBanDate(Number.isNaN(year!) ? null : year)
        : await getBanStatsOverTime(Number.isNaN(year!) ? null : year);
      res.json(rows);
    }),
  );

  router.get(
    "/api/stats-years",
    asyncHandler(async (req, res) => {
      const years =
        req.query.by === "ban"
          ? await getBanStatsYearsByBanDate()
          : await getBanStatsYears();
      res.json(years);
    }),
  );

  router.get(
    "/api/search",
    asyncHandler(async (req, res) => {
      const q = String(req.query.q || "").trim();
      const limit = Math.min(parseInt(String(req.query.limit ?? "12"), 10), 20);
      res.json(q.length >= 2 ? await getSearchProfiles(q, limit) : []);
    }),
  );

  router.get(
    "/api/vac-cloud",
    asyncHandler(async (req, res) => {
      const raw = String(req.query.limit ?? "150");
      const limit =
        raw === "0" || raw.toLowerCase() === "unlimited"
          ? 0
          : parseInt(raw, 10);
      res.json(await getVacCloudGraph(Number.isNaN(limit) ? 150 : limit));
    }),
  );

  router.get(
    "/api/resolve-vanity",
    asyncHandler(async (req, res) => {
      const vanity = String(req.query.vanity || req.query.vanityurl || "").trim();
      if (!vanity) {
        res.status(400).json({ error: "vanity required" });
        return;
      }
      if (!env.STEAM_API_KEY) {
        res.status(503).json({ error: "STEAM_API_KEY not configured" });
        return;
      }
      const steamid64 = await resolveVanityUrl(env.STEAM_API_KEY, vanity);
      if (!steamid64) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ steamid64 });
    }),
  );

  router.get(
    "/api/profiles",
    asyncHandler(async (req, res) => {
      const limit = parseInt(String(req.query.limit ?? "10"), 10);
      const offset = parseInt(String(req.query.offset ?? "0"), 10);
      const search = (req.query.search as string) || null;
      const [rows, total] = await Promise.all([
        getProfiles(limit, offset, search),
        getProfilesCount(search),
      ]);
      res.json({ rows, total });
    }),
  );

  router.get(
    "/api/profile/:steamid64",
    asyncHandler(async (req, res) => {
      const steamid64 = req.params.steamid64;
      const profile = await getProfile(steamid64);
      if (!profile) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const [friendCount, friendBannedCount, friends_banned] = await Promise.all(
        [
          getFriendCount(steamid64),
          getFriendBannedCount(steamid64),
          getBannedFriends(steamid64),
        ],
      );
      const payload: Record<string, unknown> = {
        ...profile,
        friend_count: friendCount,
        friend_banned_count: friendBannedCount,
        friend_ban_percentage:
          friendCount > 0
            ? Math.round((friendBannedCount / friendCount) * 100)
            : null,
        friends_banned,
      };
      await enrichProfile(steamid64, payload);
      res.json(payload);
    }),
  );

  return router;
}

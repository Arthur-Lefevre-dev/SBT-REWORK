import { Router } from "express";
import {
  getSetting,
  getStats,
  getVacBanned,
  getVacBannedCount,
  setSetting,
} from "../../db/queries.js";
import { env, getAdminIds } from "../../env.js";
import { asyncHandler } from "../async-handler.js";
import { getSteamAuth, isAdmin, requireAdmin } from "../auth.js";
import {
  getBotState,
  pauseBot,
  resumeBot,
  startBot,
  stopBot,
} from "../bot-runner.js";
import {
  getVacVerifyState,
  startVacVerify,
  stopVacVerify,
} from "../vac-verify.js";
import { createToken } from "../ws-tokens.js";

export function adminRoutes(baseUrl: string) {
  const router = Router();

  router.get("/api/admin/login-config", (_req, res) => {
    res.json({
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
      adminConfigured: getAdminIds().size > 0,
    });
  });

  router.post(
    "/admin/login",
    asyncHandler(async (req, res) => {
      const token =
        req.body?.turnstile_token || req.body?.["cf-turnstile-response"];
      const secret = env.TURNSTILE_SECRET_KEY;
      if (secret && token) {
        const verifyRes = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              secret,
              response: token,
              ...(req.ip ? { remoteip: req.ip } : {}),
            }),
          },
        );
        const data = (await verifyRes.json()) as { success?: boolean };
        if (!data.success) {
          res.status(400).json({ error: "Turnstile failed" });
          return;
        }
      } else if (secret && !token) {
        res.status(400).json({ error: "Captcha required" });
        return;
      }
      const steam = getSteamAuth(baseUrl);
      res.json({ redirectUrl: await steam.getRedirectUrl() });
    }),
  );

  router.get(
    "/admin/login",
    asyncHandler(async (_req, res) => {
      const steam = getSteamAuth(baseUrl);
      res.redirect(await steam.getRedirectUrl());
    }),
  );

  router.get(
    "/admin/callback",
    asyncHandler(async (req, res) => {
      try {
        const steam = getSteamAuth(baseUrl);
        const user = await steam.authenticate(req);
        (req.session as { steamId?: string }).steamId = user.steamid;
        res.redirect("/admin");
      } catch {
        res.redirect("/admin?error=auth");
      }
    }),
  );

  router.get("/admin/logout", (req, res) => {
    req.session = null;
    res.redirect("/");
  });

  router.get("/api/admin/me", (req, res) => {
    const steamId = (req.session as { steamId?: string } | null)?.steamId;
    res.json({
      steamId: steamId || null,
      isAdmin: isAdmin(steamId),
    });
  });

  router.get("/api/admin/ws-token", requireAdmin, (req, res) => {
    const steamId = (req.session as { steamId: string }).steamId;
    res.json({ token: createToken(steamId) });
  });

  router.get(
    "/api/admin/settings",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const steamApiKey = await getSetting("steam_api_key");
      res.json({
        steam_api_key_set: !!steamApiKey,
        start_steamid64: (await getSetting("start_steamid64")) || "",
        max_depth: (await getSetting("max_depth")) || "2",
        max_profiles: (await getSetting("max_profiles")) || "500",
      });
    }),
  );

  router.put(
    "/api/admin/settings",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { steam_api_key, start_steamid64, max_depth, max_profiles } =
        req.body || {};
      if (steam_api_key !== undefined && steam_api_key !== "") {
        await setSetting("steam_api_key", steam_api_key);
      }
      if (start_steamid64 !== undefined) {
        await setSetting("start_steamid64", start_steamid64);
      }
      if (max_depth !== undefined) {
        await setSetting("max_depth", String(max_depth));
      }
      if (max_profiles !== undefined) {
        await setSetting("max_profiles", String(max_profiles));
      }
      res.json({ ok: true });
    }),
  );

  router.get("/api/admin/bot/state", requireAdmin, (_req, res) => {
    res.json(getBotState());
  });
  router.post(
    "/api/admin/bot/start",
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.json(await startBot(req.body || {}));
    }),
  );
  router.post("/api/admin/bot/pause", requireAdmin, (_req, res) => {
    res.json({ ok: pauseBot() });
  });
  router.post("/api/admin/bot/resume", requireAdmin, (_req, res) => {
    res.json({ ok: resumeBot() });
  });
  router.post("/api/admin/bot/stop", requireAdmin, (_req, res) => {
    res.json({ ok: stopBot() });
  });

  router.get(
    "/api/admin/verify-vac/state",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const vacState = getVacVerifyState();
      const stats = await getStats();
      res.json({
        ...vacState,
        totalToVerify: Math.max(
          0,
          (stats.totalProfiles ?? 0) - (stats.vacBannedCount ?? 0),
        ),
      });
    }),
  );
  router.post(
    "/api/admin/verify-vac/start",
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.json(await startVacVerify(req.body || {}));
    }),
  );
  router.post("/api/admin/verify-vac/stop", requireAdmin, (_req, res) => {
    res.json({ ok: stopVacVerify() });
  });

  router.get(
    "/api/admin/export/vac-banned",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const format = String(req.query.format || "json").toLowerCase();
      const total = await getVacBannedCount();
      const rows = [];
      for (let offset = 0; offset < Math.min(100_000, total); offset += 5000) {
        rows.push(...(await getVacBanned(5000, offset)));
      }
      if (format === "csv") {
        const header =
          "steamid64;steamid;persona_name;profile_url;vac_count;days_since_last_ban;last_ban_date";
        const escape = (v: unknown) =>
          v == null ? "" : String(v).replace(/"/g, '""');
        const lines = [
          header,
          ...rows.map((r) =>
            [
              r.steamid64,
              r.steamid,
              r.persona_name,
              r.profile_url,
              r.vac_count,
              r.days_since_last_ban,
              r.last_ban_date,
            ]
              .map(escape)
              .join(";"),
          ),
        ];
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="vac-banned.csv"',
        );
        res.type("text/csv; charset=utf-8");
        res.send("\uFEFF" + lines.join("\n"));
      } else {
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="vac-banned.json"',
        );
        res.json(rows);
      }
    }),
  );

  return router;
}

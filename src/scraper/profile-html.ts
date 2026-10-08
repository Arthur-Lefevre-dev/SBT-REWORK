import { sleep } from "../shared/async.js";
import {
  coolProxy,
  isProxyEnabled,
  maskProxyUrl,
  proxyFetch,
  shortProxyLabel,
} from "./proxy.js";

const PROFILE_URL = (id: string) =>
  `https://steamcommunity.com/profiles/${id}`;
const DELAY_MS = 500;
/** Short backoffs — long sleeps look like a frozen scrape. */
const RATE_LIMIT_BACKOFF_MS = [8_000, 20_000];
const FETCH_TIMEOUT_MS = 20_000;
const PROXY_COOL_MS = 30_000;

/** Shared cooldown so parallel HTML workers do not stampede after 429. */
let htmlCooldownUntil = 0;
let htmlLogger: ((msg: string) => void) | null = null;

export function setProfileHtmlLogger(fn: ((msg: string) => void) | null) {
  htmlLogger = fn;
}

async function waitHtmlCooldown() {
  const wait = htmlCooldownUntil - Date.now();
  if (wait > 0) await sleep(wait);
}

function triggerHtmlCooldown(ms: number, status: number) {
  const until = Date.now() + ms;
  if (until > htmlCooldownUntil) {
    htmlCooldownUntil = until;
    htmlLogger?.(
      `[HTML] HTTP ${status} — pause ${Math.round(ms / 1000)}s before next profile page`,
    );
  }
}

export class ProfileRateLimitError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
    this.name = "ProfileRateLimitError";
  }
}

export function isProfileRateLimitError(err: unknown): boolean {
  return (
    err instanceof ProfileRateLimitError ||
    (err instanceof Error && /^HTTP (429|503|403)\b/.test(err.message))
  );
}

function isRateLimit(status: number) {
  return status === 429 || status === 503 || status === 403;
}

export function parseVacBanFromHtml(html: string) {
  if (!html) return null;
  const lower = html.toLowerCase();
  const vacIdx = lower.indexOf("vac ban");
  if (vacIdx === -1) return { vacBanned: false, vacCount: 0 };
  const vacOnRecord = /vac\s+ban(s?)\s+on\s+record/i.test(
    html.slice(Math.max(0, vacIdx - 20), vacIdx + 80),
  );
  if (!vacOnRecord) return { vacBanned: false, vacCount: 0 };
  const countMatch =
    html
      .slice(Math.max(0, vacIdx - 12), vacIdx + 40)
      .match(/(\d+)\s*vac\s+ban/i) ||
    html.slice(Math.max(0, vacIdx - 50), vacIdx + 50).match(/(\d+)\s*ban/i);
  const vacCount = countMatch ? Math.max(1, parseInt(countMatch[1], 10)) : 1;
  const block = html.slice(Math.max(0, vacIdx - 100), vacIdx + 600);
  const dayMatch =
    block.match(/(\d+)\s*day\s*\(\s*s\s*\)\s*since\s*last\s*ban/i) ||
    block.match(/(\d+)\s*jour\s*\(\s*s\s*\)\s*depuis/i);
  let daysSinceLastBan: number | undefined;
  let lastBanDate: string | undefined;
  if (dayMatch) {
    daysSinceLastBan = parseInt(dayMatch[1], 10);
    if (!Number.isNaN(daysSinceLastBan) && daysSinceLastBan >= 0) {
      lastBanDate = new Date(
        Date.now() - daysSinceLastBan * 24 * 60 * 60 * 1000,
      ).toISOString();
    }
  }
  return { vacBanned: true, vacCount, daysSinceLastBan, lastBanDate };
}

export function parseGameBanDaysFromHtml(html: string) {
  if (!html) return null;
  const lower = html.toLowerCase();
  const gameBanIdx = lower.indexOf("game ban");
  if (gameBanIdx === -1) return null;
  const after = html.slice(gameBanIdx, gameBanIdx + 800);
  const dayMatch = after.match(/(\d+)\s*day\s*\(\s*s\s*\)\s*since\s*last\s*ban/i);
  const jourMatch = after.match(/(\d+)\s*jour\s*\(\s*s\s*\)\s*depuis/i);
  const daysStr = dayMatch?.[1] ?? jourMatch?.[1];
  if (!daysStr) return null;
  const days = parseInt(daysStr, 10);
  if (Number.isNaN(days) || days < 0) return null;
  return {
    gameBanDaysSinceLast: days,
    gameLastBanDate: new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

export async function fetchProfilePageHtml(
  steamid64: string,
  options: { delayMs?: number; sessionId?: string; useProxy?: boolean } = {},
): Promise<string> {
  const { delayMs = DELAY_MS, useProxy = true } = options;
  const url = PROFILE_URL(steamid64);
  // Extra retries when a proxy pool can rotate away from 429s
  const maxTries = isProxyEnabled()
    ? RATE_LIMIT_BACKOFF_MS.length + 3
    : RATE_LIMIT_BACKOFF_MS.length;
  // Sticky per profile; bumped on 429 to force a new residential exit IP
  let stickySession =
    options.sessionId ?? (isProxyEnabled() ? steamid64 : undefined);

  for (let tryIndex = 0; tryIndex <= maxTries; tryIndex++) {
    if (!isProxyEnabled()) await waitHtmlCooldown();
    let res: Response & { proxyUrl?: string | null };
    try {
      res = await proxyFetch(url, {
        sessionId: stickySession,
        useProxy,
        headers: { "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort|timeout/i.test(msg) && tryIndex < maxTries) {
        if (isProxyEnabled()) {
          stickySession = `t${Date.now()}_${tryIndex}`;
          htmlLogger?.(`[HTML] timeout — retry with another proxy/session`);
          await sleep(500);
        } else {
          triggerHtmlCooldown(
            RATE_LIMIT_BACKOFF_MS[
              Math.min(tryIndex, RATE_LIMIT_BACKOFF_MS.length - 1)
            ] ?? 8_000,
            0,
          );
        }
        continue;
      }
      throw err;
    }
    if (isRateLimit(res.status)) {
      const used = res.proxyUrl;
      if (used && isProxyEnabled()) {
        coolProxy(used, PROXY_COOL_MS);
        stickySession = `r${Date.now()}_${tryIndex}`;
        htmlLogger?.(
          `[HTML] HTTP ${res.status} on ${shortProxyLabel(used)} (${maskProxyUrl(used)}) — rotating (try ${tryIndex + 1}/${maxTries + 1})`,
        );
        await sleep(300);
        continue;
      }
      const waitMs =
        RATE_LIMIT_BACKOFF_MS[
          Math.min(tryIndex, RATE_LIMIT_BACKOFF_MS.length - 1)
        ] ?? 20_000;
      triggerHtmlCooldown(waitMs, res.status);
      if (tryIndex < maxTries) {
        await sleep(waitMs);
        continue;
      }
      throw new ProfileRateLimitError(res.status);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.text();
    if (delayMs > 0) await sleep(delayMs);
    return data;
  }
  throw new ProfileRateLimitError(429);
}

export async function getVacBanFromProfilePage(
  steamid64: string,
  options: { delayMs?: number; sessionId?: string; useProxy?: boolean } = {},
) {
  const html = await fetchProfilePageHtml(steamid64, options);
  return parseVacBanFromHtml(html);
}

/** One HTML fetch → VAC + game-ban days (no Steam Web API). */
export async function getBansFromProfilePage(
  steamid64: string,
  options: { delayMs?: number; sessionId?: string; useProxy?: boolean } = {},
) {
  const html = await fetchProfilePageHtml(steamid64, options);
  const vac = parseVacBanFromHtml(html);
  const game = parseGameBanDaysFromHtml(html);
  return { vac, game };
}

export async function getGameBanDaysFromProfile(
  steamid64: string,
  options: { delayMs?: number } = {},
) {
  try {
    const html = await fetchProfilePageHtml(steamid64, {
      delayMs: options.delayMs ?? DELAY_MS,
    });
    return parseGameBanDaysFromHtml(html);
  } catch {
    return null;
  }
}

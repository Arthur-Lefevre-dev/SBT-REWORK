import { sleep } from "../shared/async.js";
import { proxyFetch } from "./proxy.js";

const PROFILE_URL = (id: string) =>
  `https://steamcommunity.com/profiles/${id}`;
const DELAY_MS = 500;
const RATE_LIMIT_RETRY_MS = 20_000;

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
    html.slice(vacIdx, vacIdx + 100).match(/(\d+)\s*vac\s+ban/i) ||
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
  const { delayMs = DELAY_MS, sessionId, useProxy = true } = options;
  const url = PROFILE_URL(steamid64);
  for (let tryIndex = 0; tryIndex < 2; tryIndex++) {
    const res = await proxyFetch(url, {
      sessionId,
      useProxy,
      headers: { "Accept-Language": "en-US,en;q=0.9" },
    });
    if (isRateLimit(res.status) && tryIndex < 1) {
      await sleep(RATE_LIMIT_RETRY_MS);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.text();
    if (delayMs > 0) await sleep(delayMs);
    return data;
  }
  throw new Error("Profile fetch failed");
}

export async function getVacBanFromProfilePage(
  steamid64: string,
  options: { delayMs?: number; sessionId?: string; useProxy?: boolean } = {},
) {
  const html = await fetchProfilePageHtml(steamid64, options);
  return parseVacBanFromHtml(html);
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

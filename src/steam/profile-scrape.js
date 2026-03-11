/**
 * Scrape Steam profile HTML to extract Game ban "days since last ban"
 * (API only gives game_ban_count, not the date)
 * Optional: Decodo proxy via DECODO_PROXY_USER / DECODO_PROXY_PASSWORD.
 */

import axios from 'axios';
import { getDecodoAxiosConfig } from '../proxy.js';

const PROFILE_URL = (steamid64) =>
  `https://steamcommunity.com/profiles/${steamid64}`;

const DELAY_MS = 500;
const RATE_LIMIT_RETRY_MS = 20000; // 20s wait before retry for steamcommunity.com

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimit(res) {
  return res?.status === 429 || res?.status === 503 || res?.status === 403;
}

/**
 * Parse VAC ban status from profile HTML (no Steam API).
 * Looks for "VAC ban on record" / "VAC bans on record" in profile_ban blocks and optional "X day(s) since last ban".
 * @param {string} html - Profile page HTML
 * @returns {{ vacBanned: boolean, vacCount: number, daysSinceLastBan?: number, lastBanDate?: string } | null}
 */
export function parseVacBanFromHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const lower = html.toLowerCase();
  const vacIdx = lower.indexOf('vac ban');
  if (vacIdx === -1) return { vacBanned: false, vacCount: 0 };
  const vacOnRecord = /vac\s+ban(s?)\s+on\s+record/i.test(html.slice(Math.max(0, vacIdx - 20), vacIdx + 80));
  if (!vacOnRecord) return { vacBanned: false, vacCount: 0 };
  const countMatch = html.slice(vacIdx, vacIdx + 100).match(/(\d+)\s*vac\s+ban/i) || html.slice(Math.max(0, vacIdx - 50), vacIdx + 50).match(/(\d+)\s*ban/i);
  const vacCount = countMatch ? Math.max(1, parseInt(countMatch[1], 10)) : 1;
  const block = html.slice(Math.max(0, vacIdx - 100), vacIdx + 600);
  const dayMatch = block.match(/(\d+)\s*day\s*\(\s*s\s*\)\s*since\s*last\s*ban/i) || block.match(/(\d+)\s*jour\s*\(\s*s\s*\)\s*depuis/i);
  let daysSinceLastBan = null;
  let lastBanDate = null;
  if (dayMatch) {
    daysSinceLastBan = parseInt(dayMatch[1], 10);
    if (!Number.isNaN(daysSinceLastBan) && daysSinceLastBan >= 0) {
      lastBanDate = new Date(Date.now() - daysSinceLastBan * 24 * 60 * 60 * 1000).toISOString();
    }
  }
  return { vacBanned: true, vacCount, daysSinceLastBan: daysSinceLastBan ?? undefined, lastBanDate: lastBanDate ?? undefined };
}

/**
 * Fetch Steam profile HTML (for scraping without API). Uses Decodo proxy if configured.
 * @param {string} steamid64
 * @param {{ delayMs?: number, sessionId?: string }} options - sessionId: Decodo sticky session (new ID = new IP)
 * @returns {Promise<string | null>}
 */
/** Build a clear error message for logging (404, rate limit, proxy auth, etc.). */
function profileFetchError(status, err) {
  const s = status != null ? Number(status) : null;
  if (s === 404) return '404 Not Found';
  if (s === 407) return 'Proxy auth required (407)';
  if (s === 429) return 'Rate limit (429)';
  if (s === 503) return 'Service unavailable (503)';
  if (s === 403) return 'Forbidden (403)';
  if (status != null) return `HTTP ${status}`;
  const code = err?.code;
  const msg = err?.message || String(err);
  if (code === 'ECONNREFUSED') return 'Connexion refusée';
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') return 'Timeout';
  if (code === 'ENOTFOUND') return 'DNS / hôte introuvable';
  if (msg) return 'Connexion: ' + msg;
  return 'Erreur de connexion';
}

export async function fetchProfilePageHtml(steamid64, options = {}) {
  const { delayMs = DELAY_MS, sessionId, useProxy = true } = options;
  const url = PROFILE_URL(steamid64);
  const proxyConfig = useProxy ? getDecodoAxiosConfig(sessionId != null ? { sessionId } : {}) : {};
  let lastStatus = null;
  let lastErr = null;
  for (let tryIndex = 0; tryIndex < 2; tryIndex++) {
    try {
      const { data, status } = await axios.get(url, {
        timeout: 10000,
        responseType: 'text',
        headers: { 'Accept-Language': 'en-US,en;q=0.9' },
        maxRedirects: 3,
        validateStatus: () => true,
        ...proxyConfig,
      }).then((res) => ({ data: res.data, status: res.status }));
      lastStatus = status;
      if (isRateLimit({ status }) && tryIndex < 1) {
        await sleep(RATE_LIMIT_RETRY_MS);
        continue;
      }
      if (status !== 200) {
        throw new Error(profileFetchError(status, null));
      }
      if (delayMs > 0) await sleep(delayMs);
      return data;
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && err.message && /^(404|407|Rate limit|HTTP \d+|Connexion|Forbidden|Service unavailable|Proxy auth)/.test(err.message)) {
        throw err;
      }
      const status = err?.response?.status ?? lastStatus;
      throw new Error(profileFetchError(status, err));
    }
  }
  throw new Error(profileFetchError(lastStatus, lastErr));
}

/**
 * Get VAC ban status by scraping profile page (no Steam API).
 * @param {string} steamid64
 * @param {{ delayMs?: number, sessionId?: string, useProxy?: boolean }} options - useProxy: false = direct (no Decodo)
 * @returns {Promise<{ vacBanned: boolean, vacCount: number, daysSinceLastBan?: number, lastBanDate?: string } | null>}
 */
export async function getVacBanFromProfilePage(steamid64, options = {}) {
  const html = await fetchProfilePageHtml(steamid64, options);
  if (html == null) return null;
  return parseVacBanFromHtml(html);
}

/**
 * Parse "X day(s) since last ban" from HTML (EN) or "X jour(s) depuis..." (FR)
 * Must appear in a context that also mentions "game ban" to avoid VAC ban block
 * @param {string} html - Profile page HTML
 * @returns {{ gameBanDaysSinceLast: number, gameLastBanDate: string } | null}
 */
export function parseGameBanDaysFromHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const lower = html.toLowerCase();
  const gameBanIdx = lower.indexOf('game ban');
  if (gameBanIdx === -1) return null;
  const afterGameBan = html.slice(gameBanIdx, gameBanIdx + 800);
  const dayMatch = afterGameBan.match(
    /(\d+)\s*day\s*\(\s*s\s*\)\s*since\s*last\s*ban/i
  );
  const jourMatch = afterGameBan.match(
    /(\d+)\s*jour\s*\(\s*s\s*\)\s*depuis/i
  );
  const daysStr = dayMatch ? dayMatch[1] : jourMatch ? jourMatch[1] : null;
  if (!daysStr) return null;
  const days = parseInt(daysStr, 10);
  if (Number.isNaN(days) || days < 0) return null;
  const gameLastBanDate = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000
  ).toISOString();
  return { gameBanDaysSinceLast: days, gameLastBanDate };
}

/**
 * Fetch profile HTML and return parsed game ban days if any
 * @param {string} steamid64
 * @param {Object} options - { delayMs, userAgent }
 * @returns {Promise<{ gameBanDaysSinceLast: number, gameLastBanDate: string } | null>}
 */
export async function getGameBanDaysFromProfile(steamid64, options = {}) {
  const { delayMs = DELAY_MS, userAgent } = options;
  const url = PROFILE_URL(steamid64);
  const proxyConfig = getDecodoAxiosConfig();
  const maxTries = 2;
  for (let tryIndex = 0; tryIndex < maxTries; tryIndex++) {
    try {
      const { data, status } = await axios.get(url, {
        timeout: 10000,
        responseType: 'text',
        headers: {
          'Accept-Language': 'en-US,en;q=0.9',
          ...(userAgent && { 'User-Agent': userAgent }),
        },
        maxRedirects: 3,
        validateStatus: () => true,
        ...proxyConfig,
      }).then((res) => ({ data: res.data, status: res.status }));
      if (isRateLimit({ status }) && tryIndex < maxTries - 1) {
        console.warn(`[Steam Community] Rate limit (${status}), retry dans ${RATE_LIMIT_RETRY_MS / 1000}s`);
        await sleep(RATE_LIMIT_RETRY_MS);
        continue;
      }
      if (status !== 200) return null;
      if (delayMs > 0) await sleep(delayMs);
      return parseGameBanDaysFromHtml(data);
    } catch (_) {
      return null;
    }
  }
  return null;
}

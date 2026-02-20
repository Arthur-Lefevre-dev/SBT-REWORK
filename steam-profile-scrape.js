/**
 * Scrape Steam profile HTML to extract Game ban "days since last ban"
 * (API only gives game_ban_count, not the date)
 */

import axios from 'axios';

const PROFILE_URL = (steamid64) =>
  `https://steamcommunity.com/profiles/${steamid64}`;

const DELAY_MS = 500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      responseType: 'text',
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        ...(userAgent && { 'User-Agent': userAgent }),
      },
      maxRedirects: 3,
      validateStatus: (s) => s === 200,
    });
    if (delayMs > 0) await sleep(delayMs);
    return parseGameBanDaysFromHtml(data);
  } catch (_) {
    return null;
  }
}

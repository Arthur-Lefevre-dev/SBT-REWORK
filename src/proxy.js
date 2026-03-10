/**
 * Optional Decodo proxy for scraping (gate.decodo.com:7000).
 * When DECODO_PROXY_USER and DECODO_PROXY_PASSWORD are set, returns axios-compatible config
 * using https-proxy-agent for HTTPS requests through the HTTP proxy.
 * @see https://help.decodo.com/docs/code-integration
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

const DECODO_HOST = 'gate.decodo.com';
const DECODO_PORT = 7000;
const IP_CHECK_URL = 'https://api.ipify.org?format=json';
/** Geo IP base URL (no key, non-commercial). Append IP: /json/1.2.3.4?fields=... */
const GEO_IP_BASE = 'http://ip-api.com/json';

/** Last IP seen when checking through proxy (to log changes). */
let lastKnownProxyIp = null;

/**
 * Get proxy config for axios when Decodo credentials are in env.
 * @returns {{ host: string, port: number, auth: { username: string, password: string } } | undefined}
 */
export function getDecodoProxyConfig() {
  const user = process.env.DECODO_PROXY_USER?.trim();
  const password = process.env.DECODO_PROXY_PASSWORD?.trim();
  if (!user || !password) return undefined;
  return {
    host: DECODO_HOST,
    port: DECODO_PORT,
    auth: { username: user, password },
  };
}

/**
 * Axios config to route HTTPS requests via Decodo proxy (when credentials are set).
 * Use: axios.get(url, { ...getDecodoAxiosConfig(), ...otherOptions }).
 * @returns {{ httpsAgent?: HttpsProxyAgent, proxy: boolean }}
 */
export function getDecodoAxiosConfig() {
  const proxy = getDecodoProxyConfig();
  if (!proxy) return { proxy: false };
  const url = `http://${encodeURIComponent(proxy.auth.username)}:${encodeURIComponent(proxy.auth.password)}@${proxy.host}:${proxy.port}`;
  return {
    httpsAgent: new HttpsProxyAgent(url),
    proxy: false,
  };
}

/**
 * Whether Decodo proxy is configured (for logging).
 */
export function isDecodoProxyEnabled() {
  return !!(
    process.env.DECODO_PROXY_USER?.trim() &&
    process.env.DECODO_PROXY_PASSWORD?.trim()
  );
}

/**
 * Fetch current outbound IP via the Decodo proxy (uses proxy config).
 * @returns {Promise<string|null>} IP string or null on failure
 */
export async function getCurrentProxyIp() {
  if (!isDecodoProxyEnabled()) return null;
  try {
    const config = getDecodoAxiosConfig();
    const { data } = await axios.get(IP_CHECK_URL, {
      ...config,
      timeout: 10000,
    });
    return data?.ip ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * Verify Decodo proxy connection: request through proxy and log success or throw.
 * Call at startup when proxy is enabled.
 * @throws {Error} if proxy is enabled but request fails
 */
export async function verifyDecodoProxy() {
  if (!isDecodoProxyEnabled()) return;
  const ip = await getCurrentProxyIp();
  if (!ip) {
    throw new Error(
      'Proxy Decodo: connexion échouée (vérifiez DECODO_PROXY_USER / DECODO_PROXY_PASSWORD et gate.decodo.com:7000)'
    );
  }
  lastKnownProxyIp = ip;
  console.log(`Proxy Decodo: connexion OK (IP: ${ip})`);
}

/**
 * Convert ISO country code (e.g. 'FR') to flag emoji (🇫🇷).
 * Returns empty string on invalid code.
 */
function countryCodeToFlag(code) {
  if (!code || typeof code !== 'string') return '';
  const upper = code.trim().toUpperCase();
  if (upper.length !== 2) return '';
  const A = 'A'.charCodeAt(0);
  const codePoints = [
    0x1f1e6 + (upper.charCodeAt(0) - A),
    0x1f1e6 + (upper.charCodeAt(1) - A),
  ];
  return String.fromCodePoint(...codePoints);
}

/**
 * Fetch approximate location for an IP (city, region, country) via ip-api.com.
 * Returns a human-friendly string with a flag emoji when possible.
 * @param {string} ip
 * @returns {Promise<string>} e.g. "🇫🇷 Paris, Île-de-France, France" or "IP" on failure
 */
async function getLocationForIp(ip) {
  try {
    const url = `${GEO_IP_BASE}/${encodeURIComponent(ip)}?fields=city,regionName,country,countryCode`;
    const { data } = await axios.get(url, { timeout: 5000 });
    const parts = [data?.city, data?.regionName, data?.country].filter(Boolean);
    let label = parts.length ? parts.join(', ') : ip;
    const flag = countryCodeToFlag(data?.countryCode);
    if (flag) label = `${flag} ${label}`;
    return label;
  } catch (_) {
    return ip;
  }
}

/**
 * Check current proxy IP and log when it changes (e.g. rotation).
 * Optionally call onLog with a message (for admin console) including location.
 * @param {{ onLog?: (msg: string) => void }} options
 */
export async function checkAndLogProxyIpChange(options = {}) {
  if (!isDecodoProxyEnabled()) return;
  const ip = await getCurrentProxyIp();
  if (!ip) return;
  const onLog = options.onLog;
  if (lastKnownProxyIp !== null && lastKnownProxyIp !== ip) {
    const msg = `[Proxy Decodo] IP changée: ${lastKnownProxyIp} → ${ip}`;
    console.log(msg);
    if (onLog) {
      const location = await getLocationForIp(ip);
      onLog(`[Proxy Decodo] IP changée: ${lastKnownProxyIp} → ${ip} (${location})`);
    }
  } else if (lastKnownProxyIp === null && onLog) {
    const location = await getLocationForIp(ip);
    onLog(`[Proxy Decodo] IP actuelle: ${ip} (${location})`);
  }
  lastKnownProxyIp = ip;
}

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
 * Check current proxy IP and log when it changes (e.g. rotation).
 * Call periodically during scraping.
 */
export async function checkAndLogProxyIpChange() {
  if (!isDecodoProxyEnabled()) return;
  const ip = await getCurrentProxyIp();
  if (!ip) return;
  if (lastKnownProxyIp !== null && lastKnownProxyIp !== ip) {
    console.log(`[Proxy Decodo] IP changée: ${lastKnownProxyIp} → ${ip}`);
  }
  lastKnownProxyIp = ip;
}

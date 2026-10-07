import { HttpsProxyAgent } from "https-proxy-agent";
import { env } from "../env.js";

const DECODO_HOST = "gate.decodo.com";
const DECODO_PORT = 7000;
const IP_CHECK_URL = "https://api.ipify.org?format=json";
const GEO_IP_BASE = "http://ip-api.com/json";

let lastKnownProxyIp: string | null = null;

export function isDecodoProxyEnabled(): boolean {
  return !!(env.DECODO_PROXY_USER?.trim() && env.DECODO_PROXY_PASSWORD?.trim());
}

function proxyUrl(sessionId?: string): string | null {
  const user = env.DECODO_PROXY_USER?.trim();
  const password = env.DECODO_PROXY_PASSWORD?.trim();
  if (!user || !password) return null;
  const username = sessionId ? `${user}-session-${sessionId}` : user;
  return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${DECODO_HOST}:${DECODO_PORT}`;
}

/** Agent for undici/node fetch via PROXY (Node 18+ custom dispatcher not needed — use agent with node-fetch style). */
export function getProxyAgent(sessionId?: string): HttpsProxyAgent<string> | undefined {
  const url = proxyUrl(sessionId);
  if (!url) return undefined;
  return new HttpsProxyAgent(url);
}

/**
 * Fetch through optional Decodo proxy using Node's undici + dispatcher.
 * Falls back to global fetch when proxy is off.
 */
export async function proxyFetch(
  url: string,
  init: RequestInit & { sessionId?: string; useProxy?: boolean } = {},
): Promise<Response> {
  const { sessionId, useProxy = true, ...rest } = init;
  if (!useProxy || !isDecodoProxyEnabled()) {
    // Always bound hangs — Steam Community can stall without responding
    const signal = rest.signal ?? AbortSignal.timeout(20_000);
    return fetch(url, { ...rest, signal });
  }
  const agent = getProxyAgent(sessionId);
  // Node fetch accepts dispatcher via undici; https-proxy-agent works with node:https.
  // Use dynamic import of node:https request wrapper for compatibility.
  const { request } = await import("node:https");
  const { URL } = await import("node:url");
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (rest.headers) {
      const h = new Headers(rest.headers);
      h.forEach((v, k) => {
        headers[k] = v;
      });
    }
    const req = request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: rest.method || "GET",
        headers,
        agent,
        timeout: 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve(
            new Response(body, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage,
              headers: res.headers as Record<string, string>,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    if (rest.body) req.write(rest.body as string);
    req.end();
  });
}

export async function getCurrentProxyIp(options: { sessionId?: string } = {}) {
  if (!isDecodoProxyEnabled()) return null;
  try {
    const res = await proxyFetch(IP_CHECK_URL, {
      sessionId: options.sessionId,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ip?: string };
    return data.ip ?? null;
  } catch {
    return null;
  }
}

export async function verifyDecodoProxy(): Promise<void> {
  if (!isDecodoProxyEnabled()) return;
  const ip = await getCurrentProxyIp();
  if (!ip) {
    throw new Error(
      "Decodo proxy: connection failed (check DECODO_PROXY_USER / DECODO_PROXY_PASSWORD)",
    );
  }
  lastKnownProxyIp = ip;
  console.log(`Decodo proxy: OK (IP: ${ip})`);
}

async function getLocationForIp(ip: string): Promise<string> {
  try {
    const res = await fetch(
      `${GEO_IP_BASE}/${encodeURIComponent(ip)}?fields=city,regionName,country,countryCode`,
      { signal: AbortSignal.timeout(5000) },
    );
    const data = (await res.json()) as {
      city?: string;
      regionName?: string;
      country?: string;
    };
    const parts = [data.city, data.regionName, data.country].filter(Boolean);
    return parts.length ? parts.join(", ") : ip;
  } catch {
    return ip;
  }
}

export async function checkAndLogProxyIpChange(options: {
  onLog?: (msg: string) => void;
} = {}) {
  if (!isDecodoProxyEnabled()) return;
  const ip = await getCurrentProxyIp();
  if (!ip) return;
  const onLog = options.onLog;
  if (lastKnownProxyIp !== null && lastKnownProxyIp !== ip) {
    const location = await getLocationForIp(ip);
    const msg = `[Proxy] IP changed: ${lastKnownProxyIp} → ${ip} (${location})`;
    console.log(msg);
    onLog?.(msg);
  } else if (lastKnownProxyIp === null && onLog) {
    const location = await getLocationForIp(ip);
    onLog(`[Proxy] Current IP: ${ip} (${location})`);
  }
  lastKnownProxyIp = ip;
}

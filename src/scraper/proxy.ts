import http from "node:http";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { env } from "../env.js";

const DECODO_HOST = "gate.decodo.com";
const DECODO_PORT = 7000;
const IP_CHECK_URL = "https://api.ipify.org?format=json";
const GEO_IP_BASE = "http://ip-api.com/json";
const DEFAULT_COOL_MS = 45_000;
const FETCH_TIMEOUT_MS = 20_000;

type ProxySlot = {
  /** Full proxy URL (http://user:pass@host:port) */
  url: string;
  coolUntil: number;
  failures: number;
};

/** Extra proxies from admin settings (DB). null = not configured via admin. */
let runtimeProxyText: string | null = null;
let slots: ProxySlot[] = [];
let rrIndex = 0;
let lastKnownProxyIp: string | null = null;
let proxyLogger: ((msg: string) => void) | null = null;
/**
 * After a reachability test: only these URLs are used for HTML fetches.
 * null = not filtered yet (all configured usable until the first test).
 */
let validatedUrls: Set<string> | null = null;

export function setProxyLogger(fn: ((msg: string) => void) | null) {
  proxyLogger = fn;
}

/** Parse PROXY_URLS / admin textarea: comma, semicolon, or newline separated. */
export function parseProxyList(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const out: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    const raw = part.trim();
    if (!raw || raw.startsWith("#")) continue;
    const normalized = normalizeProxyUrl(raw);
    if (normalized) out.push(normalized);
  }
  return [...new Set(out)];
}

/** Accept full URLs or host:port / user:pass@host:port (assumes http://). */
export function normalizeProxyUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = `http://${s}`;
  }
  try {
    const u = new URL(s);
    if (!u.hostname) return null;
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) {
      // Keep username prefix hint for Decodo session users
      const user = u.username.length > 12
        ? `${u.username.slice(0, 8)}…`
        : u.username;
      u.username = user;
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return "(invalid)";
  }
}

/** Compact label for console: host:port */
export function shortProxyLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return maskProxyUrl(url);
  }
}

function proxyIdentity(url: string): string {
  try {
    const u = new URL(url);
    const user = decodeURIComponent(u.username).replace(/-session-.*$/, "");
    return `${u.host}|${user}`;
  } catch {
    return url;
  }
}

let lastLoggedProxyKey: string | null = null;
let proxyFetchCount = 0;

function logProxyUse(proxyUrl: string | null) {
  if (!proxyUrl) return;
  proxyFetchCount += 1;
  const key = proxyIdentity(proxyUrl);
  // Log on switch, and every 15th request so the console stays informative
  if (key === lastLoggedProxyKey && proxyFetchCount % 15 !== 1) return;
  lastLoggedProxyKey = key;
  const msg = `[Proxy] using ${shortProxyLabel(proxyUrl)} · ${maskProxyUrl(proxyUrl)}`;
  console.log(msg);
  proxyLogger?.(msg);
}

function buildDecodoUrl(): string | null {
  const user = env.DECODO_PROXY_USER?.trim();
  const password = env.DECODO_PROXY_PASSWORD?.trim();
  if (!user || !password) return null;
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${DECODO_HOST}:${DECODO_PORT}`;
}

/** Apply Decodo sticky session suffix when sessionId is set. */
function withDecodoSession(proxyUrl: string, sessionId?: string): string {
  if (!sessionId) return proxyUrl;
  try {
    const u = new URL(proxyUrl);
    if (u.hostname !== DECODO_HOST) return proxyUrl;
    const baseUser = decodeURIComponent(u.username).replace(/-session-.*$/, "");
    u.username = `${baseUser}-session-${sessionId}`;
    return u.toString().replace(/\/$/, "");
  } catch {
    return proxyUrl;
  }
}

function collectConfiguredUrls(): string[] {
  const urls = [
    ...parseProxyList(env.PROXY_URLS),
    ...parseProxyList(runtimeProxyText),
  ];
  const decodo = buildDecodoUrl();
  if (decodo) urls.push(decodo);
  return [...new Set(urls)];
}

function rebuildSlots() {
  const all = collectConfiguredUrls();
  const urls =
    validatedUrls === null
      ? all
      : all.filter((u) => validatedUrls!.has(u));
  const prevCool = new Map(slots.map((s) => [s.url, s]));
  slots = urls.map((url) => {
    const old = prevCool.get(url);
    return {
      url,
      coolUntil: old?.coolUntil ?? 0,
      failures: old?.failures ?? 0,
    };
  });
  if (rrIndex >= slots.length) rrIndex = 0;
}

function applyValidatedProxies(
  passedUrls: string[],
  onLog?: (msg: string) => void,
) {
  const all = collectConfiguredUrls();
  const allowed = new Set(passedUrls.filter((u) => all.includes(u)));
  validatedUrls = allowed;
  rebuildSlots();
  emit(
    `[Proxy] active pool: ${slots.length}/${all.length} validated (failed/excluded ignored)`,
    onLog,
  );
  for (const s of slots) {
    emit(`  · active ${shortProxyLabel(s.url)} · ${maskProxyUrl(s.url)}`, onLog);
  }
  for (const u of all) {
    if (allowed.has(u)) continue;
    emit(
      `  · excluded ${shortProxyLabel(u)} · ${maskProxyUrl(u)}`,
      onLog,
    );
  }
}

rebuildSlots();

/** Clear post-test filter so all configured proxies are usable again. */
export function clearProxyValidation() {
  validatedUrls = null;
  rebuildSlots();
}

/**
 * Load proxies from admin DB setting (plaintext list).
 * Pass null to clear admin overrides (env / Decodo still apply).
 * Newly added URLs stay inactive until the next successful test.
 */
export function configureRuntimeProxies(text: string | null) {
  runtimeProxyText = text;
  const all = collectConfiguredUrls();
  if (validatedUrls) {
    validatedUrls = new Set(
      [...validatedUrls].filter((u) => all.includes(u)),
    );
  }
  rebuildSlots();
  const configured = all.length;
  const n = slots.length;
  if (configured) {
    console.log(
      `[Proxy] configured: ${configured} · active: ${n}` +
        (validatedUrls
          ? " (validated only)"
          : " (untested — run proxy test to filter)"),
    );
    for (const u of all) {
      const active = slots.some((s) => s.url === u);
      console.log(
        `  · ${active ? "active" : "pending"} ${maskProxyUrl(u)}`,
      );
    }
  } else {
    console.log("[Proxy] pool empty — HTML uses direct IP");
  }
}

export function isProxyEnabled(): boolean {
  rebuildSlots();
  return slots.length > 0;
}

/** @deprecated use isProxyEnabled — kept for older call sites */
export function isDecodoProxyEnabled(): boolean {
  return isProxyEnabled();
}

export function getProxyPoolStatus() {
  rebuildSlots();
  const all = collectConfiguredUrls();
  const activeSet = new Set(slots.map((s) => s.url));
  return {
    enabled: slots.length > 0,
    count: slots.length,
    configured: all.length,
    validatedOnly: validatedUrls !== null,
    sources: {
      envUrls: parseProxyList(env.PROXY_URLS).length,
      adminUrls: parseProxyList(runtimeProxyText).length,
      decodo: !!buildDecodoUrl(),
    },
    proxies: all.map((url) => {
      const slot = slots.find((s) => s.url === url);
      return {
        url: maskProxyUrl(url),
        label: shortProxyLabel(url),
        active: activeSet.has(url),
        validated: validatedUrls === null ? null : validatedUrls.has(url),
        cooling: slot ? slot.coolUntil > Date.now() : false,
        coolMsLeft: slot ? Math.max(0, slot.coolUntil - Date.now()) : 0,
        failures: slot?.failures ?? 0,
      };
    }),
  };
}

function hashSession(sessionId: string): number {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) {
    h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Pick a proxy from the pool.
 * - sticky: same sessionId prefers same slot (when not cooling)
 * - otherwise round-robin among non-cooling slots
 */
export function pickProxy(sessionId?: string): string | null {
  if (!slots.length) rebuildSlots();
  if (!slots.length) return null;

  const now = Date.now();
  const ready = slots.filter((s) => s.coolUntil <= now);
  const pool = ready.length ? ready : slots;

  let slot: ProxySlot;
  if (sessionId) {
    slot = pool[hashSession(sessionId) % pool.length];
  } else {
    slot = pool[rrIndex % pool.length];
    rrIndex = (rrIndex + 1) % Math.max(1, pool.length);
  }

  return withDecodoSession(slot.url, sessionId);
}

/** Cool a proxy after 429/403 so the next pick rotates away. */
export function coolProxy(proxyUrl: string, ms = DEFAULT_COOL_MS) {
  const id = proxyIdentity(proxyUrl);
  for (const s of slots) {
    if (proxyIdentity(s.url) !== id) continue;
    s.coolUntil = Math.max(s.coolUntil, Date.now() + ms);
    s.failures += 1;
    proxyLogger?.(
      `[Proxy] cooling ${maskProxyUrl(s.url)} for ${Math.round(ms / 1000)}s (fail #${s.failures})`,
    );
    break;
  }
}

function getAgent(proxyUrl: string): HttpsProxyAgent<string> {
  return new HttpsProxyAgent(proxyUrl, { timeout: FETCH_TIMEOUT_MS });
}

function requestWithAgent(
  url: string,
  agent: HttpsProxyAgent<string> | undefined,
  init: RequestInit,
): Promise<Response> {
  const parsed = new URL(url);
  const lib = parsed.protocol === "http:" ? http : https;
  const headers: Record<string, string> = {};
  if (init.headers) {
    const h = new Headers(init.headers);
    h.forEach((v, k) => {
      headers[k] = v;
    });
  }
  const timeoutMs = FETCH_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
        path: parsed.pathname + parsed.search,
        method: init.method || "GET",
        headers,
        agent,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
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
    if (init.signal) {
      const onAbort = () => {
        req.destroy();
        reject(new Error("Aborted"));
      };
      if (init.signal.aborted) onAbort();
      else init.signal.addEventListener("abort", onAbort, { once: true });
    }
    if (init.body) req.write(init.body as string);
    req.end();
  });
}

export type ProxyFetchInit = RequestInit & {
  sessionId?: string;
  useProxy?: boolean;
  /** Force a specific proxy URL (skip pick). */
  proxyUrl?: string | null;
};

/**
 * Fetch via rotating proxy pool (Steam Community HTML).
 * Falls back to direct fetch when pool is empty or useProxy=false.
 * Returns the proxy URL used (null = direct).
 */
export async function proxyFetch(
  url: string,
  init: ProxyFetchInit = {},
): Promise<Response & { proxyUrl?: string | null }> {
  const { sessionId, useProxy = true, proxyUrl: forced, ...rest } = init;
  const signal = rest.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS);

  let proxyUrl: string | null = null;
  if (useProxy) {
    proxyUrl = forced ?? pickProxy(sessionId);
  }

  if (!proxyUrl) {
    logProxyUse(null);
    const res = await fetch(url, { ...rest, signal });
    Object.defineProperty(res, "proxyUrl", { value: null });
    return res as Response & { proxyUrl?: string | null };
  }

  logProxyUse(proxyUrl);
  const agent = getAgent(proxyUrl);
  const res = await requestWithAgent(url, agent, { ...rest, signal });
  Object.defineProperty(res, "proxyUrl", { value: proxyUrl });
  return res as Response & { proxyUrl?: string | null };
}

export async function getCurrentProxyIp(options: { sessionId?: string } = {}) {
  if (!isProxyEnabled()) return null;
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

export type ProxyTestResult = {
  ok: boolean;
  ip: string | null;
  masked: string;
  label: string;
  ms: number;
  error?: string;
};

export type ProxyPoolTestReport = {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  results: ProxyTestResult[];
};

export type ProxyTestProgressEvent =
  | {
      type: "start";
      total: number;
      proxies: { label: string; masked: string }[];
    }
  | {
      type: "probing";
      index: number;
      total: number;
      label: string;
      masked: string;
    }
  | {
      type: "result";
      index: number;
      total: number;
      passed: number;
      failed: number;
      result: ProxyTestResult;
    }
  | { type: "done"; report: ProxyPoolTestReport };

function emit(msg: string, onLog?: (m: string) => void) {
  console.log(msg);
  onLog?.(msg);
  proxyLogger?.(msg);
}

/** Probe every configured proxy (ipify). Only OK ones stay in the active pool. */
export async function testAllProxies(options: {
  onLog?: (msg: string) => void;
  onProgress?: (ev: ProxyTestProgressEvent) => void;
} = {}): Promise<ProxyPoolTestReport> {
  const onLog = options.onLog;
  const onProgress = options.onProgress;

  // Test the full configured list (ignore previous validation filter)
  validatedUrls = null;
  rebuildSlots();
  const toTest = collectConfiguredUrls();

  if (!toTest.length) {
    validatedUrls = new Set();
    rebuildSlots();
    emit("[Proxy] no proxies configured — nothing to test", onLog);
    const empty: ProxyPoolTestReport = {
      ok: false,
      total: 0,
      passed: 0,
      failed: 0,
      results: [],
    };
    onProgress?.({ type: "start", total: 0, proxies: [] });
    onProgress?.({ type: "done", report: empty });
    return empty;
  }

  const proxyMeta = toTest.map((url) => ({
    label: shortProxyLabel(url),
    masked: maskProxyUrl(url),
  }));
  onProgress?.({ type: "start", total: toTest.length, proxies: proxyMeta });
  emit(`[Proxy] reachability test: ${toTest.length} endpoint(s)…`, onLog);

  const results: ProxyTestResult[] = [];
  const passedUrls: string[] = [];
  let passed = 0;

  for (let i = 0; i < toTest.length; i++) {
    const url = toTest[i];
    const masked = maskProxyUrl(url);
    const label = shortProxyLabel(url);
    const t0 = Date.now();
    onProgress?.({
      type: "probing",
      index: i,
      total: toTest.length,
      label,
      masked,
    });
    emit(`[Proxy] (${i + 1}/${toTest.length}) probing ${label}…`, onLog);

    let row: ProxyTestResult;
    try {
      const res = await proxyFetch(IP_CHECK_URL, {
        proxyUrl: url,
        useProxy: true,
      });
      const ms = Date.now() - t0;
      if (!res.ok) {
        coolProxy(url, DEFAULT_COOL_MS);
        row = {
          ok: false,
          ip: null,
          masked,
          label,
          ms,
          error: `HTTP ${res.status}`,
        };
        emit(`[Proxy] ✗ ${label} — HTTP ${res.status} (${ms}ms)`, onLog);
      } else {
        const data = (await res.json()) as { ip?: string };
        const ip = data.ip ?? null;
        if (!ip) {
          coolProxy(url, DEFAULT_COOL_MS);
          row = {
            ok: false,
            ip: null,
            masked,
            label,
            ms,
            error: "No IP in response",
          };
          emit(`[Proxy] ✗ ${label} — no IP (${ms}ms)`, onLog);
        } else {
          passed += 1;
          passedUrls.push(url);
          lastKnownProxyIp = ip;
          row = { ok: true, ip, masked, label, ms };
          emit(`[Proxy] ✓ ${label} → IP ${ip} (${ms}ms)`, onLog);
        }
      }
    } catch (e) {
      const ms = Date.now() - t0;
      const error = e instanceof Error ? e.message : String(e);
      coolProxy(url, DEFAULT_COOL_MS);
      row = { ok: false, ip: null, masked, label, ms, error };
      emit(`[Proxy] ✗ ${label} — ${error} (${ms}ms)`, onLog);
    }

    results.push(row);
    onProgress?.({
      type: "result",
      index: i,
      total: toTest.length,
      passed,
      failed: results.length - passed,
      result: row,
    });
  }

  // Keep only proxies that passed — failed ones are never used for HTML
  applyValidatedProxies(passedUrls, onLog);

  const failed = results.length - passed;
  const report: ProxyPoolTestReport = {
    ok: passed > 0,
    total: results.length,
    passed,
    failed,
    results,
  };
  emit(
    `[Proxy] test done: ${passed}/${results.length} reachable` +
      (failed ? ` · ${failed} excluded` : ""),
    onLog,
  );
  onProgress?.({ type: "done", report });
  return report;
}

export async function verifyProxyPool(): Promise<{
  ok: boolean;
  ip: string | null;
  count: number;
  passed: number;
  failed: number;
}> {
  const report = await testAllProxies();
  if (!report.total) {
    return { ok: false, ip: null, count: 0, passed: 0, failed: 0 };
  }
  if (!report.ok) {
    throw new Error(
      `Proxy pool: 0/${report.total} reachable (check PROXY_URLS / credentials)`,
    );
  }
  const firstIp = report.results.find((r) => r.ok)?.ip ?? null;
  return {
    ok: true,
    ip: firstIp,
    count: report.total,
    passed: report.passed,
    failed: report.failed,
  };
}

/** @deprecated use verifyProxyPool */
export async function verifyDecodoProxy(): Promise<void> {
  await verifyProxyPool();
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
  if (!isProxyEnabled()) return;
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

/** Test one proxy URL (or the whole pool if omitted / empty). */
export async function testProxyUrl(
  url?: string,
): Promise<
  | ProxyTestResult
  | (ProxyPoolTestReport & { ok: boolean; ip: string | null; masked: string })
> {
  if (!url?.trim()) {
    const report = await testAllProxies();
    const firstOk = report.results.find((r) => r.ok);
    return {
      ...report,
      ip: firstOk?.ip ?? null,
      masked: firstOk?.masked ?? "",
    };
  }
  const target = normalizeProxyUrl(url);
  if (!target) {
    return {
      ok: false,
      ip: null,
      masked: "",
      label: "",
      ms: 0,
      error: "Invalid proxy URL",
    };
  }
  const t0 = Date.now();
  try {
    const res = await proxyFetch(IP_CHECK_URL, {
      proxyUrl: target,
      useProxy: true,
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      return {
        ok: false,
        ip: null,
        masked: maskProxyUrl(target),
        label: shortProxyLabel(target),
        ms,
        error: `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as { ip?: string };
    return {
      ok: !!data.ip,
      ip: data.ip ?? null,
      masked: maskProxyUrl(target),
      label: shortProxyLabel(target),
      ms,
      error: data.ip ? undefined : "No IP in response",
    };
  } catch (e) {
    return {
      ok: false,
      ip: null,
      masked: maskProxyUrl(target),
      label: shortProxyLabel(target),
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

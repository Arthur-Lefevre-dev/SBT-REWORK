import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearProxyValidation,
  configureRuntimeProxies,
  coolProxy,
  getProxyPoolStatus,
  isProxyEnabled,
  maskProxyUrl,
  normalizeProxyUrl,
  parseProxyList,
  pickProxy,
  shortProxyLabel,
  testAllProxies,
} from "./proxy.js";

test("parseProxyList splits commas newlines and skips comments", () => {
  const list = parseProxyList(`
    # comment
    http://u:p@a.example:8000
    http://u2:p2@b.example:8000, host.example:9000
  `);
  assert.equal(list.length, 3);
  assert.ok(list[0].includes("a.example"));
  assert.ok(list[2].startsWith("http://host.example:9000"));
});

test("normalizeProxyUrl rejects non-http schemes", () => {
  assert.equal(normalizeProxyUrl("socks5://x:y@h:1"), null);
  assert.ok(normalizeProxyUrl("user:pass@h:8080")?.startsWith("http://"));
});

test("maskProxyUrl hides password", () => {
  const m = maskProxyUrl("http://alice:s3cret@proxy.example:8080");
  assert.ok(m.includes("***"));
  assert.ok(!m.includes("s3cret"));
  assert.ok(m.includes("proxy.example"));
});

test("shortProxyLabel is host:port", () => {
  assert.equal(
    shortProxyLabel("http://alice:s3cret@proxy.example:8080"),
    "proxy.example:8080",
  );
});

test("testAllProxies with empty pool reports zero", async () => {
  configureRuntimeProxies(null);
  // May still have env/Decodo proxies — only assert shape when empty
  const before = getProxyPoolStatus();
  if (before.count === 0) {
    const report = await testAllProxies();
    assert.equal(report.total, 0);
    assert.equal(report.ok, false);
  }
});

test("configureRuntimeProxies builds rotatable pool", () => {
  clearProxyValidation();
  configureRuntimeProxies(
    "http://u1:p1@p1.example:1000\nhttp://u2:p2@p2.example:2000",
  );
  assert.equal(isProxyEnabled(), true);
  const st = getProxyPoolStatus();
  assert.ok(st.sources.adminUrls >= 2);
  assert.ok(st.count >= 2);

  const a = pickProxy();
  assert.ok(a);
  coolProxy(a!, 60_000);
  const after = getProxyPoolStatus();
  assert.ok(after.proxies.some((p) => p.cooling || p.failures > 0));

  const c = pickProxy("session-x");
  assert.ok(c);

  configureRuntimeProxies(null);
});

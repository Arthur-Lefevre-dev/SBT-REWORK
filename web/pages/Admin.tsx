import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchJson } from "../http";
import { useI18n } from "../i18n";

type Me = { steamId: string | null; isAdmin: boolean };
type ProxyStatus = {
  enabled: boolean;
  count: number;
  configured?: number;
  validatedOnly?: boolean;
  proxies: {
    url: string;
    label?: string;
    active?: boolean;
    validated?: boolean | null;
    cooling: boolean;
    failures: number;
  }[];
};
type Settings = {
  steam_api_key_set: boolean;
  start_steamid64: string;
  max_depth: string;
  max_profiles: string;
  turbo_mode: boolean;
  proxy_urls: string;
  proxy_status: ProxyStatus;
};
type BotState = {
  status: string;
  stats: Record<string, number>;
  log: { t: string; msg: string }[];
  error?: string | null;
};

type ProxyRowState = {
  label: string;
  masked: string;
  status: "pending" | "testing" | "ok" | "fail";
  ip?: string | null;
  ms?: number;
  error?: string;
};

export default function AdminPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bot, setBot] = useState<BotState | null>(null);
  const [vac, setVac] = useState<Record<string, unknown> | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [startId, setStartId] = useState("");
  const [maxDepth, setMaxDepth] = useState("2");
  const [maxProfiles, setMaxProfiles] = useState("500");
  const [turbo, setTurbo] = useState(false);
  const [proxyUrls, setProxyUrls] = useState("");
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [proxyModalOpen, setProxyModalOpen] = useState(false);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyRows, setProxyRows] = useState<ProxyRowState[]>([]);
  const [proxyProgress, setProxyProgress] = useState({
    done: 0,
    total: 0,
    passed: 0,
    failed: 0,
  });
  const [vacLimit, setVacLimit] = useState("100");
  const [flash, setFlash] = useState<string | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const proxyEsRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetchJson<Me>("/api/admin/me")
      .then((m) => {
        setMe(m);
        if (!m.steamId) nav("/admin/login-ui");
        else if (!m.isAdmin) nav("/admin/denied");
      })
      .catch((e) => setFlashError(e.message));
  }, [nav]);

  useEffect(() => {
    if (!me?.isAdmin) return;
    fetchJson<Settings>("/api/admin/settings").then((s) => {
      setSettings(s);
      setStartId(s.start_steamid64);
      setMaxDepth(s.max_depth);
      setMaxProfiles(s.max_profiles);
      setTurbo(!!s.turbo_mode);
      setProxyUrls(s.proxy_urls || "");
      setProxyStatus(s.proxy_status || null);
    });
    fetchJson<BotState>("/api/admin/bot/state").then(setBot);
    fetchJson<Record<string, unknown>>("/api/admin/verify-vac/state").then(
      setVac,
    );

    let closed = false;
    (async () => {
      const { token } = await fetchJson<{ token: string }>(
        "/api/admin/ws-token",
      );
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${proto}://${location.host}/admin/ws?token=${token}`,
      );
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data) as {
          bot: BotState;
          vacVerify: Record<string, unknown>;
        };
        setBot(data.bot);
        setVac(data.vacVerify);
      };
    })();
    return () => {
      closed = true;
      wsRef.current?.close();
      proxyEsRef.current?.close();
      proxyEsRef.current = null;
    };
  }, [me]);

  async function saveSettings() {
    setFlash(null);
    setFlashError(null);
    try {
      const saved = await fetchJson<{ ok: boolean; proxy_status?: ProxyStatus }>(
        "/api/admin/settings",
        {
          method: "PUT",
          body: JSON.stringify({
            steam_api_key: apiKey || undefined,
            start_steamid64: startId,
            max_depth: maxDepth,
            max_profiles: maxProfiles,
            turbo_mode: turbo,
            proxy_urls: proxyUrls,
          }),
        },
      );
      setApiKey("");
      const s = await fetchJson<Settings>("/api/admin/settings");
      setSettings(s);
      setTurbo(!!s.turbo_mode);
      setProxyUrls(s.proxy_urls || "");
      setProxyStatus(saved.proxy_status || s.proxy_status || null);
      setFlash(t("admin.saved"));
    } catch (e) {
      setFlashError(e instanceof Error ? e.message : t("admin.saveError"));
    }
  }

  function closeProxyModal() {
    proxyEsRef.current?.close();
    proxyEsRef.current = null;
    setProxyModalOpen(false);
    setProxyTesting(false);
  }

  async function testProxies() {
    setFlashError(null);
    setProxyTesting(true);
    setProxyModalOpen(true);
    setProxyRows([]);
    setProxyProgress({ done: 0, total: 0, passed: 0, failed: 0 });

    // Persist textarea so the stream tests the current list
    try {
      const saved = await fetchJson<{ ok: boolean; proxy_status?: ProxyStatus }>(
        "/api/admin/settings",
        {
          method: "PUT",
          body: JSON.stringify({ proxy_urls: proxyUrls }),
        },
      );
      if (saved.proxy_status) setProxyStatus(saved.proxy_status);
    } catch {
      /* use already-loaded pool */
    }

    proxyEsRef.current?.close();
    const es = new EventSource("/api/admin/proxy/test-stream");
    proxyEsRef.current = es;

    es.addEventListener("start", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as {
        total: number;
        proxies: { label: string; masked: string }[];
      };
      setProxyRows(
        data.proxies.map((p) => ({
          label: p.label,
          masked: p.masked,
          status: "pending",
        })),
      );
      setProxyProgress({
        done: 0,
        total: data.total,
        passed: 0,
        failed: 0,
      });
    });

    es.addEventListener("probing", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { index: number };
      setProxyRows((rows) =>
        rows.map((r, i) =>
          i === data.index ? { ...r, status: "testing" } : r,
        ),
      );
    });

    es.addEventListener("result", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as {
        index: number;
        passed: number;
        failed: number;
        total: number;
        result: {
          ok: boolean;
          ip: string | null;
          ms: number;
          error?: string;
          label: string;
          masked: string;
        };
      };
      setProxyRows((rows) =>
        rows.map((r, i) =>
          i === data.index
            ? {
                ...r,
                status: data.result.ok ? "ok" : "fail",
                ip: data.result.ip,
                ms: data.result.ms,
                error: data.result.error,
              }
            : r,
        ),
      );
      setProxyProgress({
        done: data.passed + data.failed,
        total: data.total,
        passed: data.passed,
        failed: data.failed,
      });
    });

    es.addEventListener("done", async (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as {
        report: {
          total: number;
          passed: number;
          failed: number;
        };
      };
      setProxyProgress({
        done: data.report.total,
        total: data.report.total,
        passed: data.report.passed,
        failed: data.report.failed,
      });
      setProxyTesting(false);
      es.close();
      proxyEsRef.current = null;
      try {
        const st = await fetchJson<ProxyStatus>("/api/admin/proxy/status");
        setProxyStatus(st);
        setFlash(
          t("admin.proxy.testSummary", {
            passed: String(data.report.passed),
            total: String(data.report.total),
            failed: String(data.report.failed),
          }),
        );
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("fail", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { error?: string };
      setFlashError(data.error || t("admin.saveError"));
      setProxyTesting(false);
      es.close();
      proxyEsRef.current = null;
    });

    es.onerror = () => {
      // Fires after normal close too — only clear if this stream is still active
      if (proxyEsRef.current === es) {
        setProxyTesting(false);
        proxyEsRef.current = null;
      }
      es.close();
    };
  }

  if (!me?.isAdmin) return <p className="muted">{t("admin.loading")}</p>;

  return (
    <div className="stack">
      {(flash || flashError) && (
        <p className={flashError ? "error" : "muted"}>
          {flashError || flash}
        </p>
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{t("admin.title")}</h2>
        <div className="row">
          <span className="muted mono">{me.steamId}</span>
          <a className="btn ghost" href="/admin/logout">
            {t("admin.logout")}
          </a>
          <Link className="btn ghost" to="/">
            {t("nav.home")}
          </Link>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>{t("admin.settings")}</h3>
          <div className="form-row">
            <label>
              {t("admin.apiKey")}{" "}
              {settings?.steam_api_key_set
                ? t("admin.apiKey.set")
                : t("admin.apiKey.unset")}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t("admin.apiKey.keep")}
            />
          </div>
          <div className="form-row">
            <label>{t("admin.startId")}</label>
            <input value={startId} onChange={(e) => setStartId(e.target.value)} />
          </div>
          <div className="form-row">
            <label>{t("admin.maxDepth")}</label>
            <input value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} />
          </div>
          <div className="form-row">
            <label>{t("admin.maxProfiles")}</label>
            <input
              value={maxProfiles}
              onChange={(e) => setMaxProfiles(e.target.value)}
            />
          </div>
          <label className="turbo-toggle">
            <input
              type="checkbox"
              checked={turbo}
              onChange={(e) => setTurbo(e.target.checked)}
            />
            <span>
              <strong>{t("admin.turbo")}</strong>
              <span className="muted"> — {t("admin.turbo.hint")}</span>
            </span>
          </label>
          <div className="form-row">
            <label>{t("admin.proxy")}</label>
            <textarea
              rows={4}
              value={proxyUrls}
              onChange={(e) => setProxyUrls(e.target.value)}
              placeholder={t("admin.proxy.placeholder")}
              spellCheck={false}
              style={{ fontFamily: "var(--mono, monospace)", fontSize: "0.85rem" }}
            />
            <p className="muted" style={{ fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
              {t("admin.proxy.hint")}
            </p>
            <p className="muted mono" style={{ fontSize: "0.8rem" }}>
              {!proxyStatus?.configured
                ? t("admin.proxy.statusOff")
                : proxyStatus.validatedOnly
                  ? proxyStatus.enabled
                    ? t("admin.proxy.statusOn", {
                        n: String(proxyStatus.count),
                        configured: String(proxyStatus.configured),
                      })
                    : t("admin.proxy.statusOff")
                  : t("admin.proxy.statusUntested", {
                      configured: String(proxyStatus.configured),
                    })}
            </p>
          </div>
          <div className="row">
            <button className="btn" onClick={saveSettings}>
              {t("admin.save")}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={testProxies}
              disabled={proxyTesting}
            >
              {proxyTesting ? t("admin.proxy.testing") : t("admin.proxy.test")}
            </button>
          </div>
        </div>

        <div className="card">
          <h3>{t("admin.bot")}</h3>
          <p>
            {t("admin.status")}: <strong>{bot?.status ?? "—"}</strong>
            {turbo ? (
              <span className="badge vac" style={{ marginLeft: 8 }}>
                TURBO
              </span>
            ) : null}
          </p>
          <p className="muted mono">
            profiles={bot?.stats?.profilesCount ?? 0} depth=
            {bot?.stats?.currentDepth ?? 0} batches=
            {bot?.stats?.batchCount ?? 0} rl=
            {bot?.stats?.rateLimitPauses ?? 0}
          </p>
          <div className="row">
            <button
              className="btn"
              onClick={() =>
                fetchJson("/api/admin/bot/start", {
                  method: "POST",
                  body: JSON.stringify({ turbo }),
                })
              }
            >
              {t("admin.start")}
            </button>
            <button
              className="btn ghost"
              onClick={() =>
                fetchJson("/api/admin/bot/pause", { method: "POST" })
              }
            >
              {t("admin.pause")}
            </button>
            <button
              className="btn ghost"
              onClick={() =>
                fetchJson("/api/admin/bot/resume", { method: "POST" })
              }
            >
              {t("admin.resume")}
            </button>
            <button
              className="btn danger"
              onClick={() =>
                fetchJson("/api/admin/bot/stop", { method: "POST" })
              }
            >
              {t("admin.stop")}
            </button>
          </div>
          <div className="console" style={{ marginTop: "0.75rem" }}>
            {(bot?.log || [])
              .map((l) => `${l.t.slice(11, 19)} ${l.msg}`)
              .join("\n") || "—"}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>{t("admin.vac")}</h3>
        <p className="muted">
          status={String(vac?.status ?? "—")} checked=
          {String(vac?.checked ?? 0)} found={String(vac?.found ?? 0)} /{" "}
          {String(vac?.totalToVerify ?? "?")}
          {vac?.concurrency != null ? ` · ×${String(vac.concurrency)}` : ""}
        </p>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          {vac?.autoEnabled
            ? t("admin.vac.autoOn", {
                next: vac.nextAutoRun
                  ? String(vac.nextAutoRun).slice(0, 19).replace("T", " ")
                  : "—",
                last: vac.lastAutoRun
                  ? String(vac.lastAutoRun).slice(0, 19).replace("T", " ")
                  : "—",
              })
            : t("admin.vac.autoOff")}
        </p>
        <div className="row">
          <input
            style={{ width: 100 }}
            value={vacLimit}
            onChange={(e) => setVacLimit(e.target.value)}
          />
          <button
            className="btn"
            onClick={() =>
              fetchJson("/api/admin/verify-vac/start", {
                method: "POST",
                body: JSON.stringify({
                  limit: parseInt(vacLimit, 10),
                  confirmWithApi: false,
                  concurrency: 2,
                }),
              })
            }
          >
            {t("admin.verifyStart")}
          </button>
          <button
            className="btn danger"
            onClick={() =>
              fetchJson("/api/admin/verify-vac/stop", { method: "POST" })
            }
          >
            {t("admin.stop")}
          </button>
          <a className="btn ghost" href="/api/admin/export/vac-banned?format=csv">
            {t("admin.exportCsv")}
          </a>
        </div>
      </div>

      {proxyModalOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !proxyTesting) closeProxyModal();
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="proxy-test-title"
          >
            <h3 id="proxy-test-title">{t("admin.proxy.modalTitle")}</h3>
            <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
              {proxyTesting
                ? t("admin.proxy.modalHint")
                : t("admin.proxy.testSummary", {
                    passed: String(proxyProgress.passed),
                    total: String(proxyProgress.total),
                    failed: String(proxyProgress.failed),
                  })}
            </p>
            <div className="modal-progress" aria-hidden>
              <span
                style={{
                  width:
                    proxyProgress.total > 0
                      ? `${Math.round(
                          (proxyProgress.done / proxyProgress.total) * 100,
                        )}%`
                      : proxyTesting
                        ? "8%"
                        : "0%",
                }}
              />
            </div>
            <p className="muted mono" style={{ margin: 0, fontSize: "0.8rem" }}>
              {t("admin.proxy.modalProgress", {
                done: String(proxyProgress.done),
                total: String(proxyProgress.total),
                passed: String(proxyProgress.passed),
                failed: String(proxyProgress.failed),
              })}
            </p>

            {proxyRows.length === 0 && !proxyTesting ? (
              <p className="muted" style={{ marginTop: "1rem" }}>
                {t("admin.proxy.modalEmpty")}
              </p>
            ) : (
              <ul className="proxy-test-list">
                {proxyRows.map((row) => (
                  <li
                    key={row.masked + row.label}
                    className={`proxy-test-item ${row.status}`}
                  >
                    <span className="proxy-dot" />
                    <div>
                      <div className="mono">{row.label}</div>
                      <div className="muted" style={{ fontSize: "0.75rem" }}>
                        {row.masked}
                      </div>
                      {row.status === "ok" && (
                        <div style={{ color: "var(--ok)", marginTop: 2 }}>
                          IP {row.ip} · {row.ms}ms
                        </div>
                      )}
                      {row.status === "fail" && (
                        <div className="error" style={{ marginTop: 2 }}>
                          {row.error || "?"} · {row.ms}ms
                        </div>
                      )}
                      {row.status === "pending" && (
                        <div className="muted" style={{ marginTop: 2 }}>
                          {t("admin.proxy.pending")}
                        </div>
                      )}
                      {row.status === "testing" && (
                        <div style={{ color: "var(--accent)", marginTop: 2 }}>
                          {t("admin.proxy.running")}
                        </div>
                      )}
                    </div>
                    <strong className="mono" style={{ fontSize: "0.75rem" }}>
                      {row.status === "ok"
                        ? "OK"
                        : row.status === "fail"
                          ? "KO"
                          : row.status === "testing"
                            ? "…"
                            : "—"}
                    </strong>
                  </li>
                ))}
              </ul>
            )}

            <div className="row" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
              <button
                className="btn"
                type="button"
                onClick={closeProxyModal}
                disabled={proxyTesting}
              >
                {t("admin.proxy.modalClose")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

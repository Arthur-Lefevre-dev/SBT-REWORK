import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchJson } from "../http";
import { useI18n } from "../i18n";

type Me = { steamId: string | null; isAdmin: boolean };
type Settings = {
  steam_api_key_set: boolean;
  start_steamid64: string;
  max_depth: string;
  max_profiles: string;
};
type BotState = {
  status: string;
  stats: Record<string, number>;
  log: { t: string; msg: string }[];
  error?: string | null;
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
  const [vacLimit, setVacLimit] = useState("100");
  const [flash, setFlash] = useState<string | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

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
    };
  }, [me]);

  async function saveSettings() {
    setFlash(null);
    setFlashError(null);
    try {
      await fetchJson("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          steam_api_key: apiKey || undefined,
          start_steamid64: startId,
          max_depth: maxDepth,
          max_profiles: maxProfiles,
        }),
      });
      setApiKey("");
      setSettings(await fetchJson("/api/admin/settings"));
      setFlash(t("admin.saved"));
    } catch (e) {
      setFlashError(e instanceof Error ? e.message : t("admin.saveError"));
    }
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
            Logout
          </a>
          <Link className="btn ghost" to="/">
            Home
          </Link>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>{t("admin.settings")}</h3>
          <div className="form-row">
            <label>
              Steam API key{" "}
              {settings?.steam_api_key_set ? "(set)" : "(not set)"}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Leave blank to keep"
            />
          </div>
          <div className="form-row">
            <label>Start SteamID64</label>
            <input value={startId} onChange={(e) => setStartId(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Max depth</label>
            <input value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Max profiles</label>
            <input
              value={maxProfiles}
              onChange={(e) => setMaxProfiles(e.target.value)}
            />
          </div>
          <button className="btn" onClick={saveSettings}>
            Save
          </button>
        </div>

        <div className="card">
          <h3>{t("admin.bot")}</h3>
          <p>
            Status: <strong>{bot?.status ?? "—"}</strong>
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
                  body: "{}",
                })
              }
            >
              Start
            </button>
            <button
              className="btn ghost"
              onClick={() =>
                fetchJson("/api/admin/bot/pause", { method: "POST" })
              }
            >
              Pause
            </button>
            <button
              className="btn ghost"
              onClick={() =>
                fetchJson("/api/admin/bot/resume", { method: "POST" })
              }
            >
              Resume
            </button>
            <button
              className="btn danger"
              onClick={() =>
                fetchJson("/api/admin/bot/stop", { method: "POST" })
              }
            >
              Stop
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
                  confirmWithApi: true,
                }),
              })
            }
          >
            Start verify
          </button>
          <button
            className="btn danger"
            onClick={() =>
              fetchJson("/api/admin/verify-vac/stop", { method: "POST" })
            }
          >
            Stop
          </button>
          <a className="btn ghost" href="/api/admin/export/vac-banned?format=csv">
            Export CSV
          </a>
        </div>
      </div>
    </div>
  );
}

import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import { Link, useNavigate } from "react-router-dom";
import { fetchJson } from "../http";
import { useI18n } from "../i18n";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

type Stats = {
  totalProfiles: number;
  vacBannedCount: number;
  gameBannedCount: number;
  communityBannedCount: number;
};

type Row = Record<string, unknown> & {
  steamid64: string;
  persona_name?: string;
  avatar?: string;
};

type Tab = "banned" | "vac" | "game" | "community" | "profiles" | "chart";

const PAGE = 10;

export default function HomePage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<Tab>("banned");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<Row[]>([]);
  const [chartBy, setChartBy] = useState<"scrape" | "ban">("scrape");
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<string>("");
  const [chartRows, setChartRows] = useState<
    { month: string; vac: number; game: number; community?: number }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  useEffect(() => {
    fetchJson<Stats>("/api/stats")
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (tab === "chart") return;
    const endpoints: Record<Exclude<Tab, "chart">, string> = {
      banned: "/api/banned",
      vac: "/api/vac-banned",
      game: "/api/game-banned",
      community: "/api/community-banned",
      profiles: "/api/profiles",
    };
    const params = new URLSearchParams({
      limit: String(PAGE),
      offset: String(page * PAGE),
    });
    if (q.trim() && (tab === "banned" || tab === "profiles" || tab === "vac")) {
      params.set("search", q.trim());
    }
    let cancelled = false;
    setListLoading(true);
    fetchJson<{ rows: Row[]; total: number }>(
      `${endpoints[tab]}?${params}`,
    )
      .then((d) => {
        if (cancelled) return;
        setRows(d.rows);
        setTotal(d.total);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, page, q]);

  useEffect(() => {
    if (tab !== "chart") return;
    const by = chartBy === "ban" ? "ban" : "";
    fetchJson<number[]>(`/api/stats-years?by=${by}`).then((ys) => {
      setYears(ys);
      if (!year && ys[0]) setYear(String(ys[0]));
    });
  }, [tab, chartBy]);

  useEffect(() => {
    if (tab !== "chart") return;
    const params = new URLSearchParams();
    if (year) params.set("year", year);
    if (chartBy === "ban") params.set("by", "ban");
    fetchJson<typeof chartRows>(`/api/stats-over-time?${params}`).then(
      setChartRows,
    );
  }, [tab, year, chartBy]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const id = setTimeout(() => {
      fetchJson<Row[]>(`/api/search?q=${encodeURIComponent(q.trim())}`).then(
        setSuggestions,
      );
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  async function goSearch(e: React.FormEvent) {
    e.preventDefault();
    const raw = q.trim();
    if (!raw) return;
    const vanityMatch = raw.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
    const idMatch = raw.match(/(?:profiles\/)?(7656119\d{10})/);
    if (idMatch) {
      nav(`/profile/${idMatch[1]}`);
      return;
    }
    if (vanityMatch || !/^\d+$/.test(raw)) {
      const vanity = vanityMatch?.[1] || raw;
      try {
        const { steamid64 } = await fetchJson<{ steamid64: string }>(
          `/api/resolve-vanity?vanity=${encodeURIComponent(vanity)}`,
        );
        nav(`/profile/${steamid64}`);
      } catch {
        setTab("profiles");
        setPage(0);
      }
      return;
    }
    nav(`/profile/${raw}`);
  }

  const chartData = useMemo(
    () => ({
      labels: chartRows.map((r) => r.month),
      datasets: [
        {
          label: "VAC",
          data: chartRows.map((r) => r.vac),
          borderColor: "#f85149",
          tension: 0.25,
        },
        {
          label: "Game",
          data: chartRows.map((r) => r.game),
          borderColor: "#d29922",
          tension: 0.25,
        },
        ...(chartBy === "scrape"
          ? [
              {
                label: "Community",
                data: chartRows.map((r) => r.community ?? 0),
                borderColor: "#58a6ff",
                tension: 0.25,
              },
            ]
          : []),
      ],
    }),
    [chartRows, chartBy],
  );

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <div className="stats">
        <div className="stat">
          <div className="label">{t("home.stats.profiles")}</div>
          <div className="value">{stats?.totalProfiles ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="label">{t("home.stats.vac")}</div>
          <div className="value">{stats?.vacBannedCount ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="label">{t("home.stats.game")}</div>
          <div className="value">{stats?.gameBannedCount ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="label">{t("home.stats.community")}</div>
          <div className="value">{stats?.communityBannedCount ?? "—"}</div>
        </div>
      </div>

      <form className="search-row" onSubmit={goSearch}>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder={t("home.search")}
        />
        <button className="btn" type="submit">
          Go
        </button>
        {suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((s) => (
              <button
                key={s.steamid64}
                type="button"
                onClick={() => nav(`/profile/${s.steamid64}`)}
              >
                {s.avatar ? (
                  <img src={String(s.avatar)} alt="" />
                ) : (
                  <span />
                )}
                <span>{s.persona_name || s.steamid64}</span>
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="tabs">
        {(
          [
            ["banned", "home.tab.banned"],
            ["vac", "home.tab.vac"],
            ["game", "home.tab.game"],
            ["community", "home.tab.community"],
            ["profiles", "home.tab.profiles"],
            ["chart", "home.tab.chart"],
          ] as const
        ).map(([id, key]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setPage(0);
            }}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {tab === "chart" ? (
        <div className="panel" style={{ padding: "1rem" }}>
          <div className="row" style={{ marginBottom: "1rem" }}>
            <select
              value={chartBy}
              onChange={(e) =>
                setChartBy(e.target.value as "scrape" | "ban")
              }
            >
              <option value="scrape">{t("home.chart.byScrape")}</option>
              <option value="ban">{t("home.chart.byBan")}</option>
            </select>
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">{t("home.chart.allYears")}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <Line
            data={chartData}
            options={{
              responsive: true,
              plugins: { legend: { labels: { color: "#e6edf3" } } },
              scales: {
                x: { ticks: { color: "#8b949e" }, grid: { color: "#30363d" } },
                y: { ticks: { color: "#8b949e" }, grid: { color: "#30363d" } },
              },
            }}
          />
        </div>
      ) : (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>SteamID64</th>
                <th>Bans</th>
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                <tr>
                  <td colSpan={4} className="muted">
                    {t("home.loading")}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.steamid64}>
                    <td>
                      {r.avatar ? (
                        <Link to={`/profile/${r.steamid64}`}>
                          <img
                            className="avatar"
                            src={String(r.avatar)}
                            alt=""
                          />
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Link to={`/profile/${r.steamid64}`}>
                        {r.persona_name || "—"}
                      </Link>
                    </td>
                    <td className="mono">{r.steamid64}</td>
                    <td>
                      {!!(r.vac_banned || r.vac_count) && (
                        <span className="badge vac">VAC</span>
                      )}
                      {Number(r.game_ban_count) > 0 && (
                        <span className="badge game">Game</span>
                      )}
                      {!!r.community_banned && (
                        <span className="badge community">Community</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
              {!listLoading && !rows.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    {t("home.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="pager">
            <button
              className="btn ghost"
              disabled={page <= 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </button>
            <span>
              {page + 1} / {pages} ({total})
            </span>
            <button
              className="btn ghost"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchJson } from "../http";
import { useI18n } from "../i18n";
import { faceitLevelIcon, mapLogo } from "../lib/steam";

type Match = {
  id?: string | null;
  finished_at?: string | null;
  data_source?: string | null;
  game_mode?: string | null;
  outcome?: string | null;
  map_name?: string | null;
  score?: number[] | null;
  leetify_rating?: number | null;
  rank?: number | null;
};

type Profile = {
  steamid64: string;
  persona_name?: string;
  avatar?: string;
  profile_url?: string;
  vac_banned?: number;
  vac_count?: number;
  days_since_last_ban?: number | null;
  last_ban_date?: string | null;
  game_ban_count?: number;
  game_ban_days_since_last?: number | null;
  community_banned?: number;
  friend_count?: number;
  friend_banned_count?: number;
  friend_ban_percentage?: number | null;
  friends_banned?: Array<{
    steamid64: string;
    persona_name?: string;
    avatar?: string;
    vac_banned?: number;
    game_ban_count?: number;
    community_banned?: number;
  }>;
  faceit_elo?: number;
  faceit_skill_level?: number;
  faceit_url?: string;
  leetify?: {
    profile_url?: string;
    winrate?: number | null;
    total_matches?: number | null;
    ranks?: {
      premier?: number | null;
      faceit?: number | null;
      leetify_rating?: number | null;
    };
    rating?: Record<string, number | null>;
    stats?: Record<string, number | null>;
    recent_matches?: Match[];
  };
};

function ratingBar(label: string, value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) * 100)));
  return (
    <div className="rating-row" key={label}>
      <span>{label}</span>
      <div className="rating-track">
        <div className="rating-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="mono">{pct}</span>
    </div>
  );
}

export default function ProfilePage() {
  const { steamid64 = "" } = useParams();
  const { t } = useI18n();
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [friendSort, setFriendSort] = useState<"name" | "vac" | "game">("name");

  useEffect(() => {
    setP(null);
    fetchJson<Profile>(`/api/profile/${steamid64}`)
      .then(setP)
      .catch((e) => setError(e.message));
  }, [steamid64]);

  const friends = useMemo(() => {
    const list = [...(p?.friends_banned || [])];
    list.sort((a, b) => {
      if (friendSort === "vac")
        return (b.vac_banned ? 1 : 0) - (a.vac_banned ? 1 : 0);
      if (friendSort === "game")
        return (b.game_ban_count || 0) - (a.game_ban_count || 0);
      return String(a.persona_name || "").localeCompare(
        String(b.persona_name || ""),
      );
    });
    return list;
  }, [p, friendSort]);

  if (error) {
    return (
      <div>
        <Link to="/">{t("profile.back")}</Link>
        <p className="error">{error}</p>
      </div>
    );
  }
  if (!p) return <p className="muted">{t("profile.loading")}</p>;

  const faceitIcon = faceitLevelIcon(p.faceit_skill_level);
  const rating = p.leetify?.rating;
  const matches = p.leetify?.recent_matches || [];

  return (
    <div>
      <p>
        <Link to="/">← {t("profile.back")}</Link>
      </p>
      <div className="profile-hero">
        {p.avatar && <img src={p.avatar} alt="" />}
        <div>
          <h2 style={{ margin: 0 }}>{p.persona_name || p.steamid64}</h2>
          <p className="mono muted">{p.steamid64}</p>
          <div className="row">
            {p.profile_url && (
              <a href={p.profile_url} target="_blank" rel="noreferrer">
                Steam
              </a>
            )}
            {p.faceit_url && (
              <a href={p.faceit_url} target="_blank" rel="noreferrer">
                Faceit
              </a>
            )}
            {p.leetify?.profile_url && (
              <a href={p.leetify.profile_url} target="_blank" rel="noreferrer">
                Leetify
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>{t("profile.bans")}</h3>
          <p>
            {p.vac_banned ? (
              <span className="badge vac">VAC ×{p.vac_count || 1}</span>
            ) : (
              <span className="muted">{t("profile.noVac")}</span>
            )}{" "}
            {Number(p.game_ban_count) > 0 && (
              <span className="badge game">Game ×{p.game_ban_count}</span>
            )}{" "}
            {p.community_banned ? (
              <span className="badge community">Community</span>
            ) : null}
          </p>
          {p.vac_banned && p.days_since_last_ban != null && (
            <p className="muted">
              {t("profile.lastBan", { days: p.days_since_last_ban })}
              {p.last_ban_date
                ? ` (${String(p.last_ban_date).slice(0, 10)})`
                : ""}
            </p>
          )}
          <p className="muted">
            {t("profile.friends", {
              total: p.friend_count ?? 0,
              banned: p.friend_banned_count ?? 0,
            })}
            {p.friend_ban_percentage != null
              ? ` (${p.friend_ban_percentage}%)`
              : ""}
          </p>
        </div>

        <div className="card">
          <h3>{t("profile.csStats")}</h3>
          {p.faceit_elo != null ? (
            <div className="row" style={{ marginBottom: "0.5rem" }}>
              {faceitIcon && (
                <img
                  src={faceitIcon}
                  alt={`Faceit ${p.faceit_skill_level}`}
                  width={28}
                  height={28}
                />
              )}
              <span>
                Faceit ELO <strong>{p.faceit_elo}</strong> · lvl{" "}
                {p.faceit_skill_level ?? "?"}
              </span>
            </div>
          ) : (
            <p className="muted">{t("profile.noFaceit")}</p>
          )}
          {p.leetify ? (
            <>
              <p>
                {t("profile.winrate")}{" "}
                <strong>{p.leetify.winrate ?? "—"}%</strong> ·{" "}
                {t("profile.matches")} {p.leetify.total_matches ?? "—"}
                {p.leetify.ranks?.premier != null &&
                  ` · Premier ${p.leetify.ranks.premier}`}
                {p.leetify.ranks?.leetify_rating != null &&
                  ` · Rating ${Number(p.leetify.ranks.leetify_rating).toFixed(2)}`}
              </p>
              {rating && (
                <div className="rating-bars">
                  {ratingBar("Aim", rating.aim)}
                  {ratingBar("Positioning", rating.positioning)}
                  {ratingBar("Utility", rating.utility)}
                  {ratingBar("Clutch", rating.clutch)}
                  {ratingBar("Opening", rating.opening)}
                </div>
              )}
              <p className="muted" style={{ fontSize: "0.8rem" }}>
                {t("profile.leetifyCredit")}
              </p>
            </>
          ) : (
            <p className="muted">{t("profile.noLeetify")}</p>
          )}
        </div>
      </div>

      {matches.length > 0 && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h3>{t("profile.lastMatches")}</h3>
          <table>
            <thead>
              <tr>
                <th>{t("profile.map")}</th>
                <th>{t("profile.result")}</th>
                <th>{t("profile.score")}</th>
                <th>{t("profile.mode")}</th>
                <th>{t("profile.date")}</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m, i) => {
                const logo = mapLogo(m.map_name);
                const score = Array.isArray(m.score)
                  ? m.score.join("–")
                  : "—";
                return (
                  <tr key={String(m.id ?? i)}>
                    <td>
                      <span className="row">
                        {logo && (
                          <img
                            src={logo}
                            alt=""
                            width={22}
                            height={22}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        )}
                        {m.map_name || "—"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          m.outcome === "win"
                            ? "badge community"
                            : m.outcome === "loss"
                              ? "badge vac"
                              : "muted"
                        }
                      >
                        {m.outcome || "—"}
                      </span>
                    </td>
                    <td className="mono">{score}</td>
                    <td className="muted">{m.game_mode || m.data_source || "—"}</td>
                    <td className="muted">
                      {m.finished_at
                        ? String(m.finished_at).slice(0, 10)
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: "1rem" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{t("profile.friendsBanned")}</h3>
          <select
            value={friendSort}
            onChange={(e) =>
              setFriendSort(e.target.value as "name" | "vac" | "game")
            }
          >
            <option value="name">{t("profile.sort.name")}</option>
            <option value="vac">{t("profile.sort.vac")}</option>
            <option value="game">{t("profile.sort.game")}</option>
          </select>
        </div>
        <table>
          <tbody>
            {friends.map((f) => (
              <tr key={f.steamid64}>
                <td>
                  {f.avatar && (
                    <img className="avatar" src={f.avatar} alt="" />
                  )}
                </td>
                <td>
                  <Link to={`/profile/${f.steamid64}`}>
                    {f.persona_name || f.steamid64}
                  </Link>
                </td>
                <td>
                  {f.vac_banned ? <span className="badge vac">VAC</span> : null}
                  {Number(f.game_ban_count) > 0 ? (
                    <span className="badge game">Game</span>
                  ) : null}
                  {f.community_banned ? (
                    <span className="badge community">Community</span>
                  ) : null}
                </td>
              </tr>
            ))}
            {!friends.length && (
              <tr>
                <td className="muted">{t("profile.noneInDb")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { env } from "../env.js";

/** Attach optional Faceit + Leetify data to a profile payload. */
export async function enrichProfile(steamid64: string, payload: Record<string, unknown>) {
  if (env.FACEIT_API_KEY) {
    try {
      const faceitRes = await fetch(
        `https://open.faceit.com/data/v4/players?game=cs2&game_player_id=${encodeURIComponent(steamid64)}`,
        { headers: { Authorization: `Bearer ${env.FACEIT_API_KEY}` } },
      );
      if (faceitRes.ok) {
        const faceit = (await faceitRes.json()) as {
          games?: { cs2?: { faceit_elo?: number; skill_level?: number } };
          faceit_url?: string;
          nickname?: string;
        };
        const cs2 = faceit.games?.cs2;
        if (cs2) {
          payload.faceit_elo = cs2.faceit_elo ?? null;
          payload.faceit_skill_level = cs2.skill_level ?? null;
          let faceitUrl = faceit.faceit_url ?? null;
          if (typeof faceitUrl === "string") {
            faceitUrl = faceitUrl
              .replace(/\/\{lang\}\//g, "/fr/")
              .replace(/%7Blang%7D/gi, "fr");
          } else if (faceit.nickname?.trim()) {
            faceitUrl = `https://www.faceit.com/fr/players/${encodeURIComponent(faceit.nickname.trim())}`;
          }
          payload.faceit_url = faceitUrl;
        }
      }
    } catch {
      /* ignore */
    }
  }

  const leetifyOpts: RequestInit = { headers: {} };
  if (env.LEETIFY_API_KEY) {
    (leetifyOpts.headers as Record<string, string>)._leetify_key =
      env.LEETIFY_API_KEY;
  }
  try {
    const profileRes = await fetch(
      `https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=${encodeURIComponent(steamid64)}`,
      leetifyOpts,
    );
    if (!profileRes.ok) return payload;
    const leetify = (await profileRes.json()) as Record<string, unknown>;
    let recentMatches = Array.isArray(leetify.recent_matches)
      ? (leetify.recent_matches as unknown[]).slice(0, 10)
      : [];
    if (recentMatches.length < 10) {
      try {
        const matchesRes = await fetch(
          `https://api-public.cs-prod.leetify.com/v3/profile/matches?steam64_id=${encodeURIComponent(steamid64)}`,
          leetifyOpts,
        );
        if (matchesRes.ok) {
          const list = await matchesRes.json();
          if (Array.isArray(list) && list.length) recentMatches = list.slice(0, 10);
        }
      } catch {
        /* ignore */
      }
    }
    const ranks = leetify.ranks as Record<string, unknown> | undefined;
    const rating = leetify.rating as Record<string, unknown> | undefined;
    const stats = leetify.stats as Record<string, unknown> | undefined;
    payload.leetify = {
      profile_url: `https://leetify.com/app/profile/${steamid64}`,
      winrate:
        leetify.winrate != null
          ? Math.round(Number(leetify.winrate) * 100)
          : null,
      total_matches: leetify.total_matches ?? null,
      first_match_date: leetify.first_match_date ?? null,
      ranks: ranks
        ? {
            premier: ranks.premier ?? null,
            faceit: ranks.faceit ?? null,
            faceit_elo: ranks.faceit_elo ?? null,
            leetify_rating: ranks.leetify ?? null,
            wingman: ranks.wingman ?? null,
            competitive: ranks.competitive ?? [],
          }
        : null,
      rating: rating
        ? {
            aim: rating.aim ?? null,
            positioning: rating.positioning ?? null,
            utility: rating.utility ?? null,
            clutch: rating.clutch ?? null,
            opening: rating.opening ?? null,
            ct_leetify: rating.ct_leetify ?? null,
            t_leetify: rating.t_leetify ?? null,
          }
        : null,
      stats: stats
        ? {
            reaction_time_ms: stats.reaction_time_ms ?? null,
            accuracy_head: stats.accuracy_head ?? null,
            preaim: stats.preaim ?? null,
            spray_accuracy: stats.spray_accuracy ?? null,
          }
        : null,
      recent_matches: recentMatches.map((raw) => {
        const m = raw as Record<string, unknown>;
        let score = m.score;
        const teamScores = m.team_scores as
          | Array<{ score?: number }>
          | undefined;
        if (
          (!score || !Array.isArray(score)) &&
          Array.isArray(teamScores) &&
          teamScores.length >= 2
        ) {
          score = [teamScores[0].score ?? 0, teamScores[1].score ?? 0];
        }
        return {
          id: m.id ?? null,
          finished_at: m.finished_at ?? null,
          data_source: m.data_source ?? null,
          game_mode: m.game_mode ?? m.mode ?? null,
          outcome: m.outcome ?? null,
          map_name: m.map_name ?? null,
          score: score ?? null,
          leetify_rating: m.leetify_rating ?? null,
          rank: m.rank ?? null,
        };
      }),
    };
  } catch {
    /* ignore */
  }
  return payload;
}

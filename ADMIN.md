# Admin panel

This document describes admin-only features: bot control, VAC verification, export, and healthcheck.

## Vérification VAC

The **VAC verification** job re-checks profiles that are currently stored as *not VAC banned* by scraping their Steam profile pages (no Steam API for the initial detection). It is useful to catch bans that happened after the last scrape.

### Flow

1. **Proxy check** (if Decodo is configured): the job verifies that the proxy is reachable and that the session format used for scraping works. If the proxy returns 407 with the session format, the job runs **without session** (no IP rotation) to avoid 407 errors.
2. **Without proxy**: a warning is logged: *« Pas de proxy : risque de rate limit Steam »*. The job still runs.
3. **Scraping**: for each profile with `vac_banned = 0`, the job fetches the Steam profile HTML and looks for “VAC ban on record” (or similar). Up to ~50 requests per second; optional new proxy session (new IP) every N verifications if the proxy supports it.
4. **Confirmation (optional)**: if a Steam API key is configured, each profile that the scrape marks as VAC banned is **confirmed** via the Steam Web API (`GetPlayerBans`) before updating the database. If the API is unavailable or returns rate limit (429/503), the job pauses and retries once.
5. **Retries**: on profile fetch errors **407** or **429** (rate limit), the job pauses 90 seconds and retries that profile once. On API Steam 429/503, it pauses 60 seconds and retries the API call once.

### Admin UI

- **Limite (0 = illimité)**: maximum number of profiles to verify in this run (0 = no limit).
- **Sans proxy (ex. Decodo en maintenance)**: when checked, the job **skips the proxy** and connects directly to Steam. Use this when Decodo is in maintenance or unstable (timeouts, socket disconnect). Risk: Steam may rate-limit your IP.
- **Lancer la vérification** / **Arrêter**: start or stop the job.
- **Progress bar**: percentage and count (verified / total to verify).
- **Export VAC bannis**: download the list of VAC-banned profiles as **CSV** or **JSON** (admin only, up to 100k rows).

### Logs

- Connection and proxy/session status at start.
- Every 500 verified: `[N] Vérifiés: N, nouveaux VAC: M`.
- On error: `Erreur profil <steamid64>: <reason>` (e.g. `404 Not Found`, `Proxy auth required (407)`, `Rate limit (429)`).
- When confirmation is used: `VAC confirmé (API): <steamid64> (vac_count=N)` or `API Steam rate limit (429) — pause 60s puis retry…`.

---

## Healthcheck

- **GET `/api/health`** (no auth): returns `{ ok: true, db: 'ok', proxy: 'ok' | 'error' | 'not configured' }`. Use it for monitoring or load balancers. If the DB is down, returns 500 and `ok: false`.

---

## Filtres liste bannis

The **VAC banned** API supports optional query parameters for filtering:

- `search`: search in persona_name, steamid, steamid64.
- `min_vac_count`, `max_vac_count`: filter by number of VAC bans.
- `date_from`, `date_to`: filter by `last_ban_date` (YYYY-MM-DD).

Example: `GET /api/vac-banned?limit=50&offset=0&min_vac_count=2&date_from=2024-01-01`.

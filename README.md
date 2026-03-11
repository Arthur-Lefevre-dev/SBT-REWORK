# Steam Ban Tracker

This project is a rework of my [Steam Ban Tracker](https://github.com/Arthur-Lefevre-dev/STEAM-BAN-TRACKER) project, with a better architecture and more features. It is still a work in progress; please report any issues. Use it in accordance with the [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms) and Steam Terms of Service.

Translations are coming soon.

Tool to **track Steam bans** (VAC, Game, Community). Profiles are discovered through the friends network from a starting profile. Web interface with dashboard, charts, and enriched profile pages (Faceit, Leetify).

## Prerequisites

- **Node.js 18+**
- **Steam API key**: [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)

## Installation

```bash
npm install
```

Create a `.env` file in the project root (see `.env.example`):

```env
# Required for scraping
STEAM_API_KEY=your_api_key

# Database: sqlite (default) or supabase
DATABASE=sqlite

# Optional: Faceit ELO on profile pages
FACEIT_API_KEY=your_faceit_key

# Optional: Leetify (CS stats, Premier, winrate)
LEETIFY_API_KEY=your_leetify_key

# Optional: Decodo proxy for scraping (Steam Community HTML; Steam Web API stays direct)
# gate.decodo.com:7000 — set both to enable
# DECODO_PROXY_USER=your_decodo_username
# DECODO_PROXY_PASSWORD=your_decodo_password

# Admin panel (optional)
# ADMIN_STEAM_IDS=76561198011775992,76561197982036918
# SESSION_SECRET=change-this-in-production-random-string
# BASE_URL=https://your-domain.com
# ENCRYPTION_KEY=optional-32-char-secret-for-encrypting-steam-api-key-in-db
# Cloudflare Turnstile (captcha on admin login)
# TURNSTILE_SITE_KEY=your_site_key
# TURNSTILE_SECRET_KEY=your_secret_key

# Supabase (only when DATABASE=supabase)
# Run supabase/schema.sql in the SQL Editor first.
# SUPABASE_URL=http://127.0.0.1:54321
# SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx
```

## Usage

### Scraping

```bash
# Run scraper (checks DB connection on startup)
npm start
# Or: node index.js [steamId64] [depth] [max profiles]

# Example: depth 2, max 100 profiles
node index.js 76561198011775992 2 100

# No limit: unlimited depth and count
node index.js 76561198011775992 0 0
```

- **Friends** are used to discover new profiles; only scraped profiles are stored in the database.
- **Database saves** run in the background (every 800 profiles) so the crawl is not blocked.
- On Steam **rate limit** (429/503), automatic retry with backoff, then a 90s pause if needed.
- **Decodo proxy** (optional): set `DECODO_PROXY_USER` and `DECODO_PROXY_PASSWORD` in `.env` to route **Steam Community** (profile HTML) traffic via [Decodo](https://decodo.com) (gate.decodo.com:7000). Steam Web API calls stay direct. Connection is verified at startup; IP changes and proxy location (geo) are logged during scraping.
- **Memory**: `npm start` / `npm run scrape` use an 8 GB Node heap by default. For 50k+ profiles, use `node --max-old-space-size=16384 index.js` or `NODE_OPTIONS=--max-old-space-size=16384` if you hit heap limits.

### Web interface

```bash
npm run server
```

Opens **http://localhost:3000** (or **http://localhost:5173** when using Vite dev):

- **Dashboard**: global stats, paginated lists (VAC, Game, Community, all banned), profile search, ban trend charts (by scrape date or by ban date).
- **Profile page** (`/profile/:steamid64`): display name, avatar, friends (count, % banned), bans (VAC, Game, Community), **Faceit ELO** (if `FACEIT_API_KEY` is set), **Leetify stats** (if `LEETIFY_API_KEY` is set) — winrate, matches, Premier rank, rating bars, **banned friends list** (sort by date / ban type), “Data provided by Leetify” attribution.

On startup, the server prints `DB: sqlite — Connexion OK` or `DB: supabase — Connexion OK`; on failure, it suggests what to check (`.env`, Supabase key, schema).

#### Admin panel (optional)

- **URL**: **http://localhost:3000/admin** when `ADMIN_STEAM_IDS` is set in `.env`.
- **Auth**: Steam OpenID. Only SteamID64 listed in `ADMIN_STEAM_IDS` (comma-separated) can access. Set `SESSION_SECRET` in production. Set `BASE_URL` in production for Steam redirect.
- **Captcha**: optional [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) on the login page; set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Without them, login is a direct Steam link.
- **Access denied**: users who sign in with Steam but are not in `ADMIN_STEAM_IDS` see a dedicated “Access denied” page with a link back to the home page.
- **Settings**: Steam API key (stored **encrypted** in DB when set via the panel), default starting profile, max depth, max profiles. Optional `ENCRYPTION_KEY` in `.env` for the API key cipher (defaults to `SESSION_SECRET`).
- **Bot control**: start / pause / resume / stop the scraper from the UI.
- **VAC verification**: re-check profiles without VAC ban by scraping Steam profile pages (optional confirmation via Steam API). Limit, progress bar, export VAC banned (CSV/JSON). See **ADMIN.md** for details.
- **Live stats**: WebSocket pushes state in real time — status, profiles scraped, depth, batches, errors, rate-limit pauses.
- **Bot console**: live log of scraper activity (batches, DB saves, rate limits, errors) and **proxy changes** with IP and geo location when using Decodo proxy.
- **Activity chart**: line chart of profiles scraped and rate-limit pauses over time during a run.
- **Healthcheck**: `GET /api/health` returns `{ ok, db, proxy }` for monitoring (no auth).

#### Frontend with Vite (optional)

- **Dev** (hot reload): `npm run dev` — starts the Express API (port 3000) and Vite (port 5173). Open **http://localhost:5173**; Vite proxies `/api` and `/profile` to the API.  
  Note: Vite dev server may have quirks; for full testing use the Express server.
- **Build**: `npm run build` — outputs to `dist/` and copies `public/img` to `dist/img`. The Express server serves `dist/` when present.
- **Preview**: `npm run preview` — serves only static `dist/` on port 5173 (no API, no `.env`). To test the full app with API and `.env`, run `npm run server` after a build and open **http://localhost:3000**.

### Other commands

```bash
npm run scrape              # Same as npm start
npm run server              # Web server (public/ or dist/, uses .env)
npm run dev                 # Vite dev + API
npm run build               # Vite build → dist/ + copy img
npm run preview             # Static only (no API)
npm run migrate:sqlite-to-supabase   # Migrate SQLite data to Supabase
```

## Project structure

```
├── index.js                 # Scrape entry point (npm start)
├── server.js                # Web server (npm run server)
├── lib/
│   └── supabase.js          # Supabase client (when DATABASE=supabase)
├── src/
│   ├── admin/               # Admin panel
│   │   ├── auth.js          # Steam OpenID, session, requireAdmin
│   │   ├── bot-runner.js    # Start/pause/stop scraper, logs, broadcast
│   │   └── ws-tokens.js     # Short-lived tokens for /admin/ws
│   ├── db/
│   │   ├── index.js         # Facade (SQLite/Supabase, secret settings)
│   │   ├── secret-settings.js  # Encrypt/decrypt steam_api_key at rest
│   │   ├── sqlite.js
│   │   └── supabase.js
│   ├── steam/
│   │   ├── api.js           # Steam Web API + rate limit retry
│   │   └── profile-scrape.js   # Game ban days from profile page
│   ├── proxy.js             # Decodo proxy, IP check, geo for logs
│   ├── steam-scraper.js     # Crawl (batches, saves, onLog, controller)
│   ├── friendship-graph.js
│   └── stats.js             # Graph stats
├── scripts/
│   ├── migrate-sqlite-to-supabase.js
│   └── copy-img-to-dist.cjs
├── supabase/
│   └── schema.sql           # Run in Supabase SQL Editor (tables + RLS)
├── public/                  # Frontend (dashboard, profile, admin)
├── dist/                    # Vite build output (after npm run build)
└── vite.config.js          # Vite (root: public, proxy to API)
```

## Data collected

- **Profile**: SteamID64, SteamID (legacy), display name, avatar, profile URL, friends URL, scrape date.
- **Bans**: VAC (count), Game (count, days since last ban, estimated date), Community.
- **Network**: `friendships` table (profile pairs) to count friends and list banned friends.

## Database

- **SQLite** (default): `steam-data.db` at project root, tables `profiles`, `friendships`, and `settings`. Created automatically on first run.
- **Supabase**: set `DATABASE=supabase`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. Run `supabase/schema.sql` in the SQL Editor. With RLS, use the **Secret** key (or service_role JWT), not the anon key.

Migration: after creating tables via `schema.sql`, run `npm run migrate:sqlite-to-supabase`.

**Sensitive settings**: the Steam API key stored via the admin panel is **encrypted at rest** (AES-256-GCM) in the `settings` table. Use `ENCRYPTION_KEY` in production (or it falls back to `SESSION_SECRET`). Existing plaintext keys in DB remain readable until re-saved; then they are stored encrypted.

## Rate limits and robustness

- **Steam Web API**: on 429/503/403, automatic retry (3 times) with backoff 15s → 45s → 90s.
- **Steam Community** (HTML for game bans): one retry after 20s on rate limit.
- **Scraper**: if a batch still fails after retries, 90s pause then the batch is re-queued.
- **DB saves** in the background are chained; one failed save does not stop the next (error logged).

## Notes

- Comply with the [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms). Delays are applied between requests.
- **Private profiles** do not expose their friend list.
- **Faceit**: [developers.faceit.com](https://developers.faceit.com/).
- **Leetify**: [leetify.com/app/developer](https://leetify.com/app/developer) — “Data provided by Leetify” is shown on profile pages when Leetify data is used.

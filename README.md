# Steam Ban Tracker

This project is a rework of my [Steam Ban Tracker](https://github.com/Arthur-Lefevre-dev/STEAM-BAN-TRACKER) project, but with a better architecture and more features.
This project is still a work in progress, but it is already usable, please report any issues you find. And use it by respecting the [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms) and Steam Terms of Service.

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

# Optional: Decodo proxy for scraping (Steam Community HTML only; Steam Web API stays direct to avoid 403)
# gate.decodo.com:7000 — set both to enable
# DECODO_PROXY_USER=your_decodo_username
# DECODO_PROXY_PASSWORD=your_decodo_password

# Supabase (only when DATABASE=supabase)
# Run supabase/schema.sql in the SQL Editor first.
# Use Secret key (new format) or service_role JWT. With RLS, use the backend key.
# SUPABASE_URL=http://127.0.0.1:54321
# SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx
```

## Usage

### Scraping

```bash
# Run scraper (checks DB connection on startup)
npm start
# Or with args: node index.js [steamId64] [depth] [max profiles]

# Example: depth 2, max 100 profiles
node index.js 76561198011775992 2 100

# No limit: unlimited depth and count
node index.js 76561198011775992 0 0
```

- **Friends** are used to discover new profiles; only scraped profiles are stored in the database.
- **Database saves** run in the background (every 800 profiles) so the crawl is not blocked.
- On Steam **rate limit** (429/503), automatic retry with backoff, then a 90s pause if needed.
- **Decodo proxy** (optional): set `DECODO_PROXY_USER` and `DECODO_PROXY_PASSWORD` in `.env` to route **Steam Community** (profile HTML) traffic via [Decodo](https://decodo.com) (gate.decodo.com:7000). Steam Web API calls stay direct (Steam often returns 403 for proxy IPs). Connection is verified at startup; IP changes are logged during scraping.

### Web interface

```bash
npm run server
```

Opens **http://localhost:3000** (or **http://localhost:5173** if using Vite dev):

- **Dashboard**: global stats, paginated lists (VAC, Game, Community, all banned), profile search, ban trend charts (by scrape date or by ban date).
- **Profile page** (`/profile/:steamid64`): display name, avatar, friends (count, % banned), bans (VAC, Game, Community), **Faceit ELO** (if `FACEIT_API_KEY` is set), **Leetify stats** (if `LEETIFY_API_KEY` is set) — winrate, matches, Premier rank, rating bars, **banned friends list** (sort by date / ban type), “Data provided by Leetify” attribution.

On startup, the server prints `DB: sqlite — Connexion OK` or `DB: supabase — Connexion OK`; on failure, it suggests what to check (`.env`, Supabase key, schema).

#### Frontend with Vite (optional)

- **Dev** (hot reload): run `npm run dev` or `npm run Server` — starts **both** the Express API (port 3000) and Vite (port 5173). Open **http://localhost:5173**; Vite proxies `/api` and `/profile` to the API.
  WIP: Vite dev server is not working properly, so we need to use the Express server to test the frontend.
- **Build**: `npm run build` — outputs to `dist/` and runs `scripts/copy-img-to-dist.cjs` to copy **all** of `public/img` to `dist/img` (so every image is available under `/img/`). The Express server automatically serves `dist/` when present.
- **Preview**: `npm run preview` — serves only the static `dist/` at port 5173. **No API and no `.env`** (Vite preview does not run Node/Express). To test the full app with API and `.env`, run `npm run server` after a build and open **http://localhost:3000** (serves `dist/` and uses `.env`).

### Other commands

```bash
npm run Scrape [steamId64] [depth] [max profiles] # Scrape profiles from a starting profile
npm run Server                                    # Start web server (serves public/ or dist/ if present; uses .env)
npm run Dev                                       # Vite dev server (port 5173, proxy to API)
npm run Build                                     # Vite build → dist/ + copy public/img → dist/img
npm run Preview                                   # Static only: serve dist/ with Vite (no API, no .env)
npm run Migrate:sqlite-to-supabase                # Migrate SQLite data to Supabase
```

## Project structure

```
├── index.js              # Scrape entry point (npm start)
├── server.js             # Web server (npm run server)
├── lib/
│   └── supabase.js      # Supabase client (when DATABASE=supabase)
├── src/
│   ├── db/              # Database layer
│   │   ├── index.js     # Facade (SQLite/Supabase via .env)
│   │   ├── sqlite.js
│   │   └── supabase.js
│   ├── steam/           # Steam API and HTML scraping
│   │   ├── api.js       # Steam Web API (summaries, bans, friends, vanity) + rate limit retry
│   │   └── profile-scrape.js   # Game ban days from profile page
│   ├── proxy.js         # Optional Decodo proxy config (env: DECODO_PROXY_*)
│   ├── steam-scraper.js # Crawl orchestration (batches, background saves)
│   ├── friendship-graph.js
│   └── stats.js         # Graph stats (computeStats, printStats)
├── scripts/
│   ├── migrate-sqlite-to-supabase.js
│   └── stats-from-file.js
├── supabase/
│   └── schema.sql       # Run in Supabase SQL Editor (tables + RLS)
├── public/              # Frontend source (dashboard, profile page, assets)
├── dist/                # Vite build output (after npm run build)
└── vite.config.js       # Vite config (root: public, proxy to API)
```

## Data collected

- **Profile**: SteamID64, SteamID (legacy), display name, avatar, profile URL, friends URL, scrape date.
- **Bans**: VAC (count), Game (count, days since last ban, estimated date), Community.
- **Network**: `friendships` table (profile pairs) to count friends and list banned friends.

## Database

- **SQLite** (default): `steam-data.db` at project root, tables `profiles` and `friendships`. Created automatically on first run.
- **Supabase**: set `DATABASE=supabase`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. Run `supabase/schema.sql` in the project’s SQL Editor. With RLS enabled, use the **Secret** key (or service_role JWT), not the anon/publishable key.

Migration SQLite → Supabase: after creating tables via `schema.sql`, run `npm run migrate:sqlite-to-supabase`.

## Rate limits and robustness

- **Steam Web API**: on 429/503/403, automatic retry (3 times) with backoff 15s → 45s → 90s. Log: `[Steam API] Rate limit (429), retry in Xs`.
- **Steam Community** (HTML pages for game bans): one retry after 20s on rate limit.
- **Scraper**: if a batch still fails after retries (rate limit), 90s pause then the batch’s profiles are re-queued and retried.
- **DB saves** in the background are chained; one failed save does not stop the next (error logged).

## Notes

- Comply with the [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms). Delays are applied between requests.
- **Private profiles** do not expose their friend list.
- **Faceit**: [developers.faceit.com](https://developers.faceit.com/).
- **Leetify**: [leetify.com/app/developer](https://leetify.com/app/developer) — “Data provided by Leetify” attribution is shown on profile pages when Leetify data is used.

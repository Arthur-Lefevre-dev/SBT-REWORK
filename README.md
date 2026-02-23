# Steam Ban Tracker

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

### Web interface

```bash
npm run server
```

Opens **http://localhost:3000**:

- **Dashboard**: global stats, paginated lists (VAC, Game, Community, all banned), profile search, ban trend charts (by scrape date or by ban date).
- **Profile page** (`/profile/:steamid64`): display name, avatar, friends (count, % banned), bans (VAC, Game, Community), **Faceit ELO** (if `FACEIT_API_KEY` is set), **Leetify stats** (if `LEETIFY_API_KEY` is set) — winrate, matches, Premier rank, rating bars, **banned friends list** (sort by date / ban type), “Data provided by Leetify” attribution.

On startup, the server prints `DB: sqlite — Connexion OK` or `DB: supabase — Connexion OK`; on failure, it suggests what to check (`.env`, Supabase key, schema).

### Other commands

```bash
npm run server                      # Start web server
npm run stats -- <path.json>        # Print stats from an exported graph JSON
npm run stats:file -- <path.json>
npm run migrate:sqlite-to-supabase  # Migrate SQLite data to Supabase
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
│   ├── steam-scraper.js # Crawl orchestration (batches, background saves)
│   ├── friendship-graph.js
│   └── stats.js         # Graph stats (computeStats, printStats)
├── scripts/
│   ├── migrate-sqlite-to-supabase.js
│   └── stats-from-file.js
├── supabase/
│   └── schema.sql       # Run in Supabase SQL Editor (tables + RLS)
└── public/              # Frontend (dashboard, profile page, assets)
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

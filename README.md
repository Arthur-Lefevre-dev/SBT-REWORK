# Steam Ban Tracker

JavaScript tool to **track Steam bans** (VAC, Game, Community). Profiles are discovered through the friends network from a starting profile. Web interface with dashboard, charts, and enriched profile pages (Faceit, Leetify).

## Prerequisites

- **Node.js 18+**
- **Steam API key**: [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)

## Installation

```bash
npm install
```

Create a `.env` file in the project root:

```env
# Required
STEAM_API_KEY=your_api_key

# Optional: Faceit ELO on profile pages
FACEIT_API_KEY=your_faceit_key

# Optional: CS stats (Leetify) on profile pages (winrate, Premier, rating)
LEETIFY_API_KEY=your_leetify_key
```

## Usage

### Scraping

```bash
# Scrape from a SteamID64 (default: depth 2, max 100 profiles)
node index.js 76561198011775992

# Max depth 3, max 200 profiles
node index.js 76561198011775992 3 200

# No limit: unlimited depth and count
node index.js 76561198011775992 0 0
```

Friends are used to **discover new profiles**; only scraped profiles are checked for bans and stored in the database.

### Web interface

```bash
npm run server
```

Opens **http://localhost:3000**:

- **Dashboard**: global stats, paginated lists (VAC, Game, Community, all banned), profile search, ban trend charts (by scrape date or by ban date).
- **Profile page** (`/profile/:steamid64`): display name, avatar, friends (count, % banned), bans (VAC, Game, Community), **Faceit ELO** (if `FACEIT_API_KEY` is set), **Leetify stats** (if `LEETIFY_API_KEY` is set) — winrate, matches, Premier rank with color tiers, rating bars (Aim, Position, Utility, Clutch, Opening) with color scale, **banned friends list** (paginated), and “Data provided by Leetify” attribution when Leetify data is shown.

### Other commands

```bash
npm run server                    # Start web server (dashboard + profiles)
npm run stats -- <path-to.json>   # Print stats from a saved graph JSON file
npm run stats:file -- <path-to.json>
npm run migrate:sqlite-to-supabase # Migrate SQLite data to Supabase (when DATABASE=supabase)
```

## Project structure

```
├── index.js           # Scrape entry point (npm start / npm run scrape)
├── server.js          # Web server entry point (npm run server)
├── lib/
│   └── supabase.js    # Supabase client (when DATABASE=supabase)
├── src/
│   ├── db/            # Database layer (SQLite + Supabase facade)
│   │   ├── index.js   # Facade (chooses backend via .env DATABASE)
│   │   ├── sqlite.js
│   │   └── supabase.js
│   ├── steam/         # Steam API & profile scraping
│   │   ├── api.js     # Steam Web API (summaries, bans, friends, vanity)
│   │   └── profile-scrape.js  # Game ban days from profile HTML
│   ├── steam-scraper.js   # Orchestration (batched crawl)
│   ├── friendship-graph.js
│   └── stats.js       # Stats from graph (computeStats, printStats)
├── scripts/
│   ├── migrate-sqlite-to-supabase.js
│   └── stats-from-file.js  # Print stats from saved JSON graph
├── supabase/
│   └── schema.sql     # Run in Supabase SQL Editor for new project
└── public/            # Frontend (dashboard, profile page, assets)
```

## Data collected

- **Profile**: SteamID64, SteamID (legacy), display name, avatar, profile URL, friends page URL, scrape date.
- **Bans**: VAC (count), Game (count, days since last ban, estimated date), Community.
- **Network**: friendships table (pairs of scraped profiles) to count friends and list banned friends.

## Database

**`steam-data.db`** (SQLite): tables `profiles`, `friendships`. The web interface reads this database for the dashboard and profile pages.

## Notes

- The Steam API has **rate limits**; a delay is applied between requests.
- **Private profiles** do not expose their friend list.
- Please comply with the [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms).
- **Faceit** data: [developers.faceit.com](https://developers.faceit.com/).
- **Leetify** data: [leetify.com/app/developer](https://leetify.com/app/developer) — displaying Leetify data must include the “Data provided by Leetify” attribution (shown on profile pages).

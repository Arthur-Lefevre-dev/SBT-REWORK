# Steam Ban Tracker

Track Steam **VAC / Game / Community** bans. Profiles are discovered through the friends network from a starting profile. Dashboard + admin panel to run the scraper.

**Stack (v2):** TypeScript · Express · Drizzle ORM · SQLite · React · Vite · native `fetch`

Use in accordance with the [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms).

## Prerequisites

- **Node.js 22.14+** (24 ok with `better-sqlite3` ≥ 13)
- Steam API key: https://steamcommunity.com/dev/apikey

## Setup

```bash
npm install
cp .env.example .env   # then edit STEAM_API_KEY
```

## Commands

```bash
npm run scrape -- [steamId64] [depth] [maxProfiles]   # CLI scraper
npm run dev                                          # UI http://localhost:3000 (API :3001)
npm run build && npm start                           # production on http://localhost:3000
npm run typecheck
npm run db:studio                                    # Drizzle Studio
```



Examples:

```bash
npm run scrape -- 76561198011775992 2 100
npm run scrape -- 76561198011775992 0 0   # unlimited
```

## Architecture

```
src/
  db/                 Drizzle schema + queries (SQLite)
  scraper/            Steam API, HTML scrape, proxy, crawl
  shared/             types + async helpers
  server/
    index.ts          HTTP + WebSocket bootstrap
    app.ts            Express app factory
    routes/           public + admin route modules
    bot-runner.ts     scraper control from admin
web/                  React SPA (dashboard, profile, admin)
  lib/                small UI helpers (map logos, Faceit icons)
```


- **SQLite** by default (`steam-data.db`). One query layer — no dual SQLite/Supabase code paths.
- **Sessions:** signed cookies (`cookie-session`). `SESSION_SECRET` required in production.
- **Admin:** Steam OpenID + `ADMIN_STEAM_IDS` allowlist. API key stored encrypted; API never returns the raw key.
- **Health:** `GET /api/health` runs `SELECT 1` only.

## Optional

| Env | Purpose |
|-----|---------|
| `FACEIT_API_KEY` | Faceit ELO on profile |
| `LEETIFY_API_KEY` | Leetify stats on profile |
| `DECODO_PROXY_*` | Proxy for Steam Community HTML |
| `TURNSTILE_*` | Captcha on admin login |

## License

MIT

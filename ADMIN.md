# Admin panel

Set in `.env`:

```env
ADMIN_STEAM_IDS=your_steamid64
SESSION_SECRET=at-least-16-chars-random
BASE_URL=http://localhost:3000
```

1. Open `/admin` → Steam login.
2. Only IDs in `ADMIN_STEAM_IDS` get access.
3. Configure start profile / depth / API key (encrypted at rest).
4. Start / pause / stop the scraper; live logs via WebSocket.
5. VAC verify re-checks profiles without VAC via profile HTML (optional API confirm).

Production: `SESSION_SECRET` is **required**. Prefer HTTPS + `BASE_URL`.

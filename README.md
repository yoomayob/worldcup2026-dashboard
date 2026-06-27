# 26 — World Cup 2026 Dashboard

A bright, stadium-floodlight themed dashboard for the 2026 FIFA World Cup: match centre, group standings, and a tap-to-predict knockout bracket.

## What it does

- **Matches** — all 104 fixtures, filterable by status (live/upcoming/finished), group, or team search.
- **Standings** — all 12 groups (A–L), auto-sorted by points → goal difference → goals for.
- **Knockout** — a Round-of-32-to-Final bracket. Group winners/runners-up and the best third-place teams are auto-resolved from the standings; you tap a team in any tie to send them through, and your pick cascades into the next round. Saved in your browser (localStorage), no account needed.

## Data source

It tries the live [worldcup2026 API](https://github.com/rezarahiminia/worldcup2026) (`https://worldcup26.ir/get/...`) directly from your browser on load. If that's unreachable, slow, or requires auth that isn't open right now, it silently falls back to a bundled offline snapshot (`data.js`) pulled from the repo's seed data, so the site never breaks — it just shows a small "offline snapshot" badge top-right instead of "live feed".

Worth knowing: that API's own docs say most `/get/*` routes need a JWT login, while their README demo claims those same routes work with no auth — I couldn't reach the server directly to confirm which is true right now (it blocks automated tools via robots.txt). The dashboard handles either outcome gracefully, but if scores look stale, that's why.

## Deploying to Vercel

I don't have your GitHub or Vercel credentials in this session, so here's the fastest path (2 minutes):

1. Download these 4 files: `index.html`, `styles.css`, `app.js`, `data.js`.
2. Create a new GitHub repo (e.g. `worldcup2026-dashboard`) and push them — or just drag the folder into [vercel.com/new](https://vercel.com/new) directly, no GitHub needed.
3. Vercel auto-detects it as a static site (no build step, no framework) — click **Deploy**.

If you'd rather I push it for you, paste a GitHub personal access token (repo scope) and I'll create the repo and push the files — then it's one click on Vercel's "Import" screen to link it.

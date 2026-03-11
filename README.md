# Teams United League Service

## What This Does

Youth sports in the US is fragmented across dozens of scoring platforms. A parent looking up their kid's Little League standings might go to GameChanger, while a travel soccer parent checks GotSport, and a rec league uses SportsAffinity. There's no single place to see all of it.

This service solves that. It connects to **8 different scoring platforms**, pulls league standings on a daily schedule, normalizes everything into a common format, and stores it in Firestore. The Teams United app then reads from that single data source to show parents standings across any league, any platform, any sport.

**In plain terms:** we scrape, parse, and normalize youth sports standings from across the internet so families don't have to bounce between 8 different websites.

## How It Works

The service runs on **Google Cloud Functions** and follows a simple pipeline:

1. **Cloud Scheduler** triggers `collectAll` once per day
2. `collectAll` loops through every active league in Firestore
3. For each league, it loads the right **platform adapter** (GameChanger, SportsConnect, etc.)
4. The adapter fetches standings — via JSON API, HTML scraping, or Puppeteer browser automation depending on the platform
5. Results are normalized into a common schema and written to Firestore (`divisions` + `standings` collections)
6. After all leagues are collected, standings are synced to a Google Sheets dashboard for ops visibility
7. A weekly **season monitor** detects stale leagues, auto-discovers new seasons, and flags issues

Individual leagues can also be collected on-demand via `collectLeague` (useful for testing and debugging).

The Teams United app reads from Firestore via three read-only API functions: `getLeagues`, `getDivisions`, `getStandings`.

## The 8 Platform Adapters

Each adapter knows how to talk to one scoring platform. The platforms vary wildly in how they expose data:

| Adapter | How It Works | Used By |
|---|---|---|
| **GameChanger** | Puppeteer browser automation against `web.gc.com` | Youth baseball/softball — the #1 scoring app in the US |
| **SportsConnect** | Puppeteer against ASP.NET WebForms postback dropdowns | Little League International, PONY Baseball (15,000+ programs) |
| **SportsAffinity** | Direct JSON API calls | Regional soccer leagues (RCL, SYSA, etc.) |
| **GotSport** | HTML scraping with Cheerio | Travel soccer (ECNL qualifiers, state leagues) |
| **TGS/ECNL** | Browser automation + AthleteOne API | Elite soccer (ECNL, Girls Academy) |
| **Demosphere** | HTML scraping | Rec soccer leagues |
| **Pointstreak** | HTML scraping | Baseball and hockey leagues |
| **LeagueApps** | HTML scraping | Multi-sport (baseball, soccer, basketball, lacrosse) |

The two Puppeteer-based adapters (GameChanger, SportsConnect) require **1024MB** of Cloud Function memory. The rest run fine at 256MB.

## Architecture

```
Cloud Scheduler (daily)
  └─→ collectAll ─→ for each active league:
                       └─→ registry.getAdapter(platform)
                            └─→ adapter.collectStandings(leagueConfig)
                                 └─→ { divisions[], standings[] }
                                      └─→ write to Firestore
                     └─→ updateSheet (sync to Google Sheets)

Cloud Scheduler (weekly)
  └─→ seasonMonitor ─→ check active leagues for staleness
                    ─→ check dormant leagues for new seasons
                    ─→ check pending leagues for readiness
                    ─→ store health report

Teams United App
  └─→ getLeagues(?sport=&state=&status=)
  └─→ getDivisions(?league=)
  └─→ getStandings(?division=)
```

## Project Structure

```
index.js              — Cloud Function entry points (collectLeague, collectAll, API endpoints)
registry.js           — Adapter registry (maps platform names to adapter modules)
browser.js            — Shared Puppeteer launcher with retry logic and frame-detached resilience
season-monitor.js     — Weekly health checks, auto-season discovery, stale/dormant management
sheets-sync.js        — Firestore → Google Sheets sync (ops dashboard)
discover-gc.js        — GameChanger league discovery via DuckDuckGo search + GC public API
discover-groups.js    — GotSport division group auto-discovery
adapters/
  gamechanger.js      — GameChanger browser adapter
  sportsconnect.js    — SportsConnect/Blue Sombrero browser adapter
  sportsaffinity.js   — SportsAffinity JSON API adapter
  gotsport.js         — GotSport HTML scraping adapter
  tgs.js              — TGS/ECNL browser + API adapter
  demosphere.js       — Demosphere HTML scraping adapter
  pointstreak.js      — Pointstreak HTML scraping adapter
  leagueapps.js       — LeagueApps HTML scraping adapter
dashboard/            — Firebase-hosted ops dashboard
scripts/              — Operational scripts (deploy, discovery, maintenance)
```

## Firestore Data Model

**leagues** — one doc per league program (e.g., "Sammamish Valley Little League", "RCL Washington")
- `sourcePlatform` + `sourceConfig` tell the adapter how to fetch data
- `status` controls whether it's collected daily: `active`, `dormant`, `pending_*`, `deactivated_phase1`
- Season monitor fields track health: `lastDataChange`, `monitorStatus`, `lastStandingsHash`

**divisions** — one doc per age/gender group within a league (e.g., "Majors Baseball Ages 10-12")
- Keyed by `{leagueId}-{slugified-name}`
- Links back to `leagueId`

**standings** — one doc per team's current record in a division
- Keyed by `{divisionId}-{slugified-teamName}`
- Normalized fields: `wins`, `losses`, `ties`, `points`, `scored`, `allowed`, `differential`, etc.

## Current Rollout (March 2026)

**Phase 1 states:** WA, OR, ID, MT, CA

| Metric | Count |
|---|---|
| Total leagues in Firestore | ~257 |
| Active leagues (collected daily) | ~114 |
| Divisions | 1,580 |
| Team standings | 16,279 |
| Sports covered | Baseball, Soccer, Hockey, Basketball, Lacrosse |

WA and CA have the most coverage. OR, ID, and MT are in active discovery.

## Deployment

- **GCP Project:** `teams-united` (us-central1)
- **Runtime:** Node.js 20, Cloud Functions Gen2
- **Deploy VM:** `35.209.45.82:8080` with `/exec` endpoint for remote `gcloud` and `node` commands
- **Dashboard:** Firebase Hosting

Operational scripts in `scripts/` handle deploys, league discovery, and maintenance tasks. See `CLAUDE.md` for the full operational runbook.

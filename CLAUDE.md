# Teams United League Service — CLAUDE.md

## Overview

Multi-platform youth sports standings collection service for [Teams United](https://teams-united.com).
Collects league standings from 8 different scoring platforms, stores them in Firestore, and serves
them via Cloud Functions API + Google Sheets dashboard.

**GCP Project:** `teams-united` (us-central1)
**Deploy VM:** `35.209.45.82:8080` — has `/exec` endpoint for running `gcloud` and `node` scripts remotely
**Firestore:** 3 main collections: `leagues`, `divisions`, `standings`
**Dashboard Sheet:** `1CfFj3dXz3Vc9FBhBe8OiGLWmQE6LH81MLa133TbdUco`

## Architecture

```
Cloud Scheduler (daily) → collectAll → iterates active leagues → adapter.collectStandings()
                                                                      ↓
User/API → collectLeague(leagueId) ─────────────────────────→ adapter.collectStandings()
                                                                      ↓
                                                              Firestore (divisions, standings)
                                                                      ↓
                                                              updateSheet → Google Sheets
                                                                      ↓
Cloud Scheduler (weekly) → seasonMonitor → health checks, season discovery, auto-dormant
```

### Cloud Functions (Gen2, Node 20)

| Function | Trigger | Purpose | Memory |
|---|---|---|---|
| `collectLeague` | HTTP POST `{leagueId}` | Collect one league | 1024MB* |
| `collectAll` | Cloud Scheduler (daily) | Collect all active leagues | 1024MB* |
| `getLeagues` | HTTP GET | List leagues with filters | 256MB |
| `getDivisions` | HTTP GET `?league=` | List divisions for a league | 256MB |
| `getStandings` | HTTP GET `?division=` | Get standings for a division | 256MB |
| `seasonMonitor` | Cloud Scheduler (weekly) | Detect stale/dormant leagues, discover new seasons | 256MB |
| `updateSheet` | POST (after collectAll) | Sync Firestore → Google Sheets | 256MB |
| `discoverGC` | HTTP POST | Discover GameChanger leagues via DuckDuckGo + API | 256MB |
| `discoverGroups` | HTTP POST | Discover GotSport division groups | 256MB |

\* collectLeague/collectAll need 1024MB for Puppeteer-based adapters (SC, GC). Deploy script: `scripts/deploy-memory-upgrade.sh`

### 8 Platform Adapters (`adapters/`)

| Adapter | Method | Sports | Config Keys |
|---|---|---|---|
| **gamechanger** | Browser (Puppeteer) | Baseball, Softball | `orgId`, `allOrgIds` |
| **sportsconnect** | Browser (Puppeteer) | Baseball (Little League, PONY) | `baseUrl`, `standingsTabId`, `programs[]` |
| **sportsaffinity** | JSON API | Soccer | `organizationId`, `seasonGuid` |
| **gotsport** | HTML scraping | Soccer | `leagueEventId`, `groups[]` |
| **tgs** | Browser/API | Soccer (ECNL, GA) | `eventId` |
| **demosphere** | HTML scraping | Soccer | `baseUrl`, `divisions[]` |
| **pointstreak** | HTML scraping | Baseball, Hockey | `leagueId`, `seasonId` |
| **leagueapps** | HTML scraping | Baseball, Soccer, Basketball, Lacrosse | `baseUrl`, `programs[]` |

### Key Files

- `index.js` — Cloud Function entry point (collectLeague, collectAll, getLeagues, getDivisions, getStandings)
- `registry.js` — Adapter registry
- `browser.js` — Shared Puppeteer launcher (v2 with frame-detached resilience)
- `season-monitor.js` — Weekly health checks + auto season discovery (1034 lines)
- `sheets-sync.js` — Google Sheets sync
- `discover-gc.js` — GameChanger org discovery via DuckDuckGo search
- `discover-groups.js` — GotSport group auto-discovery
- `dashboard/` — Firebase-hosted ops dashboard

### Firestore Schema

**leagues** collection:
```
{
  name, sport, state, region,
  sourcePlatform, sourceConfig: { ... platform-specific ... },
  status: 'active' | 'dormant' | 'pending_config' | 'pending_tabid' | 'pending_groups' | 'deactivated_phase1' | 'template',
  autoUpdate, lastCollected, lastDataChange, lastStandingsHash,
  monitorStatus: 'healthy' | 'stale' | 'dormant' | 'error' | 'needs_attention',
  monitorNotes, lastMonitorCheck,
  seasonStart, seasonEnd, staleDays, discoveryConfig
}
```

**divisions** collection:
```
{ id, leagueId, seasonId, name, ageGroup, gender, level, platformDivisionId, status }
```

**standings** collection (keyed by `{divisionId}-{slugified-teamName}`):
```
{ teamName, position, gamesPlayed, wins, losses, ties, points, scored, allowed, differential, ... }
```

## Current State (March 11, 2026)

### Stats
- 183 total leagues in Firestore
- 122 active, 44 pending_config, 12 pending_tabid
- 1,623 divisions, 16,587 standings
- 6 sports: Baseball (141), Soccer (39), Hockey (2), Lacrosse (1), Softball (planned)
- 8 adapters: GameChanger, SportsConnect, SportsAffinity, GotSport, TGS, Demosphere, Pointstreak, LeagueApps

### Phase 1 Rollout States
**WA** (Washington) — primary, most coverage. Baseball ~70 active, Soccer 8 active + 13 pending
**CA** (California) — good GameChanger coverage
**OR** (Oregon) — soccer expansion next after WA cleanup
**ID** (Idaho) — some soccer (Idaho Premier League on GotSport)
**MT** (Montana) — minimal coverage, needs discovery

### WA Soccer Expansion (just completed)
- 39 total WA soccer leagues registered (was 15)
- 8 active collecting: RCL, SSUL, NPSL, EWSL, WPL Spring 11U-14U, WPL Girls HS, WPL Dev League, LWYSA
- 13 pending_config, 3 pending_tabid
- Platforms: GotSport (11), SportsAffinity (4), Demosphere (10), SportsConnect (8), TGS/ECNL (6)
- **Known issues**: See `tasks/wa-soccer-seasonal-fix.md` for 30 data hygiene issues to fix

### Softball (planned)
- Shares platforms with baseball: GameChanger, SportsConnect, LeagueApps
- WA discovery needed — ASA, USSSA, NSA league structures
- Minimal new adapter work expected

### Recent Additions
- WA Soccer Expansion: 19 new leagues registered across 3 tiers
- 14 WA Little League programs discovered (SportsConnect): 1 GC-matched, 13 pending tabId resolution
- Google Sheets sync RETIRED — dashboard is now GCS-hosted HTML

## Scripts (`scripts/`)

| Script | Purpose | Usage |
|---|---|---|
| `deploy-memory-upgrade.sh` | Deploy collectLeague/collectAll with 1024MB | `bash scripts/deploy-memory-upgrade.sh` |
| `deactivate-non-phase1.js` | Deactivate leagues outside WA/OR/ID/MT/CA | `node scripts/deactivate-non-phase1.js [--dry-run]` |
| `discover-or-id-mt.js` | Discover GC + known leagues in OR/ID/MT | `node scripts/discover-or-id-mt.js [--dry-run] [--state=OR]` |
| `resolve-sportsconnect-pending.js` | Auto-discover SC standings tabIds | `node scripts/resolve-sportsconnect-pending.js [--dry-run] [--fix]` |
| `wa-soccer-expansion.js` | Register 21 WA soccer leagues (3 tiers) | `node scripts/wa-soccer-expansion.js [--dry-run] [--tier=1]` |

Run scripts on the deploy VM via:
```bash
curl -X POST http://35.209.45.82:8080/exec \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"cd /path/to/service && node scripts/deactivate-non-phase1.js --dry-run"}'
```

## Operational Priorities (ordered)

### Immediate (do now)
1. **Fix WA soccer data hygiene** — See `tasks/wa-soccer-seasonal-fix.md`
   - Normalize sport casing ("Soccer" → "soccer")
   - Add missing seasonStart/seasonEnd to 16 active soccer leagues
   - Add discoveryConfig to 11 GotSport leagues for season monitor auto-discovery
   - Set EWSL to dormant (fall 2025 season ended)
2. **Resolve pending SC leagues** — 13+ Little League programs need standingsTabId for spring 2026
   - Run `scripts/resolve-sportsconnect-pending.js --fix` on deploy VM
3. **Verify spring 2026 data flows** — SSUL (Apr 18), SC leagues (Apr 12-18), EWSL spring TBD

### Short-term
4. **Soccer OR expansion** — after WA soccer is clean, expand to Oregon
5. **Softball WA discovery** — find ASA/USSSA/NSA softball leagues on GameChanger
6. Re-map 34 pending_config baseball leagues to correct GC org IDs
7. Add more OR/ID/MT leagues from other platforms

### Medium-term
8. Build TeamSideline adapter (unlocks Thurston + Lewis County soccer)
9. Improve collectAll parallelism — currently sequential, could batch by platform
10. League Request feature — allow users to request a league be added
11. Phase 2 state expansion planning (CO, NV, AZ, UT)

## Important Notes

- **Puppeteer memory**: GameChanger and SportsConnect adapters use Puppeteer for browser automation. They require at least 1024MB Cloud Function memory. At 488MB they OOM.
- **GC season rotation**: GameChanger creates new org IDs each season. The adapter handles auto-rotation via `allOrgIds` + the public API. The season monitor also discovers rotations.
- **SportsConnect ASP.NET postbacks**: SC sites use ASP.NET WebForms with postback-driven dropdowns. Each dropdown selection causes a full page reload. The adapter handles this with `waitForNavigation`.
- **Rate limiting**: GC discovery uses DuckDuckGo HTML search (3s delay between searches) and GC API (300ms delay between calls). Be respectful of external services.
- **Season monitor**: Runs weekly. Auto-transitions stale leagues to dormant (3x stale threshold). Auto-discovers new seasons where possible. Generates reports in `monitorReports` collection.
- **Firestore batch limits**: Max 500 operations per batch. Code uses 400-op chunks for safety margin.

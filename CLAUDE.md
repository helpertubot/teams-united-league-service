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

## Current State (March 12, 2026)

### Stats
- ~193 total leagues in Firestore
- ~132 active, ~38 pending_config, 12 pending_tabid, 2 pending_groups
- 1,623+ divisions, 16,587+ standings
- 6 sports: Baseball (141), Soccer (49+), Hockey (2), Lacrosse (1), Softball (planned)
- 9 adapters: GameChanger, SportsConnect, SportsAffinity, SportsAffinity-ASP, GotSport, TGS, Demosphere, Pointstreak, LeagueApps

### Phase 1 Rollout States
**WA** (Washington) — primary, most coverage. Baseball ~70 active, Soccer 8 active + 13 pending
**CA** (California) — good GameChanger coverage, 2 soccer active + 2 pending_groups
**OR** (Oregon) — soccer resolved: 5 active, 2 dormant, 3 deactivated
**ID** (Idaho) — 4 soccer leagues active (ISL, D3L, SRL, IPL)
**MT** (Montana) — 1 soccer active (MSSL Spring), 1 dormant (MSSL Fall)

### OR Soccer (completed March 12)
- 5 activated: OYSA Spring Competitive, OYSA Spring South, OYSA Dev League, OYSA Valley Academy, PMSL
- 2 dormant: OYSA Winter (season ended), USYS NW Conference (2025-26 not created)
- 3 deactivated: ALBION SC Portland, GPSD (adult), Oregon Soccer Club (stale)

### CA/ID/MT Soccer Expansion (completed March 12)
- 8 new leagues registered, 2 existing updated
- 7 leagues activated with discovered groups (246 total groups)
- 2 CA leagues pending_groups: SOCAL Soccer League (43086), NorCal Premier (44142) — too large for WebFetch

### Softball (planned)
- Shares platforms with baseball: GameChanger, SportsConnect, LeagueApps
- WA discovery needed — ASA, USSSA, NSA league structures
- Minimal new adapter work expected

### Recent Additions
- OR soccer resolution: all 9 pending_config leagues resolved
- CA/ID/MT soccer expansion: 8 new GotSport leagues + 2 updates
- Fall City LL registered (SportsConnect, already active)
- Google Sheets sync RETIRED — dashboard is now GCS-hosted HTML

## Scripts (`scripts/`)

Scripts are organized into subdirectories by purpose:

### `scripts/discovery/` — League & group discovery
| Script | Purpose | Usage |
|---|---|---|
| `discover-or-id-mt.js` | Discover GC + known leagues in OR/ID/MT | `node scripts/discovery/discover-or-id-mt.js [--dry-run] [--state=OR]` |
| `discover-and-activate-gotsport.js` | Discover GotSport groups & activate leagues | `node scripts/discovery/discover-and-activate-gotsport.js [--dry-run]` |
| `resolve-sportsconnect-pending.js` | Auto-discover SC standings tabIds | `node scripts/discovery/resolve-sportsconnect-pending.js [--dry-run] [--fix]` |
| `discovered_groups_new.json` | Pre-discovered GotSport group data | Data file for update-groups.js |

### `scripts/activation/` — League status changes
| Script | Purpose | Usage |
|---|---|---|
| `activate-or-soccer.js` | Activate/dormant/deactivate OR soccer leagues | `node scripts/activation/activate-or-soccer.js [--dry-run]` |
| `deactivate-non-phase1.js` | Deactivate leagues outside WA/OR/ID/MT/CA | `node scripts/activation/deactivate-non-phase1.js [--dry-run]` |

### `scripts/maintenance/` — Data fixes & cleanup
| Script | Purpose | Usage |
|---|---|---|
| `fix-soccer-casing.js` | Normalize sport casing ("Soccer" → "soccer") | `node scripts/maintenance/fix-soccer-casing.js [--dry-run]` |
| `fix-soccer-discovery-config.js` | Add discoveryConfig to GotSport leagues | `node scripts/maintenance/fix-soccer-discovery-config.js [--dry-run]` |
| `fix-soccer-season-dates.js` | Add missing seasonStart/seasonEnd | `node scripts/maintenance/fix-soccer-season-dates.js [--dry-run]` |
| `fix-regions.js` | Fix/add region fields | `node scripts/maintenance/fix-regions.js [--dry-run]` |

### `scripts/setup/` — League registration
| Script | Purpose | Usage |
|---|---|---|
| `wa-soccer-expansion.js` | Register 21 WA soccer leagues (3 tiers) | `node scripts/setup/wa-soccer-expansion.js [--dry-run] [--tier=1]` |
| `or-soccer-expansion.js` | Register 7 OR soccer leagues | `node scripts/setup/or-soccer-expansion.js [--dry-run]` |
| `expand-soccer-ca-id-mt.js` | Register CA/ID/MT soccer leagues | `node scripts/setup/expand-soccer-ca-id-mt.js [--dry-run]` |
| `setup-fall-city-ll.js` | Register Fall City LL (SportsConnect) | `node scripts/setup/setup-fall-city-ll.js [--dry-run]` |

### Root scripts
| Script | Purpose | Usage |
|---|---|---|
| `deploy-memory-upgrade.sh` | Deploy collectLeague/collectAll with 1024MB | `bash scripts/deploy-memory-upgrade.sh` |

## Config (`config/`)

League configuration data organized by state and sport:

```
config/
├── national/              # (future) cross-state config
└── states/
    ├── WA/soccer/leagues.json   # 21 leagues across 3 tiers
    ├── OR/soccer/leagues.json   # 7 leagues (OYSA, PMSL, USYS NW)
    ├── CA/soccer/leagues.json   # 4 leagues (SOCAL, CCSL, NorCal)
    ├── ID/soccer/leagues.json   # 4 leagues (ISL, D3L, SRL, IPL)
    └── MT/soccer/leagues.json   # 2 leagues (MSSL spring/fall)
```

Run scripts on the deploy VM via:
```bash
curl -X POST http://35.209.45.82:8080/exec \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"command":"cd /home/deploy/workspace/league-standings && node scripts/setup/expand-soccer-ca-id-mt.js --dry-run"}'
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
4. ~~**Soccer OR expansion**~~ — DONE (March 12): 5 active, 2 dormant, 3 deactivated
5. **Discover groups for SOCAL (43086) and NorCal Premier (44142)** — need browser-based discovery (too large for WebFetch)
6. **Softball WA discovery** — find ASA/USSSA/NSA softball leagues on GameChanger
7. Re-map 34 pending_config baseball leagues to correct GC org IDs
8. Add more OR/ID/MT leagues from other platforms

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

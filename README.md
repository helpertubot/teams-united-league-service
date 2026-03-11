# Teams United League Service

Multi-platform league standings collection service for Teams United.

## Architecture

- **Cloud Functions**: `collectLeague`, `collectAll`, `getLeagues`, `getDivisions`, `getStandings`
- **8 Platform Adapters**: GameChanger, SportsConnect, GotSport, TGS/ECNL, Demosphere, SportsAffinity, Pointstreak, LeagueApps
- **Season Monitor**: Auto-detection of stale data and season changes
- **Dashboard**: Firebase-hosted ops dashboard + rollout tracker

## Stats (March 2026)

- 114 active baseball leagues across WA/CA/OR/ID/MT
- 1,580 divisions, 16,279 standings
- 14 new WA Little Leagues added (1 GC-matched, 13 pending)
- 5 sports: Baseball, Soccer, Hockey, Basketball, Lacrosse


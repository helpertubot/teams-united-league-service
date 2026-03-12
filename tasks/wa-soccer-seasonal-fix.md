# Task: Fix WA Soccer Seasonal Change Issues + Data Hygiene

## Context
The WA soccer expansion just registered 19 new leagues (39 total soccer). Testing revealed 30 issues that need fixing before we can trust the season monitor to auto-manage soccer seasons. The collection infrastructure works — GotSport, SportsAffinity, Demosphere, and SportsConnect adapters all successfully return data. But the Firestore league documents are missing critical fields the season monitor needs.

## What the Season Monitor Does
The season monitor (`season-monitor.js`) runs weekly and:
1. **Phase 0**: Onboards new leagues (sets initial `lastMonitorCheck`)
2. **Phase 1**: Checks active leagues for staleness (no data change in N days → stale → dormant)
3. **Phase 2**: Discovers new seasons for dormant leagues (platform-specific strategies)
4. **Phase 3**: Checks pending leagues that might now be ready

For Phase 2 to work on GotSport, it needs `discoveryConfig.orgUrl` on the league doc. Without it, the monitor can only do a basic check and can't find the next season's `leagueEventId` + `groupIds`.

## Issues to Fix (3 categories)

### Category 1: Sport Field Casing (1 fix)
19 leagues have `sport: "Soccer"` (capital S) and 20 have `sport: "soccer"` (lowercase). The season monitor uses `(league.sport || 'default').toLowerCase()` so this doesn't break functionality, but it causes display issues on the dashboard and makes queries unreliable.

**Fix**: Normalize ALL soccer leagues to `sport: "soccer"` (lowercase). Run this on the deploy VM:
```javascript
// scripts/fix-soccer-casing.js
const {Firestore} = require('@google-cloud/firestore');
const db = new Firestore();

async function fix() {
  const snap = await db.collection('leagues').get();
  let fixed = 0;
  for (const doc of snap.docs) {
    if (doc.data().sport === 'Soccer') {
      await doc.ref.update({ sport: 'soccer' });
      console.log(`Fixed: ${doc.id}`);
      fixed++;
    }
  }
  console.log(`Fixed ${fixed} leagues`);
}
fix();
```

### Category 2: Missing Season Dates (16 fixes)
These active soccer leagues have no `seasonStart`/`seasonEnd`. Without these, the monitor can't auto-transition to dormant when a season ends — it relies solely on data staleness (14 days for soccer), which is slower and less reliable.

**Leagues needing season dates** (look these up on their source platforms):
- `ecnl-boys` — ECNL Boys (TGS, eventId in sourceConfig)
- `ecnl-girls` — ECNL Girls (TGS)
- `ecnl-rl-boys` — ECNL Regional League Boys (TGS)
- `ecnl-rl-girls` — ECNL Regional League Girls (TGS)
- `pre-ecnl-boys` — Pre-ECNL Boys (TGS)
- `pre-ecnl-girls` — Pre-ECNL Girls (TGS)
- `id-premier-league` — Idaho Premier League (GotSport)
- `norcal-premier` — NorCal Premier Soccer NPL (GotSport)
- `npsl-wa` — North Puget Sound League (Demosphere)
- `rcl-wa` — Regional Club League (SportsAffinity) — NOTE: the NEW rcl-wa doc from expansion HAS dates, but the ORIGINAL rcl-wa may not. Check which doc is active.
- `sc-lwysa-wa` — Lake Washington Youth Soccer (SportsConnect)
- `usys-nw-conference` — US Youth Soccer NW Conference (GotSport)
- `wa-cup-boys-hs` — WA Cup Boys HS (GotSport)
- `wpl-boys-hs-fall` — WPL Boys HS Fall (GotSport)
- `wpl-ewa-dev-spring` — WPL Eastern WA Dev Spring (GotSport)
- `wpl-spring-npl` — WPL Spring NPL & Classic (GotSport)

**Fix approach**: Create a script that sets `seasonStart` and `seasonEnd` on each. For ECNL/TGS leagues, check the TGS event page. For GotSport, check the event page. General rules:
- Fall seasons: Sep 1 – Nov 30
- Spring seasons: Mar 1 – Jun 30
- Year-round (ECNL): Sep 1 – Jun 30
- WPL Dev: Nov 1 – Apr 30

### Category 3: Missing discoveryConfig on GotSport Leagues (11 fixes)
These GotSport leagues have no `discoveryConfig`, which means the season monitor can't auto-discover next season's `leagueEventId` when the current season ends. This is the biggest gap for seasonal change.

**Leagues needing discoveryConfig**:
- `ewsl-wa` — ALSO past seasonEnd (Nov 2025), should be set to dormant
- `id-premier-league`
- `norcal-premier`
- `usys-nw-conference`
- `wa-cup-boys-hs`
- `wpl-boys-hs-fall`
- `wpl-ewa-dev-spring`
- `wpl-girls-hs-spring`
- `wpl-spring-1114u`
- `wpl-spring-npl`
- `wpl-wwa-dev-spring`

**Fix approach**: For each GotSport league, find the organization's page URL on gotsport.com. The pattern is usually `https://system.gotsport.com/org_event/events?club=CLUB_ID` or the org landing page. Set:
```javascript
discoveryConfig: {
  orgUrl: 'https://system.gotsport.com/...',  // org page that lists season events
}
```

For `ewsl-wa` specifically, ALSO update its status to `dormant` since seasonEnd was Nov 2025.

### Bonus: EWSL Status Fix
`ewsl-wa` has `seasonEnd: 2025-11-10` (5 months ago) but `status: active`. Fix:
```javascript
await db.collection('leagues').doc('ewsl-wa').update({
  status: 'dormant',
  monitorStatus: 'dormant',
  monitorNotes: 'Fall 2025 season ended Nov 10. Spring 2026 not yet published — monitor will auto-reactivate when discovered.'
});
```

## Deliverables
1. `scripts/fix-soccer-casing.js` — Normalize sport field to lowercase
2. `scripts/fix-soccer-season-dates.js` — Add seasonStart/seasonEnd to 16 leagues
3. `scripts/fix-soccer-discovery-config.js` — Add discoveryConfig to 11 GotSport leagues + dormant EWSL
4. Run all 3 scripts on deploy VM
5. Verify the season monitor correctly processes the updated leagues by checking a few docs in Firestore
6. Update CLAUDE.md with:
   - Softball added to sport coverage plan
   - WA soccer: 39 total leagues registered (8 active collecting, 13 pending_config, 3 pending_tabid, 15 other states)
   - Next: Soccer OR expansion after WA is clean
   - Next: Softball WA discovery

## How to Verify Season Monitor Works After Fixes
After running the fix scripts, manually trigger the season monitor:
```bash
curl -X POST https://us-central1-teams-united.cloudfunctions.net/seasonMonitor
```
Check the response for:
- `newLeaguesOnboarded` should include the 19 new soccer leagues
- `ewsl-wa` should appear as dormant
- No errors on the soccer leagues

## Remote Access
- Firestore: accessible from the deploy environment via `@google-cloud/firestore`
- Working directory: `/home/deploy/workspace/league-standings/`
- SSH and VM details are in your environment, not in this file

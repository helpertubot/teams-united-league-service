# Task: Oregon Soccer Expansion — Register OR Youth Soccer Leagues

## Priority: High
## Sport: Soccer
## State: Oregon (OR)
## Affects: League coverage expansion, SportsAffinity adapter, region assignments

---

## Background

Oregon Youth Soccer Association (OYSA) governs all youth soccer in Oregon with ~90 member clubs. OYSA runs 3 conference tiers through their league play program, all hosted on SportsAffinity at `oysa.sportsaffinity.com`.

This task registers OYSA league seasons into Firestore so the existing SportsAffinity adapter can collect standings.

---

## OYSA League Structure

### 3 Conferences (all youth competitive)

1. **PCL (Platform Conference League)** — Top tier: ECNL, GA, MLS Next clubs
2. **SCL (State Conference League)** — Statewide competitive, open to all OYSA clubs
3. **RCL (Regional Conference League)** — Regional play, split into 3 sub-regions:
   - **North**: Salem and north
   - **Central**: Corvallis–Bend–Cottage Grove corridor
   - **South**: Roseburg and south

### Seasons

| Season | Age Groups | Dates | Cost |
|--------|-----------|-------|------|
| Fall League | U11-U16 | Sep–Oct | $954/team |
| Spring League | U11-U14 | Feb–Apr | $749/team |
| Winter League | U15-U19 | Jan–Mar | — |

---

## SportsAffinity Config — NEEDS DISCOVERY

OYSA uses SportsAffinity at `oysa.sportsaffinity.com`. Our adapter calls:
```
https://sctour.sportsaffinity.com/api/standings?organizationId={GUID}&tournamentId={seasonGuid}
```

### What we know

- **Season GUIDs found** (these are the `tournamentId` values):
  - Fall 2025: `014d6282-e344-410e-81bb-8fdf842c270e`
  - Spring 2026: `2A349A09-F127-445D-9252-62C4D1029140`
  - Winter 2026: `72ad07b7-ee2c-43f5-9108-edeb82f6b58a`

- **organizationId: UNKNOWN** — This is the blocker. The API requires a GUID-format organizationId. We tried:
  - Numeric orgid `1236554` (from dataLayer on page) → API rejects, needs GUID format
  - Logo GUID `72C0C9E8-CA5E-410A-8611-637D88717AFB` → Returns "LeagueNotFound"
  - Background image GUID `4F640841-A545-4CFD-A33D-4369C659321C` → "LeagueNotFound"

- **WA reference**: WA's organizationId is `7379E8F5-2B0D-4729-BDF9-967A08999A37` (shared across RCL-WA and SSUL-WA). Each season gets a different `seasonGuid`/`tournamentId`.

### How to find the OYSA organizationId

The organizationId GUID is NOT visible in the page HTML. It's used internally by SportsAffinity's API layer. To find it, try these approaches:

1. **Intercept network requests**: Load a standings page on `oysa.sportsaffinity.com` with browser DevTools Network tab open. Click through divisions/flights. Look for any XHR/fetch calls to `sctour.sportsaffinity.com/api/*` and capture the `organizationId` param.

2. **Try the tournaments listing endpoint**: 
   ```
   https://sctour.sportsaffinity.com/api/tournaments?organizationId={GUID}
   ```
   If you find a candidate GUID, this endpoint should return a list of seasons.

3. **Check Blazor app config**: SportsAffinity has been migrating to Blazor WebAssembly. Check:
   - `https://oysa.sportsaffinity.com/_framework/blazor.boot.json`
   - Any `appsettings.json` referenced in the Blazor bootstrap
   
4. **Search SportsAffinity HTML thoroughly**: Look in ALL `<script>` tags, hidden inputs, data attributes, cookie values, and `__VIEWSTATE` fields for any GUID that's ~36 chars in standard GUID format.

5. **Try brute patterns**: SportsAffinity might use a predictable pattern. WA's org GUID starts with `7379E8F5`. Try GUIDs found in other page elements (club GUIDs, team GUIDs) — one might be the org.

6. **Alternative**: If the API absolutely can't be cracked, consider using Puppeteer/Playwright to parse the HTML standings pages directly at URLs like:
   ```
   https://oysa.sportsaffinity.com/tour/public/info/schedule_standings.asp?sessionguid=&flightguid={flightGuid}&tournamentguid={seasonGuid}
   ```
   This is a fallback — the JSON API is strongly preferred.

---

## Script to Create: `scripts/or-soccer-expansion.js`

Model after `scripts/wa-soccer-expansion.js`. Register these leagues:

### OYSA RCL Leagues (SportsAffinity)

```javascript
// ── OYSA RCL Fall (Regional Conference League) ──
{
  id: 'rcl-or-fall',
  name: 'OYSA Regional Conference League (RCL) — Fall',
  state: 'OR',
  sport: 'soccer',  // lowercase!
  region: 'Pacific Northwest',  // Use our standard region from lib/regions.js
  subRegion: 'Oregon Statewide',
  sourcePlatform: 'sportsaffinity',
  status: 'pending_config',  // Change to 'active' once organizationId is found
  autoUpdate: true,
  sourceConfig: {
    organizationId: '',  // FILL THIS IN — see discovery steps above
    seasonGuid: '014d6282-e344-410e-81bb-8fdf842c270e',  // Fall 2025
  },
  seasonStart: '2025-09-01',
  seasonEnd: '2025-10-31',
  notes: 'OYSA RCL Fall 2025. U11-U16. 3 sub-regions: North (Salem+), Central (Corvallis-Bend), South (Roseburg+). ~90 clubs statewide.',
}

// ── OYSA RCL Spring ──
{
  id: 'rcl-or-spring',
  name: 'OYSA Regional Conference League (RCL) — Spring',
  state: 'OR',
  sport: 'soccer',
  region: 'Pacific Northwest',
  subRegion: 'Oregon Statewide',
  sourcePlatform: 'sportsaffinity',
  status: 'pending_config',
  autoUpdate: true,
  sourceConfig: {
    organizationId: '',  // SAME org ID as Fall
    seasonGuid: '2A349A09-F127-445D-9252-62C4D1029140',  // Spring 2026
  },
  seasonStart: '2026-02-01',
  seasonEnd: '2026-04-30',
  notes: 'OYSA RCL Spring 2026. U11-U14.',
}

// ── OYSA Winter League ──
{
  id: 'rcl-or-winter',
  name: 'OYSA Winter League',
  state: 'OR',
  sport: 'soccer',
  region: 'Pacific Northwest',
  subRegion: 'Oregon Statewide',
  sourcePlatform: 'sportsaffinity',
  status: 'pending_config',
  autoUpdate: true,
  sourceConfig: {
    organizationId: '',  // SAME org ID
    seasonGuid: '72ad07b7-ee2c-43f5-9108-edeb82f6b58a',  // Winter 2026
  },
  seasonStart: '2026-01-01',
  seasonEnd: '2026-03-31',
  notes: 'OYSA Winter 2026. U15-U19.',
}
```

### OYSA SCL and PCL (if separate season GUIDs exist)

SCL and PCL may use the SAME season GUIDs as RCL (all under OYSA). Check if the Fall/Spring/Winter GUIDs above return flights for all 3 conferences, or if SCL/PCL have their own season GUIDs. If separate:

```javascript
// ── OYSA SCL (State Conference League) ──
{
  id: 'scl-or',
  name: 'OYSA State Conference League (SCL)',
  // ... same pattern, different seasonGuid if needed
}

// ── OYSA PCL (Platform Conference League) ──  
{
  id: 'pcl-or',
  name: 'OYSA Platform Conference League (PCL)',
  // ... same pattern, different seasonGuid if needed
}
```

### National Leagues Operating in OR (already in system or pending)

These national leagues already have OR clubs. Don't re-register — just note for reference:
- **ECNL Boys/Girls** — Already registered as `ecnl-boys`, `ecnl-girls` (national, GotSport/TGS)
- **GA Boys/Girls** — Already registered as `ga-boys`, `ga-girls` (national, GotSport)
- **MLS Next** — Already registered (national)

OR ECNL clubs: United PDX, Columbia Premier, Oregon Premier FC, Eugene Metros, Capital FC, FC Portland, Oregon Surf
OR GA clubs: Westside Metros, Oregon Premier FC, Columbia Premier, Capital FC, Eugene Metros

### GPSD (Greater Portland Soccer District) — LOW PRIORITY

GPSD is **adult-only** rec soccer (Over 30/40/50/58/65 leagues). Uses Demosphere/OttoSport at `gpsdsoccer.demosphere-secure.com` (redirects to `ottosport.ai`). NOT youth soccer — register as low priority only if we want adult coverage:

```javascript
{
  id: 'gpsd-or',
  name: 'Greater Portland Soccer District (GPSD)',
  state: 'OR',
  sport: 'soccer',
  region: 'Pacific Northwest',
  subRegion: 'Portland Metro',
  sourcePlatform: 'demosphere',
  status: 'pending_config',
  autoUpdate: false,
  sourceConfig: {
    baseUrl: 'https://gpsdsoccer.demosphere-secure.com',
    // Redirects to ottosport.ai
  },
  notes: 'ADULT ONLY — Over 30/40/50/58/65 rec leagues. Low priority. Demosphere/OttoSport platform. Division URL pattern: /divisions/{AgeGroup}_{Division}_{Season}',
}
```

---

## Deliverables

1. **Find the OYSA SportsAffinity organizationId** (GUID format) — this is the critical blocker
2. **Verify the 3 season GUIDs work** with the API once organizationId is found
3. **Create `scripts/or-soccer-expansion.js`** — register all OR soccer leagues into Firestore
4. **Run with `--dry-run` first**, then live
5. **Update CLAUDE.md** with OR soccer status

## Testing

Once organizationId is found, verify:
```bash
# Should return JSON array of flights with standings
curl "https://sctour.sportsaffinity.com/api/standings?organizationId={FOUND_GUID}&tournamentId=014d6282-e344-410e-81bb-8fdf842c270e"
```

If the Fall 2025 season is over and returns empty, try Spring 2026:
```bash
curl "https://sctour.sportsaffinity.com/api/standings?organizationId={FOUND_GUID}&tournamentId=2A349A09-F127-445D-9252-62C4D1029140"
```

## Files to Create

| File | Action |
|------|--------|
| `scripts/or-soccer-expansion.js` | **CREATE** — register OR soccer leagues |

## DO NOT Modify
- `adapters/sportsaffinity.js` — already handles OYSA (same API as WA)
- Any WA league documents
- Any credentials or connection configs
- Do NOT put Runpod SSH details in any file

---

## Reference

- WA expansion script: `scripts/wa-soccer-expansion.js` — follow same pattern
- SportsAffinity adapter: `adapters/sportsaffinity.js` — uses `organizationId` + `seasonGuid`
- Region mapping: `lib/regions.js` — OR maps to "Pacific Northwest"
- OYSA website: https://oysa.sportsaffinity.com
- OYSA league info: https://www.oregonyouthsoccer.org/leagues/

# Task: Baseball Age Group Inference for Division Data

## Priority: High
## Sport: Baseball / Softball
## Affects: GameChanger adapter, Pointstreak adapter, division data quality

---

## Problem

Baseball divisions in Firestore have `ageGroup: "open"` for most GameChanger and Pointstreak leagues. Soccer divisions have proper age groups (U14, B2008, etc.) because soccer platforms expose age metadata. Baseball platforms organize by **division level** (Tee Ball, Minors, Majors, Juniors, etc.) rather than age.

This matters because on the Teams United Team Management side, clubs create groups with baseball-specific names like "Tee Ball", "Majors", "AAA", "Juniors", etc. When they select a league division for standings, they need the age groups to match up. Currently everything shows as "open" which makes filtering impossible.

### Current State
- **54 baseball divisions** checked: 31 have `ageGroup: "open"`, only 23 have real values
- Some leagues already have `sourceConfig.ageGroup` set from GC discovery (e.g., "pinto", "minors", "AA") — these flow through correctly
- The SportsConnect adapter already has smart baseball mapping (see `parseDivisionInfo()` in `adapters/sportsconnect.js` lines 409-446) — use this as reference

---

## Solution

### 1. Create `lib/baseball-age-groups.js` — shared baseball division level mapping

This module should export a function that maps baseball division level names to standard age groups. The Teams United platform lets clubs name their groups freely, so **preserve baseball terminology** — don't convert to U-age format.

```js
// Standard Little League division levels → age ranges
const LITTLE_LEAGUE_DIVISIONS = {
  'tee ball':       { ageGroup: 'Tee Ball',       ageRange: '4-6',   gender: 'mixed' },
  't-ball':         { ageGroup: 'Tee Ball',       ageRange: '4-6',   gender: 'mixed' },
  'coach pitch':    { ageGroup: 'Coach Pitch',    ageRange: '5-7',   gender: 'mixed' },
  'machine pitch':  { ageGroup: 'Machine Pitch',  ageRange: '6-8',   gender: 'mixed' },
  'minor a':        { ageGroup: 'Minor A',        ageRange: '7-9',   gender: 'mixed' },
  'minor b':        { ageGroup: 'Minor B',        ageRange: '7-9',   gender: 'mixed' },
  'minor aa':       { ageGroup: 'Minor AA',       ageRange: '8-10',  gender: 'mixed' },
  'minor aaa':      { ageGroup: 'Minor AAA',      ageRange: '9-11',  gender: 'mixed' },
  'minors':         { ageGroup: 'Minors',         ageRange: '7-11',  gender: 'mixed' },
  'a':              { ageGroup: 'A',              ageRange: '7-9',   gender: 'mixed' },
  'aa':             { ageGroup: 'AA',             ageRange: '8-10',  gender: 'mixed' },
  'aaa':            { ageGroup: 'AAA',            ageRange: '9-11',  gender: 'mixed' },
  'majors':         { ageGroup: 'Majors',         ageRange: '10-12', gender: 'mixed' },
  'major':          { ageGroup: 'Majors',         ageRange: '10-12', gender: 'mixed' },
  'intermediate':   { ageGroup: 'Intermediate',   ageRange: '11-13', gender: 'mixed' },
  '50/70':          { ageGroup: 'Intermediate',   ageRange: '11-13', gender: 'mixed' },
  'juniors':        { ageGroup: 'Juniors',        ageRange: '12-14', gender: 'mixed' },
  'junior':         { ageGroup: 'Juniors',        ageRange: '12-14', gender: 'mixed' },
  'seniors':        { ageGroup: 'Seniors',        ageRange: '13-16', gender: 'mixed' },
  'senior':         { ageGroup: 'Seniors',        ageRange: '13-16', gender: 'mixed' },
};

// PONY Baseball divisions
const PONY_DIVISIONS = {
  'shetland':  { ageGroup: 'Shetland',  ageRange: '5-6',   gender: 'mixed' },
  'pinto':     { ageGroup: 'Pinto',     ageRange: '7-8',   gender: 'mixed' },
  'mustang':   { ageGroup: 'Mustang',   ageRange: '9-10',  gender: 'mixed' },
  'bronco':    { ageGroup: 'Bronco',    ageRange: '11-12', gender: 'mixed' },
  'pony':      { ageGroup: 'Pony',      ageRange: '13-14', gender: 'mixed' },
  'colt':      { ageGroup: 'Colt',      ageRange: '15-16', gender: 'mixed' },
  'palomino':  { ageGroup: 'Palomino',  ageRange: '17-18', gender: 'mixed' },
};

// Softball-specific overrides
const SOFTBALL_DIVISIONS = {
  'minor':     { ageGroup: 'Minor',     ageRange: '7-11',  gender: 'girls' },
  'major':     { ageGroup: 'Major',     ageRange: '9-12',  gender: 'girls' },
  'junior':    { ageGroup: 'Junior',    ageRange: '12-14', gender: 'girls' },
  'senior':    { ageGroup: 'Senior',    ageRange: '13-16', gender: 'girls' },
};
```

The function `inferBaseballAgeGroup(divisionName, leagueName, sport)` should:
1. Normalize the input (lowercase, trim)
2. Check the league name and division name against these dictionaries
3. Look for patterns like "Majors", "AAA", "Pinto" anywhere in the name
4. If `sport === 'softball'`, prefer the softball mappings and default `gender: 'girls'`
5. Return `{ ageGroup, ageRange, gender }` or `{ ageGroup: 'open', gender: 'mixed' }` if no match
6. Also detect U-age patterns in case they're present (e.g., "10U", "12U" → ageGroup like "10U")

### 2. Update `adapters/gamechanger.js`

In the `collectStandings` function around line 142, replace:

```js
ageGroup: leagueConfig.sourceConfig.ageGroup || 'open',
gender: leagueConfig.sourceConfig.gender || 'mixed',
```

With:

```js
// Use sourceConfig ageGroup if set, otherwise infer from division/league name
const inferred = inferBaseballAgeGroup(divName, leagueConfig.name, leagueConfig.sport);
ageGroup: leagueConfig.sourceConfig.ageGroup || inferred.ageGroup,
gender: leagueConfig.sourceConfig.gender || inferred.gender,
```

Import `inferBaseballAgeGroup` from `../lib/baseball-age-groups.js`.

### 3. Update `adapters/pointstreak.js`

Same pattern — around line 112 and line 264, use the inference function when `ageGroup` would default to `'open'`.

### 4. Write a one-time backfill script `scripts/backfill-baseball-ages.js`

This script should:
1. Query all divisions where `sport` (via parent league) is `baseball` or `softball`
2. For each division with `ageGroup === 'open'`, run the inference function
3. Update the division document with the inferred `ageGroup` and `gender`
4. Support `--dry-run` flag
5. Print summary of changes

---

## Testing

After implementing, verify by checking:
```bash
# Should show baseball-appropriate age groups instead of "open"
node -e "
  const db = require('firebase-admin').firestore();
  db.collection('divisions').where('leagueId', '==', 'gc-3gazQeqDyJKD').get()
    .then(s => s.forEach(d => console.log(d.data().name, '→', d.data().ageGroup)));
"
```

Kirkland Little League divisions should show "AAA" or "Majors" instead of "open".

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `lib/baseball-age-groups.js` | **CREATE** — shared baseball division → age group mapping |
| `adapters/gamechanger.js` | **MODIFY** — use inference when ageGroup not in sourceConfig |
| `adapters/pointstreak.js` | **MODIFY** — use inference when ageGroup not in sourceConfig |
| `scripts/backfill-baseball-ages.js` | **CREATE** — one-time backfill for existing divisions |

## DO NOT Modify
- `adapters/sportsconnect.js` — already has working baseball age mapping
- Any league documents — only division documents need updating
- Any credentials or connection configs

---

## Reference

- SportsConnect adapter's `parseDivisionInfo()` function (lines 409-446) shows the pattern to follow
- The league `sourceConfig.ageGroup` field takes priority when set (from GC discovery)
- Keep `gender: 'mixed'` as default for baseball, `gender: 'girls'` for softball

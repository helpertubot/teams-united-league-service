# Coverage Research Ingest Parser v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `scripts/coverage/ingest-research.js` to consume the new 2-file per-state research format (separate leagues + tournaments markdown, new 12/19-col schemas, 8 sports including volleyball) and upsert rows into `config/states/{STATE}/{sport}/{leagues,tournaments}.json`.

**Architecture:** Additive extension to `scripts/coverage/lib.js` (new V2 schema constants + normalizers) plus full rewrite of the `ingest-research.js` driver. Old lib helpers (used by `regen-coverage.js`) are left untouched. Driver is split into pure functions so every transformation is unit-testable. Tests use Node's built-in `node:test` runner (zero-dep) under `scripts/coverage/__tests__/`.

**Tech Stack:** Node.js 20+, `node:test`, `node:assert/strict`, repo stdlib only.

**Spec:** `docs/superpowers/specs/2026-04-12-coverage-ingest-parser-v2-design.md`

---

## File Structure

**Modified:**
- `scripts/coverage/lib.js` — add V2 schema constants + new normalizers/helpers. Preserves all existing exports (regen-coverage.js depends on them).
- `scripts/coverage/ingest-research.js` — full rewrite. Becomes a thin orchestrator over library functions.
- `package.json` — add `"test:coverage"` script.

**Created:**
- `scripts/coverage/mappers.js` — new module containing `researchLeagueToConfigV2` and `researchTournamentToConfigV2`. Keeps the driver small and makes the mappers trivially unit-testable.
- `scripts/coverage/__tests__/normalizers.test.js` — unit tests for all lib.js V2 helpers.
- `scripts/coverage/__tests__/mappers.test.js` — unit tests for mappers.
- `scripts/coverage/__tests__/ingest-research.test.js` — integration tests (child_process-driven end-to-end runs).
- `scripts/coverage/__fixtures__/CA-leagues-sample.md` — trimmed research file for fixtures.
- `scripts/coverage/__fixtures__/CA-tournaments-sample.md` — trimmed research file for fixtures.

**Untouched (out of scope):** `scripts/coverage/regen-coverage.js`, existing `scripts/coverage/__fixtures__/ID-softball-sample.md`, `coverage/_template.md`, `push-to-firestore.js`.

---

## Working Directory Note

All paths below are relative to `/private/tmp/teams-united-league-service`. The feature branch `claude/coverage-ingest-v2` is already checked out (spec commit exists). All work happens on that branch.

---

### Task 1: Test infrastructure

**Files:**
- Create: `scripts/coverage/__tests__/smoke.test.js`
- Modify: `package.json`

- [ ] **Step 1: Create smoke test**

Create `scripts/coverage/__tests__/smoke.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

test('node:test runner is wired up', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Add npm script**

Modify `package.json` `"scripts"` block by adding the `test:coverage` entry (leave existing `"test"` script alone):

```json
"scripts": {
  "start": "functions-framework --target=collectLeague --port=8080",
  "test": "node test-adapters.js",
  "test:coverage": "node --test scripts/coverage/__tests__/*.test.js"
}
```

- [ ] **Step 3: Run the test**

Run: `cd /private/tmp/teams-united-league-service && npm run test:coverage`

Expected output includes: `# pass 1` and exit code 0.

- [ ] **Step 4: Commit**

```bash
cd /private/tmp/teams-united-league-service
git add scripts/coverage/__tests__/smoke.test.js package.json
git commit -m "chore(coverage): wire up node:test runner for coverage scripts"
```

---

### Task 2: `normalizeCell` helper

**Files:**
- Modify: `scripts/coverage/lib.js`
- Create/modify: `scripts/coverage/__tests__/normalizers.test.js`

- [ ] **Step 1: Write failing test**

Create `scripts/coverage/__tests__/normalizers.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib');

test('normalizeCell returns undefined for absent sentinels', () => {
  for (const v of ['', ' ', 'n/a', 'N/A', '-', '—', 'TBD', 'tbd']) {
    assert.equal(L.normalizeCell(v), undefined, `sentinel ${JSON.stringify(v)}`);
  }
});

test('normalizeCell trims and collapses internal whitespace', () => {
  assert.equal(L.normalizeCell('  hello   world  '), 'hello world');
});

test('normalizeCell passes real values through', () => {
  assert.equal(L.normalizeCell('Santa Monica Little League'), 'Santa Monica Little League');
});

test('normalizeCell returns undefined for non-string null/undefined', () => {
  assert.equal(L.normalizeCell(null), undefined);
  assert.equal(L.normalizeCell(undefined), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:coverage`

Expected: FAIL with `L.normalizeCell is not a function`.

- [ ] **Step 3: Implement**

Append to `scripts/coverage/lib.js` (before `module.exports`):

```javascript
const ABSENT_SENTINELS = new Set(['', 'n/a', '-', '—', 'tbd']);

function normalizeCell(value) {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim().replace(/\s+/g, ' ');
  if (ABSENT_SENTINELS.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}
```

Add `normalizeCell` to the `module.exports` object.

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`

Expected: all normalizeCell tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/lib.js scripts/coverage/__tests__/normalizers.test.js
git commit -m "feat(coverage): add normalizeCell helper"
```

---

### Task 3: `normalizeGender` helper

**Files:**
- Modify: `scripts/coverage/lib.js`
- Modify: `scripts/coverage/__tests__/normalizers.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/normalizers.test.js`:

```javascript
test('normalizeGender maps aliases to Boys+Girls', () => {
  for (const v of ['Both', 'Mixed', 'Coed', 'Co-ed', 'Boys and Girls', 'BOTH', 'mixed']) {
    assert.equal(L.normalizeGender(v), 'Boys+Girls', `alias ${JSON.stringify(v)}`);
  }
});

test('normalizeGender passes canonical values through', () => {
  assert.equal(L.normalizeGender('Boys'), 'Boys');
  assert.equal(L.normalizeGender('Girls'), 'Girls');
  assert.equal(L.normalizeGender('Boys+Girls'), 'Boys+Girls');
});

test('normalizeGender returns undefined for empty/absent', () => {
  assert.equal(L.normalizeGender(''), undefined);
  assert.equal(L.normalizeGender(undefined), undefined);
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`

Expected: FAIL with `L.normalizeGender is not a function`.

- [ ] **Step 3: Implement**

Append to `scripts/coverage/lib.js`:

```javascript
const GENDER_ALIASES = new Set(['both', 'mixed', 'coed', 'co-ed', 'boys and girls']);

function normalizeGender(value) {
  const v = normalizeCell(value);
  if (!v) return undefined;
  if (GENDER_ALIASES.has(v.toLowerCase())) return 'Boys+Girls';
  return v;
}
```

Add `normalizeGender` to `module.exports`.

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: all normalizeGender tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/lib.js scripts/coverage/__tests__/normalizers.test.js
git commit -m "feat(coverage): add normalizeGender helper"
```

---

### Task 4: `stripUrlWrapper` helper

**Files:**
- Modify: `scripts/coverage/lib.js`
- Modify: `scripts/coverage/__tests__/normalizers.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/normalizers.test.js`:

```javascript
test('stripUrlWrapper removes google.com/search?q= raw wrapper', () => {
  assert.equal(
    L.stripUrlWrapper('https://www.google.com/search?q=https%3A%2F%2Fexample.com'),
    'https://example.com'
  );
});

test('stripUrlWrapper removes markdown-link wrapper', () => {
  assert.equal(
    L.stripUrlWrapper('[https://example.com](https://www.google.com/search?q=https%3A%2F%2Fexample.com)'),
    'https://example.com'
  );
});

test('stripUrlWrapper passes unwrapped URLs through', () => {
  assert.equal(L.stripUrlWrapper('https://example.com'), 'https://example.com');
});

test('stripUrlWrapper returns undefined for empty/absent', () => {
  assert.equal(L.stripUrlWrapper(''), undefined);
  assert.equal(L.stripUrlWrapper(undefined), undefined);
});

test('stripUrlWrapper handles google.com/search?q= without protocol on inner', () => {
  assert.equal(
    L.stripUrlWrapper('https://www.google.com/search?q=example.com%2Fpath'),
    'example.com/path'
  );
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: FAIL with `L.stripUrlWrapper is not a function`.

- [ ] **Step 3: Implement**

Append to `scripts/coverage/lib.js`:

```javascript
function stripUrlWrapper(value) {
  const v = normalizeCell(value);
  if (!v) return undefined;
  // Markdown-link form: [display](wrapper) — prefer display if present.
  const md = v.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (md) {
    const inner = stripUrlWrapper(md[2]);
    // If the wrapper's inner URL decodes to the display text, they match;
    // return display. Otherwise prefer display text (it's what the human wrote).
    return md[1];
  }
  // Raw wrapper: https://www.google.com/search?q=<encoded-url>
  const wrapped = v.match(/^https?:\/\/(?:www\.)?google\.com\/search\?(?:.*&)?q=([^&]+)/);
  if (wrapped) {
    try {
      return decodeURIComponent(wrapped[1]);
    } catch (_) {
      return wrapped[1];
    }
  }
  return v;
}
```

Add `stripUrlWrapper` to `module.exports`.

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: all stripUrlWrapper tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/lib.js scripts/coverage/__tests__/normalizers.test.js
git commit -m "feat(coverage): add stripUrlWrapper helper"
```

---

### Task 5: `slugWithoutYear` helper

**Files:**
- Modify: `scripts/coverage/lib.js`
- Modify: `scripts/coverage/__tests__/normalizers.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/normalizers.test.js`:

```javascript
test('slugWithoutYear strips leading 4-digit year', () => {
  assert.equal(L.slugWithoutYear('2026 Dublin United Clover Cup'), 'dublin-united-clover-cup');
});

test('slugWithoutYear strips trailing 4-digit year', () => {
  assert.equal(L.slugWithoutYear('Spring Rose Classic 2026'), 'spring-rose-classic');
});

test('slugWithoutYear strips internal 4-digit year', () => {
  assert.equal(L.slugWithoutYear('2026 Pacific Coast Cup'), 'pacific-coast-cup');
});

test('slugWithoutYear leaves 2-digit numbers intact', () => {
  assert.equal(L.slugWithoutYear('26 IR Elk Grove Cup'), '26-ir-elk-grove-cup');
  assert.equal(L.slugWithoutYear('24 Hour Showdown'), '24-hour-showdown');
});

test('slugWithoutYear leaves numbers that are not years', () => {
  assert.equal(L.slugWithoutYear('Surf Cup Olders U15'), 'surf-cup-olders-u15');
});

test('slugWithoutYear collapses resulting whitespace', () => {
  assert.equal(L.slugWithoutYear('  2026   Extra   Spaces  2026  '), 'extra-spaces');
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: FAIL with `L.slugWithoutYear is not a function`.

- [ ] **Step 3: Implement**

Append to `scripts/coverage/lib.js`:

```javascript
function slugWithoutYear(value) {
  const v = String(value || '');
  const stripped = v.replace(/\b20\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim();
  return slug(stripped);
}
```

Add `slugWithoutYear` to `module.exports`.

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: all slugWithoutYear tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/lib.js scripts/coverage/__tests__/normalizers.test.js
git commit -m "feat(coverage): add slugWithoutYear helper"
```

---

### Task 6: `parseYear` + `validateDate` helpers

**Files:**
- Modify: `scripts/coverage/lib.js`
- Modify: `scripts/coverage/__tests__/normalizers.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/normalizers.test.js`:

```javascript
test('parseYear extracts 4-digit year from ISO date', () => {
  assert.equal(L.parseYear('2026-03-14'), 2026);
  assert.equal(L.parseYear('2025-12-31'), 2025);
});

test('parseYear returns null for malformed input', () => {
  assert.equal(L.parseYear('garbage'), null);
  assert.equal(L.parseYear(''), null);
  assert.equal(L.parseYear(undefined), null);
  assert.equal(L.parseYear('14/03/2026'), null);
});

test('validateDate accepts valid ISO date', () => {
  assert.equal(L.validateDate('2026-03-14'), true);
});

test('validateDate rejects invalid inputs', () => {
  assert.equal(L.validateDate('2026-3-14'), false);
  assert.equal(L.validateDate('14/03/2026'), false);
  assert.equal(L.validateDate(''), false);
  assert.equal(L.validateDate(undefined), false);
  assert.equal(L.validateDate('2026-03'), false);
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: FAIL with `L.parseYear is not a function`.

- [ ] **Step 3: Implement**

Append to `scripts/coverage/lib.js`:

```javascript
function validateDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseYear(s) {
  if (!validateDate(s)) return null;
  return Number(s.slice(0, 4));
}
```

Add both to `module.exports`.

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: all parseYear/validateDate tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/lib.js scripts/coverage/__tests__/normalizers.test.js
git commit -m "feat(coverage): add parseYear and validateDate helpers"
```

---

### Task 7: Extend `normalizePlatform`

**Files:**
- Modify: `scripts/coverage/lib.js`
- Modify: `scripts/coverage/__tests__/normalizers.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/normalizers.test.js`:

```javascript
test('normalizePlatform handles new v2 sources', () => {
  assert.equal(L.normalizePlatform('TravelSports'), 'travelsports');
  assert.equal(L.normalizePlatform('travel sports'), 'travelsports');
  assert.equal(L.normalizePlatform('Exposure Events'), 'exposureevents');
  assert.equal(L.normalizePlatform('exposureevents'), 'exposureevents');
  assert.equal(L.normalizePlatform('NCS'), 'ncs');
  assert.equal(L.normalizePlatform('USSSA'), 'usssa');
});

test('normalizePlatform preserves existing mappings', () => {
  assert.equal(L.normalizePlatform('GotSport'), 'gotsport');
  assert.equal(L.normalizePlatform('SportsEngine'), 'sportngin');
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`

The existing `normalizePlatform` falls through to `t.replace(/\s+/g, '')` for unknown values, so all these cases likely already pass via the fallback. The test is primarily a regression guard on v2 platform strings.

- Expected outcome A: all tests pass without code change → skip Step 3; commit the test only.
- Expected outcome B: one or more fail → proceed to Step 3 to add explicit aliases.

- [ ] **Step 3: Implement (only if Step 2 had failures)**

Edit the `map` object inside `normalizePlatform` in `scripts/coverage/lib.js`. Add entries for any failing cases (full set for completeness / intent documentation):

```javascript
    'travelsports': 'travelsports',
    'travel sports': 'travelsports',
    'exposureevents': 'exposureevents',
    'exposure events': 'exposureevents',
    'ncs': 'ncs',
    'usssa': 'usssa',
    'event website': 'eventwebsite'
```

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: all normalizePlatform tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/lib.js scripts/coverage/__tests__/normalizers.test.js
git commit -m "test(coverage): pin v2 platform name handling (+aliases if needed)"
```

---

### Task 8: Add volleyball to SPORTS

**Files:**
- Modify: `scripts/coverage/lib.js`
- Modify: `scripts/coverage/__tests__/normalizers.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/normalizers.test.js`:

```javascript
test('SPORTS includes volleyball', () => {
  assert.ok(L.SPORTS.includes('volleyball'), 'volleyball should be a recognized sport');
});

test('detectSport recognizes Volleyball heading', () => {
  assert.equal(L.detectSport('Volleyball'), 'volleyball');
  assert.equal(L.detectSport('## Volleyball'), 'volleyball');
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: FAIL — current SPORTS has 7 entries, no volleyball.

- [ ] **Step 3: Implement**

Edit `scripts/coverage/lib.js`:

```javascript
const SPORTS = ['soccer', 'baseball', 'softball', 'basketball', 'lacrosse', 'hockey', 'football', 'volleyball'];
```

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: all volleyball tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/lib.js scripts/coverage/__tests__/normalizers.test.js
git commit -m "feat(coverage): add volleyball to SPORTS list"
```

---

### Task 9: V2 schema constants + HEADER_ALIASES_V2

**Files:**
- Modify: `scripts/coverage/lib.js`
- Modify: `scripts/coverage/__tests__/normalizers.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/normalizers.test.js`:

```javascript
test('LEAGUE_COLUMNS_V2 has exactly 12 canonical columns', () => {
  assert.deepEqual(L.LEAGUE_COLUMNS_V2, [
    'name', 'sport', 'level', 'ageGroups', 'gender', 'season',
    'geography', 'governingBody', 'sanctioning', 'website',
    'sourceUrl', 'notes'
  ]);
});

test('TOURNAMENT_COLUMNS_V2 has exactly 19 canonical columns', () => {
  assert.deepEqual(L.TOURNAMENT_COLUMNS_V2, [
    'name', 'sport', 'startDate', 'endDate', 'venue', 'city', 'state',
    'entryFee', 'teamCount', 'platform', 'registrationUrl', 'ageGroups',
    'gender', 'format', 'organizer', 'sanctioning', 'confidence',
    'sourceUrl', 'notes'
  ]);
});

test('normalizeHeadersV2 maps camelCase research headers through', () => {
  const headers = ['name', 'Name', 'Start Date', 'startDate', 'Source URL', 'sourceUrl'];
  const normalized = L.normalizeHeadersV2(headers);
  assert.deepEqual(normalized, ['name', 'name', 'startDate', 'startDate', 'sourceUrl', 'sourceUrl']);
});

test('normalizeHeadersV2 passes unknown headers through unchanged', () => {
  assert.deepEqual(L.normalizeHeadersV2(['custom', 'Other']), ['custom', 'Other']);
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: FAIL — V2 constants do not exist yet.

- [ ] **Step 3: Implement**

Append to `scripts/coverage/lib.js` (before `module.exports`):

```javascript
const LEAGUE_COLUMNS_V2 = [
  'name', 'sport', 'level', 'ageGroups', 'gender', 'season',
  'geography', 'governingBody', 'sanctioning', 'website',
  'sourceUrl', 'notes'
];

const TOURNAMENT_COLUMNS_V2 = [
  'name', 'sport', 'startDate', 'endDate', 'venue', 'city', 'state',
  'entryFee', 'teamCount', 'platform', 'registrationUrl', 'ageGroups',
  'gender', 'format', 'organizer', 'sanctioning', 'confidence',
  'sourceUrl', 'notes'
];

const HEADER_ALIASES_V2 = {
  'name': 'name',
  'sport': 'sport',
  'level': 'level',
  'agegroups': 'ageGroups',
  'age groups': 'ageGroups',
  'ages': 'ageGroups',
  'age range': 'ageGroups',
  'gender': 'gender',
  'season': 'season',
  'seasons': 'season',
  'season(s)': 'season',
  'geography': 'geography',
  'geographic scope': 'geography',
  'scope': 'geography',
  'governingbody': 'governingBody',
  'governing body': 'governingBody',
  'sanctioning': 'sanctioning',
  'sanctioning body': 'sanctioning',
  'website': 'website',
  'sourceurl': 'sourceUrl',
  'source url': 'sourceUrl',
  'notes': 'notes',
  'startdate': 'startDate',
  'start date': 'startDate',
  'enddate': 'endDate',
  'end date': 'endDate',
  'venue': 'venue',
  'city': 'city',
  'state': 'state',
  'entryfee': 'entryFee',
  'entry fee': 'entryFee',
  'teamcount': 'teamCount',
  'team count': 'teamCount',
  'platform': 'platform',
  'registrationurl': 'registrationUrl',
  'registration url': 'registrationUrl',
  'format': 'format',
  'organizer': 'organizer',
  'confidence': 'confidence'
};

function normalizeHeadersV2(headers) {
  return headers.map((h) => {
    const key = String(h).toLowerCase().trim();
    return HEADER_ALIASES_V2[key] || h;
  });
}
```

Add all four (`LEAGUE_COLUMNS_V2`, `TOURNAMENT_COLUMNS_V2`, `HEADER_ALIASES_V2`, `normalizeHeadersV2`) to `module.exports`.

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: all V2 schema tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/lib.js scripts/coverage/__tests__/normalizers.test.js
git commit -m "feat(coverage): add v2 schema constants and header aliases"
```

---

### Task 10: Trimmed fixture files

**Files:**
- Create: `scripts/coverage/__fixtures__/CA-leagues-sample.md`
- Create: `scripts/coverage/__fixtures__/CA-tournaments-sample.md`

- [ ] **Step 1: Create leagues fixture**

Create `scripts/coverage/__fixtures__/CA-leagues-sample.md` with the exact content below. These rows are hand-picked to exercise every normalization case (absent cells, gender alias, real URLs, multiple sports, volleyball).

```markdown
# CA Leagues Sample Fixture

**Soccer**

| name | sport | level | ageGroups | gender | season | geography | governingBody | sanctioning | website | sourceUrl | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| NorCal Youth Premier League – Gold | Soccer | competitive | U14-U19 | Boys+Girls | year-round | regional (NorCal) | NorCal Premier | US Club Soccer | https://norcalpremier.com | https://norcalpremier.com/competition/youth-premier-league-u14-u19/ | Tier row: Gold division. |
| California Youth Soccer League – Boys | Soccer | rec | U-4 to U-16 | Boys | year-round | metro | California Youth Soccer League | none stated | https://www.caliyouthsoccer.com | https://www.caliyouthsoccer.com/ | Site shows 2026 registration. |
| California Youth Soccer League – Girls | Soccer | rec | U-4 to U-16 | Girls | year-round | metro | California Youth Soccer League | none stated | https://www.caliyouthsoccer.com | https://www.caliyouthsoccer.com/ | Site shows 2026 registration. |

**Volleyball**

| name | sport | level | ageGroups | gender | season | geography | governingBody | sanctioning | website | sourceUrl | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SCVA Junior League | Volleyball | competitive | 12U-18U | Girls | winter | regional (SoCal) | SCVA | USA Volleyball | https://scva.org | https://scva.org/junior-league | n/a |
| NCVA Coed Mixer | Volleyball | rec | 14U-18U | Both | spring | regional (NorCal) | NCVA | USA Volleyball |  | https://ncva.com/events | Gender alias should normalize. |
```

- [ ] **Step 2: Create tournaments fixture**

Create `scripts/coverage/__fixtures__/CA-tournaments-sample.md`:

```markdown
# CA Tournaments Sample Fixture

## Soccer

| name | sport | startDate | endDate | venue | city | state | entryFee | teamCount | platform | registrationUrl | ageGroups | gender | format | organizer | sanctioning | confidence | sourceUrl | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026 Dublin United Clover Cup Tournament | Soccer | 2026-03-14 | 2026-03-15 | Fallon Sports Park - Dublin | Dublin | CA | $700-$800 | n/a | GotSport | https://system.gotsport.com/event_regs/394b04f09d | U9-U14 | Boys+Girls | 3GG | Dublin United Soccer | n/a | high | https://system.gotsport.com/event_regs/394b04f09d | Fees and venue listed on GotSport registration page. |
| Spring Rose Classic 2026 | Soccer | 2026-04-25 | 2026-04-26 | TBD - Roseville | Roseville | CA |  | n/a | GotSport | https://home.gotsoccer.com/events.aspx | n/a | Mixed |  | n/a | n/a | high | https://home.gotsoccer.com/events.aspx | Gender alias case. |
| California Cup | Soccer | 2026-05-23 | 2026-05-25 | Granite Regional Park - Sacramento | Sacramento | CA | $900-$1775 | n/a | Event website | https://californiacup.com/ | U9-U19 | Boys+Girls | n/a | Cal North | US Club Soccer | high | https://californiacup.com/ | No year in name — seriesId should match full slug. |

## Volleyball

| name | sport | startDate | endDate | venue | city | state | entryFee | teamCount | platform | registrationUrl | ageGroups | gender | format | organizer | sanctioning | confidence | sourceUrl | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| JVA West Coast Cup | Volleyball | 2026-05-23 | 2026-05-25 | Long Beach Convention Center - Long Beach | Long Beach | CA | n/a | n/a | TravelSports | https://volleyball.travelsports.com/tournaments/jva-west-coast-cup | 14U-18U | Girls |  | JVA | JVA | high | https://volleyball.travelsports.com/tournaments/jva-west-coast-cup |  |
| SoCal Cup: 14/13 Tourney 3 | Volleyball | bad-date | 2026-04-11 | AIM Sportsplex - Seal Beach | Seal Beach | CA |  | n/a | TravelSports | https://volleyball.travelsports.com/tournaments/socal-cup-winter-formal | 13U-14U | Boys |  | SoCal Cup Volleyball | n/a | medium | https://volleyball.travelsports.com/tournaments/socal-cup-winter-formal | Malformed startDate — should be dropped but row kept. |
```

- [ ] **Step 3: Commit**

```bash
git add scripts/coverage/__fixtures__/CA-leagues-sample.md scripts/coverage/__fixtures__/CA-tournaments-sample.md
git commit -m "test(coverage): add v2 research fixture files"
```

---

### Task 11: `researchLeagueToConfigV2` mapper

**Files:**
- Create: `scripts/coverage/mappers.js`
- Create: `scripts/coverage/__tests__/mappers.test.js`

- [ ] **Step 1: Write failing test**

Create `scripts/coverage/__tests__/mappers.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../mappers');

test('researchLeagueToConfigV2 maps a full 12-col row', () => {
  const row = {
    name: 'NorCal Youth Premier League – Gold',
    sport: 'Soccer',
    level: 'competitive',
    ageGroups: 'U14-U19',
    gender: 'Boys+Girls',
    season: 'year-round',
    geography: 'regional (NorCal)',
    governingBody: 'NorCal Premier',
    sanctioning: 'US Club Soccer',
    website: 'https://norcalpremier.com',
    sourceUrl: 'https://norcalpremier.com/competition/ypl/',
    notes: 'Tier row: Gold division.'
  };
  const out = M.researchLeagueToConfigV2(row);
  assert.deepEqual(out, {
    id: 'norcal-youth-premier-league-gold',
    name: 'NorCal Youth Premier League – Gold',
    level: 'competitive',
    ageGroups: 'U14-U19',
    gender: 'Boys+Girls',
    season: 'year-round',
    region: 'regional (NorCal)',
    governingBody: 'NorCal Premier',
    sanctioning: 'US Club Soccer',
    website: 'https://norcalpremier.com',
    sourceUrl: 'https://norcalpremier.com/competition/ypl/',
    notes: 'Tier row: Gold division.'
  });
});

test('researchLeagueToConfigV2 drops absent fields', () => {
  const row = {
    name: 'NCVA Coed Mixer',
    sport: 'Volleyball',
    gender: 'Both',
    geography: 'regional (NorCal)',
    website: '',
    sourceUrl: 'https://ncva.com/events',
    notes: 'n/a'
  };
  const out = M.researchLeagueToConfigV2(row);
  assert.deepEqual(out, {
    id: 'ncva-coed-mixer',
    name: 'NCVA Coed Mixer',
    gender: 'Boys+Girls',
    region: 'regional (NorCal)',
    sourceUrl: 'https://ncva.com/events'
  });
});

test('researchLeagueToConfigV2 returns null when name is absent', () => {
  assert.equal(M.researchLeagueToConfigV2({ name: '' }), null);
  assert.equal(M.researchLeagueToConfigV2({ name: 'n/a' }), null);
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: FAIL — `mappers.js` does not exist.

- [ ] **Step 3: Implement**

Create `scripts/coverage/mappers.js`:

```javascript
const L = require('./lib');

function dropEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

function researchLeagueToConfigV2(row) {
  const name = L.normalizeCell(row.name);
  if (!name) return null;
  return dropEmpty({
    id: L.slug(name),
    name,
    level: L.normalizeCell(row.level),
    ageGroups: L.normalizeCell(row.ageGroups),
    gender: L.normalizeGender(row.gender),
    season: L.normalizeCell(row.season),
    region: L.normalizeCell(row.geography),
    governingBody: L.normalizeCell(row.governingBody),
    sanctioning: L.normalizeCell(row.sanctioning),
    website: L.stripUrlWrapper(row.website),
    sourceUrl: L.stripUrlWrapper(row.sourceUrl),
    notes: L.normalizeCell(row.notes)
  });
}

module.exports = { researchLeagueToConfigV2 };
```

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: all researchLeagueToConfigV2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/mappers.js scripts/coverage/__tests__/mappers.test.js
git commit -m "feat(coverage): add researchLeagueToConfigV2 mapper"
```

---

### Task 12: `researchTournamentToConfigV2` mapper

**Files:**
- Modify: `scripts/coverage/mappers.js`
- Modify: `scripts/coverage/__tests__/mappers.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/mappers.test.js`:

```javascript
test('researchTournamentToConfigV2 maps a full 19-col row with derived fields', () => {
  const row = {
    name: '2026 Dublin United Clover Cup Tournament',
    sport: 'Soccer',
    startDate: '2026-03-14',
    endDate: '2026-03-15',
    venue: 'Fallon Sports Park - Dublin',
    city: 'Dublin',
    state: 'CA',
    entryFee: '$700-$800',
    teamCount: 'n/a',
    platform: 'GotSport',
    registrationUrl: 'https://system.gotsport.com/event_regs/394b04f09d',
    ageGroups: 'U9-U14',
    gender: 'Boys+Girls',
    format: '3GG',
    organizer: 'Dublin United Soccer',
    sanctioning: 'n/a',
    confidence: 'high',
    sourceUrl: 'https://system.gotsport.com/event_regs/394b04f09d',
    notes: 'Fees and venue listed.'
  };
  const out = M.researchTournamentToConfigV2(row);
  assert.deepEqual(out, {
    id: '2026-dublin-united-clover-cup-tournament',
    seriesId: 'dublin-united-clover-cup-tournament',
    year: 2026,
    lifecycle: 'upcoming',
    name: '2026 Dublin United Clover Cup Tournament',
    startDate: '2026-03-14',
    endDate: '2026-03-15',
    venue: 'Fallon Sports Park - Dublin',
    city: 'Dublin',
    entryFee: '$700-$800',
    sourcePlatform: 'gotsport',
    registrationUrl: 'https://system.gotsport.com/event_regs/394b04f09d',
    ageGroups: 'U9-U14',
    gender: 'Boys+Girls',
    format: '3GG',
    organizer: 'Dublin United Soccer',
    confidence: 'high',
    sourceUrl: 'https://system.gotsport.com/event_regs/394b04f09d',
    notes: 'Fees and venue listed.'
  });
});

test('researchTournamentToConfigV2 drops malformed date field but keeps row', () => {
  const row = {
    name: 'SoCal Cup: 14/13 Tourney 3',
    startDate: 'bad-date',
    endDate: '2026-04-11',
    venue: 'AIM Sportsplex',
    city: 'Seal Beach',
    sourceUrl: 'https://example.com'
  };
  const out = M.researchTournamentToConfigV2(row);
  assert.equal(out.name, 'SoCal Cup: 14/13 Tourney 3');
  assert.equal(out.startDate, undefined);
  assert.equal(out.endDate, '2026-04-11');
  assert.equal(out.year, null);
  assert.equal(out.lifecycle, 'upcoming');
});

test('researchTournamentToConfigV2 returns null when name is absent', () => {
  assert.equal(M.researchTournamentToConfigV2({ name: '' }), null);
});

test('researchTournamentToConfigV2 seriesId equals id when no year in name', () => {
  const out = M.researchTournamentToConfigV2({
    name: 'California Cup',
    startDate: '2026-05-23',
    endDate: '2026-05-25'
  });
  assert.equal(out.id, 'california-cup');
  assert.equal(out.seriesId, 'california-cup');
  assert.equal(out.year, 2026);
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: FAIL — `researchTournamentToConfigV2` does not exist.

- [ ] **Step 3: Implement**

Modify `scripts/coverage/mappers.js` — add the tournament mapper and export it:

```javascript
function researchTournamentToConfigV2(row) {
  const name = L.normalizeCell(row.name);
  if (!name) return null;

  const startDateRaw = L.normalizeCell(row.startDate);
  const endDateRaw = L.normalizeCell(row.endDate);
  const startDate = L.validateDate(startDateRaw) ? startDateRaw : undefined;
  const endDate = L.validateDate(endDateRaw) ? endDateRaw : undefined;

  if (startDateRaw && !startDate) {
    console.warn(`warn: malformed startDate "${startDateRaw}" on row "${name}" — dropping field`);
  }
  if (endDateRaw && !endDate) {
    console.warn(`warn: malformed endDate "${endDateRaw}" on row "${name}" — dropping field`);
  }

  const entry = dropEmpty({
    id: L.slug(name),
    seriesId: L.slugWithoutYear(name),
    name,
    startDate,
    endDate,
    venue: L.normalizeCell(row.venue),
    city: L.normalizeCell(row.city),
    entryFee: L.normalizeCell(row.entryFee),
    teamCount: L.normalizeCell(row.teamCount),
    sourcePlatform: L.normalizePlatform(L.normalizeCell(row.platform) || ''),
    registrationUrl: L.stripUrlWrapper(row.registrationUrl),
    ageGroups: L.normalizeCell(row.ageGroups),
    gender: L.normalizeGender(row.gender),
    format: L.normalizeCell(row.format),
    organizer: L.normalizeCell(row.organizer),
    sanctioning: L.normalizeCell(row.sanctioning),
    confidence: L.normalizeCell(row.confidence),
    sourceUrl: L.stripUrlWrapper(row.sourceUrl),
    notes: L.normalizeCell(row.notes)
  });

  // Always include these derived fields even when null/missing:
  entry.year = L.parseYear(startDate);
  entry.lifecycle = 'upcoming';

  return entry;
}

module.exports = { researchLeagueToConfigV2, researchTournamentToConfigV2 };
```

Also update the `sourcePlatform` handling: if `normalizePlatform('')` returns `''`, `dropEmpty` will drop it — that's correct.

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: all researchTournamentToConfigV2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/mappers.js scripts/coverage/__tests__/mappers.test.js
git commit -m "feat(coverage): add researchTournamentToConfigV2 mapper"
```

---

### Task 13: Driver — argument parsing + state/kind resolution

**Files:**
- Modify: `scripts/coverage/ingest-research.js` (full rewrite)
- Create: `scripts/coverage/__tests__/ingest-research.test.js`

- [ ] **Step 1: Write failing integration test**

Create `scripts/coverage/__tests__/ingest-research.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'ingest-research.js');
const FIXTURES = path.resolve(__dirname, '..', '__fixtures__');

function runIngest(args, opts = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || path.resolve(__dirname, '..', '..', '..')
  });
}

test('ingest-research exits 1 when no path given', () => {
  const r = runIngest([]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/);
});

test('ingest-research resolves state and kind from filename (dry-run)', () => {
  const r = runIngest([path.join(FIXTURES, 'CA-leagues-sample.md'), '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[CA\/soccer\]/);
  assert.match(r.stdout, /leagues:/);
});

test('ingest-research exits 1 when state cannot be inferred', () => {
  const tmp = path.join(os.tmpdir(), `ingest-test-${Date.now()}.md`);
  fs.writeFileSync(tmp, '# garbage\n');
  const r = runIngest([tmp, '--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /state/i);
  fs.unlinkSync(tmp);
});

test('ingest-research --state flag overrides filename', () => {
  const r = runIngest([
    path.join(FIXTURES, 'CA-leagues-sample.md'),
    '--state', 'WA',
    '--dry-run'
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[WA\/soccer\]/);
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: FAIL — current driver uses old schema and will not produce `[CA/soccer]` output for the v2 fixture.

- [ ] **Step 3: Rewrite driver (top half — arg parsing + state/kind resolution)**

Overwrite `scripts/coverage/ingest-research.js` with a skeleton. Subsequent tasks fill in the body:

```javascript
#!/usr/bin/env node
/**
 * Ingest a v2 research markdown file (separate leagues or tournaments)
 * into config/states/{STATE}/{sport}/{leagues,tournaments}.json.
 *
 * Usage:
 *   node scripts/coverage/ingest-research.js <research.md> \
 *     [--state XX] [--kind leagues|tournaments] [--dry-run]
 *
 * Filename convention: <STATE>-<leagues|tournaments>.md (e.g. CA-leagues.md).
 * Flags override filename inference.
 */

const fs = require('fs');
const path = require('path');
const L = require('./lib');
const M = require('./mappers');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out.flags[a.slice(2)] = argv[++i];
      } else {
        out.flags[a.slice(2)] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function inferFromFilename(filepath) {
  const base = path.basename(filepath).replace(/\.md$/i, '');
  const m = base.match(/^([A-Za-z]{2})-(leagues|tournaments)(?:-.*)?$/i);
  if (!m) return { state: null, kind: null };
  return { state: m[1].toUpperCase(), kind: m[2].toLowerCase() };
}

const args = parseArgs(process.argv);
const inputPath = args._[0];
if (!inputPath) {
  console.error('usage: ingest-research.js <research.md> [--state XX] [--kind leagues|tournaments] [--dry-run]');
  process.exit(1);
}

const DRY = !!args.flags['dry-run'];
const inferred = inferFromFilename(inputPath);
const state = (args.flags.state || inferred.state || '').toString().toUpperCase();
const kind = (args.flags.kind || inferred.kind || '').toString().toLowerCase();

if (!state) {
  console.error('error: cannot resolve state — pass --state XX or use <STATE>-<kind>.md filename');
  process.exit(1);
}
if (!['leagues', 'tournaments'].includes(kind)) {
  console.error('error: cannot resolve kind — pass --kind leagues|tournaments or use <STATE>-<kind>.md filename');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8');

// Remaining logic filled in by subsequent tasks.
// For now: emit placeholder output so arg-parsing tests pass.
console.log(`[${state}/soccer] leagues: +0 new, 0 merged → 0 total`);
process.exit(0);
```

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: the three arg-parsing tests pass; integration test using real fixture passes with placeholder output. Other ingest tests (none yet) pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/ingest-research.js scripts/coverage/__tests__/ingest-research.test.js
git commit -m "feat(coverage): rewrite ingest driver — argument parsing skeleton"
```

---

### Task 14: Driver — table parsing + per-sport grouping

**Files:**
- Modify: `scripts/coverage/ingest-research.js`
- Modify: `scripts/coverage/__tests__/ingest-research.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/ingest-research.test.js`:

```javascript
test('ingest-research leagues --dry-run reports per-sport row counts', () => {
  const r = runIngest([path.join(FIXTURES, 'CA-leagues-sample.md'), '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  // 3 soccer, 2 volleyball in the fixture
  assert.match(r.stdout, /\[CA\/soccer\] leagues: \+3 new/);
  assert.match(r.stdout, /\[CA\/volleyball\] leagues: \+2 new/);
});

test('ingest-research tournaments --dry-run reports per-sport row counts', () => {
  const r = runIngest([path.join(FIXTURES, 'CA-tournaments-sample.md'), '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  // 3 soccer, 2 volleyball
  assert.match(r.stdout, /\[CA\/soccer\] tournaments: \+3 new/);
  assert.match(r.stdout, /\[CA\/volleyball\] tournaments: \+2 new/);
});

test('ingest-research exits 1 when no parseable tables', () => {
  const tmp = path.join(os.tmpdir(), `ingest-empty-${Date.now()}.md`);
  fs.writeFileSync(tmp, '# CA Leagues\n\nNo tables here.\n');
  const r = runIngest([tmp, '--state', 'CA', '--kind', 'leagues', '--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no parseable.*tables/i);
  fs.unlinkSync(tmp);
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: FAIL — driver still emits placeholder output.

- [ ] **Step 3: Implement table parsing + grouping**

Replace the placeholder block at the bottom of `scripts/coverage/ingest-research.js`. After the `raw = fs.readFileSync(...)` line, insert:

```javascript
const tables = L.parseMarkdownTables(raw);
for (const t of tables) {
  t.headers = L.normalizeHeadersV2(t.headers);
}

// Required headers per kind.
const REQUIRED_LEAGUES = ['name'];
const REQUIRED_TOURNAMENTS = ['name', 'startDate'];
const required = kind === 'leagues' ? REQUIRED_LEAGUES : REQUIRED_TOURNAMENTS;

// Group by sport using either the preceding heading or a per-row sport cell.
const bySport = {};
for (const t of tables) {
  const hasRequired = required.every((h) => t.headers.includes(h));
  if (!hasRequired) {
    console.warn(
      `warn: table under heading "${t.heading}" missing required header(s) — skipping`
    );
    continue;
  }
  const headingSport = L.detectSport(t.heading);
  for (const row of t.rows) {
    const obj = L.rowToObject(t.headers, row);
    const rowSport =
      (obj.sport && L.detectSport(obj.sport)) ||
      (obj.sport && String(obj.sport).toLowerCase().trim()) ||
      headingSport;
    if (!rowSport || !L.SPORTS.includes(rowSport)) {
      console.warn(
        `warn: row "${obj.name || '(no name)'}" under heading "${t.heading}" — unknown sport "${obj.sport || ''}"; skipping`
      );
      continue;
    }
    bySport[rowSport] = bySport[rowSport] || [];
    const entry =
      kind === 'leagues'
        ? M.researchLeagueToConfigV2(obj)
        : M.researchTournamentToConfigV2(obj);
    if (!entry) continue;
    bySport[rowSport].push(entry);
  }
}

if (Object.keys(bySport).length === 0) {
  console.error('error: no parseable tables found');
  process.exit(1);
}

// Replace the placeholder console.log line from Task 13 with the summary loop below.
// Merge + write logic is added in Task 15 & 16; for now emit counts only:
for (const [sport, entries] of Object.entries(bySport)) {
  console.log(`[${state}/${sport}] ${kind}: +${entries.length} new, 0 merged → ${entries.length} total`);
}
process.exit(0);
```

Delete the old placeholder `console.log` + `process.exit(0)` line from Task 13 so only the new summary loop remains.

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: all table-parsing tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/ingest-research.js scripts/coverage/__tests__/ingest-research.test.js
git commit -m "feat(coverage): parse tables and group rows per-sport in ingest driver"
```

---

### Task 15: Driver — merge + write (existing-fields-win, sticky fields)

**Files:**
- Modify: `scripts/coverage/ingest-research.js`
- Modify: `scripts/coverage/__tests__/ingest-research.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/ingest-research.test.js`:

```javascript
const { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs');

function withTempRepo(fn) {
  const tmpRepo = mkdtempSync(path.join(os.tmpdir(), 'tu-ingest-'));
  try {
    // Create minimal repo layout: config/states/
    mkdirSync(path.join(tmpRepo, 'config', 'states'), { recursive: true });
    // Driver resolves config paths relative to REPO_ROOT (two levels up from scripts/coverage).
    // Create that layout: tmpRepo/scripts/coverage/lib.js needs to exist because lib.js
    // computes REPO_ROOT from __dirname. We copy by symlinking scripts/ into the tmp repo.
    const realScripts = path.resolve(__dirname, '..', '..');
    fs.symlinkSync(realScripts, path.join(tmpRepo, 'scripts'));
    fn(tmpRepo);
  } finally {
    rmSync(tmpRepo, { recursive: true, force: true });
  }
}

test('ingest writes leagues.json on new config', () => {
  withTempRepo((repo) => {
    const r = runIngest(
      [path.join(FIXTURES, 'CA-leagues-sample.md')],
      { cwd: repo }
    );
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(readFileSync(path.join(repo, 'config', 'states', 'CA', 'soccer', 'leagues.json'), 'utf8'));
    assert.equal(out.leagues.length, 3);
    assert.equal(out.leagues[0].id, 'norcal-youth-premier-league-gold');
  });
});

test('ingest preserves existing fields on merge (existing wins)', () => {
  withTempRepo((repo) => {
    const leaguesPath = path.join(repo, 'config', 'states', 'CA', 'soccer', 'leagues.json');
    mkdirSync(path.dirname(leaguesPath), { recursive: true });
    writeFileSync(
      leaguesPath,
      JSON.stringify({
        _description: 'CA soccer leagues',
        _lastUpdated: '2025-01-01',
        leagues: [
          {
            id: 'norcal-youth-premier-league-gold',
            name: 'NorCal Youth Premier League – Gold',
            notes: 'HAND-CURATED NOTE',
            customField: 'should survive'
          }
        ]
      }, null, 2)
    );
    const r = runIngest(
      [path.join(FIXTURES, 'CA-leagues-sample.md')],
      { cwd: repo }
    );
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(readFileSync(leaguesPath, 'utf8'));
    const row = out.leagues.find((l) => l.id === 'norcal-youth-premier-league-gold');
    assert.equal(row.notes, 'HAND-CURATED NOTE');
    assert.equal(row.customField, 'should survive');
    assert.equal(row.level, 'competitive'); // filled from research (was absent)
  });
});

test('ingest preserves tournament sticky fields on merge', () => {
  withTempRepo((repo) => {
    const tournPath = path.join(repo, 'config', 'states', 'CA', 'soccer', 'tournaments.json');
    mkdirSync(path.dirname(tournPath), { recursive: true });
    writeFileSync(
      tournPath,
      JSON.stringify({
        _description: 'CA soccer tournaments',
        _lastUpdated: '2025-01-01',
        tournaments: [
          {
            id: '2026-dublin-united-clover-cup-tournament',
            name: '2026 Dublin United Clover Cup Tournament',
            lifecycle: 'stale',
            lastChecked: '2026-04-10',
            lastHttpStatus: 404,
            consecutiveFailures: 2
          }
        ]
      }, null, 2)
    );
    const r = runIngest(
      [path.join(FIXTURES, 'CA-tournaments-sample.md')],
      { cwd: repo }
    );
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(readFileSync(tournPath, 'utf8'));
    const row = out.tournaments.find((t) => t.id === '2026-dublin-united-clover-cup-tournament');
    assert.equal(row.lifecycle, 'stale');
    assert.equal(row.lastChecked, '2026-04-10');
    assert.equal(row.lastHttpStatus, 404);
    assert.equal(row.consecutiveFailures, 2);
    assert.equal(row.venue, 'Fallon Sports Park - Dublin'); // filled from research
  });
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: FAIL — no JSON is written yet.

- [ ] **Step 3: Implement merge + write**

Replace the summary-only loop at the bottom of `scripts/coverage/ingest-research.js` with:

```javascript
const PROTECTED_TOURNAMENT_FIELDS = new Set([
  'lifecycle', 'lastChecked', 'lastHttpStatus',
  'consecutiveFailures', 'movedTo', 'missingSince'
]);

function mergeList(existing, incoming, kind) {
  const out = existing.map((e) => ({ ...e }));
  const byId = new Map(out.map((e, i) => [e.id, i]));
  const byDomain = new Map();
  for (let i = 0; i < out.length; i++) {
    const d = L.domainOf(out[i].website);
    if (d) byDomain.set(d, i);
  }
  let added = 0;
  let merged = 0;
  for (const inc of incoming) {
    let idx = byId.has(inc.id) ? byId.get(inc.id) : -1;
    if (idx === -1) {
      const d = L.domainOf(inc.website);
      if (d && byDomain.has(d)) idx = byDomain.get(d);
    }
    if (idx === -1) {
      out.push(inc);
      byId.set(inc.id, out.length - 1);
      const d = L.domainOf(inc.website);
      if (d) byDomain.set(d, out.length - 1);
      added++;
    } else {
      const cur = out[idx];
      let changed = false;
      for (const k of Object.keys(inc)) {
        if (kind === 'tournaments' && PROTECTED_TOURNAMENT_FIELDS.has(k)) continue;
        if (cur[k] === undefined || cur[k] === '' || cur[k] === null) {
          cur[k] = inc[k];
          changed = true;
        }
      }
      if (changed) merged++;
    }
  }
  return { list: out, added, merged };
}

const plan = [];
for (const [sport, entries] of Object.entries(bySport)) {
  const configPath =
    kind === 'leagues'
      ? L.configLeaguesPath(state, sport)
      : L.configTournamentsPath(state, sport);
  const envelopeKey = kind; // 'leagues' or 'tournaments'
  const existing = L.readJson(configPath) || {
    _description: `${state} ${sport} ${kind}`,
    _lastUpdated: L.todayISO(),
    [envelopeKey]: []
  };
  const { list, added, merged } = mergeList(existing[envelopeKey] || [], entries, kind);
  plan.push({
    sport,
    configPath,
    envelopeKey,
    newEnvelope: { ...existing, _lastUpdated: L.todayISO(), [envelopeKey]: list },
    counts: { added, merged, total: list.length }
  });
}

for (const p of plan) {
  console.log(
    `[${state}/${p.sport}] ${kind}: +${p.counts.added} new, ${p.counts.merged} merged → ${p.counts.total} total`
  );
  if (DRY) {
    console.log(`  (dry-run) would write ${p.configPath}`);
  } else {
    L.writeJson(p.configPath, p.newEnvelope);
    console.log(`  wrote ${p.configPath}`);
  }
}
```

Delete the old short summary loop from Task 14 and the `process.exit(0)` so the script falls off the end cleanly.

- [ ] **Step 4: Run test**

Run: `npm run test:coverage`
Expected: all merge + write tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/ingest-research.js scripts/coverage/__tests__/ingest-research.test.js
git commit -m "feat(coverage): add merge + write with existing-fields-win and sticky protection"
```

---

### Task 16: Driver — domain-match merge + idempotency

**Files:**
- Modify: `scripts/coverage/__tests__/ingest-research.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/ingest-research.test.js`:

```javascript
test('ingest is idempotent — re-run produces zero diff', () => {
  withTempRepo((repo) => {
    const r1 = runIngest([path.join(FIXTURES, 'CA-leagues-sample.md')], { cwd: repo });
    assert.equal(r1.status, 0, r1.stderr);
    const first = readFileSync(path.join(repo, 'config', 'states', 'CA', 'soccer', 'leagues.json'), 'utf8');

    const r2 = runIngest([path.join(FIXTURES, 'CA-leagues-sample.md')], { cwd: repo });
    assert.equal(r2.status, 0, r2.stderr);
    const second = readFileSync(path.join(repo, 'config', 'states', 'CA', 'soccer', 'leagues.json'), 'utf8');

    // _lastUpdated will be same date (ISO-day granularity). Contents must match.
    assert.equal(first, second, 're-run should produce byte-identical file');
    assert.match(r2.stdout, /\+0 new, 0 merged/);
  });
});

test('ingest merges by website domain when id differs', () => {
  withTempRepo((repo) => {
    const leaguesPath = path.join(repo, 'config', 'states', 'CA', 'soccer', 'leagues.json');
    mkdirSync(path.dirname(leaguesPath), { recursive: true });
    writeFileSync(
      leaguesPath,
      JSON.stringify({
        _description: 'CA soccer leagues',
        _lastUpdated: '2025-01-01',
        leagues: [
          {
            id: 'caliyouthsoccer-legacy-entry',
            name: 'Legacy entry',
            website: 'https://www.caliyouthsoccer.com',
            notes: 'ORIGINAL'
          }
        ]
      }, null, 2)
    );
    const r = runIngest([path.join(FIXTURES, 'CA-leagues-sample.md')], { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(readFileSync(leaguesPath, 'utf8'));
    // Both research rows (Boys + Girls) share the same domain as the legacy entry.
    // First research row with that domain merges into legacy; second becomes a new row
    // (since legacy's domain index is already consumed by the first match).
    const legacy = out.leagues.find((l) => l.id === 'caliyouthsoccer-legacy-entry');
    assert.equal(legacy.notes, 'ORIGINAL'); // preserved
    assert.ok(out.leagues.length >= 2);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: PASS — the logic from Task 15 already supports these cases. If either test fails, the failure is the signal; investigate and fix before proceeding.

- [ ] **Step 3: Commit the tests**

(No code change expected. If a fix was needed, include it.)

```bash
git add scripts/coverage/__tests__/ingest-research.test.js
# plus any fix to scripts/coverage/ingest-research.js if the test surfaced a bug
git commit -m "test(coverage): verify idempotency and domain-match merge"
```

---

### Task 17: End-to-end tournament ingest + lifecycle create-only

**Files:**
- Modify: `scripts/coverage/__tests__/ingest-research.test.js`

- [ ] **Step 1: Write failing test**

Append to `scripts/coverage/__tests__/ingest-research.test.js`:

```javascript
test('ingest tournaments writes derived id/seriesId/year/lifecycle on create', () => {
  withTempRepo((repo) => {
    const r = runIngest([path.join(FIXTURES, 'CA-tournaments-sample.md')], { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(readFileSync(path.join(repo, 'config', 'states', 'CA', 'soccer', 'tournaments.json'), 'utf8'));
    const clover = out.tournaments.find((t) => t.id === '2026-dublin-united-clover-cup-tournament');
    assert.equal(clover.seriesId, 'dublin-united-clover-cup-tournament');
    assert.equal(clover.year, 2026);
    assert.equal(clover.lifecycle, 'upcoming');

    const calCup = out.tournaments.find((t) => t.id === 'california-cup');
    assert.equal(calCup.seriesId, 'california-cup');
    assert.equal(calCup.year, 2026);
  });
});

test('ingest drops malformed startDate field but keeps row', () => {
  withTempRepo((repo) => {
    const r = runIngest([path.join(FIXTURES, 'CA-tournaments-sample.md')], { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(readFileSync(path.join(repo, 'config', 'states', 'CA', 'volleyball', 'tournaments.json'), 'utf8'));
    const bad = out.tournaments.find((t) => t.name === 'SoCal Cup: 14/13 Tourney 3');
    assert.ok(bad, 'row with bad startDate should still be ingested');
    assert.equal(bad.startDate, undefined);
    assert.equal(bad.endDate, '2026-04-11');
    assert.equal(bad.year, null);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:coverage`
Expected: PASS (the mapper + merge already produce these outputs; this test confirms end-to-end behavior).

- [ ] **Step 3: Commit**

```bash
git add scripts/coverage/__tests__/ingest-research.test.js
git commit -m "test(coverage): verify tournament derived fields and malformed-date handling"
```

---

### Task 18: Smoke-test against real CA research files

**Files:**
- No code changes

- [ ] **Step 1: Dry-run on the real CA leagues file (vault)**

Run:

```bash
cd /private/tmp/teams-united-league-service
node scripts/coverage/ingest-research.js \
  "/Users/prcummins/Desktop/Obsidian/Machine/Research Results/coverage/CA-leagues.md" \
  --dry-run
```

Expected: exit 0, per-sport counts for each of the 8 sports printed. Any warnings recorded in the terminal output belong to research-data fuzz (acceptable) — none should indicate parser crashes.

- [ ] **Step 2: Dry-run on the real CA tournaments file (vault)**

Run:

```bash
node scripts/coverage/ingest-research.js \
  "/Users/prcummins/Desktop/Obsidian/Machine/Research Results/coverage/CA-tournaments.md" \
  --dry-run
```

Expected: exit 0, per-sport counts printed for soccer(40), baseball(30), softball(20), basketball(25), football(10), hockey(10), lacrosse(15), volleyball(20) per the research audit. Values may differ by ±1 due to a known duplicate row in volleyball; flag for the reviewer but do not fail the task.

- [ ] **Step 3: Capture output to the plan thread**

Copy the two stdout blocks into the task's note/comment trail so a reviewer sees real-file counts. No commit needed — this is a verification step.

---

### Task 19: Remove dead code + docs update

**Files:**
- Modify: `scripts/coverage/ingest-research.js` (remove any old helpers that ended up unused)
- Create/modify: `scripts/coverage/README.md` (if one exists) with a V2 usage block

- [ ] **Step 1: Grep for stale references**

Run:

```bash
cd /private/tmp/teams-united-league-service
grep -nE "frontmatter|extractChangelog|renderCoverageDoc|templatePath\(|coveragePath\(|LEAGUE_COLUMNS[^_]" scripts/coverage/ingest-research.js
```

Expected: empty output. Any hits are dead code left from Task 13-15 and must be removed.

- [ ] **Step 2: Verify regen-coverage still runs**

Run:

```bash
node scripts/coverage/regen-coverage.js --help 2>&1 | head -5 || true
node -e "require('./scripts/coverage/regen-coverage.js')" 2>&1 | head -5 || true
```

Expected: either the script prints help/runs to completion on its own, or it errors on missing CLI args but does not throw on `require()`-time symbol lookup (confirming our lib.js changes didn't break its imports).

- [ ] **Step 3: Update or create `scripts/coverage/README.md`**

If `scripts/coverage/README.md` exists, replace its "Ingest" section with:

````markdown
## Ingesting research

v2 research files arrive as two per state (`CA-leagues.md`, `CA-tournaments.md`).
Run once per file:

```bash
node scripts/coverage/ingest-research.js CA-leagues.md
node scripts/coverage/ingest-research.js CA-tournaments.md
```

Filename convention `<STATE>-<kind>.md` auto-resolves state and kind. Use
`--state` / `--kind` flags to override. `--dry-run` prints the plan without
writing JSON.

Row merge behavior:
- Existing rows matched by `id` or `website` domain; existing fields always win.
- For tournaments: `lifecycle` is set to `upcoming` on create only; ingest never
  overwrites `lifecycle`, `lastChecked`, `lastHttpStatus`, `consecutiveFailures`,
  `movedTo`, or `missingSince` on existing rows.
- Ingest is idempotent: re-running on the same input is a no-op.
````

If no README exists, create one with just the above section.

- [ ] **Step 4: Commit**

```bash
git add scripts/coverage/README.md scripts/coverage/ingest-research.js
git commit -m "docs(coverage): document v2 ingest workflow and invariants"
```

---

### Task 20: Final verification

**Files:**
- No changes

- [ ] **Step 1: Run full test suite**

Run: `cd /private/tmp/teams-united-league-service && npm run test:coverage`

Expected: all tests pass, exit 0.

- [ ] **Step 2: Verify the existing non-coverage test script is untouched**

Run: `npm test || true`

Expected: whatever the existing `test-adapters.js` does (may pass, may fail for reasons unrelated to this plan). The only requirement: our changes did not break this script's invocation path. If `test-adapters.js` errors with a message about something we changed in `lib.js`, fix it; otherwise leave alone.

- [ ] **Step 3: Verify branch is ready for PR**

Run:

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Expected output includes commits from Tasks 1–19 and touches only: `scripts/coverage/lib.js`, `scripts/coverage/mappers.js`, `scripts/coverage/ingest-research.js`, `scripts/coverage/__tests__/**`, `scripts/coverage/__fixtures__/CA-{leagues,tournaments}-sample.md`, `scripts/coverage/README.md`, `package.json`, `docs/superpowers/specs/**`, `docs/superpowers/plans/**`.

No changes to `scripts/coverage/regen-coverage.js`, `push-to-firestore.js`, `config/states/**`, or any other file.

- [ ] **Step 4: Report**

Report back: all tests passing, branch ready for PR (`claude/coverage-ingest-v2`). Next step is running the driver against the four new states (WA/ID/MT/OR) once their research files land and opening a PR for review.

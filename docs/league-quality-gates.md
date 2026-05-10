# League Quality Gates and Safe Collection Ops

Updated: 2026-05-02

Purpose: keep public TeamsUnited league surfaces limited to leagues that actually work, while separating source intelligence/backlog rows from site-visible rows.

## Public-site rule

Do not use `status=active` as public-site eligibility.

A league is public/site eligible only when a qualified manifest or durable flag proves:

1. status is active;
2. source platform/adapter is present;
3. `getDivisions?league=<id>` returns one or more real divisions;
4. `getStandings?division=<id>` returns standings/team rows for at least one division;
5. last collection/freshness is within the accepted freshness window;
6. the row is not phantom-active, template, pending adapter/config, source-research, dormant, or deprecated.

## Safe read-only qualification

Use:

```bash
node scripts/quality/qualify-leagues-readonly.js \
  --candidates /path/to/platformed-active-candidates.csv \
  --output-dir /path/to/output \
  --concurrency 4 \
  --max-freshness-days 30
```

This script calls only:

- `getDivisions`
- `getStandings`

It never calls:

- `collectLeague`
- `collectAll`
- `publishSummaries`
- `updateSheet`

It writes only local JSON files:

- `qualified-leagues-manifest.json`
- `qualified-leagues-failures.json`

## Site filtering

The TeamsUnited web server supports fail-closed qualified filtering through environment variables:

```bash
LEAGUES_REQUIRE_QUALIFIED=1
LEAGUES_QUALITY_MANIFEST_FILE=/absolute/path/to/qualified-leagues-manifest.json
# or
LEAGUES_QUALITY_MANIFEST_URL=https://storage.googleapis.com/tu-league-dashboard/qualified-leagues-manifest.json
```

When `LEAGUES_REQUIRE_QUALIFIED=1`:

- `/api/leagues` returns only manifest-qualified or explicitly `siteEligible` / `qaQualified` leagues.
- `/api/leagues/search` returns only manifest-qualified active leagues.
- if no manifest is available, the API fails closed and returns zero leagues with `quality.mode=qualified_required_manifest_missing`.

When the env var is absent, the API remains legacy-compatible but returns `quality.mode=legacy_unqualified`, making the risk visible.

## Dashboard summary generation

`buildDashboardSnapshots` now accepts:

```js
buildDashboardSnapshots(leagues, divCounts, {
  requireQualified: true,
  qualifiedLeagueIds: new Set([...]),
});
```

This lets future `publishSummaries` / maintenance jobs write public summaries that already exclude unqualified rows.

## Functions to avoid for first-pass QA

- `collectAll`: broad active-league scan, adapter execution, Firestore writes, collection logs, summary publishing. Admin/manual-only.
- `collectLeague`: targeted but still mutating; use only after read-only QA identifies repair/backfill rows and PC approves compute/write scope.
- `getLeagues`: useful UI API but expensive for repeated QA loops because it scans divisions for counts.
- `publishSummaries`: keep scheduled/incremental; do not use as an ad hoc QA probe.
- `updateSheet`: human reporting path; not part of public-site qualification.

## Cleanup candidates not executed automatically

These require deploy/scheduler changes, so they were not performed locally:

1. Rename stale scheduler names:
   - `publish-summaries-15min` if it now runs daily.
   - `batch-activate-urls-15min` if it now runs every 6h.
2. Protect or retire deployed `collectAll` if no scheduler/job legitimately uses it.
3. Bring source for deployed-only functions back under canonical repo control before changing them:
   - `publishSummaries`
   - `qaSampler`
   - `freshnessSweeper`
   - `reclassifyPending`
   - `batchActivateUrls`
   - `tournamentSweeper`
   - `seedWorker`
   - `renderPage`
4. Convert summary publication to changed state/sport slices rather than full scans where possible.

## Verification commands

```bash
npm test -- --test-reporter=spec
```

Expected coverage includes:

- qualified league evaluator tests;
- dashboard snapshot quality-gate tests;
- existing coverage ingest tests.

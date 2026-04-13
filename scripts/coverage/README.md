# scripts/coverage

Coverage data tooling: research ingest, sweeper, reconcile.

## Ingesting research (v2)

Research files arrive as two per state: `<STATE>-leagues.md` and
`<STATE>-tournaments.md`. Each carries one markdown table per sport under
a sport heading (e.g. `## Soccer`).

Run once per file:

```bash
node scripts/coverage/ingest-research.js CA-leagues.md
node scripts/coverage/ingest-research.js CA-tournaments.md
```

Filename convention `<STATE>-<kind>.md` auto-resolves state and kind.
`--state` and `--kind` flags override. `--dry-run` prints the plan
without writing JSON.

### Output

Writes to `config/states/{STATE}/{sport}/{leagues,tournaments}.json`,
one file per sport × kind. Envelope shape:

```json
{
  "_description": "CA soccer leagues",
  "_lastUpdated": "2026-04-12",
  "leagues": [...]
}
```

### Merge behavior

- Rows are matched by `id` (primary) or `website` domain (fallback).
- Existing fields always win — incoming values only fill empty slots.
- For tournaments, these sweeper-owned fields are never overwritten:
  `lifecycle`, `lastChecked`, `lastHttpStatus`, `consecutiveFailures`,
  `movedTo`, `missingSince`.
- `lifecycle` is set to `'upcoming'` when a new tournament row is
  created; ingest never changes it on existing rows.
- Ingest is idempotent: re-running on the same input produces no diff.

### Testing

```bash
npm run test:coverage
```

Tests use Node's built-in `node:test`. Integration tests set
`TU_CONFIG_ROOT` to sandbox writes into a temp directory — see
`scripts/coverage/__tests__/ingest-research.test.js`.

### Schemas

- **Leagues** (12 fields): `id, name, level, ageGroups, gender, season,
  region, governingBody, sanctioning, website, sourceUrl, notes`.
- **Tournaments** (research fields + derived): `id, seriesId, year,
  lifecycle, name, startDate, endDate, venue, city, entryFee, teamCount,
  sourcePlatform, registrationUrl, ageGroups, gender, format, organizer,
  sanctioning, confidence, sourceUrl, notes`.

See `docs/superpowers/specs/2026-04-12-coverage-ingest-parser-v2-design.md`
for the full design.

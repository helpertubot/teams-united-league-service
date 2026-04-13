# Coverage Research Ingest Parser v2 — Design

**Date:** 2026-04-12
**Status:** Approved (brainstorming phase complete)
**Repo:** `teams-united-league-service`
**Entry points:** `scripts/coverage/ingest-research.js`, `scripts/coverage/lib.js`

## Purpose

Rewrite the repo-side research ingest parser to consume the new 2-file per-state research format — one leagues markdown, one tournaments markdown — and upsert rows into `config/states/{STATE}/{sport}/{leagues,tournaments}.json`. The old all-in-one research format is dropped.

## Context

The research pipeline evolved after the initial parser shipped:

- Research is now produced per-state as two separate files with distinct schemas (leagues-only and tournaments-only) rather than one combined file per state+sport.
- Tournament rows now carry per-edition data (`startDate`, `endDate`, `venue`, `entryFee`, `teamCount`) instead of series-level `cadence`/`hostVenues`.
- Leagues rows carry richer per-row metadata (`level`, `ageGroups`, `gender`, `season`, `governingBody`, `sanctioning`, `sourceUrl`) that were previously dropped at ingest.
- Volleyball is now in scope (8 sports, up from 7).
- The lifecycle system (`seriesId`, `year`, `lifecycle`, sweeper-owned fields) shipped 2026-04-12 and is well-aligned with per-edition tournament rows.

The existing parser (`scripts/coverage/ingest-research.js`, 300 lines + `lib.js`, 291 lines) assumes the old format and schemas. This design replaces it.

## Non-goals

- Vault-side orchestrator (folder watcher / Drive poller) — separate brainstorm.
- Coverage doc regeneration (`coverage/{STATE}/{sport}.md`) — dropped; research markdown files in the vault are the coverage record.
- Minimum row-count validation — dropped; research-quality judgment belongs with the supervisor agent or a separate audit script.
- Backward compatibility with old research files — dropped.
- Firestore sync (`push-to-firestore.js`, future `push-leagues-to-firestore.js`) — unchanged.
- Reconcile and sweeper behavior — unchanged.

## CLI

```
node scripts/coverage/ingest-research.js <path-to-research.md> \
  [--state XX] [--kind leagues|tournaments] [--dry-run]
```

- Filename convention: `<STATE>-<leagues|tournaments>.md` (e.g. `CA-leagues.md`).
- `--state` and `--kind` flags override filename inference.
- Exit 0 on success, 1 on fatal error (no resolvable state, no parseable tables).

## Architecture

### `scripts/coverage/lib.js` — updated shared helpers

Constants:

- `SPORTS` — add `volleyball`. Final list: `soccer, baseball, softball, basketball, football, hockey, lacrosse, volleyball`.
- `LEAGUE_COLUMNS_V2` — new 12-col canonical schema.
- `TOURNAMENT_COLUMNS_V2` — new 19-col canonical schema.
- `HEADER_ALIASES_V2` — maps research column names (`name`, `sport`, `startDate`, `geography`, `platform`, etc.) to canonical names.

Parsing helpers (new):

- `normalizeCell(value)` — trim, collapse internal whitespace, treat `""`, `"n/a"`, `"N/A"`, `"-"`, `"—"`, `"TBD"` as absent (returns `undefined`).
- `normalizeGender(value)` — `Both`, `Mixed`, `Coed`, `Co-ed`, `Boys and Girls` → `Boys+Girls`. Pass through otherwise.
- `stripUrlWrapper(url)` — strips `https://www.google.com/search?q=<url>` wrappers in both raw and markdown-link forms (`[url](https://www.google.com/search?q=url)` → `url`). URL-decodes the inner content.
- `normalizePlatform(value)` — extended with entries for `travelsports`, `exposureevents`, `ncs`, `usssa`, plus existing mappings.
- `slugWithoutYear(s)` — `slug()` variant that strips any 4-digit year (`/\b20\d{2}\b/`) before slugging. 2-digit years are **not** stripped (ambiguous with edition numbers).
- `parseYear(dateStr)` — parses `"YYYY-MM-DD"` and returns the 4-digit year as a number, or `null` if malformed.
- `validateDate(s)` — tests `/^\d{4}-\d{2}-\d{2}$/`.

Retained helpers (unchanged): `parseMarkdownTables`, `splitTableRow`, `rowToObject`, `slug`, `domainOf`, `readJson`, `writeJson`, `writeText`, `todayISO`, `detectSport`, path helpers.

### `scripts/coverage/ingest-research.js` — rewritten driver

Flow:

1. Parse CLI args; read file.
2. Resolve `state` and `kind` from filename (`CA-leagues.md` → state=`CA`, kind=`leagues`); flags override.
3. Parse markdown tables from the body via `parseMarkdownTables`.
4. Group tables by sport using the preceding `##` heading (`## Soccer` → `soccer`); skip tables with unrecognized sport headings (warn).
5. Normalize headers via `HEADER_ALIASES_V2`. A table is valid for its kind if the normalized headers include `name` (leagues or tournaments) plus, for tournaments, `startDate`. Missing minimum headers: table dropped with warning.
6. For each row:
   - Apply `normalizeCell` to every cell.
   - Apply domain-specific normalizers: `normalizeGender` on gender cells, `stripUrlWrapper` on all URL cells, `normalizePlatform` on platform cells.
   - Drop the row if `name` is absent (no warning — empty trailing rows are common).
   - Map to config entry via `researchLeagueToConfigV2` or `researchTournamentToConfigV2` (see mappers below).
   - Drop any output fields that are `undefined` or empty.
7. For each sport, merge incoming entries into the existing config JSON (see merge behavior).
8. Write JSON (or log dry-run plan).
9. Print per-sport counts: `[CA/soccer] leagues: +N new, M merged → T total`.

### Mappers

**`researchLeagueToConfigV2(row)`** — output shape:

```js
{
  id: slug(row.name),
  name: row.name,
  level: row.level,
  ageGroups: row.ageGroups,
  gender: normalizeGender(row.gender),
  season: row.season,
  region: row.geography,                       // renamed
  governingBody: row.governingBody,
  sanctioning: row.sanctioning,
  website: stripUrlWrapper(row.website),
  sourceUrl: stripUrlWrapper(row.sourceUrl),
  notes: row.notes
}
```

Strip `undefined`/empty fields from the output.

**`researchTournamentToConfigV2(row)`** — output shape:

```js
{
  id: slug(row.name),                          // includes year
  seriesId: slugWithoutYear(row.name),         // year stripped
  year: parseYear(row.startDate),
  lifecycle: 'upcoming',                       // set on create only
  name: row.name,
  startDate: row.startDate,                    // validated
  endDate: row.endDate,                        // validated
  venue: row.venue,
  city: row.city,
  entryFee: row.entryFee,
  teamCount: row.teamCount,
  sourcePlatform: normalizePlatform(row.platform),
  registrationUrl: stripUrlWrapper(row.registrationUrl),
  ageGroups: row.ageGroups,
  gender: normalizeGender(row.gender),
  format: row.format,
  organizer: row.organizer,
  sanctioning: row.sanctioning,
  confidence: row.confidence,
  sourceUrl: stripUrlWrapper(row.sourceUrl),
  notes: row.notes
}
```

Date validation: if `startDate` or `endDate` fails `validateDate`, drop that field (not the row) and warn. Sweeper-owned fields (`lastChecked`, `lastHttpStatus`, `consecutiveFailures`, `movedTo`, `missingSince`) are never written by ingest.

### Merge behavior

For each sport, load existing `{leagues,tournaments}.json` (create default envelope if absent):

```js
{ _description, _lastUpdated, leagues|tournaments: [...] }
```

Match each incoming row against the existing list by:

1. `id` equality, or
2. `domainOf(website)` equality (fallback).

If no match: append as a new row.

If matched: fill fields on the existing row only where the existing value is `undefined` / `null` / `""`. **Existing fields always win.**

Ingest never overwrites these tournament fields on an existing row: `lifecycle`, `lastChecked`, `lastHttpStatus`, `consecutiveFailures`, `movedTo`, `missingSince`. `lifecycle` is only set (`'upcoming'`) when a tournament row is created.

`seriesId` match alone does not trigger merge — different editions of the same series are separate rows, distinguished by `id` (which includes year).

## Data flow

```
  CA-leagues.md      CA-tournaments.md
      │                      │
      └──────────┬───────────┘
                 ▼
         parseMarkdownTables
                 │
                 ▼
       per-sport row groups
                 │
                 ▼
        normalizeCell + domain
        normalizers per field
                 │
                 ▼
          mapper (v2)
                 │
                 ▼
     incoming config entries
                 │
                 ▼
  existing JSON ─┴── mergeList (id | domain)
                     │
                     ▼
     config/states/XX/{sport}/{leagues|tournaments}.json
```

## Error handling

| Condition | Behavior |
|---|---|
| Missing `name` on row | Row dropped silently (empty-row tolerance) |
| Unknown sport on table heading | Table dropped, `console.warn` |
| Required columns missing for kind | Table dropped, `console.warn` |
| Malformed `startDate` / `endDate` | Field dropped, row kept, `console.warn` |
| No parseable tables in file | Exit 1 with error |
| Unresolvable state | Exit 1 with error |
| JSON write failure | Exit non-zero with stack (fail loud) |

Warnings go to stderr; stdout carries the final per-sport row-count summary.

## Testing

Fixtures under `scripts/coverage/__fixtures__/`:

- `CA-leagues-sample.md` — trimmed copy of real research file (one or two sports, ~5 rows each, covering all normalization cases).
- `CA-tournaments-sample.md` — same shape, tournament format.
- `CA-leagues-expected.json`, `CA-tournaments-expected.json` — per-sport snapshot files or a combined fixture directory.

Test coverage (TDD, each as its own test case):

**Unit — normalizers:**

- `normalizeCell` — all absent-sentinels return `undefined`; real values round-trip with whitespace collapsed.
- `normalizeGender` — every alias listed maps to `Boys+Girls`; unknowns pass through.
- `stripUrlWrapper` — raw and markdown-link forms of `google.com/search?q=` are stripped; non-wrapped URLs pass through; URL-encoded inner content is decoded.
- `slugWithoutYear` — `"2026 Dublin United Clover Cup"` → `dublin-united-clover-cup`; `"24 Hour Showdown"` → `24-hour-showdown` (2-digit kept); `"Spring Rose Classic 2026"` → `spring-rose-classic`.
- `parseYear` — `"2026-03-14"` → `2026`; `"garbage"` → `null`.
- `validateDate` — accepts valid ISO, rejects others.

**Unit — mappers:**

- `researchLeagueToConfigV2` on a full 12-col row produces the expected 12-field entry, with empty cells omitted.
- `researchTournamentToConfigV2` on a full 19-col row produces the expected entry with derived `id`, `seriesId`, `year`, `lifecycle: 'upcoming'`.
- Tournament row with malformed `startDate` still produces a row; `year` is `null`, bad date field omitted, warning emitted.

**Integration — end-to-end:**

- Run ingest against `CA-leagues-sample.md` on an empty config; diff output JSON against expected snapshot.
- Run ingest against `CA-tournaments-sample.md` on an empty config; diff output JSON against expected snapshot.
- **Idempotency:** run ingest twice on empty config; second run produces zero diff and logs `0 new, 0 merged`.
- **Existing-fields-win:** run ingest against a config pre-populated with a row whose `id` matches an incoming row but has hand-curated `notes`; output retains the existing `notes`, fills any other empty fields.
- **Sticky fields preserved:** run ingest against a tournament config row with `lifecycle: 'stale'`, `lastChecked: ...`; output retains those fields unchanged.
- **Domain-match merge:** run ingest with an incoming row whose `name` differs from existing but `website` domain matches; merges into existing row.

Test runner: Node's built-in `node:test` (no dep install required; repo already targets Node 20+ per `package.json` `engines`). Tests live under `scripts/coverage/__tests__/` and run via `node --test scripts/coverage/__tests__/`. A new `"test:coverage"` script in `package.json` wires this up without touching the existing `"test"` script (`test-adapters.js`).

## Schema reference

**Leagues JSON entry (12 fields):**

```
{ id, name, level, ageGroups, gender, season, region,
  governingBody, sanctioning, website, sourceUrl, notes }
```

**Tournaments JSON entry (19 research fields + 4 derived; lifecycle fields untouched by ingest):**

```
{ id, seriesId, year, lifecycle,
  name, startDate, endDate, venue, city, entryFee, teamCount,
  sourcePlatform, registrationUrl, ageGroups, gender, format,
  organizer, sanctioning, confidence, sourceUrl, notes,
  lastChecked?, lastHttpStatus?, consecutiveFailures?, movedTo?, missingSince? }
```

## Open questions

None at design time. Revisit during implementation planning if any test case surfaces a genuine ambiguity.

## References

- `.claude/projects/.../memory/project_coverage_ingest_pipeline.md` — pipeline context and schema decisions
- `.claude/projects/.../memory/project_tournament_lifecycle_sweeper.md` — lifecycle fields, sweeper ownership, invariants
- `Machine/Research Results/coverage/CA-leagues.md` — reference input for leagues fixture
- `Machine/Research Results/coverage/CA-tournaments.md` — reference input for tournaments fixture

# Coverage System

Per-combo living state-of-the-union docs for every `{STATE} x {sport}` we support.

## What it is

`coverage/{STATE}/{sport}.md` is the canonical, human-readable snapshot of what
leagues and tournament series we know about for a given state + sport. It is:

- **Seeded** from Claude Research output via `scripts/coverage/ingest-research.js`.
- **Maintained** by agents and scripts that change the config (discovery, season
  monitor, activation scripts, Tier-2/Dev/Eng agents) via
  `scripts/coverage/regen-coverage.js`.
- **Source of truth for research-only fields** (Confidence, Contact, Notes,
  Registration URL, Est. # Teams, Season(s), Sanctioning Body, etc.) that are
  NOT tracked in `config/states/...` or Firestore.
- **Reconciled with git config** (`config/states/{STATE}/{sport}/leagues.json`,
  `.../tournaments.json`) which is authoritative for the active-league set,
  platform mapping, and source config fields.

## Naming convention

```
coverage/{STATE}/{sport}.md
```

`{STATE}` is the two-letter upper-case postal code. `{sport}` is lower-case
(e.g. `soccer`, `baseball`, `softball`, `basketball`, `lacrosse`, `hockey`).

## Mandatory rule

If leagues or tournaments change for state X sport Y — activation, dormanting,
deactivation, rename, platform change, new league registered, tournament added
or dropped — the commit that changes the config MUST also regenerate and
include the updated `coverage/X/Y.md`:

```
node scripts/coverage/regen-coverage.js --state X --sport Y --source <agent-or-script-name>
```

This rule is mirrored in the top-level `CLAUDE.md` under "Coverage System" and
applies to Tier-2, Dev, Eng, Discovery, and Tournament agents — and to any
human-run maintenance script.

## Lifecycle

1. **Seed** — Run Claude Research for a state × sport combo, drop the markdown
   output anywhere, then:
   ```
   node scripts/coverage/ingest-research.js path/to/research.md
   ```
   This merges leagues + tournaments into `config/states/...` and writes the
   coverage doc.

2. **Maintain** — Any agent/script that mutates the league or tournament set
   for a combo runs `regen-coverage.js` before committing.

3. **Evolve** — Re-ingesting a refreshed research file is idempotent and will
   merge new info without dropping existing leagues.

## Files

- `_template.md` — canonical template rendered by ingest + regen scripts.
- `{STATE}/` — directory per Phase-1 state.
- `{STATE}/{sport}.md` — the living doc.

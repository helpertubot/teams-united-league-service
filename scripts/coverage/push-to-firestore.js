#!/usr/bin/env node
/**
 * Push config/states/*​/*​/tournaments.json → Firestore `tournaments`
 * collection via the `importTournament` Cloud Function.
 *
 * Usage:
 *   node scripts/coverage/push-to-firestore.js [--state XX] [--sport yyy]
 *                                              [--endpoint URL] [--dry-run]
 *
 * Behavior:
 *   - Walks config/states/{STATE}/{sport}/tournaments.json (filter by flags).
 *   - POSTs batches to importTournament with the FULL JSON object passed
 *     through (no field allow-listing — the Cloud Function decides what to
 *     keep). This way new fields added in the ingest parser flow to
 *     Firestore automatically.
 *   - Idempotent: importTournament uses `doc.set(..., { merge: true })`,
 *     so re-runs UPD matching docs instead of duplicating.
 *
 * Env:
 *   TU_FUNCTIONS_BASE  override default CF region/project URL
 *                      (default: https://us-central1-teams-united.cloudfunctions.net)
 */

const fs = require('fs');
const path = require('path');
const L = require('./lib');

function parseArgs(argv) {
  const out = { flags: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out.flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out.flags[a.slice(2)] = argv[++i];
    } else {
      out.flags[a.slice(2)] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const DRY = !!args.flags['dry-run'];
const filterState = args.flags.state ? String(args.flags.state).toUpperCase() : null;
const filterSport = args.flags.sport ? String(args.flags.sport).toLowerCase() : null;
const BASE = args.flags.endpoint
  || process.env.TU_FUNCTIONS_BASE
  || 'https://us-central1-teams-united.cloudfunctions.net';
const ENDPOINT = `${BASE.replace(/\/$/, '')}/importTournament`;

function listTournamentFiles() {
  const root = path.join(L.REPO_ROOT, 'config', 'states');
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const state of fs.readdirSync(root)) {
    if (filterState && state !== filterState) continue;
    const stateDir = path.join(root, state);
    if (!fs.statSync(stateDir).isDirectory()) continue;
    for (const sport of fs.readdirSync(stateDir)) {
      if (filterSport && sport !== filterSport) continue;
      const file = path.join(stateDir, sport, 'tournaments.json');
      if (fs.existsSync(file)) files.push({ state, sport, file });
    }
  }
  return files;
}

async function postBatch(tournaments) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tournaments })
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return body;
}

(async () => {
  const targets = listTournamentFiles();
  if (!targets.length) {
    console.error('no tournaments.json files found for filter');
    process.exit(1);
  }

  console.log(`endpoint: ${ENDPOINT}`);
  console.log(`targets:  ${targets.length} file(s)${DRY ? ' (dry-run)' : ''}`);

  let totalPushed = 0;
  let totalFiles = 0;

  for (const { state, sport, file } of targets) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(raw.tournaments) ? raw.tournaments : [];
    if (!list.length) {
      console.log(`[${state}/${sport}] empty, skipping`);
      continue;
    }

    // Tournament IDs come from ingest (scripts/coverage/ingest-research.js).
    // push-to-firestore is pass-through only — never mutate IDs here.
    // (Earlier versions prefixed `${state}-${sport}-` to the slug, which
    // drifted from the ingest-generated IDs and produced duplicate docs in
    // Firestore. Standardized on: use `tournament.id` verbatim.)
    // Pass through the JSON as-is, only backfilling state/sport when the
    // stored record omits them (older entries predated schema enrichment).
    const payload = list.map((t) => ({
      ...t,
      state: t.state || state,
      sport: (t.sport || sport || '').toLowerCase()
    }));

    console.log(`[${state}/${sport}] pushing ${payload.length} tournaments…`);
    if (DRY) {
      console.log(`  (dry-run) sample:`, JSON.stringify(payload[0], null, 2));
      totalPushed += payload.length;
      totalFiles++;
      continue;
    }
    try {
      const result = await postBatch(payload);
      console.log(`  → imported ${result.imported}/${result.total}`);
      totalPushed += result.imported || 0;
      totalFiles++;
    } catch (err) {
      console.error(`  ! failed: ${err.message}`);
      process.exitCode = 2;
    }
  }

  console.log(`\ndone. files: ${totalFiles}, tournaments pushed: ${totalPushed}`);
})();

#!/usr/bin/env node
/**
 * reconcile-tournaments — recompute lifecycle from dates.
 *
 * Scope: all tournament rows for a state (optionally narrowed to one sport).
 * - Never deletes rows.
 * - Never demotes sticky states (stale / moved / missing-from-research).
 * - Writes a per-run report to Machine-equivalent log on stdout + JSON file.
 *
 * Usage:
 *   node scripts/coverage/reconcile-tournaments.js --state CA
 *   node scripts/coverage/reconcile-tournaments.js --state ID --sport soccer
 *   node scripts/coverage/reconcile-tournaments.js --state CA --dry-run
 */

const fs = require('fs');
const path = require('path');
const L = require('./lib');

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args.flags[key] = next; i++; }
      else args.flags[key] = true;
    } else args.positional.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const state = args.flags.state;
const sportFilter = args.flags.sport || null;
const dryRun = !!args.flags['dry-run'];

if (!state) {
  console.error('Usage: reconcile-tournaments.js --state XX [--sport YY] [--dry-run]');
  process.exit(1);
}

const sports = sportFilter ? [sportFilter] : L.SPORTS;
const now = L.todayISO();
const report = { state, ranAt: now, dryRun, sports: {} };

for (const sport of sports) {
  const p = L.configTournamentsPath(state, sport);
  if (!fs.existsSync(p)) continue;
  const data = L.readJson(p);
  if (!data || !Array.isArray(data.tournaments)) continue;

  const before = JSON.stringify(data.tournaments);
  const changes = [];
  const updated = data.tournaments.map((row) => {
    const next = L.applyTournamentSchemaDefaults(row);
    const derived = L.deriveLifecycle(next, now);
    if (next.lifecycle !== derived) {
      changes.push({ id: next.id, from: next.lifecycle || '(unset)', to: derived });
      next.lifecycle = derived;
    }
    return next;
  });

  const afterStr = JSON.stringify(updated);
  if (afterStr !== before) {
    data.tournaments = updated;
    data._lastUpdated = now;
    if (!dryRun) L.writeJson(p, data);
  }

  report.sports[sport] = {
    total: updated.length,
    changed: changes.length,
    changes
  };
  console.log(`[${state}/${sport}] total=${updated.length} changed=${changes.length}` + (dryRun ? ' (dry-run)' : ''));
  for (const c of changes) console.log(`  ${c.id}: ${c.from} -> ${c.to}`);
}

// Report file alongside other coverage outputs in Machine/Outputs — but this
// repo has no Machine dir, so write to scripts/coverage/_reports/.
const reportDir = path.join(L.REPO_ROOT, 'scripts', 'coverage', '_reports');
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `reconcile-${state}-${now}.json`);
if (!dryRun) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport: ${dryRun ? '(dry-run, not written)' : reportPath}`);

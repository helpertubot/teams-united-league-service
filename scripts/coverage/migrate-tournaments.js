#!/usr/bin/env node
/**
 * One-shot migration: backfill schema defaults on every tournament row.
 *
 * Walks config/states/**\/tournaments.json, applies
 * applyTournamentSchemaDefaults() to every row (idempotent), writes back.
 *
 * Safe to re-run. No deletions. No lifecycle demotion.
 *
 * Usage:
 *   node scripts/coverage/migrate-tournaments.js
 *   node scripts/coverage/migrate-tournaments.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const L = require('./lib');

const dryRun = process.argv.includes('--dry-run');
const statesDir = path.join(L.REPO_ROOT, 'config', 'states');

if (!fs.existsSync(statesDir)) {
  console.error(`No states dir at ${statesDir}`);
  process.exit(1);
}

let touchedFiles = 0;
let touchedRows = 0;
const now = L.todayISO();

for (const state of fs.readdirSync(statesDir).sort()) {
  const stateDir = path.join(statesDir, state);
  if (!fs.statSync(stateDir).isDirectory()) continue;
  for (const sport of fs.readdirSync(stateDir).sort()) {
    const p = path.join(stateDir, sport, 'tournaments.json');
    if (!fs.existsSync(p)) continue;
    const data = L.readJson(p);
    if (!data || !Array.isArray(data.tournaments)) continue;

    let changedInFile = 0;
    const updated = data.tournaments.map((row) => {
      const next = L.applyTournamentSchemaDefaults(row);
      if (JSON.stringify(next) !== JSON.stringify(row)) changedInFile++;
      return next;
    });

    if (changedInFile > 0) {
      data.tournaments = updated;
      data._lastUpdated = now;
      if (!dryRun) L.writeJson(p, data);
      touchedFiles++;
      touchedRows += changedInFile;
      console.log(`${state}/${sport}: ${changedInFile} rows backfilled` + (dryRun ? ' (dry-run)' : ''));
    }
  }
}

console.log(`\n${touchedFiles} files, ${touchedRows} rows${dryRun ? ' (dry-run, nothing written)' : ''}`);

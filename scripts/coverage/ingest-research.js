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

// Tasks 15+ will add merge + write. For now emit per-sport counts.
for (const [sport, entries] of Object.entries(bySport)) {
  console.log(`[${state}/${sport}] ${kind}: +${entries.length} new, 0 merged → ${entries.length} total`);
}
process.exit(0);

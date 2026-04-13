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

// Placeholder output so arg-parsing tests pass. Tasks 14+ replace this.
console.log(`[${state}/soccer] ${kind}: +0 new, 0 merged → 0 total`);
process.exit(0);

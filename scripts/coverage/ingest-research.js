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
      // Intentionally NOT adding to byDomain: domain-match is only against
      // pre-existing rows from disk, so multiple incoming rows that share a
      // domain but have distinct ids each get appended.
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
  const envelopeKey = kind;
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
process.exit(0);

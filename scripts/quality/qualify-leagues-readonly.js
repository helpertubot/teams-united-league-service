#!/usr/bin/env node
'use strict';

/**
 * Read-only TeamsUnited league qualifier.
 *
 * Calls only getDivisions/getStandings; never collectLeague/collectAll and never
 * writes Firestore/GCS. Intended input is a candidate JSON/CSV produced by the
 * national audit/control-board layer.
 */

const fs = require('fs/promises');
const path = require('path');
const {
  evaluateLeagueQuality,
  buildQualifiedManifest,
  normalizeDivisionsPayload,
} = require('./qualified-leagues');

const DEFAULT_DIVISIONS_URL = 'https://us-central1-teams-united.cloudfunctions.net/getDivisions';
const DEFAULT_STANDINGS_URL = 'https://us-central1-teams-united.cloudfunctions.net/getStandings';

function parseArgs(argv) {
  const args = {
    candidates: null,
    outputDir: path.join(process.cwd(), 'quality-output'),
    limit: null,
    concurrency: 4,
    maxFreshnessDays: 30,
    divisionsUrl: process.env.GCP_GET_DIVISIONS_URL || DEFAULT_DIVISIONS_URL,
    standingsUrl: process.env.GCP_GET_STANDINGS_URL || DEFAULT_STANDINGS_URL,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--candidates') { args.candidates = value; i += 1; }
    else if (key === '--output-dir') { args.outputDir = value; i += 1; }
    else if (key === '--limit') { args.limit = Number(value); i += 1; }
    else if (key === '--concurrency') { args.concurrency = Number(value); i += 1; }
    else if (key === '--max-freshness-days') { args.maxFreshnessDays = Number(value); i += 1; }
    else if (key === '--divisions-url') { args.divisionsUrl = value; i += 1; }
    else if (key === '--standings-url') { args.standingsUrl = value; i += 1; }
    else if (key === '--help') { args.help = true; }
  }
  return args;
}

function usage() {
  return `Usage: node scripts/quality/qualify-leagues-readonly.js --candidates <file> [--output-dir <dir>] [--limit N] [--concurrency N]\n\nNo writes. No collectLeague. No collectAll. Calls only getDivisions/getStandings.`;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { values.push(cur); cur = ''; }
      else cur += ch;
    }
    values.push(cur);
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    return row;
  });
}

async function loadCandidates(file) {
  const text = await fs.readFile(file, 'utf8');
  if (/\.json$/i.test(file)) {
    const parsed = JSON.parse(text);
    return parsed.leagues || parsed.candidates || parsed.rows || parsed;
  }
  return parseCsv(text);
}

async function fetchJson(url, params) {
  const qs = new URLSearchParams(params);
  const full = `${url}?${qs.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(full, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeLeague(row) {
  return {
    id: row.id || row.leagueId || row.queue_id || row.firestore_id,
    name: row.name || row.leagueName || row.league_name || row.customer_name,
    sport: row.sport,
    state: row.state,
    status: row.status || row.league_status,
    sourcePlatform: row.sourcePlatform || row.platform || row.source_platform,
    sourceUrl: row.sourceUrl || row.source_url,
    divisionCount: Number(row.divisionCount || row.division_count || 0),
    lastCollected: row.lastCollected || row.last_collected,
    lastDataChange: row.lastDataChange || row.last_data_change,
  };
}

function evaluatePreflight(league) {
  const status = String(league.status || '').toLowerCase();
  if (status && status !== 'active') {
    return evaluateLeagueQuality({ league, divisionsPayload: [], now: new Date() });
  }
  if (!(league.sourcePlatform || league.platform || league.adapter)) {
    return evaluateLeagueQuality({ league, divisionsPayload: [], now: new Date() });
  }
  return null;
}

async function evaluateRemote(league, args) {
  const leagueId = league.id;
  const preflight = evaluatePreflight(league);
  if (preflight) return preflight;
  if (!leagueId) {
    return {
      leagueId: '',
      leagueName: league.name || '',
      qualified: false,
      reason: 'missing_league_id',
      divisionCount: 0,
      standingsTeamCount: 0,
      checkedAt: new Date().toISOString(),
    };
  }
  try {
    const divisionsPayload = await fetchJson(args.divisionsUrl, { league: leagueId });
    const divisions = normalizeDivisionsPayload(divisionsPayload);
    const standingsByDivision = {};
    await mapLimit(divisions, 3, async (division) => {
      if (!division?.id) return;
      try {
        standingsByDivision[division.id] = await fetchJson(args.standingsUrl, { division: division.id });
      } catch (err) {
        standingsByDivision[division.id] = { standings: [], error: err.message };
      }
    });
    return evaluateLeagueQuality({
      league,
      divisionsPayload,
      standingsByDivision,
      now: new Date(),
      maxFreshnessDays: args.maxFreshnessDays,
    });
  } catch (err) {
    return {
      leagueId,
      leagueName: league.name || leagueId,
      sport: league.sport || null,
      state: league.state || null,
      platform: league.sourcePlatform || null,
      status: league.status || null,
      qualified: false,
      reason: 'read_api_error',
      error: err.message,
      divisionCount: 0,
      standingsTeamCount: 0,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.candidates) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const rows = await loadCandidates(args.candidates);
  let leagues = rows.map(normalizeLeague).filter((l) => l.id);
  if (args.limit) leagues = leagues.slice(0, args.limit);

  console.log(`Read-only qualifying ${leagues.length} leagues with concurrency=${args.concurrency}`);
  console.log('Endpoints: getDivisions/getStandings only; no collectLeague/collectAll; no writes.');

  const evaluations = await mapLimit(leagues, args.concurrency, (league, idx) => {
    if ((idx + 1) % 25 === 0) console.log(`  checked ${idx + 1}/${leagues.length}`);
    return evaluateRemote(league, args);
  });

  const generatedAt = new Date().toISOString();
  const manifest = buildQualifiedManifest(evaluations, {
    generatedAt,
    mode: 'read_only_getDivisions_getStandings',
    maxFreshnessDays: args.maxFreshnessDays,
  });

  await fs.mkdir(args.outputDir, { recursive: true });
  const manifestPath = path.join(args.outputDir, 'qualified-leagues-manifest.json');
  const failuresPath = path.join(args.outputDir, 'qualified-leagues-failures.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await fs.writeFile(failuresPath, JSON.stringify(manifest.failures, null, 2));

  console.log(`Qualified: ${manifest.counts.qualified}/${manifest.counts.checked}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Failures: ${failuresPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

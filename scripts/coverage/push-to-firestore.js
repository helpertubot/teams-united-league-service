#!/usr/bin/env node
/**
 * push-to-firestore.js
 *
 * Walks config/states/<STATE>/<SPORT>/tournaments.json and POSTs each
 * tournament to the importTournament Cloud Function, upserting by a
 * stable ID derived from state+sport+slug(name).
 *
 * Usage:
 *   node scripts/coverage/push-to-firestore.js [--state ID] [--sport soccer] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CF_BASE = 'https://us-central1-teams-united.cloudfunctions.net';
const IMPORT_URL = `${CF_BASE}/importTournament`;
const LIST_URL = `${CF_BASE}/getTournaments`;

function parseArgs(argv) {
  const args = { state: null, sport: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--state') args.state = argv[++i];
    else if (a === '--sport') args.sport = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: push-to-firestore.js [--state ID] [--sport soccer] [--dry-run]');
      process.exit(0);
    }
  }
  return args;
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function stableId(state, sport, name, rawId) {
  const base = rawId || name;
  // Prefix with state+sport to guarantee uniqueness across states/sports.
  return `${state.toLowerCase()}-${sport.toLowerCase()}-${slugify(base)}`;
}

function walkTournamentFiles(rootDir, { state, sport } = {}) {
  const out = [];
  const statesDir = path.join(rootDir, 'config', 'states');
  if (!fs.existsSync(statesDir)) return out;
  for (const stateName of fs.readdirSync(statesDir)) {
    if (state && stateName.toUpperCase() !== state.toUpperCase()) continue;
    const stateDir = path.join(statesDir, stateName);
    if (!fs.statSync(stateDir).isDirectory()) continue;
    for (const sportName of fs.readdirSync(stateDir)) {
      if (sport && sportName.toLowerCase() !== sport.toLowerCase()) continue;
      const sportDir = path.join(stateDir, sportName);
      if (!fs.statSync(sportDir).isDirectory()) continue;
      const file = path.join(sportDir, 'tournaments.json');
      if (fs.existsSync(file)) {
        out.push({ state: stateName, sport: sportName, file });
      }
    }
  }
  return out;
}

function loadTournaments({ state, sport, file }) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.tournaments || [];
  return list.map(t => {
    const id = stableId(state, sport, t.name, t.id);
    return {
      ...t,
      id,
      name: t.name,
      sport: sport.toLowerCase(),
      state: state.toUpperCase(),
      // Preserve source fields
      sourcePlatform: t.sourcePlatform || '',
      // Map hostVenues -> venue if venue not set
      venue: t.venue || t.hostVenues || '',
      city: t.city || t.region || '',
      recurring: t.recurring || t.cadence || 'unknown',
      sourceUrl: t.sourceUrl || t.website || '',
      notes: t.notes || '',
    };
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, body }); }
      });
    }).on('error', reject);
  });
}

function httpPost(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getExistingIdsForState(state) {
  const url = `${LIST_URL}?state=${encodeURIComponent(state)}&upcoming=false`;
  const { status, body } = await httpGet(url);
  if (status !== 200 || !body || !Array.isArray(body.tournaments)) return new Set();
  return new Set(body.tournaments.map(t => t.id));
}

async function main() {
  const args = parseArgs(process.argv);
  const rootDir = path.resolve(__dirname, '..', '..');

  const files = walkTournamentFiles(rootDir, args);
  if (files.length === 0) {
    console.log('No tournaments.json files matched filters.');
    return;
  }

  // Preload existing IDs per state to classify new vs updated.
  const existingByState = new Map();
  if (!args.dryRun) {
    const statesToFetch = new Set(files.map(f => f.state));
    for (const st of statesToFetch) {
      existingByState.set(st, await getExistingIdsForState(st));
    }
  }

  let totalNew = 0, totalUpdated = 0, totalSkipped = 0, totalSynced = 0;
  const perSport = {}; // key = `${state}/${sport}`

  for (const entry of files) {
    const tournaments = loadTournaments(entry);
    const key = `${entry.state}/${entry.sport}`;
    perSport[key] = perSport[key] || { new: 0, updated: 0, skipped: 0 };

    if (tournaments.length === 0) {
      console.log(`[skip] ${entry.file} — empty`);
      continue;
    }

    console.log(`\n[${entry.state}/${entry.sport}] ${tournaments.length} tournament(s) from ${path.relative(rootDir, entry.file)}`);

    if (args.dryRun) {
      for (const t of tournaments) {
        console.log(`  DRY  ${t.id}  ::  ${t.name}`);
        perSport[key].new++;
        totalNew++;
      }
      continue;
    }

    const existing = existingByState.get(entry.state) || new Set();

    // Batch post all for this file
    const resp = await httpPost(IMPORT_URL, { tournaments });
    if (resp.status !== 200) {
      console.error(`  ERROR ${resp.status}:`, resp.body);
      perSport[key].skipped += tournaments.length;
      totalSkipped += tournaments.length;
      continue;
    }

    for (const t of tournaments) {
      if (existing.has(t.id)) {
        perSport[key].updated++;
        totalUpdated++;
        console.log(`  UPD  ${t.id}`);
      } else {
        perSport[key].new++;
        totalNew++;
        console.log(`  NEW  ${t.id}`);
      }
      totalSynced++;
    }
  }

  console.log('\n====== SUMMARY ======');
  for (const key of Object.keys(perSport).sort()) {
    const p = perSport[key];
    console.log(`  ${key}: ${p.new} new, ${p.updated} updated, ${p.skipped} skipped`);
  }
  if (args.dryRun) {
    console.log(`\nDRY RUN: would sync ${totalNew} tournaments across ${files.length} file(s). No writes made.`);
  } else {
    console.log(`\nSynced ${totalSynced} tournaments (${totalNew} new, ${totalUpdated} updated, ${totalSkipped} skipped)`);
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});

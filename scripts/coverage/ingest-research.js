#!/usr/bin/env node
/**
 * Ingest a Claude Research markdown file into config + coverage.
 *
 * Usage:
 *   node scripts/coverage/ingest-research.js <path-to-research.md> \
 *     [--state XX] [--sport yyy] [--dry-run]
 *
 * Variants:
 *   - Single-state single-sport: frontmatter has state + sport,
 *     body has 1 leagues table + 1 tournament table.
 *   - Single-state all-sports: 7 per-sport league tables +
 *     1 (or per-sport) tournament table. Each leagues-table heading
 *     must name the sport (e.g. "## Soccer Leagues"). Each tournament
 *     table heading must contain "Tournament" and the sport.
 *
 * Behavior:
 *   - Merges (does not overwrite) into
 *     config/states/{STATE}/{sport}/leagues.json and tournaments.json.
 *     Match by slug(id) OR website domain. Existing fields win.
 *   - Writes coverage/{STATE}/{sport}.md (full 15-column tables).
 *   - Idempotent: re-running produces no diff.
 */

const fs = require('fs');
const path = require('path');
const L = require('./lib');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
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

const args = parseArgs(process.argv);
const inputPath = args._[0];
if (!inputPath) {
  console.error('usage: ingest-research.js <research.md> [--state XX] [--sport yyy] [--dry-run]');
  process.exit(1);
}

const DRY = !!args.flags['dry-run'];
const raw = fs.readFileSync(inputPath, 'utf8');
const { data: fm, body } = L.parseFrontmatter(raw);
const state = (args.flags.state || fm.state || '').toString().toUpperCase();
if (!state) {
  console.error('error: missing state (set in frontmatter or pass --state XX)');
  process.exit(1);
}
const sourceLabel = fm.source || path.basename(inputPath);

// Group tables by sport + kind.
const tables = L.parseMarkdownTables(body);
// Kind detection: if headers include "Series Name" or "Cadence" → tournament, else leagues.
function kindOf(headers) {
  const h = headers.map((x) => x.toLowerCase());
  if (h.includes('series name') || h.includes('cadence')) return 'tournament';
  if (h.includes('league name')) return 'league';
  return null;
}

const explicitSport = args.flags.sport || fm.sport;
const bySport = {}; // sport -> { leagues: [rowObj], tournaments: [rowObj] }

for (const t of tables) {
  const kind = kindOf(t.headers);
  if (!kind) continue;
  const sport = (explicitSport || L.detectSport(t.heading) || '').toString().toLowerCase();
  if (!sport) {
    console.warn(`warn: skipping table under heading "${t.heading}" — no sport detected`);
    continue;
  }
  bySport[sport] = bySport[sport] || { leagues: [], tournaments: [] };
  for (const row of t.rows) {
    const obj = L.rowToObject(t.headers, row);
    if (!obj['League Name'] && !obj['Series Name']) continue;
    if (kind === 'league') bySport[sport].leagues.push(obj);
    else bySport[sport].tournaments.push(obj);
  }
}

if (!Object.keys(bySport).length) {
  console.error('error: no parseable league/tournament tables found');
  process.exit(1);
}

function researchLeagueToConfig(r) {
  const id = L.slug(r['League Name']);
  const platform = L.normalizePlatform(r['Platform']);
  const entry = {
    id,
    name: r['League Name'],
    region: r['Geographic Scope'] || undefined,
    sourcePlatform: platform || undefined,
    website: r['Website'] || undefined,
    notes: r['Notes'] || undefined
  };
  // Drop undefined
  for (const k of Object.keys(entry)) if (entry[k] === undefined || entry[k] === '') delete entry[k];
  return entry;
}

function researchTournamentToConfig(r) {
  const id = L.slug(r['Series Name']);
  const platform = L.normalizePlatform(r['Platform']);
  const entry = {
    id,
    name: r['Series Name'],
    region: r['Geographic Scope'] || undefined,
    sourcePlatform: platform || undefined,
    website: r['Website'] || undefined,
    cadence: r['Cadence'] || undefined,
    hostVenues: r['Host Venues'] || undefined,
    notes: r['Notes'] || undefined
  };
  for (const k of Object.keys(entry)) if (entry[k] === undefined || entry[k] === '') delete entry[k];
  return entry;
}

function mergeList(existing, incoming, kind) {
  // Match by id OR by website domain.
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
      const d = L.domainOf(inc.website);
      if (d) byDomain.set(d, out.length - 1);
      added++;
    } else {
      const cur = out[idx];
      let changed = false;
      for (const k of Object.keys(inc)) {
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

function renderCoverageDoc(state, sport, leagueRows, tournamentRows, sourceLabel, existingCoverage) {
  const tpl = fs.readFileSync(L.templatePath(), 'utf8');
  // Build changelog. Idempotency: don't append an identical line if already present.
  const existingChangelog = existingCoverage ? extractChangelog(existingCoverage) : '';
  const entry = `- ${L.todayISO()} (research): ingested ${leagueRows.length} leagues, ${tournamentRows.length} tournaments from ${sourceLabel}`;
  let changelog;
  if (existingChangelog.includes(entry)) {
    changelog = existingChangelog;
  } else if (existingChangelog) {
    changelog = `${entry}\n${existingChangelog}`.trim();
  } else {
    changelog = entry;
  }

  const rendered = L.renderTemplate(tpl, {
    STATE: state,
    SPORT: sport,
    LAST_UPDATED: L.todayISO(),
    LAST_UPDATED_BY: 'research',
    SOURCE: sourceLabel,
    LEAGUES_COUNT: leagueRows.length,
    TOURNAMENTS_COUNT: tournamentRows.length,
    SUMMARY: `Seeded from research file \`${sourceLabel}\`. ${leagueRows.length} leagues, ${tournamentRows.length} tournament series.`,
    LEAGUES_TABLE: L.renderTable(L.LEAGUE_COLUMNS, leagueRows),
    TOURNAMENTS_TABLE: L.renderTable(L.TOURNAMENT_COLUMNS, tournamentRows),
    GAPS: '_None identified yet — review after first data collection pass._',
    CHANGELOG: changelog,
    SOURCES: `- ${sourceLabel}`
  });
  return rendered;
}

function extractChangelog(text) {
  const m = text.match(/## Changelog\s*\r?\n([\s\S]*?)(?:\r?\n## |\s*$)/);
  if (!m) return '';
  return m[1].trim();
}

const plan = [];

for (const [sport, data] of Object.entries(bySport)) {
  const leaguesPath = L.configLeaguesPath(state, sport);
  const tournPath = L.configTournamentsPath(state, sport);
  const covPath = L.coveragePath(state, sport);

  const existingLeagues = L.readJson(leaguesPath) || {
    _description: `${state} ${sport} leagues`,
    _lastUpdated: L.todayISO(),
    leagues: []
  };
  const existingTourn = L.readJson(tournPath) || {
    _description: `${state} ${sport} tournament series`,
    _lastUpdated: L.todayISO(),
    tournaments: []
  };

  const incomingLeagues = data.leagues.map(researchLeagueToConfig);
  const incomingTourn = data.tournaments.map(researchTournamentToConfig);

  const lRes = mergeList(existingLeagues.leagues || [], incomingLeagues, 'league');
  const tRes = mergeList(existingTourn.tournaments || [], incomingTourn, 'tournament');

  const newLeagues = {
    ...existingLeagues,
    _lastUpdated: L.todayISO(),
    leagues: lRes.list
  };
  const newTourn = {
    ...existingTourn,
    _lastUpdated: L.todayISO(),
    tournaments: tRes.list
  };

  const existingCoverage = fs.existsSync(covPath) ? fs.readFileSync(covPath, 'utf8') : null;
  const coverageText = renderCoverageDoc(
    state,
    sport,
    data.leagues,
    data.tournaments,
    sourceLabel,
    existingCoverage
  );

  plan.push({ sport, leaguesPath, tournPath, covPath, newLeagues, newTourn, coverageText, lRes, tRes });
}

for (const p of plan) {
  console.log(
    `[${state}/${p.sport}] leagues: +${p.lRes.added} new, ${p.lRes.merged} merged → ${p.newLeagues.leagues.length} total`
  );
  console.log(
    `[${state}/${p.sport}] tournaments: +${p.tRes.added} new, ${p.tRes.merged} merged → ${p.newTourn.tournaments.length} total`
  );
  if (DRY) {
    console.log(`  (dry-run) would write ${p.leaguesPath}`);
    console.log(`  (dry-run) would write ${p.tournPath}`);
    console.log(`  (dry-run) would write ${p.covPath}`);
  } else {
    L.writeJson(p.leaguesPath, p.newLeagues);
    L.writeJson(p.tournPath, p.newTourn);
    L.writeText(p.covPath, p.coverageText);
    console.log(`  wrote ${p.leaguesPath}`);
    console.log(`  wrote ${p.tournPath}`);
    console.log(`  wrote ${p.covPath}`);
  }
}

console.log(DRY ? 'dry-run complete.' : 'ingest complete.');

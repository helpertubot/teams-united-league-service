#!/usr/bin/env node
/**
 * Regenerate coverage/{STATE}/{sport}.md from git config + existing coverage doc.
 *
 * Usage:
 *   node scripts/coverage/regen-coverage.js --state XX --sport yyy [--source <label>]
 *   node scripts/coverage/regen-coverage.js --all [--source <label>]
 *
 * Rules:
 *   - Git config (config/states/{STATE}/{sport}/leagues.json + tournaments.json)
 *     is authoritative for the LEAGUE SET, the `id`, the `name`, the platform,
 *     and source-config fields.
 *   - The existing coverage doc is authoritative for research-only columns:
 *     Type, Level, Registration URL, Age Range, Est. # Teams, Season(s),
 *     Sanctioning Body, Contact, Confidence, Notes (when not in config),
 *     and the full Tournament Series rows (unless tournaments.json exists).
 *   - Items in coverage doc but missing from config: keep the row, set
 *     Confidence=Low, and prepend "(not in config)" to Notes.
 *   - Items in config but missing from coverage doc: add a row, filled from config.
 *
 * v1 does NOT read Firestore — git config is the only live input.
 */

// TODO: reconcile with Firestore — pull actual `status`, `monitorStatus`,
// and source-config fields from the `leagues` collection and fold them into
// the Notes / Confidence columns. Not implemented in v1.

const fs = require('fs');
const path = require('path');
const L = require('./lib');

function parseArgs(argv) {
  const out = { flags: {} };
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
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const source = args.flags.source || 'regen';

function findAllCoverageDocs() {
  const root = path.join(L.REPO_ROOT, 'coverage');
  const out = [];
  for (const st of fs.readdirSync(root)) {
    const stDir = path.join(root, st);
    if (!fs.statSync(stDir).isDirectory()) continue;
    if (!/^[A-Z]{2}$/.test(st)) continue;
    for (const f of fs.readdirSync(stDir)) {
      if (f.endsWith('.md') && f !== 'README.md' && f !== '_template.md') {
        out.push({ state: st, sport: f.replace(/\.md$/, '') });
      }
    }
  }
  return out;
}

let targets = [];
if (args.flags.all) {
  targets = findAllCoverageDocs();
} else {
  const state = (args.flags.state || '').toString().toUpperCase();
  const sport = (args.flags.sport || '').toString().toLowerCase();
  if (!state || !sport) {
    console.error('usage: regen-coverage.js --state XX --sport yyy [--source <label>] | --all');
    process.exit(1);
  }
  targets = [{ state, sport }];
}

function extractSection(text, heading) {
  if (!text) return '';
  const re = new RegExp(`## ${heading}\\s*\\r?\\n([\\s\\S]*?)(?:\\r?\\n## |\\s*$)`);
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

function parseTableFromSection(section, columns) {
  if (!section) return [];
  const lines = section.split(/\r?\n/);
  // Find header line (first line starting with |)
  const tables = L.parseMarkdownTables(section);
  if (!tables.length) return [];
  const t = tables[0];
  const rows = [];
  for (const r of t.rows) {
    const obj = L.rowToObject(t.headers, r);
    // Skip placeholder empty table row ("— | — | ...")
    const hasContent = Object.values(obj).some((v) => v && v !== '—');
    if (!hasContent) continue;
    // Normalize to requested columns
    const norm = {};
    for (const c of columns) norm[c] = obj[c] || '';
    rows.push(norm);
  }
  return rows;
}

function mergeLeagueRows(configLeagues, coverageRows) {
  // Key by slug(name) matching config id.
  const coverageByKey = new Map();
  for (const r of coverageRows) {
    const key = L.slug(r['League Name']);
    if (key) coverageByKey.set(key, r);
  }
  const configByKey = new Map();
  for (const l of configLeagues) {
    configByKey.set(l.id, l);
  }
  const result = [];

  // Start with config (authoritative set, in config order).
  for (const l of configLeagues) {
    const prior = coverageByKey.get(l.id) || {};
    const row = {
      'League Name': l.name || prior['League Name'] || l.id,
      'Type': prior['Type'] || '',
      'Level': prior['Level'] || '',
      'Website': prior['Website'] || l.website || '',
      'Registration URL': prior['Registration URL'] || '',
      'Platform': prior['Platform'] || l.sourcePlatform || '',
      'Age Range': prior['Age Range'] || '',
      'Geographic Scope': prior['Geographic Scope'] || l.region || '',
      'Est. # Teams': prior['Est. # Teams'] || '',
      'Season(s)': prior['Season(s)'] || '',
      'Sanctioning Body': prior['Sanctioning Body'] || '',
      'Contact': prior['Contact'] || '',
      'Confidence': prior['Confidence'] || 'Medium',
      'Notes': prior['Notes'] || l.notes || ''
    };
    // Reconcile platform authority from config.
    if (l.sourcePlatform) row['Platform'] = l.sourcePlatform;
    result.push(row);
  }

  // Add coverage-only rows (in coverage doc but not in config) — preserve, mark Low.
  for (const [key, r] of coverageByKey.entries()) {
    if (configByKey.has(key)) continue;
    const notes = r['Notes'] || '';
    const marked = notes.startsWith('(not in config)') ? notes : `(not in config) ${notes}`.trim();
    result.push({
      ...r,
      'Confidence': 'Low',
      'Notes': marked
    });
  }
  return result;
}

function mergeTournamentRows(configTourn, coverageRows) {
  const coverageByKey = new Map();
  for (const r of coverageRows) {
    const key = L.slug(r['Series Name']);
    if (key) coverageByKey.set(key, r);
  }
  const configByKey = new Map();
  for (const t of configTourn) configByKey.set(t.id, t);
  const result = [];
  for (const t of configTourn) {
    const prior = coverageByKey.get(t.id) || {};
    const row = {
      'Series Name': t.name || prior['Series Name'] || t.id,
      'Type': prior['Type'] || '',
      'Level': prior['Level'] || '',
      'Website': prior['Website'] || t.website || '',
      'Registration URL': prior['Registration URL'] || '',
      'Platform': t.sourcePlatform || prior['Platform'] || '',
      'Age Range': prior['Age Range'] || '',
      'Geographic Scope': prior['Geographic Scope'] || t.region || '',
      'Est. # Teams': prior['Est. # Teams'] || '',
      'Cadence': prior['Cadence'] || t.cadence || '',
      'Host Venues': prior['Host Venues'] || t.hostVenues || '',
      'Sanctioning Body': prior['Sanctioning Body'] || '',
      'Contact': prior['Contact'] || '',
      'Confidence': prior['Confidence'] || 'Medium',
      'Notes': prior['Notes'] || t.notes || ''
    };
    result.push(row);
  }
  for (const [key, r] of coverageByKey.entries()) {
    if (configByKey.has(key)) continue;
    const notes = r['Notes'] || '';
    const marked = notes.startsWith('(not in config)') ? notes : `(not in config) ${notes}`.trim();
    result.push({ ...r, 'Confidence': 'Low', 'Notes': marked });
  }
  return result;
}

function regenOne(state, sport) {
  const leaguesPath = L.configLeaguesPath(state, sport);
  const tournPath = L.configTournamentsPath(state, sport);
  const covPath = L.coveragePath(state, sport);

  const leaguesJson = L.readJson(leaguesPath);
  const tournJson = L.readJson(tournPath);
  const configLeagues = leaguesJson ? leaguesJson.leagues || [] : [];
  const configTourn = tournJson ? tournJson.tournaments || [] : [];

  const existingText = fs.existsSync(covPath) ? fs.readFileSync(covPath, 'utf8') : '';
  const { data: existingFm } = L.parseFrontmatter(existingText);
  const priorLeagueRows = parseTableFromSection(
    extractSection(existingText, 'Leagues'),
    L.LEAGUE_COLUMNS
  );
  const priorTournRows = parseTableFromSection(
    extractSection(existingText, 'Tournament Series'),
    L.TOURNAMENT_COLUMNS
  );

  const mergedLeagues = mergeLeagueRows(configLeagues, priorLeagueRows);
  const mergedTourn = mergeTournamentRows(configTourn, priorTournRows);

  const priorLeagueCount = Number(existingFm.leagues_count) || priorLeagueRows.length;
  const priorTournCount = Number(existingFm.tournaments_count) || priorTournRows.length;
  const dLeagues = mergedLeagues.length - priorLeagueCount;
  const dTourn = mergedTourn.length - priorTournCount;

  const priorChangelog = existingText ? (extractSection(existingText, 'Changelog') || '') : '';
  const priorSources = existingText ? (extractSection(existingText, 'Sources') || '') : '';
  const priorGaps = existingText ? (extractSection(existingText, 'Gaps') || '') : '_None identified yet._';
  const priorSummary =
    existingText
      ? (extractSection(existingText, 'Summary') || '').trim() ||
        `${state} ${sport} coverage.`
      : `${state} ${sport} coverage.`;

  const changelogEntry = `- ${L.todayISO()} (${source}): ${dLeagues >= 0 ? '+' : ''}${dLeagues} leagues, ${
    dTourn >= 0 ? '+' : ''
  }${dTourn} tournaments (regen from git config)`;
  let changelog;
  if (priorChangelog.includes(changelogEntry)) {
    changelog = priorChangelog;
  } else if (priorChangelog) {
    changelog = `${changelogEntry}\n${priorChangelog}`.trim();
  } else {
    changelog = changelogEntry;
  }

  const tpl = fs.readFileSync(L.templatePath(), 'utf8');
  const rendered = L.renderTemplate(tpl, {
    STATE: state,
    SPORT: sport,
    LAST_UPDATED: L.todayISO(),
    LAST_UPDATED_BY: source,
    SOURCE: existingFm.source || 'git-config',
    LEAGUES_COUNT: mergedLeagues.length,
    TOURNAMENTS_COUNT: mergedTourn.length,
    SUMMARY: priorSummary,
    LEAGUES_TABLE: L.renderTable(L.LEAGUE_COLUMNS, mergedLeagues),
    TOURNAMENTS_TABLE: L.renderTable(L.TOURNAMENT_COLUMNS, mergedTourn),
    GAPS: priorGaps,
    CHANGELOG: changelog,
    SOURCES: priorSources || '- git-config'
  });

  L.writeText(covPath, rendered);
  console.log(
    `[${state}/${sport}] leagues: ${mergedLeagues.length} (Δ${dLeagues >= 0 ? '+' : ''}${dLeagues}), tournaments: ${mergedTourn.length} (Δ${dTourn >= 0 ? '+' : ''}${dTourn}) → ${covPath}`
  );
}

for (const { state, sport } of targets) {
  regenOne(state, sport);
}

console.log('regen complete.');

/**
 * Shared coverage helpers: YAML frontmatter + markdown table parsing,
 * slugging, JSON I/O, and template rendering.
 *
 * Intentionally dependency-free — only Node stdlib.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const LEAGUE_COLUMNS = [
  '#', 'League Name', 'Type', 'Level', 'Website', 'Registration URL',
  'Platform', 'Age Range', 'Geographic Scope', 'Est. # Teams', 'Season(s)',
  'Sanctioning Body', 'Contact', 'Confidence', 'Notes'
];

const TOURNAMENT_COLUMNS = [
  '#', 'Series Name', 'Type', 'Level', 'Website', 'Registration URL',
  'Platform', 'Age Range', 'Geographic Scope', 'Est. # Teams', 'Cadence',
  'Host Venues', 'Sanctioning Body', 'Contact', 'Confidence', 'Notes'
];

const SPORTS = ['soccer', 'baseball', 'softball', 'basketball', 'lacrosse', 'hockey', 'football'];

/**
 * Minimal YAML frontmatter parser. Supports flat key: value pairs,
 * quoted strings, unquoted scalars, numbers. No nesting, no lists.
 */
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: text };
  const block = match[1];
  const data = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    else if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
    data[m[1]] = val;
  }
  return { data, body: text.slice(match[0].length) };
}

/**
 * Parse all markdown tables from text. Returns array of
 * { headers: string[], rows: string[][], preceding: string (nearest heading line above) }.
 */
function parseMarkdownTables(body) {
  const lines = body.split(/\r?\n/);
  const tables = [];
  let lastHeading = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{1,6}\s+/.test(line)) {
      lastHeading = line.replace(/^#{1,6}\s+/, '').trim();
    }
    // Detect table: header row = starts with |, next row = separator with --- cells
    if (line.trim().startsWith('|') && i + 1 < lines.length) {
      const sep = lines[i + 1].trim();
      if (/^\|?\s*:?-{2,}/.test(sep) && sep.includes('|')) {
        const headers = splitTableRow(line);
        const rows = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim().startsWith('|')) {
          rows.push(splitTableRow(lines[j]));
          j++;
        }
        tables.push({ headers, rows, heading: lastHeading });
        i = j;
        continue;
      }
    }
    i++;
  }
  return tables;
}

function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((c) => c.trim());
}

/**
 * Given a parsed table row (array of cell strings) and its headers,
 * build an object keyed by header name. Unknown headers are preserved.
 */
function rowToObject(headers, row) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i] !== undefined ? row[i] : '';
  }
  return obj;
}

/**
 * Canonical header names our renderer/config code expects. Research files in
 * the wild use shorthand (~Teams, Ages, Scope, Sanction). Normalize incoming
 * headers to canonical names so downstream rowToObject + render code stays
 * schema-strict without silently dropping fields.
 */
const HEADER_ALIASES = {
  '#': '#',
  'league': 'League Name',
  'league name': 'League Name',
  'series': 'Series Name',
  'series name': 'Series Name',
  'type': 'Type',
  'level': 'Level',
  'website': 'Website',
  'registration url': 'Registration URL',
  'platform': 'Platform',
  'age range': 'Age Range',
  'ages': 'Age Range',
  'geographic scope': 'Geographic Scope',
  'scope': 'Geographic Scope',
  'est. # teams': 'Est. # Teams',
  'est # teams': 'Est. # Teams',
  '~teams': 'Est. # Teams',
  'teams': 'Est. # Teams',
  'season(s)': 'Season(s)',
  'seasons': 'Season(s)',
  'season': 'Season(s)',
  'sanctioning body': 'Sanctioning Body',
  'sanction': 'Sanctioning Body',
  'contact': 'Contact',
  'confidence': 'Confidence',
  'notes': 'Notes',
  'cadence': 'Cadence',
  'host venues': 'Host Venues',
  'host': 'Host Venues',
  'sport': 'Sport'
};

function normalizeHeaders(headers) {
  return headers.map((h) => {
    const key = String(h).toLowerCase().trim();
    return HEADER_ALIASES[key] || h;
  });
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function domainOf(url) {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

/**
 * Map a research "Platform" cell to a sourcePlatform adapter key.
 * Unknown values are lower-cased and returned as-is so we don't drop info.
 */
function normalizePlatform(p) {
  if (!p) return '';
  const t = String(p).toLowerCase().trim();
  const map = {
    'gotsport': 'gotsport',
    'sportsaffinity': 'sportsaffinity',
    'sports affinity': 'sportsaffinity',
    'sportsconnect': 'sportsconnect',
    'sports connect': 'sportsconnect',
    'gamechanger': 'gamechanger',
    'game changer': 'gamechanger',
    'demosphere': 'demosphere',
    'tgs': 'tgs',
    'pointstreak': 'pointstreak',
    'leagueapps': 'leagueapps',
    'league apps': 'leagueapps',
    'teamsnap': 'teamsnap',
    'sportngin': 'sportngin',
    'sportsengine': 'sportngin',
    'crossbar': 'crossbar',
    'myhockey': 'myhockey',
    'leaguelineup': 'leaguelineup',
    'teamsideline': 'teamsideline'
  };
  return map[t] || t.replace(/\s+/g, '');
}

/**
 * Tournament-facing platform names. These are the consumer-side
 * `sourcePlatform` strings the TeamsUnited UI + Firestore tournaments
 * collection expect, which diverge from the league-collector adapter
 * keys (e.g. tournaments use "sportsengine", leagues use "sportngin").
 */
function normalizeTournamentPlatform(p) {
  if (!p) return '';
  const t = String(p).toLowerCase().trim();
  const map = {
    'gotsport': 'gotsport',
    'sportsengine': 'sportsengine',
    'sportngin': 'sportsengine',
    'teamsnap': 'teamsnap',
    'leagueapps': 'leagueapps',
    'league apps': 'leagueapps',
    'exposure': 'exposure',
    'exposure events': 'exposure',
    'eventconnect': 'eventconnect',
    'custom': 'custom',
    'unknown': 'unknown',
    '': ''
  };
  return map[t] || t.replace(/\s+/g, '');
}

/**
 * Map research Cadence strings to Firestore `recurring` values
 * (Annual→annual, Monthly→monthly, Seasonal→seasonal). Falls through
 * to lower-cased input so we never drop signal.
 */
function normalizeRecurring(c) {
  if (!c) return '';
  const t = String(c).toLowerCase().trim();
  if (t.startsWith('annual')) return 'annual';
  if (t.startsWith('monthly')) return 'monthly';
  if (t.startsWith('seasonal')) return 'seasonal';
  if (t.startsWith('weekly')) return 'weekly';
  return t;
}

function normalizeConfidence(c) {
  if (!c) return '';
  const t = String(c).toLowerCase().trim();
  if (['high', 'medium', 'low'].includes(t)) return t;
  return t;
}

/**
 * Parse a Host Venues cell into { venue, city }. Research often writes
 * "Settlers Park (Meridian)" → venue="Settlers Park", city="Meridian".
 * If no parenthetical, we leave the whole string as venue and omit city.
 * Multi-venue cells like "Twin Falls/Boise" also fall through as venue
 * with empty city — the enrichment pass will split those later.
 */
function parseHostVenue(host) {
  if (!host) return { venue: '', city: '' };
  const s = String(host).trim();
  const m = s.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    return { venue: m[1].trim(), city: m[2].trim() };
  }
  return { venue: s, city: '' };
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function writeText(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeCell(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderTable(columns, rows) {
  if (!rows.length) return `| ${columns.map(() => '—').join(' | ')} |`;
  return rows
    .map((r, idx) => {
      const cells = columns.map((c, ci) => {
        if (ci === 0) return String(idx + 1);
        return escapeCell(r[c]);
      });
      return `| ${cells.join(' | ')} |`;
    })
    .join('\n');
}

function renderTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

function configLeaguesPath(state, sport) {
  return path.join(REPO_ROOT, 'config', 'states', state, sport, 'leagues.json');
}

function configTournamentsPath(state, sport) {
  return path.join(REPO_ROOT, 'config', 'states', state, sport, 'tournaments.json');
}

function coveragePath(state, sport) {
  return path.join(REPO_ROOT, 'coverage', state, `${sport}.md`);
}

function templatePath() {
  return path.join(REPO_ROOT, 'coverage', '_template.md');
}

/**
 * Determine (state, sport) from research frontmatter + table headings.
 * For all-sports variants, returns null sport and caller iterates per-table.
 */
function detectSport(heading, sports = SPORTS) {
  const h = (heading || '').toLowerCase();
  for (const s of sports) {
    if (h.includes(s)) return s;
  }
  return null;
}

module.exports = {
  REPO_ROOT,
  LEAGUE_COLUMNS,
  TOURNAMENT_COLUMNS,
  SPORTS,
  parseFrontmatter,
  parseMarkdownTables,
  rowToObject,
  normalizeHeaders,
  HEADER_ALIASES,
  slug,
  domainOf,
  normalizePlatform,
  normalizeTournamentPlatform,
  normalizeRecurring,
  normalizeConfidence,
  parseHostVenue,
  readJson,
  writeJson,
  writeText,
  todayISO,
  renderTable,
  renderTemplate,
  configLeaguesPath,
  configTournamentsPath,
  coveragePath,
  templatePath,
  detectSport
};

/**
 * LeagueLineup Adapter
 *
 * HTML parser for LeagueLineup standings pages.
 * Used by: youth basketball/baseball/football orgs hosted on leaguelineup.com.
 *
 * Supported URL patterns:
 *   https://www.leaguelineup.com/standings.asp?url={urlKey}
 *   https://www.leaguelineup.com/standings_basketball.asp?url={urlKey}
 *   https://www.leaguelineup.com/welcome.asp?url={urlKey}
 *
 * sourceConfig schema:
 * {
 *   urlKey: 'norcalheatelite', // preferred
 *   website: 'https://www.leaguelineup.com/welcome.asp?url=norcalheatelite',
 *   baseUrl: 'https://www.leaguelineup.com',
 *   divisionIds: ['526394', '765642'] // optional subset filter
 * }
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'leaguelineup';
const USER_AGENT = 'TeamsUnited-Standings/1.0';

async function collectStandings(leagueConfig) {
  const cfg = leagueConfig.sourceConfig || {};
  const baseUrl = (cfg.baseUrl || 'https://www.leaguelineup.com').replace(/\/+$/, '');
  const urlKey = resolveUrlKey(cfg, leagueConfig);

  if (!urlKey) {
    throw new Error('LeagueLineup adapter requires sourceConfig.urlKey or a URL containing ?url={key}');
  }

  const first = await fetchStandingsPage(baseUrl, urlKey, null);
  const divisionsMeta = parseDivisionOptions(first.$);

  let targetDivisions;
  if (Array.isArray(cfg.divisionIds) && cfg.divisionIds.length > 0) {
    const allowed = new Set(cfg.divisionIds.map(String));
    targetDivisions = divisionsMeta.filter(d => allowed.has(String(d.id)));
    if (targetDivisions.length === 0) {
      targetDivisions = cfg.divisionIds.map(id => ({ id: String(id), name: `Division ${id}` }));
    }
  } else if (divisionsMeta.length > 0) {
    targetDivisions = divisionsMeta;
  } else {
    targetDivisions = [{ id: null, name: parseSelectedDivisionName(first.$) || 'Standings' }];
  }

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  for (const division of targetDivisions) {
    let page;
    if (division.id) {
      page = await fetchStandingsPage(baseUrl, urlKey, division.id);
    } else {
      page = first;
    }

    const parsed = parseStandingsTable(page.$);
    if (parsed.rows.length === 0) {
      console.warn(`LeagueLineup: No standings rows for division ${division.id || 'default'} (${division.name})`);
      continue;
    }

    const divisionName = parsed.divisionName || division.name || `Division ${division.id || 'default'}`;
    const inferred = inferAgeGroup(divisionName);
    const platformDivisionId = division.id ? String(division.id) : slugify(divisionName);
    const divisionId = `${leagueConfig.id}-${platformDivisionId}`;
    const seasonId = leagueConfig.seasonId || cfg.seasonId || '2025-2026';

    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId,
      name: divisionName,
      ageGroup: inferred.ageGroup,
      gender: inferred.gender,
      level: parseLevel(divisionName),
      platformDivisionId,
      status: 'active',
    });

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      standings.push({
        teamName: row.teamName,
        position: i + 1,
        gamesPlayed: row.wins + row.losses + row.ties,
        wins: row.wins,
        losses: row.losses,
        ties: row.ties,
        points: 0,
        scored: row.pointsFor,
        allowed: row.pointsAgainst,
        differential: row.pointsFor - row.pointsAgainst,
        shutouts: 0,
        yellowCards: 0,
        redCards: 0,
        clubKey: null,
        teamKey: row.teamId,
        leagueId: leagueConfig.id,
        divisionId,
        seasonId,
        collectedAt: now,
      });
    }
  }

  console.log(`LeagueLineup: Collected ${divisions.length} divisions, ${standings.length} standings from ${urlKey}`);
  return { divisions, standings };
}

async function fetchStandingsPage(baseUrl, urlKey, divisionId) {
  const params = new URLSearchParams({ url: urlKey });
  if (divisionId) params.set('divisionid', String(divisionId));

  const candidatePaths = [
    `/standings.asp?${params.toString()}`,
    `/standings_basketball.asp?${params.toString()}`,
  ];

  let lastErr = null;
  for (const path of candidatePaths) {
    try {
      const resp = await axios.get(`${baseUrl}${path}`, {
        timeout: 30000,
        maxRedirects: 5,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      });
      const $ = cheerio.load(resp.data);
      if (hasStandingsTable($)) {
        return { $, path };
      }
      // Accept non-table pages only if this is the last fallback.
      if (path === candidatePaths[candidatePaths.length - 1]) {
        return { $, path };
      }
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(`LeagueLineup fetch failed for url=${urlKey}${divisionId ? ` division=${divisionId}` : ''}: ${lastErr ? lastErr.message : 'unknown error'}`);
}

function hasStandingsTable($) {
  return findStandingsTable($).length > 0;
}

function parseDivisionOptions($) {
  const divisions = [];
  $('select[name="DivisionID"] option').each((_, el) => {
    const id = ($(el).attr('value') || '').trim();
    const name = $(el).text().trim();
    if (!id || !name) return;
    divisions.push({ id, name });
  });
  return divisions;
}

function parseSelectedDivisionName($) {
  const selected = $('select[name="DivisionID"] option[selected]').first();
  if (selected.length) return selected.text().trim();
  const first = $('select[name="DivisionID"] option').first();
  if (first.length) return first.text().trim();
  return null;
}

function parseStandingsTable($) {
  const table = findStandingsTable($);
  const divisionName = parseSelectedDivisionName($) || $('h4').first().text().trim() || 'Standings';
  if (table.length === 0) return { divisionName, rows: [] };

  const headerCells = table.find('tr').first().find('th');
  const headers = headerCells.map((_, th) => normalizeHeader($(th).text())).get();

  const idxTeam = findHeaderIndex(headers, ['team']);
  const idxWon = findHeaderIndex(headers, ['won', 'wins', 'w']);
  const idxLost = findHeaderIndex(headers, ['lost', 'losses', 'l']);
  const idxTied = findHeaderIndex(headers, ['tied', 'ties', 't']);
  const idxPf = findHeaderIndex(headers, ['pf', 'points for', 'pts for']);
  const idxPa = findHeaderIndex(headers, ['pa', 'points against', 'pts against']);

  const rows = [];
  table.find('tr').slice(1).each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length === 0) return;

    const teamIdx = idxTeam >= 0 ? idxTeam : 0;
    const teamCell = cells.eq(teamIdx);
    const teamName = cleanText(teamCell.text());
    if (!teamName) return;

    const teamHref = teamCell.find('a').attr('href') || '';
    const teamIdMatch = teamHref.match(/[?&]teamid=(\d+)/i);

    const wins = idxWon >= 0 ? parseNum(cells.eq(idxWon).text()) : 0;
    const losses = idxLost >= 0 ? parseNum(cells.eq(idxLost).text()) : 0;
    const ties = idxTied >= 0 ? parseNum(cells.eq(idxTied).text()) : 0;
    const pointsFor = idxPf >= 0 ? parseNum(cells.eq(idxPf).text()) : 0;
    const pointsAgainst = idxPa >= 0 ? parseNum(cells.eq(idxPa).text()) : 0;

    rows.push({
      teamName,
      teamId: teamIdMatch ? teamIdMatch[1] : null,
      wins,
      losses,
      ties,
      pointsFor,
      pointsAgainst,
    });
  });

  return { divisionName, rows };
}

function findStandingsTable($) {
  const candidates = $('table.table, table.table-striped, table.table-bordered, table.tableview');
  let found = $();

  candidates.each((_, table) => {
    const headers = $(table)
      .find('tr')
      .first()
      .find('th')
      .map((_, th) => normalizeHeader($(th).text()))
      .get();

    if (headers.length === 0) return;

    const hasTeam = headers.includes('team');
    const hasRecord = headers.includes('won') || headers.includes('wins') || headers.includes('w');

    if (hasTeam && hasRecord && found.length === 0) {
      found = $(table);
    }
  });

  return found;
}

function findHeaderIndex(headers, options) {
  for (const option of options) {
    const idx = headers.indexOf(option);
    if (idx >= 0) return idx;
  }
  return -1;
}

function normalizeHeader(text) {
  return cleanText(text).toLowerCase();
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function parseNum(text) {
  const cleaned = String(text || '').replace(/[^0-9.-]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function resolveUrlKey(cfg, leagueConfig) {
  if (cfg.urlKey) return String(cfg.urlKey).trim();

  const candidates = [
    cfg.website,
    cfg.url,
    cfg.standingsUrl,
    cfg.welcomeUrl,
    cfg.baseUrl,
    leagueConfig.website,
    leagueConfig.url,
  ].filter(Boolean);

  for (const raw of candidates) {
    const key = extractUrlKey(raw);
    if (key) return key;
  }

  return null;
}

function extractUrlKey(rawUrl) {
  try {
    const u = new URL(String(rawUrl));
    const key = u.searchParams.get('url');
    if (key) return key.trim();

    // Handle forms like https://foo.leaguelineup.com
    const host = u.hostname.toLowerCase();
    const hostMatch = host.match(/^([a-z0-9-]+)\.leaguelineup\.com$/i);
    if (hostMatch) return hostMatch[1];
  } catch (_) {
    const match = String(rawUrl).match(/[?&]url=([a-z0-9_-]+)/i);
    if (match) return match[1];
  }
  return null;
}

function parseLevel(name) {
  const upper = String(name || '').toUpperCase();
  if (/\bELITE\b/.test(upper)) return 'Elite';
  if (/\bVARSITY\b/.test(upper)) return 'Varsity';
  if (/\bJV\b/.test(upper)) return 'JV';
  if (/\bFROSH\b/.test(upper)) return 'Frosh';
  if (/\bREC\b|\bRECREATIONAL\b/.test(upper)) return 'Rec';
  return null;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

module.exports = {
  PLATFORM_ID,
  collectStandings,
};

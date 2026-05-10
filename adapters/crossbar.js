/**
 * Crossbar Adapter
 *
 * HTML parser for Crossbar-hosted league websites.
 * Used by: lacrosse/hockey organizations hosted on crossbar.org infrastructure.
 *
 * Common URL patterns:
 *   League page:    /leagues/{league-slug}/{leagueId}
 *   Division page:  /division/{divisionId}
 *   Standings page: /division/{divisionId}/standings?subseason_id={subseasonId}
 *
 * sourceConfig schema:
 * {
 *   baseUrl: 'https://www.oregonyouthlacrosse.org',              // required
 *   leaguePath: '/leagues/oyl-spring-league/2310',               // optional (for auto-discovery)
 *   leagueUrl: 'https://www.oregonyouthlacrosse.org/.../2310',   // optional alternative
 *   divisionIds: ['26670', '26669'],                             // optional manual override
 *   subseasonId: '5371',                                         // optional default
 *   subseasonIdsByDivision: { '26670': '5371' },                 // optional per-division override
 *   seasonId: '2025-2026'                                        // optional output override
 * }
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'crossbar';
const USER_AGENT = 'TeamsUnited-Standings/1.0';

async function collectStandings(leagueConfig) {
  const cfg = leagueConfig.sourceConfig || {};
  const baseUrl = normalizeBaseUrl(cfg.baseUrl || cfg.websiteUrl || cfg.website);

  if (!baseUrl) {
    throw new Error('Crossbar adapter requires sourceConfig.baseUrl');
  }

  const divisionIds = await resolveDivisionIds(baseUrl, cfg);
  if (divisionIds.length === 0) {
    console.warn(`Crossbar: No divisions found for ${leagueConfig.id}`);
    return { divisions: [], standings: [] };
  }

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();
  const seenDivisionKeys = new Set();

  for (const divisionId of divisionIds) {
    const configuredSubseasonId = resolveConfiguredSubseasonId(cfg, divisionId);
    let page;
    try {
      page = await fetchDivisionStandingsPage(baseUrl, divisionId, configuredSubseasonId);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        console.warn(`Crossbar: Division ${divisionId} standings page returned 404; skipping stale division`);
        continue;
      }
      throw err;
    }

    if (page.rows.length === 0) {
      console.warn(`Crossbar: Division ${divisionId} returned no standings rows`);
      continue;
    }

    const platformDivisionKey = page.subseasonId
      ? `${divisionId}-${page.subseasonId}`
      : String(divisionId);
    const divisionDocId = `${leagueConfig.id}-${platformDivisionKey}`;

    if (!seenDivisionKeys.has(platformDivisionKey)) {
      const inferred = inferAgeGroup(page.divisionName);
      divisions.push({
        id: divisionDocId,
        leagueId: leagueConfig.id,
        seasonId: leagueConfig.seasonId || cfg.seasonId || deriveSeasonId(page.subseasonLabel, page.subseasonId),
        name: page.divisionName,
        ageGroup: inferred.ageGroup,
        gender: inferred.gender,
        level: parseLevel(page.divisionName),
        platformDivisionId: platformDivisionKey,
        status: 'active',
      });
      seenDivisionKeys.add(platformDivisionKey);
    }

    for (let i = 0; i < page.rows.length; i++) {
      const row = page.rows[i];
      standings.push({
        teamName: row.teamName,
        position: i + 1,
        gamesPlayed: row.gamesPlayed,
        wins: row.wins,
        losses: row.losses,
        ties: row.ties,
        points: row.points,
        scored: row.scored,
        allowed: row.allowed,
        differential: row.differential,
        winPct: row.winPct,
        shutouts: 0,
        yellowCards: 0,
        redCards: 0,
        clubKey: null,
        teamKey: row.teamKey,
        leagueId: leagueConfig.id,
        divisionId: divisionDocId,
        seasonId: leagueConfig.seasonId || cfg.seasonId || deriveSeasonId(page.subseasonLabel, page.subseasonId),
        collectedAt: now,
      });
    }

    await sleep(150);
  }

  console.log(`Crossbar: Collected ${divisions.length} divisions, ${standings.length} standings`);
  return { divisions, standings };
}

async function resolveDivisionIds(baseUrl, cfg) {
  if (Array.isArray(cfg.divisionIds) && cfg.divisionIds.length > 0) {
    return [...new Set(cfg.divisionIds.map(String).filter(Boolean))];
  }

  const leaguePath = resolveLeaguePath(cfg);
  if (leaguePath) {
    const html = await fetchHtml(`${baseUrl}${leaguePath}`);
    return extractDivisionIds(html);
  }

  const html = await fetchHtml(baseUrl);
  return extractDivisionIds(html);
}

async function fetchDivisionStandingsPage(baseUrl, divisionId, configuredSubseasonId) {
  const probeUrl = configuredSubseasonId
    ? `${baseUrl}/division/${encodeURIComponent(String(divisionId))}/standings?subseason_id=${encodeURIComponent(String(configuredSubseasonId))}`
    : `${baseUrl}/division/${encodeURIComponent(String(divisionId))}/standings`;

  const probeHtml = await fetchHtml(probeUrl);
  const probe$ = cheerio.load(probeHtml);
  const selected = getSelectedSubseason(probe$);
  const chosenSubseasonId = configuredSubseasonId || selected.id;

  if (chosenSubseasonId && String(chosenSubseasonId) !== String(configuredSubseasonId || '')) {
    const finalUrl = `${baseUrl}/division/${encodeURIComponent(String(divisionId))}/standings?subseason_id=${encodeURIComponent(String(chosenSubseasonId))}`;
    const html = await fetchHtml(finalUrl);
    return parseStandingsPage(cheerio.load(html), divisionId, chosenSubseasonId, selected.label);
  }

  return parseStandingsPage(probe$, divisionId, chosenSubseasonId, selected.label);
}

function parseStandingsPage($, divisionId, subseasonId, subseasonLabel) {
  const heading = cleanText($('h1').first().text());
  const divisionName = heading.replace(/\s*-\s*standings\s*$/i, '') || `Division ${divisionId}`;

  const table = findStandingsTable($);
  if (table.length === 0) {
    return { divisionName, subseasonId: subseasonId ? String(subseasonId) : null, subseasonLabel, rows: [] };
  }

  const headers = table
    .find('tr')
    .first()
    .find('th')
    .map((_, th) => normalizeHeader($(th).text()))
    .get();

  const idxTeam = findHeaderIndex(headers, ['team']);
  const idxGp = findHeaderIndex(headers, ['gp', 'games played', 'games']);
  const idxW = findHeaderIndex(headers, ['w', 'wins', 'won']);
  const idxL = findHeaderIndex(headers, ['l', 'losses', 'lost']);
  const idxT = findHeaderIndex(headers, ['t', 'ties', 'tie']);
  const idxPts = findHeaderIndex(headers, ['pts', 'points']);
  const idxPct = findHeaderIndex(headers, ['pct', 'win %', 'win pct', 'win percentage']);
  const idxScored = findHeaderIndex(headers, ['gf', 'pf', 'goals for', 'points for']);
  const idxAllowed = findHeaderIndex(headers, ['ga', 'pa', 'goals against', 'points against']);
  const idxDiff = findHeaderIndex(headers, ['gd', 'diff', 'differential']);

  const rows = [];
  table.find('tr').slice(1).each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length === 0) return;

    const teamCell = cells.eq(idxTeam >= 0 ? idxTeam : 0);
    const teamName = cleanText(teamCell.text());
    if (!teamName) return;

    const teamHref = teamCell.find('a[href*="/team/"]').attr('href') || '';
    const teamIdMatch = teamHref.match(/\/team\/(\d+)/i);
    const teamKey = teamIdMatch ? teamIdMatch[1] : null;

    const wins = parseNumber(cellText(cells, idxW));
    const losses = parseNumber(cellText(cells, idxL));
    const ties = parseNumber(cellText(cells, idxT));
    const gamesPlayedRaw = parseNumber(cellText(cells, idxGp));
    const points = parseNumber(cellText(cells, idxPts));
    const winPct = parsePct(cellText(cells, idxPct));
    const scored = parseNumber(cellText(cells, idxScored));
    const allowed = parseNumber(cellText(cells, idxAllowed));
    const diffRaw = parseNumber(cellText(cells, idxDiff));

    const gamesPlayed = gamesPlayedRaw || (wins + losses + ties);
    const differential = diffRaw || (scored - allowed);

    rows.push({
      teamName,
      teamKey,
      gamesPlayed,
      wins,
      losses,
      ties,
      points,
      scored,
      allowed,
      differential,
      winPct,
    });
  });

  return {
    divisionName,
    subseasonId: subseasonId ? String(subseasonId) : null,
    subseasonLabel,
    rows,
  };
}

function findStandingsTable($) {
  let found = $();
  $('table').each((_, table) => {
    const headers = $(table)
      .find('tr')
      .first()
      .find('th')
      .map((__, th) => normalizeHeader($(th).text()))
      .get();

    if (!headers.length) return;
    if (headers.includes('team') && headers.some(h => ['w', 'l', 'pct', 'gp', 'points', 'pts'].includes(h)) && found.length === 0) {
      found = $(table);
    }
  });
  return found;
}

function getSelectedSubseason($) {
  const selected = $('#input_subseason_id option[selected]').first();
  if (selected.length && selected.attr('value')) {
    return {
      id: String(selected.attr('value')).trim(),
      label: cleanText(selected.text()),
    };
  }

  const firstNonEmpty = $('#input_subseason_id option')
    .toArray()
    .map(el => ({ id: String($(el).attr('value') || '').trim(), label: cleanText($(el).text()) }))
    .find(o => o.id);

  return firstNonEmpty || { id: null, label: null };
}

function extractDivisionIds(html) {
  const $ = cheerio.load(html);
  const found = new Set();

  $('a[href*="/division/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/\/division\/(\d+)/i);
    if (match) found.add(match[1]);
  });

  return Array.from(found);
}

function resolveConfiguredSubseasonId(cfg, divisionId) {
  if (cfg.subseasonIdsByDivision && typeof cfg.subseasonIdsByDivision === 'object') {
    const key = String(divisionId);
    if (cfg.subseasonIdsByDivision[key]) return String(cfg.subseasonIdsByDivision[key]);
  }
  if (cfg.subseasonId) return String(cfg.subseasonId);
  return null;
}

function resolveLeaguePath(cfg) {
  if (cfg.leaguePath) {
    return String(cfg.leaguePath).startsWith('/') ? String(cfg.leaguePath) : `/${cfg.leaguePath}`;
  }

  if (cfg.leagueUrl) {
    try {
      return new URL(cfg.leagueUrl).pathname;
    } catch (_) {
      const match = String(cfg.leagueUrl).match(/https?:\/\/[^/]+(\/[^?#]+)/i);
      if (match) return match[1];
    }
  }

  return null;
}

function normalizeBaseUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return null;
  }
}

async function fetchHtml(url) {
  const resp = await axios.get(url, {
    timeout: 30000,
    maxRedirects: 5,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  return resp.data;
}

function deriveSeasonId(subseasonLabel, subseasonId) {
  if (subseasonLabel) {
    const yearMatch = String(subseasonLabel).match(/\b(20\d{2})\b/);
    if (yearMatch) return yearMatch[1];
  }
  return subseasonId ? String(subseasonId) : 'current';
}

function findHeaderIndex(headers, variants) {
  for (const variant of variants) {
    const idx = headers.indexOf(variant);
    if (idx >= 0) return idx;
  }
  return -1;
}

function cellText(cells, idx) {
  if (idx < 0 || idx >= cells.length) return '';
  return cleanText(cells.eq(idx).text());
}

function normalizeHeader(text) {
  return cleanText(text).toLowerCase();
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function parseNumber(text) {
  const raw = cleanText(text).replace(/,/g, '');
  if (!raw) return 0;
  const match = raw.match(/-?\d+(\.\d+)?/);
  if (!match) return 0;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : 0;
}

function parsePct(text) {
  const raw = cleanText(text);
  if (!raw) return null;
  if (/^\.\d+$/.test(raw)) return Number(raw);
  const num = parseNumber(raw);
  if (!Number.isFinite(num)) return null;
  if (num > 1 && num <= 100 && raw.includes('%')) return num / 100;
  return num;
}

function parseLevel(divisionName) {
  if (!divisionName) return null;
  const upper = divisionName.toUpperCase();
  if (/\bVARSITY\b/.test(upper)) return 'Varsity';
  if (/\bJV\b/.test(upper)) return 'JV';
  if (/\bAAA\b/.test(upper)) return 'AAA';
  if (/\bAA\b/.test(upper)) return 'AA';
  if (/\bA\b/.test(upper)) return 'A';
  if (/\bREC\b/.test(upper)) return 'Rec';
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  PLATFORM_ID,
  collectStandings,
};

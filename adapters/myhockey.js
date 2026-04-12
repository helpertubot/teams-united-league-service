/**
 * MYHockey Adapter
 *
 * HTML parser for MYHockey Rankings association/division pages.
 * Used by: youth hockey associations that publish records on myhockeyrankings.com.
 *
 * URL patterns:
 *   Association: https://www.myhockeyrankings.com/association-info?a={associationId}&y={year}
 *   Division:    https://www.myhockeyrankings.com/division-info?d={divisionId}&y={year}
 *
 * Table shape:
 *   Team Name | Division(s) | W-L-T | Rating
 *
 * sourceConfig schema:
 * {
 *   associationId: '1056',                 // required unless associationUrl provided
 *   associationUrl: 'https://www.myhockeyrankings.com/association-info?a=1056',
 *   year: 2025,                            // optional, MYHockey season year
 *   divisionIds: ['1769', '2540'],         // optional manual override
 *   baseUrl: 'https://www.myhockeyrankings.com'
 * }
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'myhockey';
const USER_AGENT = 'TeamsUnited-Standings/1.0';

async function collectStandings(leagueConfig) {
  const cfg = leagueConfig.sourceConfig || {};
  const base = (cfg.baseUrl || 'https://www.myhockeyrankings.com').replace(/\/+$/, '');
  const year = cfg.year ? String(cfg.year) : null;
  const associationId = extractAssociationId(cfg);

  if (!associationId && (!Array.isArray(cfg.divisionIds) || cfg.divisionIds.length === 0)) {
    throw new Error('MYHockey adapter requires sourceConfig.associationId (or associationUrl) or sourceConfig.divisionIds');
  }

  let divisionIds = Array.isArray(cfg.divisionIds) ? [...new Set(cfg.divisionIds.map(String))] : [];
  if (divisionIds.length === 0) {
    divisionIds = await discoverDivisionIds(base, associationId, year);
  }

  if (divisionIds.length === 0) {
    console.warn(`MYHockey: No divisions discovered for association ${associationId || 'n/a'}`);
    return { divisions: [], standings: [] };
  }

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  for (const divId of divisionIds) {
    const url = buildDivisionUrl(base, divId, year);
    let html;

    try {
      const resp = await axios.get(url, {
        timeout: 30000,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      });
      html = resp.data;
    } catch (err) {
      console.error(`MYHockey: Failed to fetch division ${divId}: ${err.message}`);
      continue;
    }

    const parsed = parseDivisionPage(html);
    if (parsed.teams.length === 0) {
      console.warn(`MYHockey: Division ${divId} returned no team rows`);
      continue;
    }

    const divisionId = `${leagueConfig.id}-${divId}`;
    const inferred = inferAgeGroup(parsed.name);

    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId: leagueConfig.seasonId || defaultSeasonId(year),
      name: parsed.name || `Division ${divId}`,
      ageGroup: inferred.ageGroup,
      gender: inferred.gender,
      level: parseLevel(parsed.name),
      platformDivisionId: String(divId),
      status: 'active',
    });

    for (let i = 0; i < parsed.teams.length; i++) {
      const team = parsed.teams[i];
      standings.push({
        teamName: team.teamName,
        position: i + 1,
        gamesPlayed: team.wins + team.losses + team.ties,
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        points: 0,
        scored: 0,
        allowed: 0,
        differential: 0,
        rating: team.rating,
        shutouts: 0,
        yellowCards: 0,
        redCards: 0,
        clubKey: null,
        teamKey: team.teamId || null,
        leagueId: leagueConfig.id,
        divisionId,
        seasonId: leagueConfig.seasonId || defaultSeasonId(year),
        collectedAt: now,
      });
    }

    await sleep(250);
  }

  console.log(`MYHockey: Collected ${divisions.length} divisions, ${standings.length} standings`);
  return { divisions, standings };
}

async function discoverDivisionIds(base, associationId, year) {
  const url = buildAssociationUrl(base, associationId, year);
  let html;
  try {
    const resp = await axios.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    });
    html = resp.data;
  } catch (err) {
    console.error(`MYHockey: Failed to fetch association ${associationId}: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const found = new Set();

  $('a[href*="/division-info"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/[?&]d=(\d+)/);
    if (match) found.add(match[1]);
  });

  return Array.from(found);
}

function parseDivisionPage(html) {
  const $ = cheerio.load(html);
  const name = parseDivisionName($);
  const teams = [];
  const table = $('table.rating-math').first();

  if (table.length === 0) {
    return { name, teams };
  }

  table.find('tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 4) return;

    const teamCell = $(cells[0]);
    const teamLink = teamCell.find('a').attr('href') || '';
    const teamIdMatch = teamLink.match(/[?&]t=(\d+)/);
    const teamName = teamCell.text().trim().replace(/\s+/g, ' ');
    if (!teamName) return;

    const recordText = $(cells[2]).text().trim();
    const { wins, losses, ties } = parseRecord(recordText);
    const rating = parseFloat($(cells[3]).text().trim()) || 0;

    teams.push({
      teamName,
      teamId: teamIdMatch ? teamIdMatch[1] : null,
      wins,
      losses,
      ties,
      rating,
    });
  });

  return { name, teams };
}

function parseDivisionName($) {
  const title = $('title').text().trim();
  const titleMatch = title.match(/^(.+?)\s*-\s*Division Information/i);
  if (titleMatch) return titleMatch[1].trim();

  const h1 = $('h1').first().text().trim();
  return h1 || 'Unknown Division';
}

function parseRecord(text) {
  const match = (text || '').match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
  if (!match) return { wins: 0, losses: 0, ties: 0 };
  return {
    wins: parseInt(match[1], 10) || 0,
    losses: parseInt(match[2], 10) || 0,
    ties: parseInt(match[3], 10) || 0,
  };
}

function parseLevel(divisionName) {
  if (!divisionName) return null;
  const upper = divisionName.toUpperCase();
  if (/\bAAA\b/.test(upper)) return 'AAA';
  if (/\bAA\b/.test(upper)) return 'AA';
  if (/\bA\b/.test(upper)) return 'A';
  if (/\bBB\b/.test(upper)) return 'BB';
  if (/\bB\b/.test(upper)) return 'B';
  if (/\bREC\b/.test(upper)) return 'Rec';
  return null;
}

function extractAssociationId(cfg) {
  if (cfg.associationId) return String(cfg.associationId);
  if (!cfg.associationUrl) return null;

  try {
    const url = new URL(cfg.associationUrl);
    const a = url.searchParams.get('a');
    return a ? String(a) : null;
  } catch (_) {
    const match = String(cfg.associationUrl).match(/[?&]a=(\d+)/);
    return match ? match[1] : null;
  }
}

function buildAssociationUrl(base, associationId, year) {
  const url = `${base}/association-info?a=${encodeURIComponent(String(associationId))}`;
  return year ? `${url}&y=${encodeURIComponent(year)}` : url;
}

function buildDivisionUrl(base, divisionId, year) {
  const url = `${base}/division-info?d=${encodeURIComponent(String(divisionId))}`;
  return year ? `${url}&y=${encodeURIComponent(year)}` : url;
}

function defaultSeasonId(year) {
  return year ? `${year}-${Number(year) + 1}` : '2025-2026';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { PLATFORM_ID, collectStandings };

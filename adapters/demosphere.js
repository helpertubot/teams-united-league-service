/**
 * Demosphere / OttoSport Adapter (v2 — JSON extraction)
 * 
 * Extracts standings from Demosphere / OttoSport standings pages.
 * Used by: Youth soccer leagues (NPSL, NCSL, and many others)
 * 
 * How it works:
 * 1. Fetches the main standings page (e.g., /fall-2024-standings)
 * 2. Finds the embedded iframe data-src pointing to elements.demosphere-secure.com
 * 3. Follows the redirect to get the static HTML URL
 * 4. Extracts the embedded JSON `tms` object (contains all teams + divisions inline)
 * 5. Groups teams by division (tg field) and builds standings
 * 
 * This approach is MUCH more reliable than Puppeteer rendering because:
 * - The JSON data is embedded directly in the static HTML
 * - No JS execution or browser rendering needed
 * - All divisions on a page are captured automatically (no pre-config needed)
 * 
 * sourceConfig modes:
 * A) Auto-discover (preferred): { baseUrl, standingsSlug, orgId }
 *    - Fetches the standings page, finds iframe, extracts all divisions
 * B) Legacy configured: { baseUrl, divisions: [{path, name, ageGroup, gender}] }
 *    - Falls back to per-division URL fetching (old behavior)
 */

const axios = require('axios');
const cheerio = require('cheerio');

const PLATFORM_ID = 'demosphere';

/**
 * Collect standings for a Demosphere league
 */
async function collectStandings(leagueConfig) {
  const { sourceConfig } = leagueConfig;
  
  // Mode A: Auto-discover from standings page (preferred)
  if (sourceConfig.standingsSlug || sourceConfig.elementsUrl) {
    return collectFromStandingsPage(leagueConfig);
  }
  
  // Mode B: Legacy per-division configured paths
  if (sourceConfig.divisions && Array.isArray(sourceConfig.divisions)) {
    return collectFromConfiguredDivisions(leagueConfig);
  }
  
  throw new Error(`Demosphere: No standingsSlug or divisions configured for ${leagueConfig.id}`);
}

/**
 * Mode A: Auto-discover all divisions from a single standings page
 */
async function collectFromStandingsPage(leagueConfig) {
  const { baseUrl, standingsSlug, orgId, elementsUrl } = leagueConfig.sourceConfig;
  
  let staticUrl;
  
  if (elementsUrl) {
    // Direct elements URL provided
    staticUrl = elementsUrl;
  } else {
    // Step 1: Fetch the main standings page to find the iframe data-src
    const pageUrl = normalizeBaseUrl(baseUrl) + '/' + standingsSlug;
    console.log(`Demosphere: Fetching standings page ${pageUrl}`);
    
    const pageResp = await axios.get(pageUrl, {
      timeout: 30000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'TeamsUnited-Standings/1.0', 'Accept': 'text/html' },
    });
    
    const $ = cheerio.load(pageResp.data);
    
    // Find the elements iframe data-src
    const dataSrc = $('[data-src*="elements.demosphere"]').attr('data-src');
    if (!dataSrc) {
      throw new Error(`Demosphere: No elements iframe found on ${pageUrl}`);
    }
    
    // Step 2: The iframe URL returns a 302 redirect to the static HTML.
    // We need the Location header URL, NOT the response body (which axios follows).
    const iframeUrl = dataSrc.startsWith('//') ? 'https:' + dataSrc : dataSrc;
    const cleanUrl = iframeUrl.split('#')[0];
    console.log(`Demosphere: Fetching iframe redirect from ${cleanUrl}`);
    
    try {
      // Don't follow redirects — we want the Location header
      const redirectResp = await axios.get(cleanUrl, {
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: { 'User-Agent': 'TeamsUnited-Standings/1.0' },
      });
      
      // If 200, parse the <a> href from the body
      const $redir = cheerio.load(redirectResp.data);
      staticUrl = $redir('a').attr('href');
    } catch (redirErr) {
      // axios throws on 3xx when maxRedirects=0 — extract Location from the error response
      if (redirErr.response && redirErr.response.headers && redirErr.response.headers.location) {
        staticUrl = redirErr.response.headers.location;
      } else if (redirErr.response && redirErr.response.data) {
        // Fallback: parse body
        const $redir = cheerio.load(redirErr.response.data);
        staticUrl = $redir('a').attr('href');
      }
    }
    
    if (!staticUrl || staticUrl === '#') {
      throw new Error(`Demosphere: Could not extract static URL from iframe redirect at ${cleanUrl}`);
    }
  }
  
  console.log(`Demosphere: Fetching static standings from ${staticUrl}`);
  
  // Step 3: Fetch the static HTML containing embedded JSON
  const htmlResp = await axios.get(staticUrl, {
    timeout: 30000,
    headers: { 'User-Agent': 'TeamsUnited-Standings/1.0' },
  });
  
  const html = htmlResp.data;
  
  // Step 4: Extract the tms JSON object
  const tms = extractTmsJson(html);
  if (!tms || Object.keys(tms).length === 0) {
    console.warn(`Demosphere: No team data found in ${staticUrl}`);
    return { divisions: [], standings: [] };
  }
  
  console.log(`Demosphere: Extracted ${Object.keys(tms).length} team entries`);
  
  // Step 5: Group teams by division and build results
  return buildFromTms(tms, leagueConfig);
}

/**
 * Mode B: Legacy — fetch each configured division URL separately
 */
async function collectFromConfiguredDivisions(leagueConfig) {
  const { baseUrl, divisions: divConfigs } = leagueConfig.sourceConfig;
  
  if (!divConfigs || !Array.isArray(divConfigs) || divConfigs.length === 0) {
    console.warn(`Demosphere: No divisions configured for ${leagueConfig.id}`);
    return { divisions: [], standings: [] };
  }

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  for (const divConfig of divConfigs) {
    const url = normalizeBaseUrl(baseUrl) + divConfig.path;
    
    try {
      // Try to fetch and check if it has embedded JSON (OttoSport pages)
      const resp = await axios.get(url, {
        timeout: 30000,
        maxRedirects: 5,
        headers: { 'User-Agent': 'TeamsUnited-Standings/1.0', 'Accept': 'text/html' },
      });
      
      const html = resp.data;
      const $ = cheerio.load(html);
      
      // Check if this page has an elements iframe (auto-discover)
      const dataSrc = $('[data-src*="elements.demosphere"]').attr('data-src');
      if (dataSrc) {
        // This is actually a full standings page — use auto-discover
        console.log(`Demosphere: Division URL ${url} has elements iframe, switching to auto-discover`);
        const result = await collectFromStandingsPage({
          ...leagueConfig,
          sourceConfig: { ...leagueConfig.sourceConfig, standingsSlug: divConfig.path.replace(/^\//, '') }
        });
        divisions.push(...result.divisions);
        standings.push(...result.standings);
        continue;
      }
      
      // Otherwise try legacy table parsing
      parseHtmlTables($, html, divConfig, leagueConfig, divisions, standings, now);
    } catch (err) {
      console.error(`Demosphere: Failed to fetch ${url}: ${err.message}`);
      continue;
    }
    
    await sleep(500);
  }

  return { divisions, standings };
}

/**
 * Extract the embedded tms JSON from a Demosphere elements HTML page
 */
function extractTmsJson(html) {
  const start = html.indexOf('tms:{');
  if (start === -1) return null;
  
  const jsonStart = start + 4; // skip 'tms:'
  let depth = 0;
  let end = jsonStart;
  
  for (let i = jsonStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  
  let jsonStr = html.substring(jsonStart, end);
  // Clean up JS-style JSON (trailing commas, \r\n)
  jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/\r\n/g, '\n');
  
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(`Demosphere: Failed to parse tms JSON: ${e.message}`);
    return null;
  }
}

/**
 * Build divisions and standings from the extracted tms data
 */
function buildFromTms(tms, leagueConfig) {
  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();
  
  // Group teams by division (tg field)
  const divGroups = {};
  for (const [tmId, team] of Object.entries(tms)) {
    const tg = team.tg || 'unknown';
    const tgnm = team.tgnm || 'Unknown Division';
    
    if (!divGroups[tg]) {
      divGroups[tg] = { name: tgnm, teams: [] };
    }
    divGroups[tg].teams.push(team);
  }
  
  // Build division and standings entries
  for (const [tgKey, divGroup] of Object.entries(divGroups)) {
    const divName = divGroup.name;
    const divisionId = `${leagueConfig.id}-${slugify(divName)}`;
    
    // Parse age group and gender from division name (e.g., "BU13 Division 1 (12)")
    const { ageGroup, gender } = parseDivisionName(divName);
    
    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId: leagueConfig.seasonId || '2025-2026',
      name: divName,
      ageGroup: ageGroup,
      gender: gender,
      level: extractLevel(divName),
      platformDivisionId: tgKey,
      status: 'active',
    });
    
    // Sort teams by rank, then by points descending
    const sortedTeams = divGroup.teams.sort((a, b) => {
      const rankA = parseInt(a.rank) || 999;
      const rankB = parseInt(b.rank) || 999;
      if (rankA !== rankB) return rankA - rankB;
      return (parseInt(b.TOT_PTS) || 0) - (parseInt(a.TOT_PTS) || 0);
    });
    
    for (let i = 0; i < sortedTeams.length; i++) {
      const t = sortedTeams[i];
      const wins = parseInt(t.TOT_W) || 0;
      const losses = parseInt(t.TOT_L) || 0;
      const ties = parseInt(t.TOT_T) || 0;
      const scored = parseInt(t.TOT_GF) || 0;
      const allowed = parseInt(t.TOT_GA) || 0;
      
      standings.push({
        teamName: (t.tmnm || '').trim(),
        position: i + 1,
        gamesPlayed: parseInt(t.TOT_GP || t.gp) || (wins + losses + ties),
        wins,
        losses,
        ties,
        points: parseInt(t.TOT_PTS) || 0,
        scored,
        allowed,
        differential: parseInt(t.TOT_GD) || (scored - allowed),
        shutouts: 0,
        yellowCards: 0,
        redCards: 0,
        clubKey: t.cb || null,
        teamKey: t.tm || null,
        leagueId: leagueConfig.id,
        divisionId,
        seasonId: leagueConfig.seasonId || '2025-2026',
        collectedAt: now,
      });
    }
  }
  
  console.log(`Demosphere: Built ${divisions.length} divisions, ${standings.length} standings entries`);
  return { divisions, standings };
}

/**
 * Parse age group and gender from Demosphere division names
 * Patterns: "BU13 Division 1 (12)", "GU10 Division 1-2 (15)", "BU19 Division 2 (06)"
 * B = Boys, G = Girls, U = Under
 */
function parseDivisionName(name) {
  // Pattern: BU## or GU##
  const match = name.match(/^(B|G)U(\d+)/i);
  if (match) {
    const gender = match[1].toUpperCase() === 'B' ? 'boys' : 'girls';
    const ageNum = parseInt(match[2]);
    return {
      gender,
      ageGroup: `U${ageNum}`,
    };
  }
  
  // Fallback patterns
  const genderMatch = name.match(/\b(boys?|girls?|men|women|co-?ed|mixed)\b/i);
  const ageMatch = name.match(/\b(U-?\d+|under\s*\d+|\d+\s*&?\s*under)\b/i);
  
  return {
    gender: genderMatch ? genderMatch[1].toLowerCase().replace(/s$/, '') : 'unknown',
    ageGroup: ageMatch ? ageMatch[1].replace(/\s+/g, '') : 'unknown',
  };
}

/**
 * Extract division level from name
 */
function extractLevel(name) {
  const match = name.match(/Division\s+(\d+)/i);
  if (match) return `D${match[1]}`;
  
  const levelMatch = name.match(/\b(Premier|Elite|Gold|Silver|Bronze|Platinum|Championship)\b/i);
  if (levelMatch) return levelMatch[1];
  
  return null;
}

/**
 * Legacy: Parse HTML tables from old-style Demosphere pages
 */
function parseHtmlTables($, html, divConfig, leagueConfig, divisions, standings, now) {
  const $page = typeof html === 'string' ? cheerio.load(html) : $;
  
  const tables = $page('table').filter((i, table) => {
    const hasBorder = $page(table).attr('border') === '1';
    const hasWidth = ($page(table).attr('style') || '').includes('width');
    const hasStrongHeaders = $page(table).find('tr:first-child strong').length > 0;
    return (hasBorder || hasWidth) && hasStrongHeaders;
  });

  if (tables.length === 0) {
    const fallback = $page('table').filter((i, table) => {
      const headerText = $page(table).find('tr:first-child').text();
      return headerText.includes('W') && headerText.includes('L') && headerText.includes('Pts');
    });
    if (fallback.length > 0) {
      parseTable($page, fallback.first(), divConfig, leagueConfig, divisions, standings, now);
    } else {
      console.warn(`Demosphere: No standings table found for ${divConfig.name}`);
    }
    return;
  }

  tables.each((tableIdx, table) => {
    parseTable($page, $page(table), divConfig, leagueConfig, divisions, standings, now, tableIdx);
  });
}

function parseTable($, $table, divConfig, leagueConfig, divisions, standings, now, tableIdx = 0) {
  const suffix = tableIdx > 0 ? `-${tableIdx}` : '';
  const divisionId = `${leagueConfig.id}-${slugify(divConfig.name)}${suffix}`;

  divisions.push({
    id: divisionId,
    leagueId: leagueConfig.id,
    seasonId: leagueConfig.seasonId || '2025-2026',
    name: divConfig.name,
    ageGroup: divConfig.ageGroup || 'unknown',
    gender: divConfig.gender || 'unknown',
    level: divConfig.level || null,
    platformDivisionId: divConfig.path,
    status: 'active',
  });

  const rows = $table.find('tr');
  if (rows.length < 2) return;

  const headerRow = $(rows[0]);
  const headers = [];
  headerRow.find('td').each((i, td) => {
    const text = $(td).find('strong').text().trim() || $(td).text().trim();
    headers.push(text.toUpperCase());
  });

  const colIdx = {};
  headers.forEach((h, i) => {
    if (h === 'W') colIdx.wins = i;
    else if (h === 'L') colIdx.losses = i;
    else if (h === 'T') colIdx.ties = i;
    else if (h === 'PTS') colIdx.points = i;
    else if (h === 'GF') colIdx.scored = i;
    else if (h === 'GA') colIdx.allowed = i;
    else if (h === 'GP' || h === 'MP') colIdx.gamesPlayed = i;
    else if (h === 'GD') colIdx.differential = i;
  });

  if (colIdx.wins === undefined) return;

  for (let r = 1; r < rows.length; r++) {
    const cells = $(rows[r]).find('td');
    if (cells.length < 4) continue;

    const teamCell = $(cells[0]);
    const teamName = teamCell.find('strong').text().trim() || 
                     teamCell.find('a').text().trim() || 
                     teamCell.text().trim();
    
    if (!teamName || teamName === '&nbsp;') continue;

    const wins = parseInt(getCellText($, cells, colIdx.wins)) || 0;
    const losses = parseInt(getCellText($, cells, colIdx.losses)) || 0;
    const ties = parseInt(getCellText($, cells, colIdx.ties)) || 0;
    const scored = parseInt(getCellText($, cells, colIdx.scored)) || 0;
    const allowed = parseInt(getCellText($, cells, colIdx.allowed)) || 0;

    standings.push({
      teamName,
      position: r,
      gamesPlayed: colIdx.gamesPlayed !== undefined
        ? parseInt(getCellText($, cells, colIdx.gamesPlayed)) || 0
        : wins + losses + ties,
      wins,
      losses,
      ties,
      points: parseInt(getCellText($, cells, colIdx.points)) || 0,
      scored,
      allowed,
      differential: colIdx.differential !== undefined
        ? parseInt(getCellText($, cells, colIdx.differential)) || 0
        : scored - allowed,
      shutouts: 0,
      yellowCards: 0,
      redCards: 0,
      clubKey: null,
      teamKey: null,
      leagueId: leagueConfig.id,
      divisionId,
      seasonId: leagueConfig.seasonId || '2025-2026',
      collectedAt: now,
    });
  }
}

function getCellText($, cells, idx) {
  if (idx === undefined || idx >= cells.length) return '0';
  return $(cells[idx]).text().trim() || '0';
}

function normalizeBaseUrl(url) {
  // Ensure https and remove trailing slash
  let normalized = url.replace(/\/$/, '');
  if (normalized.startsWith('//')) normalized = 'https:' + normalized;
  if (!normalized.startsWith('http')) normalized = 'https://' + normalized;
  // Auto-swap demosphere-secure.com → ottosport.ai (redirects happen anyway)
  return normalized;
}

function slugify(text) {
  return (text || 'division')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { PLATFORM_ID, collectStandings };

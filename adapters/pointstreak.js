/**
 * Pointstreak Adapter
 * 
 * HTML parser for Pointstreak standings pages.
 * Used by: Youth/adult baseball and hockey leagues across North America
 * 
 * Baseball URL: baseball.pointstreak.com/standings.html?leagueid={id}&seasonid={id}
 * Hockey URL:   stats.pointstreak.com/standings.html?leagueid={id}&seasonid={id}
 * 
 * Table selector: table.nova-stats-table
 * Baseball columns: TEAM, W, L, PCT, GB, STREAK, LAST 10
 * Hockey columns:   TEAM, GP, W, L, T, OTL, PTS (varies by league config)
 * 
 * NOTE: Server-rendered HTML. Baseball may have multiple division tables on one page.
 * Hockey pages use a single table. Division headers are identified by ID attributes
 * like "division_XXXXX".
 */

const axios = require('axios');
const cheerio = require('cheerio');

const PLATFORM_ID = 'pointstreak';

/**
 * Collect standings for a Pointstreak league
 * @param {Object} leagueConfig
 * @param {string} leagueConfig.sourceConfig.sport - 'baseball' or 'hockey'
 * @param {string} leagueConfig.sourceConfig.leagueId - Pointstreak league ID
 * @param {string} leagueConfig.sourceConfig.seasonId - Pointstreak season ID
 * @param {string} [leagueConfig.sourceConfig.baseUrl] - Override base URL
 * @param {Array}  [leagueConfig.sourceConfig.divisionMeta] - Optional metadata { divisionId: { ageGroup, gender } }
 * @returns {Object} { divisions: [...], standings: [...] }
 */
async function collectStandings(leagueConfig) {
  const { sport, leagueId, seasonId, baseUrl, divisionMeta } = leagueConfig.sourceConfig;
  const meta = divisionMeta || {};
  
  // If we have explicit division IDs in divisionMeta, fetch each one directly
  // This is needed for hockey where per-division URLs are the norm
  const divisionIds = Object.keys(meta);
  if (divisionIds.length > 0 && sport === 'hockey') {
    return collectByDivision(leagueConfig, divisionIds, meta);
  }
  
  // Otherwise use league-level URL (works for baseball, some hockey)
  let base;
  if (baseUrl) {
    base = baseUrl;
  } else if (sport === 'hockey') {
    base = 'https://stats.pointstreak.com';
  } else {
    base = 'https://baseball.pointstreak.com';
  }

  const url = `${base}/standings.html?leagueid=${leagueId}&seasonid=${seasonId}`;
  
  let html;
  try {
    const resp = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'TeamsUnited-Standings/1.0',
        'Accept': 'text/html',
      },
    });
    html = resp.data;
  } catch (err) {
    console.error(`Pointstreak: Failed to fetch league ${leagueId}: ${err.message}`);
    return { divisions: [], standings: [] };
  }

  const $ = cheerio.load(html);
  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  // Pointstreak renders divisions in two ways:
  // 1. Baseball: Multiple tables with IDs like "division_12345"
  // 2. Hockey: Single table, sometimes with division name rows

  const tables = $('table.nova-stats-table');

  if (tables.length === 0) {
    console.warn(`Pointstreak: No standings tables found at ${url}`);
    return { divisions, standings };
  }

  tables.each((tableIdx, table) => {
    // Try to get division name from nearby heading or table ID
    const tableId = $(table).attr('id') || '';
    const divIdMatch = tableId.match(/division_(\d+)/);
    const platformDivId = divIdMatch ? divIdMatch[1] : `div-${tableIdx}`;

    // Look for division name in preceding element
    let divisionName = '';
    const prevEl = $(table).prev();
    if (prevEl.length) {
      divisionName = prevEl.text().trim();
    }
    if (!divisionName) {
      divisionName = `Division ${tableIdx + 1}`;
    }

    const divisionId = `${leagueConfig.id}-${platformDivId}`;
    const divMeta = meta[platformDivId] || {};

    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId: leagueConfig.seasonId || '2025-2026',
      name: divisionName,
      ageGroup: divMeta.ageGroup || 'open',
      gender: divMeta.gender || 'mixed',
      level: divMeta.level || null,
      platformDivisionId: platformDivId,
      status: 'active',
    });

    // Parse column headers to determine stats structure
    const headers = [];
    $(table).find('thead th').each((i, th) => {
      headers.push($(th).text().trim().toUpperCase());
    });

    // Parse each row
    const rows = $(table).find('tbody tr');
    rows.each((rowIdx, row) => {
      const cells = $(row).find('td');
      if (cells.length < 3) return; // Skip malformed

      // Build a cell map from headers
      const cellMap = {};
      cells.each((i, cell) => {
        if (i < headers.length) {
          cellMap[headers[i]] = $(cell).text().trim();
        }
      });

      // Team name is always first column (with possible link)
      const teamCell = $(cells[0]);
      // Use link text if available (cleaner), fall back to full cell text
      const teamName = (teamCell.find('a').first().text().trim() || teamCell.text().trim()).replace(/\s+/g, ' ');
      if (!teamName) return;

      const teamLink = teamCell.find('a').attr('href') || '';
      const teamIdMatch = teamLink.match(/teamid=(\d+)/);
      const platformTeamId = teamIdMatch ? teamIdMatch[1] : null;

      // Normalize across baseball/hockey column names
      const wins = parseInt(cellMap['W'] || '0');
      const losses = parseInt(cellMap['L'] || '0');
      const ties = parseInt(cellMap['T'] || cellMap['OTL'] || '0');
      const gamesPlayed = parseInt(cellMap['GP'] || '0') || (wins + losses + ties);
      const points = parseInt(cellMap['PTS'] || '0') || wins; // Baseball doesn't have PTS
      const pct = cellMap['PCT'] || null;
      const gamesBack = cellMap['GB'] || null;
      const streak = cellMap['STREAK'] || null;

      // Goals/runs columns (hockey vs baseball)
      const scored = parseInt(cellMap['GF'] || cellMap['RS'] || cellMap['R'] || '0');
      const allowed = parseInt(cellMap['GA'] || cellMap['RA'] || '0');

      standings.push({
        teamName,
        position: rowIdx + 1,
        gamesPlayed,
        wins,
        losses,
        ties,
        points,
        scored,
        allowed,
        differential: scored - allowed,
        // Pointstreak-specific extras stored as metadata
        winPct: pct ? parseFloat(pct) : null,
        gamesBack,
        streak,
        shutouts: 0,
        yellowCards: 0,
        redCards: 0,
        clubKey: null,
        teamKey: platformTeamId,
        leagueId: leagueConfig.id,
        divisionId,
        seasonId: leagueConfig.seasonId || '2025-2026',
        collectedAt: now,
      });
    });
  });

  return { divisions, standings };
}

/**
 * Collect standings from individual division pages (hockey pattern)
 * URL: https://pointstreak.com/players/players-division-standings.html?divisionid={id}&seasonid={id}
 */
async function collectByDivision(leagueConfig, divisionIds, meta) {
  const { seasonId } = leagueConfig.sourceConfig;
  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  for (const divId of divisionIds) {
    const url = `https://pointstreak.com/players/players-division-standings.html?divisionid=${divId}&seasonid=${seasonId}`;
    
    let html;
    try {
      const resp = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) TeamsUnited-Standings/1.0',
          'Accept': 'text/html',
        },
      });
      html = resp.data;
    } catch (err) {
      console.error(`Pointstreak: Failed to fetch division ${divId}: ${err.message}`);
      continue;
    }

    const $ = cheerio.load(html);
    const divMeta = meta[divId] || {};
    
    // Get division name from page
    let divisionName = $('h1, h2, .division-name, .page-title').first().text().trim();
    if (!divisionName || divisionName.length > 100) {
      divisionName = divMeta.ageGroup ? `${divMeta.ageGroup} ${divMeta.gender || ''}`.trim() : `Division ${divId}`;
    }
    
    const divisionId = `${leagueConfig.id}-${divId}`;
    
    // Find standings table — Pointstreak division pages use plain tables
    // Headers are in tr.fields with td elements (not th), data rows use whiteCell/lightGrey
    const tables = $('table');
    let foundTable = null;
    
    tables.each((i, table) => {
      const headerRow = $(table).find('tr.fields').first();
      if (headerRow.length === 0) return;
      
      const headers = [];
      headerRow.find('td, th').each((_, cell) => {
        const text = $(cell).text().trim().toUpperCase();
        headers.push(text);
      });
      // Look for a table with hockey standings columns
      if (headers.some(h => ['W', 'GP', 'PTS'].includes(h))) {
        foundTable = { table, headers };
        return false; // break
      }
    });

    if (!foundTable) {
      console.warn(`Pointstreak: No standings table found for division ${divId}`);
      continue;
    }

    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId: leagueConfig.seasonId || '2025-2026',
      name: divisionName,
      ageGroup: divMeta.ageGroup || 'open',
      gender: divMeta.gender || 'mixed',
      level: divMeta.level || null,
      platformDivisionId: divId,
      status: 'active',
    });

    const { table, headers } = foundTable;
    // Data rows have class whiteCell or lightGrey
    $(table).find('tr.whiteCell, tr.lightGrey').each((rowIdx, row) => {
      const cells = $(row).find('td');
      if (cells.length < 3) return;

      const cellMap = {};
      cells.each((i, cell) => {
        if (i < headers.length) {
          cellMap[headers[i]] = $(cell).text().trim();
        }
      });

      const teamCell = $(cells[0]);
      const teamName = (teamCell.find('a').first().text().trim() || teamCell.text().trim()).replace(/\s+/g, ' ');
      if (!teamName || teamName === 'TEAM') return;

      const wins = parseInt(cellMap['W'] || '0');
      const losses = parseInt(cellMap['L'] || '0');
      const ties = parseInt(cellMap['T'] || cellMap['OTL'] || '0');
      const gamesPlayed = parseInt(cellMap['GP'] || '0') || (wins + losses + ties);
      const points = parseInt(cellMap['PTS'] || '0') || wins;
      const scored = parseInt(cellMap['GF'] || cellMap['RS'] || '0');
      const allowed = parseInt(cellMap['GA'] || cellMap['RA'] || '0');

      standings.push({
        teamName,
        position: rowIdx + 1,
        gamesPlayed,
        wins,
        losses,
        ties,
        points,
        scored,
        allowed,
        differential: scored - allowed,
        winPct: cellMap['PCT'] ? parseFloat(cellMap['PCT']) : null,
        gamesBack: cellMap['GB'] || null,
        streak: cellMap['STREAK'] || null,
        shutouts: 0, yellowCards: 0, redCards: 0,
        clubKey: null, teamKey: null,
        leagueId: leagueConfig.id,
        divisionId,
        seasonId: leagueConfig.seasonId || '2025-2026',
        collectedAt: now,
      });
    });
  }

  return { divisions, standings };
}

module.exports = { PLATFORM_ID, collectStandings };

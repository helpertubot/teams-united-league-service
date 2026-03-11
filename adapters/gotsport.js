/**
 * GotSport Adapter
 * 
 * HTML parser for GotSport league standings pages.
 * Used by: Youth soccer LEAGUE PLAY — WPL, PSPL, state leagues, NPL leagues
 * 
 * NOTE: GotSport uses the term "event" for both tournaments AND league seasons.
 * We only use this adapter for LEAGUE PLAY (seasonal standings), not tournaments.
 * Our config uses "leagueEventId" to make this clear — it maps to GotSport's
 * event ID parameter in the URL.
 * 
 * URL Pattern: https://system.gotsport.com/org_event/events/{LEAGUE_EVENT_ID}/results?group={GROUP_ID}
 * Table selector: table.table-bordered.table-hover.table-condensed
 * Columns: (index), Team, MP, W, L, D, GF, GA, GD, PTS
 * 
 * GotSport standings are server-rendered HTML. No JSON API available.
 * Each "group" (division) has its own GROUP_ID and may contain multiple brackets (A, B, etc.).
 */

const axios = require('axios');
const cheerio = require('cheerio');

const PLATFORM_ID = 'gotsport';

/**
 * Collect standings for a GotSport league season
 * @param {Object} leagueConfig
 * @param {string} leagueConfig.sourceConfig.leagueEventId - GotSport league event ID (or legacy "eventId")
 * @param {Array}  leagueConfig.sourceConfig.groups - Array of { groupId, name, ageGroup, gender }
 * @param {string} [leagueConfig.sourceConfig.baseUrl] - Override base URL
 * @returns {Object} { divisions: [...], standings: [...] }
 */
async function collectStandings(leagueConfig) {
  const { leagueEventId, eventId, groups, baseUrl } = leagueConfig.sourceConfig;
  // Support both new "leagueEventId" and legacy "eventId" field names
  const gsEventId = leagueEventId || eventId;
  const base = baseUrl || 'https://system.gotsport.com';

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  for (const group of groups) {
    const url = `${base}/org_event/events/${gsEventId}/results?group=${group.groupId}`;
    
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
      console.error(`GotSport: Failed to fetch group ${group.groupId}: ${err.message}`);
      continue;
    }

    const $ = cheerio.load(html);
    
    // Each bracket is a separate table with the same class
    const tables = $('table.table-bordered.table-hover.table-condensed');
    
    if (tables.length === 0) {
      // Fallback: try any table with table-condensed class
      const fallback = $('table.table-condensed');
      if (fallback.length > 0) {
        parseTables($, fallback, group, leagueConfig, divisions, standings, now);
      } else {
        console.warn(`GotSport: No standings tables found for group ${group.groupId}`);
      }
    } else {
      parseTables($, tables, group, leagueConfig, divisions, standings, now);
    }

    // Throttle requests — be respectful
    await sleep(500);
  }

  return { divisions, standings };
}

function parseTables($, tables, group, leagueConfig, divisions, standings, now) {
  tables.each((tableIdx, table) => {
    // If multiple brackets, label them A, B, C...
    const bracketLabel = tables.length > 1 ? ` Bracket ${String.fromCharCode(65 + tableIdx)}` : '';
    const divisionName = `${group.name}${bracketLabel}`;
    const divisionId = `${leagueConfig.id}-${group.groupId}${bracketLabel ? `-${String.fromCharCode(97 + tableIdx)}` : ''}`;

    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId: leagueConfig.seasonId || '2025-2026',
      name: divisionName,
      ageGroup: group.ageGroup || 'unknown',
      gender: group.gender || 'unknown',
      level: group.level || null,
      platformDivisionId: `${group.groupId}${bracketLabel ? `-${tableIdx}` : ''}`,
      status: 'active',
    });

    const rows = $(table).find('tbody tr');
    rows.each((rowIdx, row) => {
      const cells = $(row).find('td');
      if (cells.length < 10) return; // Skip malformed rows

      const teamName = $(cells[1]).text().trim();
      if (!teamName) return;

      // Extract team link for potential ID mapping
      const teamLink = $(cells[1]).find('a').attr('href') || '';
      const teamIdMatch = teamLink.match(/team=(\d+)/);
      const platformTeamId = teamIdMatch ? teamIdMatch[1] : null;

      standings.push({
        teamName,
        position: parseInt($(cells[0]).text().trim()) || (rowIdx + 1),
        gamesPlayed: parseInt($(cells[2]).text().trim()) || 0, // MP
        wins: parseInt($(cells[3]).text().trim()) || 0,
        losses: parseInt($(cells[4]).text().trim()) || 0,
        ties: parseInt($(cells[5]).text().trim()) || 0, // D (draws)
        points: parseInt($(cells[9]).text().trim()) || 0, // PTS
        scored: parseInt($(cells[6]).text().trim()) || 0, // GF
        allowed: parseInt($(cells[7]).text().trim()) || 0, // GA
        differential: parseInt($(cells[8]).text().trim()) || 0, // GD
        shutouts: 0, // Not available on GotSport
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
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { PLATFORM_ID, collectStandings };

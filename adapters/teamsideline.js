/**
 * TeamSideline Adapter
 *
 * HTML parser for TeamSideline.com league standings pages.
 * Used by: Youth lacrosse, soccer, football, and other sports orgs hosted on TeamSideline.
 *
 * TeamSideline uses ASP.NET with Telerik RadGrid controls for standings tables.
 * Standings are server-rendered HTML — no API needed.
 *
 * URL Patterns:
 *   Schedule listing: https://{domain}/Layouts/minimalist/Schedules.aspx?d={encodedParam}
 *   Or via custom domain: https://{customDomain}/schedules
 *   Individual schedule: https://{domain}/sites/{siteName}/schedule/{scheduleId}/
 *
 * Standings table: Telerik RadGrid with class "RadGrid"
 *   Columns: Place, Team, W, L, T, GP, PCT, Streak, AGD
 *   Row classes: rgRow / rgAltRow
 *
 * sourceConfig requirements:
 *   - baseUrl: The org's TeamSideline base URL (e.g., "https://mountainlax.com")
 *   - siteName: The TeamSideline site name (e.g., "MountainLacrosse")
 *   - schedules: Array of { scheduleId, name, ageGroup, gender } for specific divisions
 *     OR omit to auto-discover all schedules from the listing page
 *   - schedulesUrl: (optional) Direct URL to the schedules listing page
 */

const axios = require('axios');
const cheerio = require('cheerio');

const PLATFORM_ID = 'teamsideline';

const USER_AGENT = 'TeamsUnited-Standings/1.0';

/**
 * Collect standings for a TeamSideline league
 */
async function collectStandings(leagueConfig) {
  const { baseUrl, siteName, schedules, schedulesUrl } = leagueConfig.sourceConfig;

  if (!baseUrl || !siteName) {
    throw new Error('TeamSideline adapter requires baseUrl and siteName in sourceConfig');
  }

  // Either use provided schedules or discover them
  const divisionSchedules = schedules || await discoverSchedules(baseUrl, siteName, schedulesUrl);

  if (!divisionSchedules || divisionSchedules.length === 0) {
    console.warn('TeamSideline: No schedules found');
    return { divisions: [], standings: [] };
  }

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  for (const schedule of divisionSchedules) {
    const scheduleId = schedule.scheduleId;
    const url = `${baseUrl}/sites/${siteName}/schedule/${scheduleId}/`;

    let html;
    try {
      const resp = await axios.get(url, {
        timeout: 30000,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
      });
      html = resp.data;
    } catch (err) {
      console.error(`TeamSideline: Failed to fetch schedule ${scheduleId}: ${err.message}`);
      continue;
    }

    const $ = cheerio.load(html);
    const divisionId = `${leagueConfig.id}-${scheduleId}`;
    const divisionName = schedule.name || `Division ${scheduleId}`;

    // Parse age group and gender from name if not provided
    const ageGroup = schedule.ageGroup || parseAgeGroup(divisionName);
    const gender = schedule.gender || parseGender(divisionName);

    // Find the standings grid (Telerik RadGrid)
    const standingsTable = $('div[id*="standingsGrid"] table.rgMasterTable, div[id*="StandingsGrid"] table.rgMasterTable');

    if (standingsTable.length === 0) {
      console.warn(`TeamSideline: No standings table found for schedule ${scheduleId} (${divisionName})`);
      continue;
    }

    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId: leagueConfig.seasonId || '2025-2026',
      name: divisionName,
      ageGroup,
      gender,
      level: schedule.level || null,
      platformDivisionId: String(scheduleId),
      status: 'active',
    });

    // Parse standings rows (rgRow and rgAltRow)
    const rows = standingsTable.find('tbody tr.rgRow, tbody tr.rgAltRow');
    rows.each((rowIdx, row) => {
      const cells = $(row).find('td');
      if (cells.length < 6) return;

      const teamName = $(cells[1]).text().trim();
      if (!teamName) return;

      const place = parseInt($(cells[0]).text().trim()) || (rowIdx + 1);
      const wins = parseInt($(cells[2]).text().trim()) || 0;
      const losses = parseInt($(cells[3]).text().trim()) || 0;
      const ties = parseInt($(cells[4]).text().trim()) || 0;
      const gamesPlayed = parseInt($(cells[5]).text().trim()) || 0;

      // PCT and AGD may be '--' for teams with no games
      const pctText = cells.length > 6 ? $(cells[6]).text().trim() : '--';
      const agdText = cells.length > 8 ? $(cells[8]).text().trim() : '--';

      standings.push({
        teamName,
        position: place,
        gamesPlayed,
        wins,
        losses,
        ties,
        points: 0, // TeamSideline uses PCT not points
        scored: 0, // Not available in standings table
        allowed: 0,
        differential: agdText !== '--' ? parseFloat(agdText) || 0 : 0,
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
    });

    // Throttle requests
    await sleep(500);
  }

  return { divisions, standings };
}

/**
 * Discover available schedules from the TeamSideline listing page
 */
async function discoverSchedules(baseUrl, siteName, schedulesUrl) {
  // Try the custom domain schedules page first, then the TeamSideline layout
  const urls = [
    schedulesUrl,
    `${baseUrl}/schedules`,
    `${baseUrl}/Org/Schedules.aspx`,
  ].filter(Boolean);

  for (const url of urls) {
    try {
      const resp = await axios.get(url, {
        timeout: 30000,
        maxRedirects: 5,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
      });

      const $ = cheerio.load(resp.data);
      const schedules = [];

      // Find all schedule links matching /sites/{siteName}/schedule/{id}/
      const pattern = new RegExp(`/sites/${siteName}/schedule/(\\d+)/`, 'i');
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        const match = href && href.match(pattern);
        if (match) {
          const scheduleId = match[1];
          const name = $(el).text().trim();
          // Avoid duplicates
          if (!schedules.find(s => s.scheduleId === scheduleId)) {
            schedules.push({
              scheduleId,
              name,
              ageGroup: parseAgeGroup(name),
              gender: parseGender(name),
            });
          }
        }
      });

      if (schedules.length > 0) {
        return schedules;
      }
    } catch (err) {
      console.warn(`TeamSideline: Failed to discover schedules from ${url}: ${err.message}`);
    }
  }

  return [];
}

/**
 * Parse age group from division name
 * Examples: "2nd Grade Boys 7V7" -> "2nd Grade", "U12 Gold" -> "U12"
 */
function parseAgeGroup(name) {
  // Match grade patterns: "K/1st Grade", "2nd Grade", "3rd Grade", etc.
  const gradeMatch = name.match(/(K\/?\d*(?:st|nd|rd|th)?\s*Grade|\d+(?:st|nd|rd|th)\s*Grade)/i);
  if (gradeMatch) return gradeMatch[1];

  // Match U-age patterns: "U12", "U14", etc.
  const uMatch = name.match(/(U\d+)/i);
  if (uMatch) return uMatch[1];

  return 'unknown';
}

/**
 * Parse gender from division name
 */
function parseGender(name) {
  if (/\bgirls?\b/i.test(name)) return 'Girls';
  if (/\bboys?\b/i.test(name)) return 'Boys';
  if (/\bwomen\b/i.test(name)) return 'Women';
  if (/\bmen\b/i.test(name)) return 'Men';
  if (/\bcoed\b/i.test(name)) return 'Coed';
  return 'unknown';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { PLATFORM_ID, collectStandings, discoverSchedules };

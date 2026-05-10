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

    const divisionId = `${leagueConfig.id}-${scheduleId}`;
    const divisionName = schedule.name || `Division ${scheduleId}`;

    // Parse age group and gender from name if not provided
    const ageGroup = schedule.ageGroup || parseAgeGroup(divisionName);
    const gender = schedule.gender || parseGender(divisionName);

    const parsedRows = parseScheduleStandingsHtml(html, schedule);
    if (parsedRows.length === 0) {
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

    for (const row of parsedRows) {
      standings.push({
        teamName: row.teamName,
        position: row.position,
        gamesPlayed: row.gamesPlayed,
        wins: row.wins,
        losses: row.losses,
        ties: row.ties,
        points: row.points,
        scored: 0, // Not available in standings table
        allowed: 0,
        differential: row.differential,
        shutouts: 0,
        yellowCards: 0,
        redCards: 0,
        clubKey: null,
        teamKey: row.teamKey,
        leagueId: leagueConfig.id,
        divisionId,
        seasonId: leagueConfig.seasonId || '2025-2026',
        collectedAt: now,
      });
    }

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
 * Parse one TeamSideline schedule page into normalized standings rows.
 * TeamSideline column order varies by org, so this is header-driven.
 */
function parseScheduleStandingsHtml(html, schedule = {}) {
  const $ = cheerio.load(html);
  const standingsTable = $('div[id*="standingsGrid"] table.rgMasterTable, div[id*="StandingsGrid"] table.rgMasterTable').first();
  if (standingsTable.length === 0) return [];

  const headers = standingsTable
    .find('tr')
    .first()
    .find('th')
    .map((_, th) => normalizeHeader($(th).text()))
    .get();

  const idx = {
    place: findHeaderIndex(headers, ['place', 'rank', '#']),
    team: findHeaderIndex(headers, ['team']),
    wins: findHeaderIndex(headers, ['w', 'wins']),
    losses: findHeaderIndex(headers, ['l', 'losses']),
    ties: findHeaderIndex(headers, ['t', 'ties']),
    gamesPlayed: findHeaderIndex(headers, ['gp', 'games', 'games played']),
    points: findHeaderIndex(headers, ['pts', 'points']),
    differential: findHeaderIndex(headers, ['agd', 'diff', 'differential', '+/-']),
  };

  const rows = [];
  standingsTable.find('tbody tr.rgRow, tbody tr.rgAltRow, tr.rgRow, tr.rgAltRow').each((rowIdx, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) return;

    const teamCell = cells.eq(idx.team >= 0 ? idx.team : 0);
    const teamName = cleanText(teamCell.text());
    if (!teamName || normalizeHeader(teamName) === 'team') return;

    const teamHref = teamCell.find('a[href*="team"]').attr('href') || '';
    const teamIdMatch = teamHref.match(/\/(?:team|teams)\/(\d+)/i);

    rows.push({
      teamName,
      position: parseInteger(cellText($, cells, idx.place)) || rowIdx + 1,
      gamesPlayed: parseInteger(cellText($, cells, idx.gamesPlayed)),
      wins: parseInteger(cellText($, cells, idx.wins)),
      losses: parseInteger(cellText($, cells, idx.losses)),
      ties: parseInteger(cellText($, cells, idx.ties)),
      points: parseNumber(cellText($, cells, idx.points)),
      differential: parseNumber(cellText($, cells, idx.differential)),
      teamKey: teamIdMatch ? teamIdMatch[1] : null,
    });
  });

  return rows;
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

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value) {
  return cleanText(value).toLowerCase();
}

function findHeaderIndex(headers, names) {
  return headers.findIndex(h => names.includes(h));
}

function cellText($, cells, index) {
  if (index < 0 || index >= cells.length) return '';
  return cleanText($(cells[index]).text());
}

function parseInteger(value) {
  const n = parseInt(String(value || '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseNumber(value) {
  const n = parseFloat(String(value || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

module.exports = { PLATFORM_ID, collectStandings, discoverSchedules, parseScheduleStandingsHtml };

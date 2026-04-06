/**
 * SportsAffinity ASP (Legacy) Adapter — v2 (HTML scraping, no Puppeteer)
 *
 * Scrapes the OLD SportsAffinity ASP system used by OYSA (Oregon Youth Soccer).
 *
 * v2: Rewrote from Puppeteer to direct HTML scraping — the standings pages
 * render server-side, no JS execution needed. 10x faster, no browser dependency.
 *
 * URL Patterns:
 *   Accepted teams:   {baseUrl}/tour/public/info/accepted_list.asp?tournamentguid={GUID}
 *   Standings:         {baseUrl}/tour/public/info/schedule_standings.asp?tournamentguid={GUID}&flightguid={GUID}
 *
 * sourceConfig schema:
 * {
 *   baseUrl: 'https://oysa.sportsaffinity.com',
 *   tournamentGuid: '2A349A09-F127-445D-9252-62C4D1029140',
 *   flightGuids: ['guid1', 'guid2', ...]  // Optional — auto-discovers if omitted
 * }
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'sportsaffinity-asp';

/**
 * Collect standings for a SportsAffinity ASP league
 */
async function collectStandings(leagueConfig) {
  const { baseUrl, tournamentGuid, flightGuids } = leagueConfig.sourceConfig;
  const base = baseUrl || 'https://oysa.sportsaffinity.com';

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  // Step 1: Discover flight GUIDs if not provided
  let flights = [];
  if (flightGuids && flightGuids.length > 0) {
    flights = flightGuids.map(guid => ({ flightGuid: guid, name: null }));
  } else {
    flights = await discoverFlights(base, tournamentGuid);
  }

  if (flights.length === 0) {
    console.warn(`SportsAffinity-ASP: No flights found for tournament ${tournamentGuid}`);
    return { divisions, standings };
  }

  console.log(`SportsAffinity-ASP: Found ${flights.length} flights for tournament ${tournamentGuid}`);

  // Step 2: Collect standings for each flight
  for (const flight of flights) {
    const standingsUrl = `${base}/tour/public/info/schedule_standings.asp?tournamentguid=${tournamentGuid}&flightguid=${flight.flightGuid}`;

    try {
      const resp = await axios.get(standingsUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'TeamsUnited-Standings/1.0' },
      });

      const flightData = extractStandings(resp.data, flight.name);

      if (!flightData || flightData.rows.length === 0) {
        console.log(`SportsAffinity-ASP:   No standings data for flight ${flight.flightGuid}`);
        continue;
      }

      const flightName = flightData.flightName || flight.name || `Flight ${flight.flightGuid.substring(0, 8)}`;
      const { ageGroup, gender } = inferAgeGroup(flightName);

      const divisionId = `${leagueConfig.id}-${slugify(flightName)}`;

      divisions.push({
        id: divisionId,
        leagueId: leagueConfig.id,
        seasonId: leagueConfig.seasonId || '2025-2026',
        name: flightName,
        ageGroup,
        gender,
        level: null,
        platformDivisionId: flight.flightGuid,
        status: 'active',
      });

      flightData.rows.forEach((row, idx) => {
        standings.push({
          teamName: row.teamName,
          position: idx + 1,
          gamesPlayed: row.gamesPlayed || 0,
          wins: row.wins || 0,
          losses: row.losses || 0,
          ties: row.ties || 0,
          points: row.points || 0,
          scored: row.goalsFor || 0,
          allowed: row.goalsAgainst || 0,
          differential: (row.goalsFor || 0) - (row.goalsAgainst || 0),
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

      console.log(`SportsAffinity-ASP:   Collected ${flightData.rows.length} teams for "${flightName}"`);
    } catch (err) {
      console.error(`SportsAffinity-ASP:   Error on flight ${flight.flightGuid}: ${err.message}`);
    }

    // Respectful delay between flights
    await sleep(500);
  }

  return { divisions, standings };
}

/**
 * Discover flight GUIDs from the accepted_list page.
 * Extracts flightguid parameters from HTML links — no JS rendering needed.
 */
async function discoverFlights(baseUrl, tournamentGuid) {
  const url = `${baseUrl}/tour/public/info/accepted_list.asp?tournamentguid=${tournamentGuid}`;

  console.log(`SportsAffinity-ASP: Discovering flights from ${url}`);

  try {
    const resp = await axios.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': 'TeamsUnited-Standings/1.0' },
    });

    const $ = cheerio.load(resp.data);
    const seen = new Set();
    const flights = [];

    // Find all links containing flightguid parameter
    $('a[href*="flightguid"], a[href*="FlightGUID"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/flightguid=([A-Fa-f0-9-]+)/i);
      if (match && !seen.has(match[1])) {
        seen.add(match[1]);
        // Try to get flight name from the link text or nearby title element
        const name = $(el).text().trim() || null;
        flights.push({ flightGuid: match[1], name });
      }
    });

    console.log(`SportsAffinity-ASP: Discovered ${flights.length} flights`);
    return flights;
  } catch (err) {
    console.error(`SportsAffinity-ASP: Flight discovery failed: ${err.message}`);
    return [];
  }
}

/**
 * Extract standings from the schedule_standings HTML page.
 * The page renders standings in a table with columns:
 *   Club Info | Group/Team | Total Points | Games Played | Wins | Losses | Ties | Goals For | Goals Against
 */
function extractStandings(html, fallbackName) {
  const $ = cheerio.load(html);
  const rows = [];

  // Get flight name from page title
  let flightName = null;
  const titleEl = $('font.title');
  if (titleEl.length) {
    const titleText = titleEl.text().trim();
    // Format: "Team Standings - BU11 PCL 1"
    const match = titleText.match(/Team Standings\s*[-–—]\s*(.+)/i);
    flightName = match ? match[1].trim() : titleText;
  }

  // Find the standings table — it has class "tfixed" and contains standings data
  const table = $('table.tfixed');
  if (!table.length) {
    return { rows, flightName: flightName || fallbackName };
  }

  // Build column index map from header row
  // Note: cheerio drops <br/> tags, so "Total<br/>Points" becomes "TotalPoints"
  const headers = [];
  table.find('tr.theadb td, tr.theadb th').each((i, el) => {
    const text = $(el).text().replace(/\s+/g, '').trim().toUpperCase();
    headers.push(text);
  });

  const colMap = {};
  headers.forEach((h, i) => {
    if (h.includes('GROUP') || h === 'TEAM' || h === 'TEAMS') colMap.team = i;
    else if (h.includes('TOTALPOINTS') || h === 'PTS' || h === 'POINTS') colMap.pts = i;
    else if (h.includes('GAMESPLAYED') || h === 'GP') colMap.gp = i;
    else if (h === 'WINS' || h === 'W') colMap.w = i;
    else if (h === 'LOSSES' || h === 'L') colMap.l = i;
    else if (h === 'TIES' || h === 'T' || h === 'DRAWS' || h === 'D') colMap.t = i;
    else if (h.includes('GOALSFOR') || h === 'GF') colMap.gf = i;
    else if (h.includes('GOALSAGAINST') || h === 'GA') colMap.ga = i;
  });

  // The team name column is typically the second column (index 1) — first is Club Info icon
  if (colMap.team === undefined) colMap.team = 1;

  // Parse data rows (tbody0 and tbody1 alternating classes)
  table.find('tr.tbody0, tr.tbody1').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 4) return;

    const getVal = (idx) => {
      if (idx === undefined || idx >= cells.length) return 0;
      return parseInt($(cells[idx]).text().trim()) || 0;
    };

    // Extract team name — look for the data-bracket attribute or link text
    let teamName = '';
    const teamCell = $(cells[colMap.team]);
    const bracketEl = teamCell.find('[data-bracket]');
    if (bracketEl.length) {
      // data-bracket format: "A11:United PDX 15B Pre Black"
      const bracket = bracketEl.attr('data-bracket') || '';
      teamName = bracket.includes(':') ? bracket.split(':').slice(1).join(':').trim() : bracket;
    }
    if (!teamName) {
      teamName = teamCell.find('a').last().text().trim() || teamCell.text().trim();
    }
    if (!teamName) return;

    rows.push({
      teamName,
      gamesPlayed: getVal(colMap.gp),
      wins: getVal(colMap.w),
      losses: getVal(colMap.l),
      ties: getVal(colMap.t),
      points: getVal(colMap.pts),
      goalsFor: getVal(colMap.gf),
      goalsAgainst: getVal(colMap.ga),
    });
  });

  return { rows, flightName: flightName || fallbackName };
}

function slugify(text) {
  return (text || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 80);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { PLATFORM_ID, collectStandings };

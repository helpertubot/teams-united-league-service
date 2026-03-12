/**
 * SportsAffinity ASP (Legacy) Adapter
 *
 * Browser automation adapter for the OLD SportsAffinity ASP system.
 * Used by: OYSA (Oregon Youth Soccer Association)
 *
 * This is a DIFFERENT system from the SCTour JSON API used by WA (WYS).
 * The old ASP system uses JavaScript-rendered pages that require Puppeteer.
 *
 * URL Patterns:
 *   Tournament list:  {baseUrl}/tour/public/info/tournamentlist.asp?section=gaming
 *   Accepted teams:   {baseUrl}/tour/public/info/accepted_list.asp?tournamentguid={GUID}
 *   Standings:         {baseUrl}/tour/public/info/schedule_standings.asp?tournamentguid={GUID}&flightguid={GUID}
 *
 * The system has two levels of GUIDs:
 *   - tournamentGuid: Identifies a league season (e.g., "2026 OYSA Spring League")
 *   - flightGuid: Identifies a division/flight within that tournament (e.g., "U14 Boys Div 1")
 *
 * Flight GUIDs are discovered dynamically from the accepted_list page for each tournament.
 *
 * sourceConfig schema:
 * {
 *   baseUrl: 'https://oysa.sportsaffinity.com',
 *   tournamentGuid: '2A349A09-F127-445D-9252-62C4D1029140',
 *   flightGuids: ['guid1', 'guid2', ...]  // Optional — auto-discovers if omitted
 * }
 */

const { launchBrowser } = require('../browser');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'sportsaffinity-asp';

/**
 * Collect standings for a SportsAffinity ASP league
 * @param {Object} leagueConfig
 * @param {string} leagueConfig.sourceConfig.baseUrl - Base URL (e.g., https://oysa.sportsaffinity.com)
 * @param {string} leagueConfig.sourceConfig.tournamentGuid - Tournament GUID
 * @param {Array}  [leagueConfig.sourceConfig.flightGuids] - Optional flight GUIDs (auto-discovers if omitted)
 * @returns {Object} { divisions: [...], standings: [...] }
 */
async function collectStandings(leagueConfig) {
  const { baseUrl, tournamentGuid, flightGuids } = leagueConfig.sourceConfig;
  const base = baseUrl || 'https://oysa.sportsaffinity.com';

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 TeamsUnited-Standings/1.0');

    // Step 1: Discover flight GUIDs if not provided
    let flights = [];
    if (flightGuids && flightGuids.length > 0) {
      flights = flightGuids.map(guid => ({ flightGuid: guid, name: null }));
    } else {
      flights = await discoverFlights(page, base, tournamentGuid);
    }

    if (flights.length === 0) {
      console.warn(`SportsAffinity-ASP: No flights found for tournament ${tournamentGuid}`);
      return { divisions, standings };
    }

    console.log(`SportsAffinity-ASP: Found ${flights.length} flights for tournament ${tournamentGuid}`);

    // Step 2: Collect standings for each flight
    for (const flight of flights) {
      const standingsUrl = `${base}/tour/public/info/schedule_standings.asp?tournamentguid=${tournamentGuid}&flightguid=${flight.flightGuid}`;

      console.log(`SportsAffinity-ASP: Loading standings for flight "${flight.name || flight.flightGuid}"`);

      try {
        await page.goto(standingsUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(3000); // Wait for JS rendering

        const flightData = await extractStandings(page);

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
      await sleep(1500);
    }

  } catch (err) {
    console.error(`SportsAffinity-ASP: Browser automation failed: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  return { divisions, standings };
}

/**
 * Discover flight GUIDs from the accepted_list page for a tournament.
 * The accepted_list page renders flight names and links dynamically via JavaScript.
 */
async function discoverFlights(page, baseUrl, tournamentGuid) {
  const url = `${baseUrl}/tour/public/info/accepted_list.asp?tournamentguid=${tournamentGuid}`;

  console.log(`SportsAffinity-ASP: Discovering flights from ${url}`);

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(5000); // Wait for JS to render flight list

    // Extract flight information from the rendered page
    const flights = await page.evaluate(() => {
      const results = [];

      // Look for links containing flightguid parameter
      const links = document.querySelectorAll('a[href*="flightguid"], a[href*="FlightGUID"]');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/flightguid=([A-Fa-f0-9-]+)/i);
        if (match) {
          const guid = match[1];
          const name = link.textContent.trim();
          // Avoid duplicates
          if (!results.some(r => r.flightGuid === guid)) {
            results.push({ flightGuid: guid, name: name || null });
          }
        }
      }

      // Also check for flight sections/headers that might contain GUIDs
      const headers = document.querySelectorAll('h2, h3, h4, .flight-header, [class*="flight"]');
      for (const header of headers) {
        const text = header.textContent.trim();
        // Check if this header's parent or sibling has a flight link
        const parentLink = header.closest('a') || header.querySelector('a');
        if (parentLink) {
          const href = parentLink.getAttribute('href') || '';
          const match = href.match(/flightguid=([A-Fa-f0-9-]+)/i);
          if (match && !results.some(r => r.flightGuid === match[1])) {
            results.push({ flightGuid: match[1], name: text || null });
          }
        }
      }

      return results;
    });

    console.log(`SportsAffinity-ASP: Discovered ${flights.length} flights`);
    return flights;
  } catch (err) {
    console.error(`SportsAffinity-ASP: Flight discovery failed: ${err.message}`);
    return [];
  }
}

/**
 * Extract standings data from a rendered schedule_standings page.
 * The page renders standings tables via JavaScript after loading.
 */
async function extractStandings(page) {
  return page.evaluate(() => {
    const rows = [];
    let flightName = null;

    // Try to get flight/division name from page heading
    const heading = document.querySelector('h1, h2, h3, .flight-name, [class*="flight"]');
    if (heading) {
      flightName = heading.textContent.trim();
    }

    // Find standings table — look for tables with typical soccer standings headers
    const tables = document.querySelectorAll('table');
    let standingsTable = null;

    for (const table of tables) {
      const headerRow = table.querySelector('thead tr, tr:first-child');
      if (!headerRow) continue;

      const headerCells = headerRow.querySelectorAll('th, td');
      const headerTexts = Array.from(headerCells).map(c => c.textContent.trim().toUpperCase());

      // Soccer standings: look for W, L, T or PTS columns
      const hasWins = headerTexts.some(h => h === 'W' || h === 'WINS');
      const hasTeam = headerTexts.some(h => h === 'TEAM' || h === 'TEAMS' || h === 'CLUB');
      const hasPoints = headerTexts.some(h => h === 'PTS' || h === 'POINTS');

      if (hasTeam && (hasWins || hasPoints)) {
        standingsTable = table;
        break;
      }
    }

    if (!standingsTable) return { rows: [], flightName };

    // Build column index map
    const headerRow = standingsTable.querySelector('thead tr, tr:first-child');
    const headers = [];
    if (headerRow) {
      headerRow.querySelectorAll('th, td').forEach(cell => {
        headers.push(cell.textContent.trim().toUpperCase());
      });
    }

    const colMap = {};
    headers.forEach((h, i) => {
      const key = h.replace(/\s+/g, '');
      if (['TEAM', 'TEAMS', 'CLUB'].includes(key)) colMap.team = i;
      else if (key === 'GP' || key === 'G') colMap.gp = i;
      else if (key === 'W' || key === 'WINS') colMap.w = i;
      else if (key === 'L' || key === 'LOSSES') colMap.l = i;
      else if (key === 'T' || key === 'TIES' || key === 'D' || key === 'DRAWS') colMap.t = i;
      else if (key === 'PTS' || key === 'POINTS') colMap.pts = i;
      else if (key === 'GF' || key === 'GOALSFOR') colMap.gf = i;
      else if (key === 'GA' || key === 'GOALSAGAINST') colMap.ga = i;
    });

    if (colMap.team === undefined) colMap.team = 0;

    // Parse data rows
    const tbody = standingsTable.querySelector('tbody');
    const dataRows = tbody
      ? tbody.querySelectorAll('tr')
      : standingsTable.querySelectorAll('tr:not(:first-child)');

    dataRows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) return;

      const getCellText = (idx) => {
        if (idx === undefined || idx >= cells.length) return '';
        return cells[idx].textContent.trim();
      };

      const teamName = getCellText(colMap.team);
      if (!teamName || teamName.toUpperCase() === 'TEAM') return;

      rows.push({
        teamName,
        gamesPlayed: parseInt(getCellText(colMap.gp)) || 0,
        wins: parseInt(getCellText(colMap.w)) || 0,
        losses: parseInt(getCellText(colMap.l)) || 0,
        ties: parseInt(getCellText(colMap.t)) || 0,
        points: parseInt(getCellText(colMap.pts)) || 0,
        goalsFor: parseInt(getCellText(colMap.gf)) || 0,
        goalsAgainst: parseInt(getCellText(colMap.ga)) || 0,
      });
    });

    return { rows, flightName };
  });
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

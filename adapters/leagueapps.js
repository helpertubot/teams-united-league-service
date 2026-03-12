/**
 * LeagueApps Adapter
 * 
 * HTML parser for LeagueApps standings pages.
 * Used by: Youth baseball, soccer, basketball, lacrosse — one of the largest 
 * youth sports platforms with thousands of organizations.
 * 
 * URL Pattern: https://{subdomain}.leagueapps.com/leagues/{leagueId}/standings
 * 
 * NOTE: LeagueApps also supports tournament URLs (/tournaments/{id}/standings)
 * but we only use this adapter for LEAGUE PLAY standings, not tournaments.
 * 
 * Data is server-rendered HTML — straightforward to parse.
 * Table: standard <table> with <thead>/<tbody>
 * Columns: TEAM, GP, W, L, T, PCT (varies by sport)
 * 
 * Many orgs use custom domains that forward to their leagueapps.com subdomain.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { launchBrowser, resilientGoto } = require('../browser');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'leagueapps';

/**
 * Collect standings for a LeagueApps league
 * 
 * Supports two sourceConfig formats:
 * A) Auto-construct: { orgSlug, leagueId } → builds URL https://{orgSlug}.leagueapps.com/leagues/{leagueId}/standings
 * B) Configured:     { baseUrl, programs: [{path, name, ageGroup, gender}] }
 * 
 * @returns {Object} { divisions: [...], standings: [...] }
 */
async function collectStandings(leagueConfig) {
  const { baseUrl, programs, orgSlug, leagueId } = leagueConfig.sourceConfig;

  // Build programs list from either format
  let programList;
  if (programs && Array.isArray(programs) && programs.length > 0) {
    programList = programs;
  } else if (orgSlug && leagueId) {
    // Auto-construct from orgSlug + leagueId
    programList = [{
      path: `/leagues/${leagueId}/standings`,
      name: leagueConfig.name || 'League Standings',
      ageGroup: leagueConfig.sourceConfig.ageGroup || 'mixed',
      gender: leagueConfig.sourceConfig.gender || 'mixed',
    }];
  } else {
    console.warn(`LeagueApps: No programs or orgSlug/leagueId configured for ${leagueConfig.id}`);
    return { divisions: [], standings: [] };
  }

  const effectiveBaseUrl = baseUrl || `https://${orgSlug}.leagueapps.com`;

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  for (const program of programList) {
    const baseUrl2 = `${effectiveBaseUrl}${program.path}`;
    
    let html;
    let usedBrowser = false;
    try {
      // LeagueApps uses iframes for standings widgets. The iframe URL has
      // ?ngmp_2023_iframe_transition=1 which returns server-rendered HTML with tables.
      // Try the iframe URL first (no browser needed), then fall back to the base URL.
      const iframeUrl = baseUrl2 + (baseUrl2.includes('?') ? '&' : '?') + 'ngmp_2023_iframe_transition=1';
      
      console.log(`LeagueApps: Trying iframe URL ${iframeUrl}`);
      const resp = await axios.get(iframeUrl, {
        timeout: 30000,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
      });
      html = resp.data;
      
      // Check if page has tables
      const $check = cheerio.load(html);
      if ($check('table').length === 0) {
        // Try base URL without iframe param
        console.log(`LeagueApps: No tables in iframe URL, trying base URL...`);
        const resp2 = await axios.get(baseUrl2, {
          timeout: 30000,
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html',
          },
        });
        html = resp2.data;
        
        const $check2 = cheerio.load(html);
        if ($check2('table').length === 0) {
          console.log(`LeagueApps: No static tables at ${baseUrl2}, trying browser render...`);
          html = await renderWithBrowser(baseUrl2);
          usedBrowser = true;
        }
      }
    } catch (err) {
      console.error(`LeagueApps: Failed to fetch ${baseUrl2}: ${err.message}`);
      continue;
    }

    const $ = cheerio.load(html);

    // LeagueApps may have multiple divisions on one page, each with its own table
    // or a single table for the whole program
    const tables = $('table');

    if (tables.length === 0) {
      console.warn(`LeagueApps: No tables found at ${url}`);
      continue;
    }

    tables.each((tableIdx, table) => {
      // Parse headers
      const headers = [];
      $(table).find('thead th, thead td').each((i, th) => {
        headers.push($(th).text().trim().toUpperCase());
      });

      // Check if this looks like a standings table
      const isStandings = headers.some(h => ['W', 'WINS', 'GP', 'PCT'].includes(h));
      if (!isStandings && headers.length > 0) return;

      // If no thead, try first row as headers
      if (headers.length === 0) {
        $(table).find('tr:first-child th, tr:first-child td').each((i, cell) => {
          headers.push($(cell).text().trim().toUpperCase());
        });
      }

      // Look for a division heading before this table
      let divName = '';
      const prevEl = $(table).prev('h2, h3, h4, .division-name, .program-name');
      if (prevEl.length) {
        divName = prevEl.text().trim();
      }
      if (!divName) {
        divName = program.name + (tables.length > 1 ? ` (${tableIdx + 1})` : '');
      }

      const suffix = tableIdx > 0 ? `-${tableIdx}` : '';
      const divisionId = `${leagueConfig.id}-${slugify(program.name)}${suffix}`;

      // Map column positions
      const colIdx = {};
      headers.forEach((h, i) => {
        if (['TEAM', 'TEAMS', 'NAME'].includes(h)) colIdx.team = i;
        else if (h === 'GP' || h === 'G') colIdx.gp = i;
        else if (h === 'W') colIdx.w = i;
        else if (h === 'L') colIdx.l = i;
        else if (h === 'T' || h === 'D') colIdx.t = i;
        else if (h === 'PCT' || h === 'WIN%') colIdx.pct = i;
        else if (h === 'GB') colIdx.gb = i;
        else if (h === 'PTS') colIdx.pts = i;
        else if (h === 'GF' || h === 'RS' || h === 'PF') colIdx.scored = i;
        else if (h === 'GA' || h === 'RA' || h === 'PA') colIdx.allowed = i;
        else if (h === 'DIFF' || h === 'GD' || h === 'RD') colIdx.diff = i;
      });

      // Default team column to 0 if not explicitly found
      if (colIdx.team === undefined) colIdx.team = 0;

      const dataRows = $(table).find('tbody tr');
      if (dataRows.length === 0) return;

      divisions.push({
        id: divisionId,
        leagueId: leagueConfig.id,
        seasonId: leagueConfig.seasonId || '2025-2026',
        name: divName,
        ageGroup: program.ageGroup || inferAgeGroup(divName).ageGroup,
        gender: program.gender || inferAgeGroup(divName).gender,
        level: program.level || null,
        platformDivisionId: program.path,
        status: 'active',
      });

      dataRows.each((rowIdx, row) => {
        const cells = $(row).find('td');
        if (cells.length < 3) return;

        const teamName = $(cells[colIdx.team]).text().trim();
        if (!teamName) return;

        const teamLink = $(cells[colIdx.team]).find('a').attr('href') || '';

        const wins = parseInt(getCellText($, cells, colIdx.w)) || 0;
        const losses = parseInt(getCellText($, cells, colIdx.l)) || 0;
        const ties = parseInt(getCellText($, cells, colIdx.t)) || 0;
        const gp = parseInt(getCellText($, cells, colIdx.gp)) || (wins + losses + ties);
        const scored = parseInt(getCellText($, cells, colIdx.scored)) || 0;
        const allowed = parseInt(getCellText($, cells, colIdx.allowed)) || 0;

        standings.push({
          teamName,
          position: rowIdx + 1,
          gamesPlayed: gp,
          wins,
          losses,
          ties,
          points: parseInt(getCellText($, cells, colIdx.pts)) || 0,
          scored,
          allowed,
          differential: colIdx.diff !== undefined
            ? parseInt(getCellText($, cells, colIdx.diff)) || 0
            : scored - allowed,
          winPct: colIdx.pct !== undefined 
            ? parseFloat(getCellText($, cells, colIdx.pct)) || null 
            : null,
          gamesBack: colIdx.gb !== undefined ? getCellText($, cells, colIdx.gb) : null,
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
    });

    // Throttle
    await sleep(500);
  }

  return { divisions, standings };
}

function getCellText($, cells, idx) {
  if (idx === undefined || idx >= cells.length) return '0';
  return $(cells[idx]).text().trim() || '0';
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

/**
 * Render a LeagueApps page with Puppeteer when static HTML has no tables
 * (many LeagueApps pages use JS widgets to render standings)
 * 
 * v2: uses resilientGoto + domcontentloaded instead of networkidle2
 */
async function renderWithBrowser(url) {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 TeamsUnited-Standings/1.0');
    
    // Use resilientGoto with retries instead of raw page.goto
    await resilientGoto(page, url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
      retries: 2,
      stabilizeMs: 3000,
    });
    
    // Wait for tables or standings content to render
    await page.waitForSelector('table, [class*="standings"]', { timeout: 15000 }).catch(() => {});
    await sleep(2000);
    
    return await page.content();
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) { /* ignore close errors */ }
    }
  }
}

module.exports = { PLATFORM_ID, collectStandings };

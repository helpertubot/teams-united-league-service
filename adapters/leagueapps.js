/**
 * LeagueApps Adapter (v2 — SPA Discovery + Standings)
 *
 * LeagueApps is a JavaScript SPA — pages return "You need to enable JavaScript"
 * without the iframe bypass. However, appending ?ngmp_2023_iframe_transition=1
 * forces server-rendered HTML that we can parse with Cheerio.
 *
 * Discovery flow:
 *   1. GET /leagues?ngmp_2023_iframe_transition=1 → list master programs with IDs
 *   2. GET /leagues?state=COMPLETED&ngmp_2023_iframe_transition=1 → completed programs
 *   3. GET /ajax/discovery/subprograms?masterProgramId={id} → sub-programs (age groups)
 *   4. GET /leagues/{subProgramId}/standings?ngmp_2023_iframe_transition=1 → standings
 *
 * URL Patterns:
 *   Listings: https://{subdomain}.leagueapps.com/leagues?ngmp_2023_iframe_transition=1
 *   Program:  https://{subdomain}.leagueapps.com/leagues/{sport}/{programId}-{slug}
 *   Standings: https://{subdomain}.leagueapps.com/leagues/{programId}/standings
 *
 * Used by: Youth baseball, soccer, basketball, lacrosse, football — one of the
 * largest youth sports platforms with thousands of organizations.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { launchBrowser, resilientGoto } = require('../browser');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'leagueapps';

const IFRAME_PARAM = 'ngmp_2023_iframe_transition=1';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
};

/**
 * Fetch a LeagueApps page using the iframe transition bypass.
 * Falls back to Puppeteer if no meaningful content is returned.
 */
async function fetchPage(url, { useBrowserFallback = true } = {}) {
  const iframeUrl = url + (url.includes('?') ? '&' : '?') + IFRAME_PARAM;

  try {
    const resp = await axios.get(iframeUrl, {
      timeout: 30000,
      maxRedirects: 5,
      headers: DEFAULT_HEADERS,
    });
    const html = resp.data;

    // Check if we got meaningful content (not just the SPA shell)
    if (html.includes('You need to enable JavaScript') && !html.includes('<table')) {
      if (useBrowserFallback) {
        console.log(`LeagueApps: SPA shell at ${url}, falling back to browser`);
        return await renderWithBrowser(url);
      }
      return null;
    }
    return html;
  } catch (err) {
    if (useBrowserFallback && err.response && err.response.status === 404) {
      return null;
    }
    if (useBrowserFallback) {
      console.log(`LeagueApps: HTTP error for ${url} (${err.message}), trying browser`);
      return await renderWithBrowser(url);
    }
    throw err;
  }
}

/**
 * Discover all programs and sub-programs for a LeagueApps organization.
 *
 * @param {Object} leagueConfig - League config with sourceConfig.orgSlug or sourceConfig.baseUrl
 * @returns {Object} { programs: [...], orgSlug, siteId }
 */
async function discover(leagueConfig) {
  const { orgSlug, baseUrl } = leagueConfig.sourceConfig || {};
  const effectiveBaseUrl = baseUrl || `https://${orgSlug}.leagueapps.com`;

  if (!effectiveBaseUrl || effectiveBaseUrl === 'https://undefined.leagueapps.com') {
    throw new Error('LeagueApps discover: orgSlug or baseUrl required in sourceConfig');
  }

  const programs = [];

  // Fetch both open and completed listings in parallel
  const [openHtml, completedHtml] = await Promise.all([
    fetchPage(`${effectiveBaseUrl}/leagues`, { useBrowserFallback: false }).catch(() => null),
    fetchPage(`${effectiveBaseUrl}/leagues?state=COMPLETED`, { useBrowserFallback: false }).catch(() => null),
  ]);

  // Parse program listings from both pages
  const allHtmls = [
    { html: openHtml, state: 'open' },
    { html: completedHtml, state: 'completed' },
  ];

  const masterPrograms = [];
  let siteId = null;

  for (const { html, state } of allHtmls) {
    if (!html) continue;
    const $ = cheerio.load(html);

    // Extract siteId from page if present
    const siteIdMatch = html.match(/siteId['":\s]+(\d+)/);
    if (siteIdMatch) siteId = siteIdMatch[1];

    // Find program links — pattern: /leagues/{sport}/{programId}-{slug}
    $('a[href*="/leagues/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/\/leagues\/[\w-]+\/(\d+)-(.+)/);
      if (match) {
        const programId = match[1];
        const slug = match[2];
        const name = $(el).text().trim() || slug.replace(/-/g, ' ');

        // Avoid duplicates
        if (!masterPrograms.find(p => p.programId === programId)) {
          masterPrograms.push({ programId, slug, name, state, href });
        }
      }
    });
  }

  console.log(`LeagueApps discover: found ${masterPrograms.length} master programs at ${effectiveBaseUrl}`);

  // For each master program, try to discover sub-programs
  for (const master of masterPrograms) {
    const subPrograms = await discoverSubPrograms(effectiveBaseUrl, master.programId);

    if (subPrograms.length > 0) {
      for (const sub of subPrograms) {
        programs.push({
          masterProgramId: master.programId,
          masterProgramName: master.name,
          programId: sub.programId,
          name: sub.name,
          slug: sub.slug,
          state: master.state,
          ageGroup: sub.ageGroup || inferAgeGroup(sub.name).ageGroup,
          gender: sub.gender || inferAgeGroup(sub.name).gender,
          standingsPath: `/leagues/${sub.programId}/standings`,
        });
      }
    } else {
      // No sub-programs — the master program itself may have standings
      programs.push({
        masterProgramId: master.programId,
        masterProgramName: master.name,
        programId: master.programId,
        name: master.name,
        slug: master.slug,
        state: master.state,
        ageGroup: inferAgeGroup(master.name).ageGroup,
        gender: inferAgeGroup(master.name).gender,
        standingsPath: `/leagues/${master.programId}/standings`,
      });
    }

    await sleep(300); // Throttle between requests
  }

  // Deduplicate programs by programId (may appear in both open + completed)
  const seen = new Set();
  const uniquePrograms = programs.filter(p => {
    if (seen.has(p.programId)) return false;
    seen.add(p.programId);
    return true;
  });

  // Check which programs actually have standings
  const programsWithStandings = [];
  for (const prog of uniquePrograms) {
    const standingsUrl = `${effectiveBaseUrl}${prog.standingsPath}`;
    const html = await fetchPage(standingsUrl, { useBrowserFallback: false }).catch(() => null);
    if (html) {
      const $ = cheerio.load(html);
      const hasTables = $('table').length > 0;
      const hasNotPosted = html.toLowerCase().includes('standings have not yet been posted');
      prog.hasStandings = hasTables && !hasNotPosted;
      prog.standingsAvailable = !hasNotPosted;
    } else {
      prog.hasStandings = false;
      prog.standingsAvailable = false;
    }
    programsWithStandings.push(prog);
    await sleep(200);
  }

  return {
    orgSlug: orgSlug || effectiveBaseUrl.match(/https?:\/\/(\w+)\.leagueapps/)?.[1],
    siteId,
    baseUrl: effectiveBaseUrl,
    totalPrograms: programsWithStandings.length,
    withStandings: programsWithStandings.filter(p => p.hasStandings).length,
    programs: programsWithStandings,
  };
}

/**
 * Discover sub-programs for a master program using the AJAX endpoint.
 */
async function discoverSubPrograms(baseUrl, masterProgramId) {
  const subPrograms = [];

  // Try the AJAX endpoint for both OPEN and COMPLETED listings
  for (const listingPage of ['OPEN', 'COMPLETED']) {
    try {
      const ajaxUrl = `${baseUrl}/ajax/discovery/subprograms?masterProgramId=${masterProgramId}&eventType=LEAGUE&redirectToProgramHomePage=false&listingPage=${listingPage}`;
      const resp = await axios.get(ajaxUrl, {
        timeout: 15000,
        headers: DEFAULT_HEADERS,
      });

      const html = resp.data;
      if (!html || typeof html !== 'string') continue;

      const $ = cheerio.load(html);

      $('a[href*="/leagues/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/\/leagues\/[\w-]+\/(\d+)-(.+)/);
        if (match) {
          const programId = match[1];
          const slug = match[2];
          const name = $(el).text().trim() || slug.replace(/-/g, ' ');
          if (!subPrograms.find(p => p.programId === programId)) {
            subPrograms.push({ programId, slug, name });
          }
        }
      });
    } catch (err) {
      // Ignore — AJAX may not be available for all listing states
    }
  }

  // Also try the master program page directly (shows sub-programs inline)
  if (subPrograms.length === 0) {
    try {
      // Find the master program's own page to extract sub-program links
      for (const sport of ['football', 'basketball', 'baseball', 'soccer', 'lacrosse', 'flag-football', 'softball', 'hockey']) {
        const programPageUrl = `${baseUrl}/leagues/${sport}/${masterProgramId}`;
        const html = await fetchPage(programPageUrl, { useBrowserFallback: false }).catch(() => null);
        if (!html) continue;

        const $ = cheerio.load(html);
        $('a[href*="/leagues/"]').each((_, el) => {
          const href = $(el).attr('href') || '';
          const match = href.match(/\/leagues\/[\w-]+\/(\d+)-(.+)/);
          if (match && match[1] !== masterProgramId) {
            const programId = match[1];
            const slug = match[2];
            const name = $(el).text().trim() || slug.replace(/-/g, ' ');
            if (!subPrograms.find(p => p.programId === programId)) {
              subPrograms.push({ programId, slug, name });
            }
          }
        });
        if (subPrograms.length > 0) break;
      }
    } catch (err) { /* ignore */ }
  }

  return subPrograms;
}

/**
 * Collect standings for a LeagueApps league.
 *
 * Supports three sourceConfig formats:
 * A) Auto-discover: { orgSlug } → discovers all programs, collects standings from all
 * B) Auto-construct: { orgSlug, leagueId } → single program standings
 * C) Configured: { baseUrl, programs: [{path, name, ageGroup, gender}] }
 *
 * @returns {Object} { divisions: [...], standings: [...] }
 */
async function collectStandings(leagueConfig) {
  const { baseUrl, programs, orgSlug, leagueId } = leagueConfig.sourceConfig;

  // Build programs list from config format
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
  } else if (orgSlug && !leagueId) {
    // Auto-discover mode: find all programs with standings
    console.log(`LeagueApps: Auto-discover mode for ${orgSlug}`);
    const discovery = await discover(leagueConfig);
    const withStandings = discovery.programs.filter(p => p.hasStandings);

    if (withStandings.length === 0) {
      console.log(`LeagueApps: No programs with standings found for ${orgSlug}`);
      return { divisions: [], standings: [] };
    }

    programList = withStandings.map(p => ({
      path: p.standingsPath,
      name: p.name,
      ageGroup: p.ageGroup,
      gender: p.gender,
    }));
    console.log(`LeagueApps: Found ${programList.length} programs with standings for ${orgSlug}`);
  } else {
    console.warn(`LeagueApps: No programs or orgSlug configured for ${leagueConfig.id}`);
    return { divisions: [], standings: [] };
  }

  const effectiveBaseUrl = baseUrl || `https://${orgSlug}.leagueapps.com`;

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  for (const program of programList) {
    const standingsUrl = `${effectiveBaseUrl}${program.path}`;

    let html;
    try {
      html = await fetchPage(standingsUrl);
      if (!html) {
        console.log(`LeagueApps: No content at ${standingsUrl}`);
        continue;
      }
    } catch (err) {
      console.error(`LeagueApps: Failed to fetch ${standingsUrl}: ${err.message}`);
      continue;
    }

    const $ = cheerio.load(html);

    // Check for "standings not posted" message
    if (html.toLowerCase().includes('standings have not yet been posted')) {
      console.log(`LeagueApps: Standings not posted for ${program.name}`);
      continue;
    }

    const tables = $('table');
    if (tables.length === 0) {
      console.warn(`LeagueApps: No tables found at ${standingsUrl}`);
      continue;
    }

    parseStandingsTables($, tables, {
      leagueConfig,
      program,
      divisions,
      standings,
      now,
    });

    await sleep(500); // Throttle
  }

  return { divisions, standings };
}

/**
 * Parse standings tables from a Cheerio document.
 */
function parseStandingsTables($, tables, ctx) {
  const { leagueConfig, program, divisions, standings, now } = ctx;

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
    const colIdx = mapColumnPositions(headers);

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
}

/**
 * Map header names to column indices.
 */
function mapColumnPositions(headers) {
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
    else if (h === 'GF' || h === 'RS' || h === 'PF' || h === 'PS') colIdx.scored = i;
    else if (h === 'GA' || h === 'RA' || h === 'PA' || h === 'PSA') colIdx.allowed = i;
    else if (h === 'DIFF' || h === 'GD' || h === 'RD' || h === 'PSD') colIdx.diff = i;
  });
  return colIdx;
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
 * Render a LeagueApps page with Puppeteer when iframe bypass doesn't work.
 */
async function renderWithBrowser(url) {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 TeamsUnited-Standings/1.0');

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

module.exports = { PLATFORM_ID, collectStandings, discover };

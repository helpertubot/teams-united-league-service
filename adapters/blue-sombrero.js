/**
 * Blue Sombrero Adapter
 *
 * HTTP adapter for Blue Sombrero (Stack Sports) youth soccer standings.
 * Blue Sombrero runs the same DNN (DotNetNuke) platform and ViewStandings
 * module as SportsConnect, but is used primarily by youth soccer orgs
 * rather than Little League/PONY baseball.
 *
 * URL Patterns:
 *   - tshq.bluesombrero.com/Default.aspx?tabid={STANDINGS_TAB_ID}
 *   - clubs.bluesombrero.com/Default.aspx?tabid={TAB_ID}&portalid={PORTAL_ID}
 *   - leagues.bluesombrero.com/Default.aspx?tabid={TAB_ID}
 *   - sports.bluesombrero.com/Default.aspx?tabid={TAB_ID}
 *   - Custom domains that redirect from Blue Sombrero
 *
 * This adapter replays ASP.NET WebForms postbacks via HTTP POST (same as
 * SportsConnect). Each dropdown selection triggers a postback that returns
 * a full page with updated form state.
 *
 * Key differences from SportsConnect adapter:
 *   - Soccer-specific column handling (GF/GA/PTS instead of RS/RA)
 *   - Division-by-division iteration (soccer orgs show per-division standings)
 *   - No baseball division prefix grouping ("A / Miller / Cubs")
 *   - portalid support in URLs
 *   - Age groups are soccer-style (U8, U10, U12) not LL levels (Majors, Minors)
 *
 * sourceConfig schema:
 * {
 *   baseUrl: 'https://clubs.bluesombrero.com',  // Blue Sombrero subdomain
 *   standingsTabId: '313319',                    // tabid for standings page
 *   portalId: '309',                             // Optional — portalid param
 *   programs: [                                  // Optional — auto-discovers if omitted
 *     { programId: '12345', name: 'Spring 2026 Recreational', ageGroup: 'mixed', gender: 'mixed' }
 *   ]
 * }
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'blue-sombrero';

/**
 * Collect standings for a Blue Sombrero league
 * @param {Object} leagueConfig
 * @param {string} leagueConfig.sourceConfig.baseUrl - Blue Sombrero subdomain URL
 * @param {string} leagueConfig.sourceConfig.standingsTabId - Tab ID for standings page
 * @param {string} [leagueConfig.sourceConfig.portalId] - Portal ID (clubs.bluesombrero.com)
 * @param {Array}  [leagueConfig.sourceConfig.programs] - Optional program filter
 * @returns {Object} { divisions: [...], standings: [...] }
 */
async function collectStandings(leagueConfig) {
  const { baseUrl, standingsTabId, portalId, programs } = leagueConfig.sourceConfig;

  // Build the standings URL with optional portalid
  let standingsUrl = `${baseUrl}/Default.aspx?tabid=${standingsTabId}`;
  if (portalId) {
    standingsUrl += `&portalid=${portalId}`;
  }

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  try {
    // Step 1: GET the initial page to get form state and dropdowns
    console.log(`BlueSombrero: Fetching ${standingsUrl}`);
    let html = await fetchPage(standingsUrl);
    let formState = extractFormState(html);
    let $ = cheerio.load(html);

    // Find the program dropdown (named dropDownSeasons in ViewStandings module)
    const programDropdownId = findDropdownId($, 'dropDownSeasons');
    if (!programDropdownId) {
      console.warn('BlueSombrero: Program dropdown not found');
      return { divisions, standings };
    }

    // Get available programs from dropdown
    const availablePrograms = getDropdownOptions($, programDropdownId);
    console.log(`BlueSombrero: Found ${availablePrograms.length} programs: ${availablePrograms.map(p => p.text).join(', ')}`);

    // Filter to specified programs or use all non-default ones
    let targetPrograms = availablePrograms.filter(p => p.value && p.value !== '0' && p.text !== 'Program');

    if (programs && programs.length > 0) {
      const targetIds = new Set(programs.map(p => p.programId));
      targetPrograms = targetPrograms.filter(p => targetIds.has(p.value));
    } else {
      // Auto-filter by league sport
      const leagueSport = (leagueConfig.sport || 'soccer').toLowerCase();
      if (leagueSport) {
        const sportFiltered = targetPrograms.filter(p => {
          const pText = p.text.toLowerCase();
          return pText.includes(leagueSport) || pText.includes('recreational') || pText.includes('select') || pText.includes('premier');
        });
        // Only filter if we found matches; otherwise keep all
        if (sportFiltered.length > 0) {
          targetPrograms = sportFiltered;
        }
      }

      // Prefer the current/latest year — skip prior-year programs
      const currentYear = new Date().getFullYear().toString();
      const hasCurrentYear = targetPrograms.some(p => p.text.includes(currentYear));
      if (hasCurrentYear) {
        targetPrograms = targetPrograms.filter(p => p.text.includes(currentYear));
      }
    }

    if (targetPrograms.length === 0) {
      console.warn('BlueSombrero: No valid programs found');
      return { divisions, standings };
    }

    // Iterate through each program
    for (const program of targetPrograms) {
      console.log(`BlueSombrero: Selecting program "${program.text}" (${program.value})`);

      // POST to select program — triggers ASP.NET postback
      html = await postback(standingsUrl, formState, programDropdownId, program.value);
      formState = extractFormState(html);
      $ = cheerio.load(html);

      // Look up program metadata if provided
      const programMeta = (programs || []).find(p => p.programId === program.value) || {};

      // Find the division dropdown
      const divDropdownId = findDropdownId($, 'dropDownDivisions') || findDropdownId($, 'dropDownLeagues');

      if (divDropdownId) {
        // Soccer orgs typically have per-division standings — iterate each division
        const divOptions = getDropdownOptions($, divDropdownId);
        const validDivs = divOptions.filter(d => d.value && d.value !== '0' && d.text !== 'Division' && d.text !== 'All');

        if (validDivs.length > 0) {
          await collectByDivision(standingsUrl, formState, divDropdownId, validDivs, program, programMeta, leagueConfig, divisions, standings, now);
          // Re-extract form state after division iterations
          // (last postback state carries forward)
          await sleep(300);
          continue;
        }
      }

      // Fallback: parse standings from the program-level response (all teams)
      const tableData = parseStandingsTable(html);

      if (tableData.rows.length === 0) {
        console.log(`BlueSombrero: No standings data for program "${program.text}"`);
        continue;
      }

      console.log(`BlueSombrero: Found ${tableData.rows.length} teams for "${program.text}"`);

      // Build a single division from the program
      const divSlug = slugify(program.text);
      const divisionId = `${leagueConfig.id}-${divSlug}`;
      const { ageGroup, gender } = inferAgeGroup(program.text, {
        ageGroup: programMeta.ageGroup || 'unknown',
        gender: programMeta.gender || 'unknown',
      });

      divisions.push({
        id: divisionId,
        leagueId: leagueConfig.id,
        seasonId: leagueConfig.seasonId || '2025-2026',
        name: program.text,
        ageGroup,
        gender,
        level: null,
        platformDivisionId: null,
        status: 'active',
      });

      tableData.rows.forEach((row, idx) => {
        standings.push(buildStandingRow(row, idx, leagueConfig, divisionId, now));
      });

      await sleep(300);
    }

  } catch (err) {
    console.error(`BlueSombrero: Collection failed: ${err.message}`);
  }

  return { divisions, standings };
}

/**
 * Iterate through each division, postback to select it, and parse standings.
 * Soccer orgs typically show standings per-division (U8 Boys, U10 Girls, etc.)
 */
async function collectByDivision(standingsUrl, formState, divDropdownId, divOptions, program, programMeta, leagueConfig, divisions, standings, now) {
  for (const div of divOptions) {
    console.log(`BlueSombrero:   Selecting division "${div.text}" (${div.value})`);

    const html = await postback(standingsUrl, formState, divDropdownId, div.value);
    formState = extractFormState(html);

    const tableData = parseStandingsTable(html);
    if (tableData.rows.length === 0) {
      console.log(`BlueSombrero:   No standings for division "${div.text}"`);
      continue;
    }

    const divName = `${div.text} - ${program.text}`;
    const divSlug = `${slugify(program.text)}-${slugify(div.text)}`;
    const divisionId = `${leagueConfig.id}-${divSlug}`;

    const { ageGroup, gender } = inferAgeGroup(div.text, {
      ageGroup: programMeta.ageGroup || 'unknown',
      gender: programMeta.gender || 'unknown',
    });

    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId: leagueConfig.seasonId || '2025-2026',
      name: divName,
      ageGroup,
      gender,
      level: null,
      platformDivisionId: div.value,
      status: 'active',
    });

    tableData.rows.forEach((row, idx) => {
      standings.push(buildStandingRow(row, idx, leagueConfig, divisionId, now));
    });

    console.log(`BlueSombrero:   ${divName}: ${tableData.rows.length} teams`);
    await sleep(200);
  }
}

/**
 * Build a normalized standing row from parsed table data.
 */
function buildStandingRow(row, idx, leagueConfig, divisionId, now) {
  const sport = (leagueConfig.sport || 'soccer').toLowerCase();
  const standing = {
    teamName: row.team,
    position: idx + 1,
    gamesPlayed: parseInt(row.gp) || 0,
    wins: parseInt(row.w) || 0,
    losses: parseInt(row.l) || 0,
    ties: parseInt(row.t || row.d) || 0,
    scored: parseInt(row.gf || row.rs) || 0,
    allowed: parseInt(row.ga || row.ra) || 0,
    differential: parseInt(row.gd || row.diff) || 0,
    points: parseInt(row.pts) || 0,
    winPct: row.pct ? parseFloat(row.pct) : null,
    gamesBack: row.gb || null,
    streak: row.strk || null,
    gamesRemaining: parseInt(row.gr) || null,
    sport,
    leagueId: leagueConfig.id,
    divisionId,
    seasonId: leagueConfig.seasonId || '2025-2026',
    collectedAt: now,
  };

  // Add soccer-specific fields
  if (sport === 'soccer') {
    standing.yellowCards = parseInt(row.yc) || 0;
    standing.redCards = parseInt(row.rc) || 0;
    standing.shutouts = parseInt(row.so || row.cs) || 0;
  }

  return standing;
}

// ═══════════════════════════════════════════════════════════════
// HTTP HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch a page via GET (follows redirects for custom domains)
 */
async function fetchPage(url) {
  const resp = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 TeamsUnited-Standings/1.0',
      'Accept': 'text/html,application/xhtml+xml',
    },
    maxRedirects: 5,
  });
  return resp.data;
}

/**
 * Execute an ASP.NET postback via HTTP POST.
 *
 * Same DNN/ViewStandings module as SportsConnect — postbacks use
 * __EVENTTARGET with $ separators and include all hidden fields
 * plus current dropdown values.
 */
async function postback(url, formState, dropdownId, value) {
  const eventTarget = dropdownId.replace(/_/g, '$');

  const formData = new URLSearchParams();

  for (const [key, val] of Object.entries(formState.hiddenFields || {})) {
    formData.append(key, val);
  }

  formData.set('__EVENTTARGET', eventTarget);
  formData.set('__EVENTARGUMENT', '');

  for (const [key, val] of Object.entries(formState.dropdownValues || {})) {
    formData.set(key, val);
  }

  formData.set(eventTarget, value);

  const resp = await axios.post(url, formData.toString(), {
    timeout: 60000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 TeamsUnited-Standings/1.0',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml',
    },
    maxRedirects: 5,
  });
  return resp.data;
}

/**
 * Extract all form state from HTML — hidden fields and dropdown values.
 */
function extractFormState(html) {
  const $ = cheerio.load(html);
  const hiddenFields = {};
  const dropdownValues = {};

  $('input[type="hidden"]').each(function () {
    const name = $(this).attr('name');
    const val = $(this).attr('value') || '';
    if (name) {
      hiddenFields[name] = val;
    }
  });

  $('select').each(function () {
    const name = $(this).attr('name');
    if (name) {
      const selected = $(this).find('option:selected').attr('value');
      if (selected !== undefined) {
        dropdownValues[name] = selected;
      }
    }
  });

  return { hiddenFields, dropdownValues };
}

// ═══════════════════════════════════════════════════════════════
// HTML PARSING HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Find a dropdown element ID by partial name match.
 * ViewStandings dropdown IDs: dnn_ctr{NUM}_ViewStandings_dropDown{Type}
 */
function findDropdownId($, partialId) {
  let found = null;
  $('select').each(function () {
    const id = $(this).attr('id');
    if (id && id.includes(partialId)) {
      found = id;
      return false;
    }
  });
  return found;
}

/**
 * Get all options from a dropdown by its ID
 */
function getDropdownOptions($, dropdownId) {
  const options = [];
  $(`#${dropdownId} option`).each(function () {
    options.push({
      value: $(this).attr('value') || '',
      text: $(this).text().trim(),
    });
  });
  return options;
}

/**
 * Parse the standings table from HTML response.
 *
 * Handles two table formats used by ViewStandings:
 * 1. Telerik RadGrid (rgMasterTable with rgRow/rgAltRow) — older sites
 * 2. Standard HTML table with viewStanding CSS class — newer sites
 *
 * Soccer standings columns may include:
 *   Team, GP, W, L, T/D, GF, GA, GD, PTS, PCT
 * Baseball columns (when soccer orgs also have baseball):
 *   Team, GP, W, L, T, RS, RA, DIFF, PCT, GB
 */
function parseStandingsTable(html) {
  // Try RadGrid format first (same as SportsConnect)
  const rgResult = parseRadGridTable(html);
  if (rgResult.rows.length > 0) return rgResult;

  // Try standard HTML table format
  return parseStandardTable(html);
}

/**
 * Parse Telerik RadGrid standings table (rgMasterTable with rgRow/rgAltRow).
 * Same format as SportsConnect.
 */
function parseRadGridTable(html) {
  const tableStart = html.indexOf('rgMasterTable');
  if (tableStart === -1) return { rows: [], headers: [] };

  const afterTable = html.substring(tableStart);

  // Extract headers from <thead>
  const headers = [];
  const theadMatch = afterTable.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (theadMatch) {
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let hMatch;
    while ((hMatch = thRegex.exec(theadMatch[1])) !== null) {
      const text = hMatch[1].replace(/<[^>]+>/g, '').trim().toUpperCase();
      headers.push(text);
    }
  }

  const colMap = buildColumnMap(headers);

  // Extract data rows using rgRow/rgAltRow classes
  const rows = [];
  const trRegex = /<tr[^>]*class="[^"]*rg(?:Row|AltRow)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rMatch;
  while ((rMatch = trRegex.exec(afterTable)) !== null) {
    const row = extractRowCells(rMatch[1], colMap);
    if (row) rows.push(row);
  }

  console.log(`BlueSombrero: RadGrid parsed ${rows.length} data rows`);
  return { rows, headers };
}

/**
 * Parse standard HTML table format (non-RadGrid).
 * Looks for tables with viewStanding class or standalone standings tables.
 */
function parseStandardTable(html) {
  const $ = cheerio.load(html);

  // Look for standings tables by class or context
  const table = $('table.viewStanding, .viewStanding table, table.standings').first();
  if (table.length === 0) {
    // Try any table inside a ViewStandings module container
    const moduleTable = $('[class*="ViewStandings"] table, [id*="ViewStandings"] table').first();
    if (moduleTable.length === 0) {
      console.log('BlueSombrero: No standings table found');
      return { rows: [], headers: [] };
    }
    return parseCheerioTable(moduleTable, $);
  }

  return parseCheerioTable(table, $);
}

/**
 * Parse a Cheerio table element into rows
 */
function parseCheerioTable(table, $) {
  const headers = [];
  table.find('thead th, thead td, tr:first-child th').each(function () {
    headers.push($(this).text().trim().toUpperCase());
  });

  const colMap = buildColumnMap(headers);

  const rows = [];
  table.find('tbody tr, tr').each(function () {
    // Skip header rows
    if ($(this).find('th').length > 0) return;

    const cells = [];
    $(this).find('td').each(function () {
      cells.push($(this).text().trim());
    });

    if (cells.length < 4) return;

    const row = mapCellsToRow(cells, colMap);
    if (row && row.team && row.team !== 'Team' && row.team !== 'TEAM') {
      rows.push(row);
    }
  });

  console.log(`BlueSombrero: Standard table parsed ${rows.length} data rows`);
  return { rows, headers };
}

/**
 * Build column index map from header names.
 * Handles both soccer and baseball column naming.
 */
function buildColumnMap(headers) {
  const colMap = {};
  headers.forEach((h, i) => {
    const key = h.replace(/\s+/g, '');
    // Team
    if (key === 'TEAM' || key === 'TEAMS') colMap.team = i;
    // Common
    else if (key === 'GP' || key === 'G' || key === 'MP') colMap.gp = i;
    else if (key === 'W') colMap.w = i;
    else if (key === 'L') colMap.l = i;
    else if (key === 'T' || key === 'D' || key === 'DRAWS') colMap.t = i;
    else if (key === 'PCT' || key === 'WIN%') colMap.pct = i;
    // Soccer-specific
    else if (key === 'GF' || key === 'GOALSFOR' || key === 'F') colMap.gf = i;
    else if (key === 'GA' || key === 'GOALSAGAINST' || key === 'A') colMap.ga = i;
    else if (key === 'GD' || key === 'GOALDIFF' || key === '+/-') colMap.gd = i;
    else if (key === 'PTS' || key === 'POINTS') colMap.pts = i;
    else if (key === 'YC' || key === 'YELLOW') colMap.yc = i;
    else if (key === 'RC' || key === 'RED') colMap.rc = i;
    else if (key === 'SO' || key === 'CS' || key === 'SHUTOUTS' || key === 'CLEANSHEETS') colMap.so = i;
    // Baseball-compatible
    else if (key === 'RS' || key === 'RUNSSCORED') colMap.rs = i;
    else if (key === 'RA' || key === 'RUNSALLOWED') colMap.ra = i;
    else if (key === 'DIFF') colMap.diff = i;
    else if (key === 'GB') colMap.gb = i;
    else if (key === 'GR') colMap.gr = i;
    else if (key === 'STRK' || key === 'STREAK') colMap.strk = i;
    else if (key === 'SORTORDER') colMap.sortOrder = i;
  });

  if (colMap.team === undefined) colMap.team = 1;

  console.log(`BlueSombrero: Found ${headers.length} headers: ${headers.join(', ')}`);
  return colMap;
}

/**
 * Extract cells from a <tr> HTML string and map to row object
 */
function extractRowCells(trHtml, colMap) {
  const cells = [];
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let cMatch;
  while ((cMatch = tdRegex.exec(trHtml)) !== null) {
    cells.push(cMatch[1].replace(/<[^>]+>/g, '').trim());
  }

  if (cells.length < 4) return null;
  return mapCellsToRow(cells, colMap);
}

/**
 * Map cell array to a row object using column map
 */
function mapCellsToRow(cells, colMap) {
  const get = (idx) => (idx !== undefined && idx < cells.length) ? cells[idx] : '';

  const teamName = get(colMap.team);
  if (!teamName || teamName === 'Team' || teamName === 'TEAM') return null;

  return {
    team: teamName,
    gp: get(colMap.gp),
    w: get(colMap.w),
    l: get(colMap.l),
    t: get(colMap.t),
    // Soccer columns
    gf: get(colMap.gf),
    ga: get(colMap.ga),
    gd: get(colMap.gd),
    pts: get(colMap.pts),
    yc: get(colMap.yc),
    rc: get(colMap.rc),
    so: get(colMap.so),
    // Baseball-compatible columns
    rs: get(colMap.rs),
    ra: get(colMap.ra),
    diff: get(colMap.diff),
    pct: get(colMap.pct),
    gb: get(colMap.gb),
    gr: get(colMap.gr),
    strk: get(colMap.strk),
  };
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

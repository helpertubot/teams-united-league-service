/**
 * SportsConnect / Blue Sombrero Adapter
 *
 * Pure HTTP adapter for SportsConnect (Blue Sombrero / Stack Sports) standings.
 * Used by: Little League International, PONY Baseball, many youth rec leagues
 *
 * SportsConnect is the official website platform for Little League — most of the
 * 15,000+ Little League programs worldwide use it. Owned by DICK'S Sporting Goods
 * (same parent as GameChanger).
 *
 * URL Pattern: https://{domain}/Default.aspx?tabid={STANDINGS_TAB_ID}
 *   - Custom domains: svll.net, kirklandnationalll.com, etc.
 *   - Blue Sombrero hosted: tshq.bluesombrero.com/Default.aspx?tabid={id}
 *   - clubs.bluesombrero.com/Default.aspx?tabid={id}
 *
 * This adapter replays ASP.NET WebForms postbacks via HTTP POST instead of using
 * Puppeteer. Each dropdown selection (Program → Division → Schedule) is a postback
 * that returns a full page with updated form state (__VIEWSTATE, __EVENTVALIDATION).
 *
 * The standings table is a Telerik RadGrid with CSS classes:
 *   - rgMasterTable: the main table
 *   - rgRow / rgAltRow: data rows
 *   - rgHeader: header row
 *
 * Columns: Sort Order, Team, GP, W, L, T, GR, BYES, PCT, STRK, GB, RS, RA, RPG, APG, DIFF
 *
 * sourceConfig schema:
 * {
 *   baseUrl: 'https://www.svll.net',           // League website root
 *   standingsTabId: '2551172',                  // tabid for standings page
 *   programs: [                                 // Optional — auto-discovers if omitted
 *     { programId: '130174888', name: '2026 Baseball', ageGroup: 'mixed', gender: 'mixed' }
 *   ]
 * }
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'sportsconnect';

/**
 * Collect standings for a SportsConnect league
 * @param {Object} leagueConfig
 * @param {string} leagueConfig.sourceConfig.baseUrl - League website root URL
 * @param {string} leagueConfig.sourceConfig.standingsTabId - Tab ID for standings page
 * @param {Array}  [leagueConfig.sourceConfig.programs] - Optional program filter
 * @returns {Object} { divisions: [...], standings: [...] }
 */
async function collectStandings(leagueConfig) {
  const { baseUrl, standingsTabId, programs } = leagueConfig.sourceConfig;
  const standingsUrl = `${baseUrl}/Default.aspx?tabid=${standingsTabId}`;

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  try {
    // Step 1: GET the initial page to get form state and dropdowns
    console.log(`SportsConnect: Fetching ${standingsUrl}`);
    let html = await fetchPage(standingsUrl);
    let formState = extractFormState(html);
    let $ = cheerio.load(html);

    // Find the dropdown IDs (they contain partial names like 'dropDownSeasons')
    const programDropdownId = findDropdownId($, 'dropDownSeasons');
    if (!programDropdownId) {
      console.warn('SportsConnect: Program dropdown not found');
      return { divisions, standings };
    }

    // Get available programs from dropdown
    const availablePrograms = getDropdownOptions($, programDropdownId);
    console.log(`SportsConnect: Found ${availablePrograms.length} programs: ${availablePrograms.map(p => p.text).join(', ')}`);

    // Filter to specified programs or use all non-default ones
    let targetPrograms = availablePrograms.filter(p => p.value && p.value !== '0' && p.text !== 'Program');

    if (programs && programs.length > 0) {
      // Explicit program list from sourceConfig
      const targetIds = new Set(programs.map(p => p.programId));
      targetPrograms = targetPrograms.filter(p => targetIds.has(p.value));
    } else {
      // Auto-filter by league sport (e.g. baseball league skips softball programs)
      const leagueSport = (leagueConfig.sport || '').toLowerCase();
      if (leagueSport) {
        targetPrograms = targetPrograms.filter(p => {
          const pText = p.text.toLowerCase();
          return pText.includes(leagueSport);
        });
      }

      // Prefer the current/latest year — skip prior-year programs if current-year exists
      const currentYear = new Date().getFullYear().toString();
      const hasCurrentYear = targetPrograms.some(p => p.text.includes(currentYear));
      if (hasCurrentYear) {
        targetPrograms = targetPrograms.filter(p => p.text.includes(currentYear));
      }
    }

    if (targetPrograms.length === 0) {
      console.warn('SportsConnect: No valid programs found');
      return { divisions, standings };
    }

    // Iterate through each program
    for (const program of targetPrograms) {
      console.log(`SportsConnect: Selecting program "${program.text}" (${program.value})`);

      // POST to select program — triggers ASP.NET postback
      // The program postback response includes ALL teams in the rgMasterTable
      // with division prefixes embedded in team names (e.g. "A / Miller / Cubs").
      // Individual division postbacks are NOT needed — they often return empty tables.
      html = await postback(standingsUrl, formState, programDropdownId, program.value);
      formState = extractFormState(html);
      $ = cheerio.load(html);

      // Parse standings from the program response (contains all teams)
      const tableData = parseStandingsTable(html);

      if (tableData.rows.length === 0) {
        console.log(`SportsConnect: No standings data for program "${program.text}"`);
        continue;
      }

      console.log(`SportsConnect: Found ${tableData.rows.length} total teams for "${program.text}"`);

      // Look up program metadata if provided
      const programMeta = (programs || []).find(p => p.programId === program.value) || {};

      // Team names embed a division prefix: "A / Miller / Cubs"
      // meaning Division=A, Coach=Miller, Team=Cubs.
      // Group rows by that prefix so each sub-division gets its own division doc.
      const grouped = groupByDivisionPrefix(tableData.rows);

      for (const [prefix, groupRows] of Object.entries(grouped)) {
        const hasPrefix = prefix !== '_none';
        const divName = hasPrefix ? `${prefix} - ${program.text}` : program.text;
        const divSlug = hasPrefix
          ? `${slugify(program.text)}-${slugify(prefix)}`
          : slugify(program.text);
        const divisionId = `${leagueConfig.id}-${divSlug}`;

        const { ageGroup, gender } = parseDivisionInfo(divName, programMeta);

        divisions.push({
          id: divisionId,
          leagueId: leagueConfig.id,
          seasonId: leagueConfig.seasonId || '2025-2026',
          name: divName,
          ageGroup,
          gender,
          level: hasPrefix ? prefix : null,
          platformDivisionId: null,
          status: 'active',
        });

        groupRows.forEach((row, idx) => {
          const standing = {
            teamName: row.cleanTeam || row.team,
            coach: row.coach || null,
            position: idx + 1,
            gamesPlayed: parseInt(row.gp) || 0,
            wins: parseInt(row.w) || 0,
            losses: parseInt(row.l) || 0,
            ties: parseInt(row.t) || 0,
            scored: parseInt(row.rs) || 0,
            allowed: parseInt(row.ra) || 0,
            differential: parseInt(row.diff) || 0,
            winPct: row.pct ? parseFloat(row.pct) : null,
            gamesBack: row.gb || null,
            streak: row.strk || null,
            gamesRemaining: parseInt(row.gr) || null,
            runsPerGame: row.rpg ? parseFloat(row.rpg) : null,
            allowedPerGame: row.apg ? parseFloat(row.apg) : null,
            sport: (leagueConfig.sport || 'baseball').toLowerCase(),
            leagueId: leagueConfig.id,
            divisionId,
            seasonId: leagueConfig.seasonId || '2025-2026',
            collectedAt: now,
          };

          // Add sport-specific fields
          const sport = standing.sport;
          if (sport === 'soccer' || sport === 'hockey' || sport === 'lacrosse') {
            standing.points = 0;
            standing.yellowCards = 0;
            standing.redCards = 0;
            standing.shutouts = 0;
          }

          standings.push(standing);
        });

        console.log(`SportsConnect:   ${divName}: ${groupRows.length} teams`);
      }

      // Delay between programs
      await sleep(300);
    }

  } catch (err) {
    console.error(`SportsConnect: Collection failed: ${err.message}`);
  }

  return { divisions, standings };
}

// ═══════════════════════════════════════════════════════════════
// HTTP HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch a page via GET
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
 * Execute an ASP.NET postback via HTTP POST
 *
 * ASP.NET WebForms postbacks send the entire form state back to the server.
 * The __EVENTTARGET is the control ID (with $ separators, not _ separators)
 * that triggered the postback, and __EVENTARGUMENT is usually empty.
 *
 * SportsConnect uses DNN (DotNetNuke) which stores form state in _VSTATE
 * instead of __VIEWSTATE, and requires all hidden fields + current dropdown
 * values to be posted back.
 *
 * @param {string} url - The page URL
 * @param {Object} formState - Extracted form state (all hidden fields + dropdown values)
 * @param {string} dropdownId - The dropdown HTML ID (underscore-separated)
 * @param {string} value - The selected value
 * @returns {string} Response HTML
 */
async function postback(url, formState, dropdownId, value) {
  // ASP.NET __EVENTTARGET uses $ separators, not underscores
  const eventTarget = dropdownId.replace(/_/g, '$');

  const formData = new URLSearchParams();

  // Include all hidden fields from the form
  for (const [key, val] of Object.entries(formState.hiddenFields || {})) {
    formData.append(key, val);
  }

  // Override the event target/argument
  formData.set('__EVENTTARGET', eventTarget);
  formData.set('__EVENTARGUMENT', '');

  // Include all dropdown current values
  for (const [key, val] of Object.entries(formState.dropdownValues || {})) {
    formData.set(key, val);
  }

  // Set the changed dropdown to the new value
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
 * SportsConnect/DNN uses _VSTATE instead of __VIEWSTATE.
 */
function extractFormState(html) {
  const $ = cheerio.load(html);
  const hiddenFields = {};
  const dropdownValues = {};

  // Collect all hidden inputs
  $('input[type="hidden"]').each(function () {
    const name = $(this).attr('name');
    const val = $(this).attr('value') || '';
    if (name) {
      hiddenFields[name] = val;
    }
  });

  // Collect current dropdown values (selected options)
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
 * Find a dropdown element ID by partial name match
 * SportsConnect dropdown IDs are like: dnn_ctr{NUM}_ViewStandings_dropDownSeasons
 */
function findDropdownId($, partialId) {
  let found = null;
  $('select').each(function () {
    const id = $(this).attr('id');
    if (id && id.includes(partialId)) {
      found = id;
      return false; // break
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
 * Parse the standings table from HTML response
 *
 * SportsConnect uses Telerik RadGrid for standings tables.
 * Data rows have CSS classes "rgRow" or "rgAltRow".
 * Headers are in "rgHeader" rows inside <thead>.
 * We match directly on these classes instead of relying on <tbody> tags,
 * which RadGrid may not consistently emit.
 */
function parseStandingsTable(html) {
  // Find the rgMasterTable
  const tableStart = html.indexOf('rgMasterTable');
  if (tableStart === -1) {
    console.log('SportsConnect: No rgMasterTable found in response');
    return { rows: [], headers: [] };
  }

  // Get everything from the table onwards
  const afterTable = html.substring(tableStart);

  // Extract headers from <thead> — RadGrid puts class="rgHeader" on individual
  // <th> elements, not on the <tr>, so we match the <thead> block instead
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

  // Build column index map
  const colMap = {};
  headers.forEach((h, i) => {
    const key = h.replace(/\s+/g, '');
    if (key === 'TEAM' || key === 'TEAMS') colMap.team = i;
    else if (key === 'GP') colMap.gp = i;
    else if (key === 'W') colMap.w = i;
    else if (key === 'L') colMap.l = i;
    else if (key === 'T') colMap.t = i;
    else if (key === 'GR') colMap.gr = i;
    else if (key === 'BYES' || key === 'BYCS') colMap.byes = i;
    else if (key === 'PCT') colMap.pct = i;
    else if (key === 'STRK') colMap.strk = i;
    else if (key === 'GB') colMap.gb = i;
    else if (key === 'RS') colMap.rs = i;
    else if (key === 'RA') colMap.ra = i;
    else if (key === 'RPG') colMap.rpg = i;
    else if (key === 'APG') colMap.apg = i;
    else if (key === 'DIFF') colMap.diff = i;
    else if (key === 'SORTORDER') colMap.sortOrder = i;
  });

  // Default team column to 1 (0 is usually Sort Order)
  if (colMap.team === undefined) colMap.team = 1;

  console.log(`SportsConnect: Found ${headers.length} headers: ${headers.join(', ')}`);

  // Extract data rows using rgRow/rgAltRow classes
  // This is the key fix: we match directly on RadGrid data row classes
  // instead of relying on <tbody> which may not exist or may be nested
  const rows = [];
  const trRegex = /<tr[^>]*class="[^"]*rg(?:Row|AltRow)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rMatch;
  while ((rMatch = trRegex.exec(afterTable)) !== null) {
    const cells = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cMatch;
    while ((cMatch = tdRegex.exec(rMatch[1])) !== null) {
      // Strip HTML tags and trim
      const text = cMatch[1].replace(/<[^>]+>/g, '').trim();
      cells.push(text);
    }

    if (cells.length < 4) continue; // Skip rows with too few cells

    const getCellText = (idx) => {
      if (idx === undefined || idx >= cells.length) return '';
      return cells[idx];
    };

    const teamName = getCellText(colMap.team);
    if (!teamName || teamName === 'Team' || teamName === 'TEAM') continue;

    rows.push({
      team: teamName,
      gp: getCellText(colMap.gp),
      w: getCellText(colMap.w),
      l: getCellText(colMap.l),
      t: getCellText(colMap.t),
      gr: getCellText(colMap.gr),
      pct: getCellText(colMap.pct),
      strk: getCellText(colMap.strk),
      gb: getCellText(colMap.gb),
      rs: getCellText(colMap.rs),
      ra: getCellText(colMap.ra),
      rpg: getCellText(colMap.rpg),
      apg: getCellText(colMap.apg),
      diff: getCellText(colMap.diff),
    });
  }

  console.log(`SportsConnect: Parsed ${rows.length} data rows`);

  return { rows, headers };
}

/**
 * Extract division prefix from division name — just the first word.
 *
 * Examples:
 *   "A Baseball (League Ages 6-7)" → "A"
 *   "AA Baseball (League Ages 7-8)" → "AA"
 *   "Coast/Majors Baseball" → "Coast/Majors"
 *   "Minors - Little League Baseball" → "Minors"
 */
function extractDivisionPrefix(divName) {
  if (!divName) return null;
  return divName.split(/\s+/)[0];
}

/**
 * Group table rows by the division prefix embedded in team names.
 * SportsConnect team names often follow: "A / Miller / Cubs"
 * meaning Division=A, Coach=Miller, Team=Cubs.
 *
 * Known prefixes: A, AA, AAA, T-Ball, Majors, Minors, etc.
 * If no prefix pattern is detected, all rows go under '_none'.
 */
function groupByDivisionPrefix(rows) {
  // Known LL/youth division prefixes
  const KNOWN_PREFIXES = new Set([
    'A', 'AA', 'AAA', 'AAAA',
    'T-BALL', 'TBALL', 'TEE BALL', 'TEE-BALL',
    'MAJORS', 'MINORS', 'COAST',
    'COACH PITCH', 'PLAYER PITCH', 'MACHINE PITCH',
    'FARM', 'ROOKIE', 'JUNIOR', 'SENIOR', 'BIG LEAGUE',
    'INTERMEDIATE',
    '50/70',
    'CHALLENGER',
  ]);

  const groups = {};
  let prefixCount = 0;

  for (const row of rows) {
    const parts = row.team.split(/\s*\/\s*/);
    let prefix = '_none';
    let coach = null;
    let cleanTeam = row.team;

    if (parts.length >= 3) {
      // "A / Miller / Cubs" → prefix=A, coach=Miller, team=Cubs
      const candidate = parts[0].trim().toUpperCase();
      if (KNOWN_PREFIXES.has(candidate)) {
        prefix = parts[0].trim();
        coach = parts[1].trim();
        cleanTeam = parts.slice(2).join(' / ').trim();
        prefixCount++;
      }
    } else if (parts.length === 2) {
      // "A / Cubs" or "Miller / Cubs" — check if first part is a known prefix
      const candidate = parts[0].trim().toUpperCase();
      if (KNOWN_PREFIXES.has(candidate)) {
        prefix = parts[0].trim();
        cleanTeam = parts[1].trim();
        prefixCount++;
      }
    }

    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push({ ...row, cleanTeam, coach });
  }

  // If very few rows matched prefixes, don't split — treat as one division
  if (prefixCount > 0 && prefixCount < rows.length * 0.3) {
    // Less than 30% matched — probably not a prefix pattern, merge back
    const merged = {};
    merged['_none'] = rows.map(r => ({ ...r, cleanTeam: r.team, coach: null }));
    return merged;
  }

  return groups;
}

/**
 * Parse age group and gender from division name strings like:
 * "Majors - Little League Baseball Ages 10 to 12"
 * "AA - Player Pitch - Little League Baseball Ages 6 to 8"
 * "Minors - Little League Softball Ages 9 to 11"
 *
 * Delegates to the shared age-group-parser, with metadata overrides.
 */
function parseDivisionInfo(divName, meta) {
  const defaults = {
    ageGroup: meta.ageGroup || 'unknown',
    gender: meta.gender || 'unknown',
  };
  return inferAgeGroup(divName, defaults);
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

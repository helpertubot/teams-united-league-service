/**
 * SportsConnect / Blue Sombrero Adapter
 * 
 * Browser automation adapter for SportsConnect (Blue Sombrero / Stack Sports) standings.
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
 * IMPORTANT: This is an ASP.NET WebForms app. Standings data loads via postback
 * after cascading dropdown selections: Program → Division → Schedule → Table.
 * There is NO JSON API — must render with Puppeteer.
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

const { launchBrowser } = require('../browser');
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

  let browser;
  try {
    browser = await launchBrowser();

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 TeamsUnited-Standings/1.0');

    console.log(`SportsConnect: Navigating to ${standingsUrl}`);
    await page.goto(standingsUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for the page to fully render
    await sleep(2000);

    // Find the Program dropdown — its ID contains 'dropDownSeasons'
    const programDropdown = await findDropdown(page, 'dropDownSeasons');
    if (!programDropdown) {
      console.warn('SportsConnect: Program dropdown not found');
      return { divisions, standings };
    }

    // Get available programs
    const availablePrograms = await getDropdownOptions(page, programDropdown);
    console.log(`SportsConnect: Found ${availablePrograms.length} programs: ${availablePrograms.map(p => p.text).join(', ')}`);

    // Filter to specified programs or use all non-default ones
    let targetPrograms = availablePrograms.filter(p => p.value && p.value !== '0' && p.text !== 'Program');
    
    if (programs && programs.length > 0) {
      const targetIds = new Set(programs.map(p => p.programId));
      targetPrograms = targetPrograms.filter(p => targetIds.has(p.value));
    }

    if (targetPrograms.length === 0) {
      console.warn('SportsConnect: No valid programs found');
      return { divisions, standings };
    }

    // Iterate through each program
    for (const program of targetPrograms) {
      console.log(`SportsConnect: Selecting program "${program.text}" (${program.value})`);

      // Select the program — triggers ASP.NET postback
      await selectDropdownValue(page, programDropdown, program.value);
      await waitForPostback(page);

      // Find Division dropdown
      const divisionDropdown = await findDropdown(page, 'dropDownDivisions');
      if (!divisionDropdown) {
        console.warn(`SportsConnect: Division dropdown not found for program "${program.text}"`);
        continue;
      }

      // Get available divisions
      const availableDivisions = await getDropdownOptions(page, divisionDropdown);
      const targetDivisions = availableDivisions.filter(d => d.value && d.value !== '0' && d.text !== 'Division');
      console.log(`SportsConnect: Found ${targetDivisions.length} divisions for "${program.text}"`);

      // Iterate through each division
      for (const div of targetDivisions) {
        console.log(`SportsConnect:   Division "${div.text}" (${div.value})`);

        // Select division — triggers another postback
        await selectDropdownValue(page, divisionDropdown, div.value);
        await waitForPostback(page);

        // Find Schedule dropdown and get first schedule
        const scheduleDropdown = await findDropdown(page, 'dropDownEvents');
        if (scheduleDropdown) {
          const scheduleOptions = await getDropdownOptions(page, scheduleDropdown);
          const validSchedules = scheduleOptions.filter(s => s.value && s.value !== '0' && s.text !== 'Schedule');
          console.log(`SportsConnect:     Schedule dropdown found, ${validSchedules.length} valid schedules`);

          if (validSchedules.length > 0) {
            console.log(`SportsConnect:     Selecting schedule "${validSchedules[0].text}"`);
            // Select first valid schedule
            await selectDropdownValue(page, scheduleDropdown, validSchedules[0].value);
            await waitForPostback(page);
          }
        } else {
          console.log('SportsConnect:     No schedule dropdown found');
        }

        // Ensure "Include external teams" checkbox is checked if present
        const checkedExternal = await page.evaluate(() => {
          const checkboxes = document.querySelectorAll('input[type="checkbox"]');
          for (const cb of checkboxes) {
            if (cb.id && cb.id.includes('chkExternalTeams') && !cb.checked) {
              cb.click();
              return true;
            }
          }
          return false;
        });
        if (checkedExternal) {
          console.log('SportsConnect:     Checked "Include external teams" checkbox');
          await waitForPostback(page);
        }

        // Extract the standings table
        const tableData = await extractStandingsTable(page);
        if (tableData.rows.length === 0) {
          console.log(`SportsConnect:     No standings data for this division`);
          continue;
        }

        // Look up program metadata if provided
        const programMeta = (programs || []).find(p => p.programId === program.value) || {};
        
        // Parse ageGroup and gender from division name
        const { ageGroup, gender } = parseDivisionInfo(div.text, programMeta);

        const divisionId = `${leagueConfig.id}-${slugify(program.text)}-${slugify(div.text)}`;

        divisions.push({
          id: divisionId,
          leagueId: leagueConfig.id,
          seasonId: leagueConfig.seasonId || '2025-2026',
          name: `${div.text}`,
          ageGroup,
          gender,
          level: null,
          platformDivisionId: div.value,
          status: 'active',
        });

        tableData.rows.forEach((row, idx) => {
          standings.push({
            teamName: row.team,
            position: idx + 1,
            gamesPlayed: parseInt(row.gp) || 0,
            wins: parseInt(row.w) || 0,
            losses: parseInt(row.l) || 0,
            ties: parseInt(row.t) || 0,
            points: 0, // Youth baseball doesn't use points
            scored: parseInt(row.rs) || 0,
            allowed: parseInt(row.ra) || 0,
            differential: parseInt(row.diff) || 0,
            winPct: row.pct ? parseFloat(row.pct) : null,
            gamesBack: row.gb || null,
            streak: row.strk || null,
            gamesRemaining: parseInt(row.gr) || null,
            runsPerGame: row.rpg ? parseFloat(row.rpg) : null,
            allowedPerGame: row.apg ? parseFloat(row.apg) : null,
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

        console.log(`SportsConnect:     Collected ${tableData.rows.length} teams`);

        // Small delay between divisions to be respectful
        await sleep(1000);
      }

      // Delay between programs
      await sleep(500);
    }

  } catch (err) {
    console.error(`SportsConnect: Browser automation failed: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  return { divisions, standings };
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Find a dropdown on the page by partial ID match
 * SportsConnect dropdown IDs are like: dnn_ctr{NUM}_ViewStandings_dropDownSeasons
 */
async function findDropdown(page, partialId) {
  const selector = await page.evaluate((partial) => {
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      if (sel.id && sel.id.includes(partial)) {
        return `#${sel.id}`;
      }
    }
    return null;
  }, partialId);
  return selector;
}

/**
 * Get all options from a dropdown
 */
async function getDropdownOptions(page, selector) {
  return page.evaluate((sel) => {
    const dropdown = document.querySelector(sel);
    if (!dropdown) return [];
    return Array.from(dropdown.options).map(opt => ({
      value: opt.value,
      text: opt.text.trim(),
    }));
  }, selector);
}

/**
 * Select a value in a dropdown and trigger ASP.NET postback
 */
async function selectDropdownValue(page, selector, value) {
  // Use Puppeteer's built-in page.select() — it sets the value and dispatches
  // exactly ONE change event via native browser behavior, which properly triggers
  // ASP.NET's inline onchange handler (__doPostBack) exactly once.
  // Previous approach called both dispatchEvent(change) AND onchange(), causing
  // a double postback that destroyed the rendered page state.
  await page.select(selector, value);
}

/**
 * Wait for ASP.NET postback to complete
 * Postbacks cause a full page reload — wait for navigation + idle
 */
async function waitForPostback(page) {
  try {
    // Wait for navigation (ASP.NET postback causes full page reload)
    await page.waitForNavigation({ 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
  } catch (err) {
    // Sometimes the postback is handled client-side with UpdatePanel
    // In that case, just wait a bit for AJAX to complete
    await sleep(3000);
  }
  // Extra wait for any JavaScript rendering
  await sleep(1000);
}

/**
 * Extract the standings table data from the current page state
 */
async function extractStandingsTable(page) {
  return page.evaluate(() => {
    const rows = [];
    
    // Find the standings table — look for tables preceded by an h4 "Standings"
    // or tables containing typical standings headers
    const tables = document.querySelectorAll('table');
    let standingsTable = null;

    for (const table of tables) {
      // Check if this table has standings-like headers
      const headerRow = table.querySelector('thead tr') || table.querySelector('tr:first-child');
      if (!headerRow) continue;

      const headerCells = headerRow.querySelectorAll('th, td');
      const headerTexts = Array.from(headerCells).map(c => c.textContent.trim().toUpperCase());
      
      // Must have Team and W columns at minimum
      const hasTeam = headerTexts.some(h => h === 'TEAM' || h === 'TEAMS');
      const hasWins = headerTexts.some(h => h === 'W');
      
      if (hasTeam && hasWins) {
        standingsTable = table;
        break;
      }
    }

    if (!standingsTable) {
      // Fallback: look for table with standingTextbox inputs (SportsConnect specific)
      for (const table of tables) {
        if (table.querySelector('.standingTextbox, input[class*="standing"]')) {
          standingsTable = table;
          break;
        }
      }
    }

    if (!standingsTable) return { rows: [], headers: [] };

    // Parse headers
    const headerRow = standingsTable.querySelector('thead tr') || standingsTable.querySelector('tr:first-child');
    const headers = [];
    if (headerRow) {
      headerRow.querySelectorAll('th, td').forEach(cell => {
        headers.push(cell.textContent.trim().toUpperCase());
      });
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

    // Parse data rows — skip header row
    const tbody = standingsTable.querySelector('tbody');
    const dataRows = tbody 
      ? tbody.querySelectorAll('tr')
      : standingsTable.querySelectorAll('tr:not(:first-child)');

    dataRows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) return; // Skip rows with too few cells

      const getCellText = (idx) => {
        if (idx === undefined || idx >= cells.length) return '';
        return cells[idx].textContent.trim();
      };

      const teamName = getCellText(colMap.team);
      if (!teamName || teamName === 'Team' || teamName === 'TEAM') return;

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
    });

    return { rows, headers };
  });
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

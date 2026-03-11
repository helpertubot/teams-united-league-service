/**
 * updateSheet Cloud Function
 * 
 * Syncs Firestore league & division data → Google Sheets dashboard.
 * Runs automatically after collectAll completes, or can be triggered manually.
 * 
 * Spreadsheet: Teams United — League Dashboard
 * ID: 1CfFj3dXz3Vc9FBhBe8OiGLWmQE6LH81MLa133TbdUco
 * 
 * Tabs (by sport): Soccer, Baseball, Basketball, Hockey, Lacrosse, All Divisions
 * 
 * Trigger: POST (no body needed), or { "sport": "soccer" } to update one tab
 * 
 * Auth: Uses the league-standings-service service account.
 * The spreadsheet must be shared with:
 *   league-standings-service@teams-united.iam.gserviceaccount.com (Editor)
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');
const { google } = require('googleapis');

const db = new Firestore();

const SPREADSHEET_ID = '1CfFj3dXz3Vc9FBhBe8OiGLWmQE6LH81MLa133TbdUco';

// Tab names — must match the worksheet titles in the spreadsheet
const SPORT_TABS = {
  soccer: 'Soccer',
  baseball: 'Baseball',
  basketball: 'Basketball',
  hockey: 'Hockey',
  lacrosse: 'Lacrosse',
};
const ALL_DIVISIONS_TAB = 'All Divisions';

// League-level headers
const LEAGUE_HEADERS = [
  'League Name', 'Platform', 'Status', 'State', 'Region',
  'Divisions', 'Age Groups', 'Genders', 'Last Collected', 'League ID',
];

// Division-level headers
const DIVISION_HEADERS = [
  'Sport', 'League', 'Division Name', 'Age Group', 'Gender',
  'Level', 'Status', 'Platform', 'State', 'Teams', 'Division ID',
];

functions.http('updateSheet', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const startTime = Date.now();
  const targetSport = req.body?.sport || null; // Optional: update just one sport

  try {
    // ── 1. Authenticate with Google Sheets API ──
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // ── 2. Load all leagues from Firestore ──
    const leaguesSnap = await db.collection('leagues').get();
    const leagues = [];
    leaguesSnap.forEach(doc => {
      leagues.push({ id: doc.id, ...doc.data() });
    });
    console.log(`updateSheet: Loaded ${leagues.length} leagues from Firestore`);

    // ── 3. Load ALL divisions from top-level collection ──
    const allDivisionRows = [];
    const leagueDivCounts = {};

    const divsSnap = await db.collection('divisions').get();
    const allDivs = [];
    divsSnap.forEach(doc => allDivs.push({ id: doc.id, ...doc.data() }));
    console.log(`updateSheet: Loaded ${allDivs.length} divisions from Firestore`);

    // Index by leagueId
    const divsByLeague = {};
    for (const div of allDivs) {
      const lid = div.leagueId || '';
      if (!divsByLeague[lid]) divsByLeague[lid] = [];
      divsByLeague[lid].push(div);
    }

    // Build league div counts and division rows
    for (const league of leagues) {
      const divs = divsByLeague[league.id] || [];
      leagueDivCounts[league.id] = divs.length;

      for (const div of divs) {
        // Count teams — query standings for this division
        let teamCount = 0;
        try {
          const standingsSnap = await db.collection('standings')
            .where('divisionId', '==', div.id)
            .get();
          teamCount = standingsSnap.size;
        } catch (e) {
          // Standings query may fail if no index — just skip count
        }

        allDivisionRows.push([
          league.sport || '',
          league.name || '',
          div.name || '',
          div.ageGroup || '',
          div.gender || '',
          div.level || '',
          div.status || '',
          league.platform || league.sourcePlatform || '',
          league.state || '',
          teamCount.toString(),
          div.id || '',
        ]);
      }
    }

    // ── 4. Group leagues by sport ──
    const bySport = {};
    for (const league of leagues) {
      const sport = league.sport || 'unknown';
      if (!bySport[sport]) bySport[sport] = [];
      
      const divCount = leagueDivCounts[league.id] || 0;
      
      // Collect age groups and genders from divisions
      const sportDivs = allDivisionRows.filter(r => r[1] === league.name);
      const ageGroups = [...new Set(sportDivs.map(r => r[3]).filter(Boolean))].sort().join(', ');
      const genders = [...new Set(sportDivs.map(r => r[4]).filter(Boolean))].sort().join(', ');

      bySport[sport].push([
        league.name || '',
        league.platform || league.sourcePlatform || '',
        league.status || '',
        league.state || '',
        league.region || '',
        divCount.toString(),
        ageGroups,
        genders,
        league.lastCollected || league.lastMonitorCheck || '',
        league.id || '',
      ]);
    }

    // ── 5. Write to Google Sheets ──
    const sportsToUpdate = targetSport 
      ? { [targetSport]: bySport[targetSport] || [] }
      : bySport;

    let tabsUpdated = 0;

    for (const [sport, rows] of Object.entries(sportsToUpdate)) {
      const tabName = SPORT_TABS[sport];
      if (!tabName) {
        console.log(`updateSheet: Skipping unknown sport "${sport}"`);
        continue;
      }

      // Sort rows: active first, then by name
      rows.sort((a, b) => {
        const statusOrder = { active: 0, pending_groups: 1, pending_config: 2, pending_tabid: 3, pending_adapter: 4, pending_platform: 5, inactive: 6 };
        const sa = statusOrder[a[2]] ?? 99;
        const sb = statusOrder[b[2]] ?? 99;
        if (sa !== sb) return sa - sb;
        return a[0].localeCompare(b[0]);
      });

      const allRows = [LEAGUE_HEADERS, ...rows];
      
      // Clear existing data and write new
      await clearAndWrite(sheets, tabName, allRows);
      tabsUpdated++;
      console.log(`updateSheet: Updated "${tabName}" with ${rows.length} leagues`);
    }

    // ── 6. Update All Divisions tab ──
    if (!targetSport) {
      allDivisionRows.sort((a, b) => {
        // Sort by sport, then league, then age group
        if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
        if (a[1] !== b[1]) return a[1].localeCompare(b[1]);
        return (a[3] || '').localeCompare(b[3] || '');
      });

      const allDivRows = [DIVISION_HEADERS, ...allDivisionRows];
      await clearAndWrite(sheets, ALL_DIVISIONS_TAB, allDivRows);
      tabsUpdated++;
      console.log(`updateSheet: Updated "All Divisions" with ${allDivisionRows.length} divisions`);
    }

    const durationMs = Date.now() - startTime;
    const result = {
      success: true,
      tabsUpdated,
      totalLeagues: leagues.length,
      totalDivisions: allDivisionRows.length,
      durationMs,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
    };

    console.log(`updateSheet: Complete in ${durationMs}ms — ${tabsUpdated} tabs, ${leagues.length} leagues, ${allDivisionRows.length} divisions`);
    res.json(result);

  } catch (err) {
    console.error(`updateSheet: Error: ${err.message}`);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

/**
 * Clear a sheet tab and write new data
 */
async function clearAndWrite(sheets, tabName, rows) {
  const range = `'${tabName}'!A1`;

  // Clear existing content
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A:Z`,
    });
  } catch (e) {
    // Tab might not exist yet — that's fine, append will create it
    console.warn(`updateSheet: Could not clear "${tabName}": ${e.message}`);
  }

  // Write new data
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: {
      values: rows,
    },
  });
}

/**
 * TGS / ECNL Adapter (v4 — Script API + auto-season detection)
 * 
 * Collects standings from ECNL programs via the public TGS Script API.
 * The ECNL website (theecnl.com, Sidearm Sports) loads standings from
 * api.athleteone.com using a JavaScript widget. The API returns HTML
 * and requires only an Origin header — no auth tokens needed.
 * 
 * AUTO-SEASON DETECTION:
 *   Each ECNL program has a standings page on theecnl.com with a
 *   data-org-season-id attribute. When a new season starts, ECNL updates
 *   this attribute. The adapter reads the live page to get the current
 *   season ID, so no config changes are needed for season transitions.
 * 
 * Supports 6 ECNL programs:
 *   - ECNL Boys          page: ECNLB_0808235537.aspx
 *   - ECNL Girls         page: ECNLG_0808235238.aspx
 *   - ECNL RL Boys       page: ECNLRLB_0808235620.aspx
 *   - ECNL RL Girls      page: ECNLRLG_0808235356.aspx
 *   - Pre-ECNL Boys      page: Pre-ECNLB_0808230956.aspx
 *   - Pre-ECNL Girls     page: Pre-ECNLG_0808230711.aspx
 * 
 * API endpoint:
 *   GET https://api.athleteone.com/api/Script/get-conference-standings/{eventId}/{orgId}/{orgSeasonId}/{divisionId}/{standingType}
 * 
 * Flow:
 *   1. Fetch the live ECNL standings page to get current orgId + orgSeasonId
 *   2. Call API with eventId=0 to get list of all conferences for the program
 *   3. For each conference, call API with divisionId=0 to get age groups
 *   4. For each age group, call API with the divisionId to get standings table
 *   5. Parse HTML table into structured data
 * 
 * v4 changes:
 *   - Auto-season detection: reads orgSeasonId from live theecnl.com pages
 *   - Correct per-program orgIds from live pages (16 for RL Boys, 13 for RL Girls, etc.)
 *   - Falls back to config values if live page fetch fails
 */

const axios = require('axios');

const PLATFORM_ID = 'tgs';

const API_BASE = 'https://api.athleteone.com/api/Script/get-conference-standings';

const HEADERS = {
  'Origin': 'https://theecnl.com',
  'Referer': 'https://theecnl.com/',
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 TeamsUnited-Standings/1.0',
  'Accept': 'text/html, */*',
};

/**
 * Map of league IDs to their standings page URLs on theecnl.com.
 * Used for auto-season detection.
 */
const ECNL_PAGES = {
  'ecnl-boys':     'https://theecnl.com/sports/2023/8/8/ECNLB_0808235537.aspx',
  'ecnl-girls':    'https://theecnl.com/sports/2023/8/8/ECNLG_0808235238.aspx',
  'ecnl-rl-boys':  'https://theecnl.com/sports/2023/8/8/ECNLRLB_0808235620.aspx',
  'ecnl-rl-girls': 'https://theecnl.com/sports/2023/8/8/ECNLRLG_0808235356.aspx',
  'pre-ecnl-boys': 'https://theecnl.com/sports/2023/8/8/Pre-ECNLB_0808230956.aspx',
  'pre-ecnl-girls':'https://theecnl.com/sports/2023/8/8/Pre-ECNLG_0808230711.aspx',
};

/**
 * Fetch the current orgId and orgSeasonId from the live ECNL standings page.
 * Returns { orgId, orgSeasonId } or null if the page can't be fetched.
 */
async function detectCurrentSeason(leagueId) {
  const pageUrl = ECNL_PAGES[leagueId];
  if (!pageUrl) return null;

  try {
    console.log(`TGS: Auto-detecting season from ${pageUrl}`);
    const resp = await axios.get(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 TeamsUnited-Standings/1.0' },
      timeout: 15000,
      maxRedirects: 3,
    });
    const html = resp.data;

    const orgIdMatch = html.match(/data-org-id="(\d+)"/);
    const seasonIdMatch = html.match(/data-org-season-id="(\d+)"/);

    if (orgIdMatch && seasonIdMatch) {
      const detected = {
        orgId: parseInt(orgIdMatch[1]),
        orgSeasonId: parseInt(seasonIdMatch[1]),
      };
      console.log(`TGS: Detected orgId=${detected.orgId}, orgSeasonId=${detected.orgSeasonId} from live page`);
      return detected;
    }

    console.warn('TGS: Could not find org-id/org-season-id attributes on live page');
    return null;
  } catch (err) {
    console.warn(`TGS: Auto-season detection failed (${err.message}), using config values`);
    return null;
  }
}

/**
 * Collect standings for an ECNL program.
 * 
 * leagueConfig.sourceConfig must include:
 *   - orgId: number (fallback org ID)
 *   - orgSeasonId: number (fallback season ID)
 *   - conferenceFilter: string[] (optional — only collect these conferences by name substring)
 * 
 * The adapter will first try to auto-detect the current season from the live
 * ECNL website. If that fails, it falls back to the config values.
 */
async function collectStandings(leagueConfig) {
  // Auto-detect current season from live ECNL page
  const detected = await detectCurrentSeason(leagueConfig.id);
  const orgId = detected ? detected.orgId : leagueConfig.sourceConfig.orgId;
  const orgSeasonId = detected ? detected.orgSeasonId : leagueConfig.sourceConfig.orgSeasonId;
  const { conferenceFilter } = leagueConfig.sourceConfig;

  if (detected) {
    // Log if season changed from config
    const cfgSeason = leagueConfig.sourceConfig.orgSeasonId;
    if (cfgSeason && cfgSeason !== orgSeasonId) {
      console.log(`TGS: ⚠️ Season changed! Config had ${cfgSeason}, live page shows ${orgSeasonId}`);
    }
  }

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  // Step 1: Get all conferences for this program
  console.log(`TGS: Fetching conferences for orgId=${orgId}, seasonId=${orgSeasonId}`);
  const conferences = await fetchConferences(orgId, orgSeasonId);
  console.log(`TGS: Found ${conferences.length} conferences`);

  // Apply optional conference filter
  let targetConfs = conferences;
  if (conferenceFilter && conferenceFilter.length > 0) {
    targetConfs = conferences.filter(c =>
      conferenceFilter.some(f => c.name.toLowerCase().includes(f.toLowerCase()))
    );
    console.log(`TGS: Filtered to ${targetConfs.length} conferences (filter: ${conferenceFilter.join(', ')})`);
  }

  // Step 2: For each conference, get age groups and standings
  for (const conf of targetConfs) {
    try {
      // Get age groups for this conference
      const ageGroups = await fetchAgeGroups(conf.eventId, orgId, orgSeasonId);
      console.log(`TGS: Conference "${conf.name}" — ${ageGroups.length} age groups`);

      for (const ag of ageGroups) {
        try {
          // Get standings for this conference + age group (standingType=0 for conference)
          const teamData = await fetchStandings(conf.eventId, orgId, orgSeasonId, ag.divisionId, 0);

          if (teamData.length === 0) continue;

          const { gender, ageGroup } = parseAgeGroupCode(ag.name);
          const divisionId = `${leagueConfig.id}-${slugify(conf.name)}-${slugify(ag.name)}`;

          divisions.push({
            id: divisionId,
            leagueId: leagueConfig.id,
            seasonId: leagueConfig.seasonId || '2025-2026',
            name: `${conf.name} — ${ag.name}`,
            ageGroup,
            gender,
            level: detectLevel(conf.name),
            platformDivisionId: `${conf.eventId}-${ag.divisionId}`,
            conference: conf.name,
            conferenceEventId: conf.eventId,
            status: 'active',
          });

          teamData.forEach((team, idx) => {
            standings.push({
              teamName: team.name,
              position: team.pos || idx + 1,
              gamesPlayed: team.gp || 0,
              wins: team.w || 0,
              losses: team.l || 0,
              ties: team.d || 0,
              points: team.pts || 0,
              scored: team.gf || 0,
              allowed: team.ga || 0,
              differential: team.gd || ((team.gf || 0) - (team.ga || 0)),
              ppg: team.ppg || 0,
              qualification: team.qualification || null,
              shutouts: 0,
              yellowCards: 0,
              redCards: 0,
              clubKey: team.clubId || null,
              teamKey: team.teamId || null,
              leagueId: leagueConfig.id,
              divisionId,
              seasonId: leagueConfig.seasonId || '2025-2026',
              collectedAt: now,
            });
          });

          console.log(`TGS: ${conf.name} / ${ag.name} — ${teamData.length} teams`);
          
          // Small delay between requests to be respectful
          await sleep(200);
        } catch (agErr) {
          console.error(`TGS: Error collecting ${conf.name} / ${ag.name}: ${agErr.message}`);
        }
      }
    } catch (confErr) {
      console.error(`TGS: Error processing conference "${conf.name}": ${confErr.message}`);
    }
  }

  console.log(`TGS: Total collected — ${divisions.length} divisions, ${standings.length} standings`);
  return { divisions, standings };
}

/**
 * Fetch the list of conferences for a program.
 * Calls the API with eventId=0 to get the initial dropdown.
 */
async function fetchConferences(orgId, orgSeasonId) {
  const url = `${API_BASE}/0/${orgId}/${orgSeasonId}/0/0`;
  const resp = await axios.get(url, { headers: HEADERS, timeout: 30000 });
  const html = resp.data;

  // Parse the event-select dropdown
  const selectMatch = html.match(/id="event-select"[\s\S]*?<\/select>/);
  if (!selectMatch) return [];

  const options = [];
  const optionRegex = /<option value="(\d+)"[^>]*>(.*?)<\/option>/g;
  let match;
  while ((match = optionRegex.exec(selectMatch[0])) !== null) {
    const eventId = match[1];
    const name = match[2].trim();
    // Skip placeholder, age group entries (B2013, G2010), and CHAMPIONS LEAGUE
    if (eventId === '0' || name === '--- Select ---') continue;
    if (/^[BG]\d{4}/.test(name)) continue;
    if (name === 'CHAMPIONS LEAGUE') continue;
    options.push({ eventId, name });
  }

  return options;
}

/**
 * Fetch age groups (divisions) for a specific conference.
 * Calls the API with the conference eventId but divisionId=0.
 */
async function fetchAgeGroups(eventId, orgId, orgSeasonId) {
  const url = `${API_BASE}/${eventId}/${orgId}/${orgSeasonId}/0/0`;
  const resp = await axios.get(url, { headers: HEADERS, timeout: 30000 });
  const html = resp.data;

  // Parse the division-select dropdown
  const selectMatch = html.match(/id="division-select"[\s\S]*?<\/select>/);
  if (!selectMatch) return [];

  const ageGroups = [];
  const optionRegex = /<option value="(\d+)"[^>]*>(.*?)<\/option>/g;
  let match;
  while ((match = optionRegex.exec(selectMatch[0])) !== null) {
    const divisionId = match[1];
    const name = match[2].trim();
    if (!divisionId || name === '--- Select ---') continue;
    ageGroups.push({ divisionId, name });
  }

  return ageGroups;
}

/**
 * Fetch standings for a specific conference + age group.
 * Parses the HTML table returned by the API.
 */
async function fetchStandings(eventId, orgId, orgSeasonId, divisionId, standingType) {
  const url = `${API_BASE}/${eventId}/${orgId}/${orgSeasonId}/${divisionId}/${standingType}`;
  const resp = await axios.get(url, { headers: HEADERS, timeout: 30000 });
  const html = resp.data;

  return parseStandingsTable(html);
}

/**
 * Parse standings from the HTML table returned by the TGS Script API.
 * 
 * The table has columns: POS, TEAMS, GP, WINS, LOSSES, DRAWS, GF, GA, GD, PPG, PTS
 * Team rows have class="individual-team-item" and contain:
 *   - Team name in a div with font-weight: bold
 *   - Qualification status (e.g., "Qualification: Champions League 4")
 *   - data-event-id, data-team-id, data-club-id attributes
 */
function parseStandingsTable(html) {
  const teams = [];

  // Find the standings table
  const tableMatch = html.match(/<table[^>]*>[\s\S]*?<\/table>/);
  if (!tableMatch) return teams;
  const tableHtml = tableMatch[0];

  // Extract all <tr> from the table
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const rowContent = rowMatch[1];

    // Skip header rows (contain <th>)
    if (rowContent.includes('<th')) continue;

    // Extract all <td> contents
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const tds = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowContent)) !== null) {
      tds.push(tdMatch[1]);
    }

    // Table columns: POS(0), TEAMS(1), GP(2), WINS(3), LOSSES(4), DRAWS(5),
    //                GF(6), GA(7), GD(8), PPG(9), PTS(10)
    if (tds.length < 9) continue;

    const pos = parseInt(stripHtml(tds[0])) || 0;

    // td[1] contains: <img> + <span class="individual-team-item" data-*>Team Name</span>
    //                 + <span>Qualification: ...</span>
    const nameMatch = tds[1].match(/class="individual-team-item"[^>]*>([^<]+)/);
    const name = nameMatch ? nameMatch[1].trim() : null;

    // Extract data attributes from the individual-team-item span
    const teamIdMatch = tds[1].match(/data-team-id="(\d+)"/);
    const clubIdMatch = tds[1].match(/data-club-id="(\d+)"/);

    // Extract qualification text (pattern: Qualification:</span><span>VALUE</span>)
    const qualMatch = tds[1].match(/Qualification:<\/span>\s*<span>([^<]*)/);
    const qualification = qualMatch ? qualMatch[1].trim() : null;

    if (!name) continue;

    teams.push({
      pos,
      name,
      qualification: (qualification && qualification !== 'n/a') ? qualification : null,
      gp: parseInt(stripHtml(tds[2])) || 0,
      w: parseInt(stripHtml(tds[3])) || 0,
      l: parseInt(stripHtml(tds[4])) || 0,
      d: parseInt(stripHtml(tds[5])) || 0,
      gf: parseInt(stripHtml(tds[6])) || 0,
      ga: parseInt(stripHtml(tds[7])) || 0,
      gd: parseInt(stripHtml(tds[8])) || 0,
      ppg: parseFloat(stripHtml(tds[9])) || 0,
      pts: parseInt(stripHtml(tds[10])) || 0,
      teamId: teamIdMatch ? teamIdMatch[1] : null,
      clubId: clubIdMatch ? clubIdMatch[1] : null,
    });
  }

  return teams;
}

/**
 * Parse age group code like "B2013" or "G2008/2007" into gender and age group.
 */
function parseAgeGroupCode(code) {
  let gender = 'unknown';
  let ageGroup = code;

  if (code.startsWith('B')) {
    gender = 'boys';
    ageGroup = code; // Keep as-is: "B2013", "B2008/2007"
  } else if (code.startsWith('G')) {
    gender = 'girls';
    ageGroup = code;
  }

  return { gender, ageGroup };
}

/**
 * Detect league level from conference name.
 */
function detectLevel(confName) {
  const lower = confName.toLowerCase();
  if (lower.includes('pre-ecnl')) return 'Pre-ECNL';
  if (lower.includes('ecnl rl') || lower.includes('regional league')) return 'ECNL Regional League';
  if (lower.includes('alliance')) return 'Alliance';
  if (lower.includes('quality')) return 'Quality';
  if (lower.includes('champions')) return 'Champions';
  return 'ECNL';
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, '').trim();
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

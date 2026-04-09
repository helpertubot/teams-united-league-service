/**
 * TeamLinkt Adapter
 *
 * JSON API adapter for TeamLinkt league management platform.
 * Used by: Youth lacrosse (GELL), hockey (PNAHA), and other sports.
 *
 * API pattern:
 *   Standings page: https://leagues.teamlinkt.com/{orgSlug}/Standings
 *   Standings API:  POST /leagues/getStandings/{associationId}/{seasonId}
 *     Body: group_ids[{divId}]={divId}&season_id={seasonId}
 *     Returns: { columns: [...], standings: [...] }
 *
 * Division discovery:
 *   The standings page embeds JS variables:
 *     - divisions_by_sort_order: [{value: divId, title: "GELL-K2"}, ...]
 *     - CHILD_GROUP_TEAMS: {divId: [teamId, ...], ...}
 *     - Season dropdown: <option value="seasonId">Year</option>
 *
 * sourceConfig schema:
 * {
 *   orgSlug: 'greatereastsidelacrosseleague',
 *   associationId: '16406',
 *   seasonId: '50873',          // Optional — auto-discovers from page
 *   baseUrl: 'https://leagues.teamlinkt.com'  // Optional
 * }
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'teamlinkt';

async function collectStandings(leagueConfig) {
  const { orgSlug, associationId, seasonId, baseUrl } = leagueConfig.sourceConfig;
  const base = baseUrl || 'https://leagues.teamlinkt.com';

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  // Step 1: Load standings page to discover divisions and seasonId
  const pageUrl = `${base}/${orgSlug}/Standings`;
  let html;
  try {
    const resp = await axios.get(pageUrl, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) TeamsUnited-Standings/1.0' },
    });
    html = resp.data;
  } catch (err) {
    console.error(`TeamLinkt: Failed to load standings page: ${err.message}`);
    return { divisions, standings };
  }

  // Extract associationId and seasonId from the page if not provided
  let assocId = associationId;
  let sid = seasonId;

  if (!assocId || !sid) {
    const urlMatch = html.match(/\/leagues\/getStandings\/(\d+)\/(\d+)/);
    if (urlMatch) {
      assocId = assocId || urlMatch[1];
      sid = sid || urlMatch[2];
    }
  }

  if (!sid) {
    const selectedSeason = html.match(/<option\s+value="(\d+)"\s+selected/);
    if (selectedSeason) sid = selectedSeason[1];
  }

  if (!assocId || !sid) {
    console.error('TeamLinkt: Could not determine associationId or seasonId');
    return { divisions, standings };
  }

  // Extract divisions from embedded JS
  const divsMatch = html.match(/var\s+divisions_by_sort_order\s*=\s*(\[.*?\]);/s);
  let divList = [];
  if (divsMatch) {
    try { divList = JSON.parse(divsMatch[1]); } catch (e) {}
  }

  if (divList.length === 0) {
    console.warn('TeamLinkt: No divisions found on standings page');
    return { divisions, standings };
  }

  console.log(`TeamLinkt: Found ${divList.length} divisions for ${orgSlug} (assoc=${assocId}, season=${sid})`);

  // Step 2: Fetch standings from API per division group
  // Each group_id must be queried separately to get all teams
  const apiUrl = `${base}/leagues/getStandings/${assocId}/${sid}`;
  let allStandingsData = [];
  let columns = [];

  for (const div of divList) {
    const groupId = div.value;
    try {
      const resp = await axios.post(apiUrl, `group_ids[${groupId}]=${groupId}&season_id=${sid}`, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) TeamsUnited-Standings/1.0',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      const groupStandings = (resp.data.standings || []).map(s => ({ ...s, _groupId: String(groupId) }));
      allStandingsData.push(...groupStandings);
      if (columns.length === 0 && resp.data.columns) {
        columns = (resp.data.columns || []).map(c => {
          const col = c.AssociationStandingColumn || c;
          return { type: col.column_type, name: col.column_name, abbr: col.abbreviation };
        });
      }
    } catch (err) {
      console.warn(`TeamLinkt: API call failed for group ${groupId}: ${err.message}`);
    }
  }

  const standingsData = allStandingsData;
  if (standingsData.length === 0) {
    console.log('TeamLinkt: 0 standings returned (season may not have started)');
    return { divisions, standings };
  }

  // Extract team-to-division mapping from CHILD_GROUP_TEAMS
  const teamToDiv = {};
  const cgtMatch = html.match(/const\s+CHILD_GROUP_TEAMS\s*=\s*({.*?});/s);
  if (cgtMatch) {
    try {
      const cgt = JSON.parse(cgtMatch[1]);
      for (const [groupId, teamIds] of Object.entries(cgt)) {
        for (const tid of teamIds) {
          teamToDiv[tid] = groupId;
        }
      }
    } catch (e) {}
  }

  // Create division entries
  const divMap = {};
  for (const d of divList) {
    const divisionId = `${leagueConfig.id}-${d.value}`;
    const divName = d.title || `Division ${d.value}`;
    const { ageGroup, gender } = inferAgeGroup(divName);

    divMap[String(d.value)] = divisionId;
    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId: leagueConfig.seasonId || sid,
      name: divName,
      ageGroup,
      gender,
      level: null,
      platformDivisionId: String(d.value),
      status: 'active',
    });
  }

  // Map standings to divisions
  for (const s of standingsData) {
    const team = s.Team || {};
    const teamName = team.name || team.original_team_name || 'Unknown';
    const teamId = s.team_id || team.id;
    const groupId = s._groupId || teamToDiv[teamId];
    const divisionId = groupId ? divMap[groupId] : (divisions[0]?.id || `${leagueConfig.id}-unknown`);

    standings.push({
      teamName,
      position: s.ranking || 0,
      gamesPlayed: s.games_played || 0,
      wins: s.total_wins || 0,
      losses: s.total_losses || 0,
      ties: s.total_ties || 0,
      points: s.total_points || 0,
      scored: s.score_for || 0,
      allowed: s.score_against || 0,
      differential: s.score_differential || ((s.score_for || 0) - (s.score_against || 0)),
      winPct: s.win_percent || null,
      gamesBack: s.games_back || null,
      streak: s.streak_type && s.streak_length ? `${s.streak_type}${s.streak_length}` : null,
      shutouts: 0,
      yellowCards: 0,
      redCards: 0,
      clubKey: null,
      teamKey: String(teamId || ''),
      leagueId: leagueConfig.id,
      divisionId,
      seasonId: leagueConfig.seasonId || sid,
      collectedAt: now,
    });
  }

  console.log(`TeamLinkt: Collected ${divisions.length} divisions, ${standings.length} standings`);
  return { divisions, standings };
}

module.exports = { PLATFORM_ID, collectStandings };

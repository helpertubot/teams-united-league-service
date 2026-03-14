/**
 * GameChanger Adapter (v4 — Multi-Division + Auto-Season Rotation)
 * 
 * Uses the GameChanger public REST API to collect standings.
 * 
 * v4 changes:
 *   - Collects from ALL orgs in allOrgIds (not just fallback)
 *   - Each org's standings become a separate division
 *   - Still supports auto-season rotation when primary org has no data
 * 
 * Public API endpoints (no auth required):
 *   GET https://api.team-manager.gc.com/public/organizations/{orgId}          — org info
 *   GET https://api.team-manager.gc.com/public/organizations/{orgId}/teams     — team list
 *   GET https://api.team-manager.gc.com/public/organizations/{orgId}/standings — standings
 */

const axios = require('axios');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'gamechanger';
const API_BASE = 'https://api.team-manager.gc.com/public';

/**
 * Collect standings for a GameChanger league.
 * Iterates the primary orgId AND all orgs in allOrgIds, creating a division for each.
 */
async function collectStandings(leagueConfig) {
  const { orgId, allOrgIds } = leagueConfig.sourceConfig;
  
  if (!orgId || orgId === 'REPLACE_WITH_ORG_ID') {
    console.warn(`GameChanger: No valid orgId for ${leagueConfig.id}`);
    return { divisions: [], standings: [] };
  }

  const allDivisions = [];
  const allStandings = [];
  const collectedOrgIds = new Set();

  // Build list of all orgs to collect from
  const orgsToCollect = [{ publicId: orgId, name: null, type: 'primary' }];
  
  if (allOrgIds && allOrgIds.length > 0) {
    for (const alt of allOrgIds) {
      const altId = alt.publicId || alt.public_id;
      if (altId && altId !== orgId && !collectedOrgIds.has(altId)) {
        orgsToCollect.push(alt);
      }
    }
  }

  console.log(`GameChanger: Collecting from ${orgsToCollect.length} org(s) for ${leagueConfig.id}`);

  let rotatedToOrgId = null;
  let rotatedToOrgName = null;

  for (const orgEntry of orgsToCollect) {
    const currentOrgId = orgEntry.publicId || orgEntry.public_id || orgId;
    if (collectedOrgIds.has(currentOrgId)) continue;
    collectedOrgIds.add(currentOrgId);

    try {
      const result = await collectFromOrg(currentOrgId, leagueConfig);
      if (result.divisions.length > 0) {
        allDivisions.push(...result.divisions);
        allStandings.push(...result.standings);
      }
      
      // Track if primary org was empty but an alternative had data (season rotation)
      if (currentOrgId !== orgId && result.standings.length > 0 && allStandings.length === result.standings.length) {
        rotatedToOrgId = currentOrgId;
        rotatedToOrgName = orgEntry.name || result.divisions[0]?.name || null;
      }
    } catch (err) {
      console.warn(`GameChanger: Error collecting from org ${currentOrgId}: ${err.message}`);
    }
  }

  console.log(`GameChanger: Total collected — ${allDivisions.length} divisions, ${allStandings.length} standings`);

  if (allDivisions.length === 0 && allStandings.length === 0) {
    // Check if ALL orgs were stale/404 — log a clear message for ops visibility
    const staleCount = orgsToCollect.length;
    console.warn(`GameChanger: League "${leagueConfig.id}" returned 0 data from ${staleCount} org(s). ` +
      `Org IDs may need re-discovery for the current season. ` +
      `Run discoverGC or check web.gc.com for updated org IDs.`);
  }

  const result = { divisions: allDivisions, standings: allStandings };
  if (rotatedToOrgId) {
    result._rotatedToOrgId = rotatedToOrgId;
    result._rotatedToOrgName = rotatedToOrgName;
  }
  return result;
}

/**
 * Check if a GC org's season is current (within reasonable range).
 * Returns { current, reason } indicating if the season is expected to have data.
 */
function isSeasonCurrent(org) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  const seasonYear = org.season_year;
  const seasonName = (org.season_name || '').toLowerCase();

  if (!seasonYear) return { current: false, reason: 'no season_year set' };

  // Season year more than 1 year old — definitely stale
  if (seasonYear < currentYear - 1) {
    return { current: false, reason: `season ${seasonName} ${seasonYear} is ${currentYear - seasonYear} years old` };
  }

  // Same year or last year — check season alignment
  if (seasonYear === currentYear) return { current: true, reason: 'current year' };

  // Previous year — might be a fall/winter season that spans years
  if (seasonYear === currentYear - 1) {
    if (seasonName === 'fall' && currentMonth <= 2) {
      return { current: true, reason: 'fall season may still be active' };
    }
    if (seasonName === 'winter' && currentMonth <= 4) {
      return { current: true, reason: 'winter season may still be active' };
    }
    return { current: false, reason: `season ${seasonName} ${seasonYear} has likely ended` };
  }

  return { current: false, reason: `season year ${seasonYear} is in the future` };
}

/**
 * Collect standings from a single GC org. Returns { divisions, standings }.
 */
async function collectFromOrg(orgId, leagueConfig) {
  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  try {
    // Step 1: Get organization info
    const orgResp = await axios.get(`${API_BASE}/organizations/${orgId}`, {
      timeout: 15000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TeamsUnited-Standings/1.0' },
    });

    const org = orgResp.data;
    const orgName = org.name || leagueConfig.name || 'Unknown';
    const seasonName = org.season_name || '';
    const seasonYear = org.season_year || '';

    console.log(`GameChanger: Org "${orgName}" — ${seasonName} ${seasonYear}`);

    // Check season currency
    const seasonCheck = isSeasonCurrent(org);
    if (!seasonCheck.current) {
      console.log(`GameChanger: Org ${orgId} season is stale (${seasonCheck.reason}) — skipping`);
      return { divisions: [], standings: [], _staleOrg: true, _staleReason: seasonCheck.reason };
    }

    // Step 2: Get teams list
    const teamsResp = await axios.get(`${API_BASE}/organizations/${orgId}/teams`, {
      timeout: 15000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TeamsUnited-Standings/1.0' },
    });

    const teamsById = {};
    for (const team of teamsResp.data) {
      teamsById[team.id] = team.name || 'Unknown Team';
    }

    // Step 3: Get standings
    const standingsResp = await axios.get(`${API_BASE}/organizations/${orgId}/standings`, {
      timeout: 15000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TeamsUnited-Standings/1.0' },
    });

    const standingsData = standingsResp.data;

    if (!Array.isArray(standingsData) || standingsData.length === 0) {
      console.log(`GameChanger: No standings data for ${orgId} (season: ${seasonName} ${seasonYear})`);
      return { divisions: [], standings: [] };
    }

    // Create division — use orgId in the division ID to ensure uniqueness across orgs
    const divisionId = `${leagueConfig.id}-${orgId}`;
    const divisionName = orgName;
    
    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId: leagueConfig.seasonId || `${seasonYear || new Date().getFullYear()}`,
      name: divisionName,
      ageGroup: leagueConfig.sourceConfig.ageGroup || inferAgeGroup(divisionName).ageGroup,
      gender: leagueConfig.sourceConfig.gender || inferAgeGroup(divisionName).gender,
      level: null,
      platformDivisionId: orgId,
      status: 'active',
    });

    // Sort by winning percentage descending
    standingsData.sort((a, b) => (b.winning_pct || 0) - (a.winning_pct || 0));

    for (let i = 0; i < standingsData.length; i++) {
      const entry = standingsData[i];
      const teamName = teamsById[entry.team_id] || `Team ${entry.team_id}`;
      const overall = entry.overall || {};
      const runs = entry.runs || {};
      const streak = entry.streak || {};
      const home = entry.home || {};
      const away = entry.away || {};

      standings.push({
        teamName,
        position: i + 1,
        gamesPlayed: (overall.wins || 0) + (overall.losses || 0) + (overall.ties || 0),
        wins: overall.wins || 0,
        losses: overall.losses || 0,
        ties: overall.ties || 0,
        points: 0,
        scored: runs.scored || 0,
        allowed: runs.allowed || 0,
        differential: runs.differential || ((runs.scored || 0) - (runs.allowed || 0)),
        winPct: entry.winning_pct || null,
        gamesBack: entry.games_back != null ? String(entry.games_back) : null,
        streak: streak.type && streak.count ? `${streak.type.toUpperCase()}${streak.count}` : null,
        homeRecord: `${home.wins || 0}-${home.losses || 0}${home.ties ? '-' + home.ties : ''}`,
        awayRecord: `${away.wins || 0}-${away.losses || 0}${away.ties ? '-' + away.ties : ''}`,
        shutouts: 0,
        yellowCards: 0,
        redCards: 0,
        clubKey: null,
        teamKey: entry.team_id || null,
        leagueId: leagueConfig.id,
        divisionId,
        seasonId: leagueConfig.seasonId || `${seasonYear || new Date().getFullYear()}`,
        collectedAt: now,
      });
    }

    console.log(`GameChanger: Org ${orgId} — ${standings.length} standings`);

  } catch (err) {
    if (err.response && err.response.status === 404) {
      console.log(`GameChanger: Organization ${orgId} not found (404) — org ID may have rotated to a new season`);
    } else {
      console.error(`GameChanger: API error for ${orgId}: ${err.message}`);
    }
  }

  return { divisions, standings };
}

module.exports = { PLATFORM_ID, collectStandings };

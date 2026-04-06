/**
 * SportsAffinity Adapter
 * 
 * Existing adapter — direct JSON API, no HTML parsing needed.
 * Used by: Regional Club League (WA), SSUL, many youth soccer league organizations
 * 
 * NOTE: SportsAffinity's API uses the parameter name "tournamentId" internally,
 * but for our purposes this always represents a LEAGUE SEASON, not a tournament.
 * Our config field is named "seasonGuid" to make this clear. We map it to
 * SportsAffinity's "tournamentId" API param at request time.
 * 
 * API: https://sctour.sportsaffinity.com/api/standings?organizationId={orgGuid}&tournamentId={seasonGuid}
 */

const axios = require('axios');

const PLATFORM_ID = 'sportsaffinity';

/**
 * Collect all standings for a SportsAffinity league season
 * @param {Object} leagueConfig - League configuration from Firestore
 * @param {string} leagueConfig.sourceConfig.organizationId - Organization GUID (stable across seasons)
 * @param {string} leagueConfig.sourceConfig.seasonGuid - Season GUID (changes each season; mapped to SA's "tournamentId" API param)
 * @param {string} leagueConfig.sourceConfig.baseUrl - Base URL (e.g., https://sctour.sportsaffinity.com)
 * @returns {Object} { divisions: [...], standings: [...] }
 */
async function collectStandings(leagueConfig) {
  const { organizationId, seasonGuid, tournamentId, baseUrl } = leagueConfig.sourceConfig;
  // Support both new "seasonGuid" and legacy "tournamentId" field names
  const saSeasonId = seasonGuid || tournamentId;
  const apiBase = baseUrl || 'https://sctour.sportsaffinity.com';

  // SportsAffinity API calls this param "tournamentId" but it represents our league season
  const url = `${apiBase}/api/standings?organizationId=${organizationId}&tournamentId=${saSeasonId}`;
  const response = await axios.get(url, { timeout: 30000 });
  const data = response.data;

  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  for (const flight of data) {
    const divisionId = `${leagueConfig.id}-${flight.flightKey}`;
    
    // Parse age group and gender from flightName
    const { ageGroup, gender } = parseFlightName(flight.flightName, flight.ageGroupName);

    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId: leagueConfig.seasonId || '2025-2026',
      name: flight.flightName,
      ageGroup,
      gender,
      level: flight.flightName.includes('Div 1') ? 'D1' : flight.flightName.includes('Div 2') ? 'D2' : null,
      platformDivisionId: flight.flightKey,
      status: 'active',
    });

    if (flight.bracketsDto) {
      for (const team of flight.bracketsDto) {
        standings.push({
          teamName: (team.teamName || '').trim(),
          position: team.rank || 0,
          gamesPlayed: team.gamesPlayed || 0,
          wins: team.wins || 0,
          losses: team.losses || 0,
          ties: team.ties || 0,
          points: team.totalPoints || team.adjustedTotalPoints || 0,
          scored: team.goalsFor || 0,
          allowed: team.goalsAgainst || 0,
          differential: (team.goalsFor || 0) - (team.goalsAgainst || 0),
          shutouts: team.shutOuts || 0,
          yellowCards: team.yellowCards || 0,
          redCards: team.redCards || 0,
          clubKey: team.clubKey || null,
          teamKey: team.teamKey || null,
          leagueId: leagueConfig.id,
          divisionId,
          seasonId: leagueConfig.seasonId || '2025-2026',
          collectedAt: now,
        });
      }
    }
  }

  return { divisions, standings };
}

function parseFlightName(flightName, ageGroupName) {
  let gender = 'unknown';
  let ageGroup = ageGroupName || 'unknown';

  // Check both flightName and ageGroupName for gender
  const lower = (flightName || '').toLowerCase();
  const agLower = (ageGroupName || '').toLowerCase();
  if (lower.includes('boys') || lower.includes('boy') || agLower.includes('boys') || agLower.includes('boy')) {
    gender = 'boys';
  } else if (lower.includes('girls') || lower.includes('girl') || agLower.includes('girls') || agLower.includes('girl')) {
    gender = 'girls';
  } else {
    // Check for B/G suffix pattern (e.g., "13UB", "14UG")
    const suffixMatch = (flightName || '').match(/\d+U([BG])\b/i);
    if (suffixMatch) {
      gender = suffixMatch[1].toUpperCase() === 'B' ? 'boys' : 'girls';
    }
  }

  const ageMatch = flightName.match(/U-?(\d{1,2})/i);
  if (ageMatch) ageGroup = `U${ageMatch[1]}`;

  return { ageGroup, gender };
}

module.exports = { PLATFORM_ID, collectStandings };

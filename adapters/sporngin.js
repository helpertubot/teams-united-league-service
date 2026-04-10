/**
 * SporNgin Adapter Alias
 *
 * SporNgin-branded league sites run on the same SportsEngine stack and APIs.
 * This adapter aliases to SportsEngine so leagues configured with
 * sourcePlatform='sporngin' can be collected without migration churn.
 */

const sportsengine = require('./sportsengine');

const PLATFORM_ID = 'sporngin';

async function collectStandings(leagueConfig) {
  return sportsengine.collectStandings(leagueConfig);
}

module.exports = {
  PLATFORM_ID,
  collectStandings,
  discoverProgramIds: sportsengine.discoverProgramIds,
};

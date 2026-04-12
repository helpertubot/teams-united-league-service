/**
 * SportNgin Adapter Alias
 *
 * SportNgin-branded league sites run on the same SportsEngine stack and APIs.
 * This adapter aliases to SportsEngine so leagues configured with
 * sourcePlatform='sportngin' collect without requiring data migrations.
 */

const sportsengine = require('./sportsengine');

const PLATFORM_ID = 'sportngin';

async function collectStandings(leagueConfig) {
  return sportsengine.collectStandings(leagueConfig);
}

module.exports = {
  PLATFORM_ID,
  collectStandings,
  discoverProgramIds: sportsengine.discoverProgramIds,
};

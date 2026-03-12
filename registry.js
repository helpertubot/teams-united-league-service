/**
 * Adapter Registry
 * 
 * Central registry for all league standings platform adapters.
 * Each adapter implements: { PLATFORM_ID, collectStandings(leagueConfig) }
 * 
 * The collectStandings function returns:
 * {
 *   divisions: [{ id, leagueId, seasonId, name, ageGroup, gender, level, platformDivisionId, status }],
 *   standings: [{ teamName, position, gamesPlayed, wins, losses, ties, points, scored, allowed, differential, ... }]
 * }
 * 
 * Supported platforms:
 * - sportsaffinity: Direct JSON API (soccer)
 * - gotsport: HTML parser (soccer tournaments/leagues)
 * - pointstreak: HTML parser (baseball, hockey)
 * - demosphere: HTML parser (youth soccer rec leagues)
 * - tgs: Browser automation / API (ECNL, Girls Academy, premium soccer)
 * - gamechanger: Browser automation (youth baseball/softball — #1 scoring app)
 * - leagueapps: HTML parser (baseball, soccer, basketball, lacrosse — thousands of orgs)
 * - sportsconnect: Browser automation (Little League, PONY — SportsConnect/Blue Sombrero ASP.NET sites)
 * - sportsaffinity-asp: Browser automation (OYSA — legacy SportsAffinity ASP system)
 */

const sportsaffinity = require('./adapters/sportsaffinity');
const sportsaffinityAsp = require('./adapters/sportsaffinity-asp');
const gotsport = require('./adapters/gotsport');
const pointstreak = require('./adapters/pointstreak');
const demosphere = require('./adapters/demosphere');
const tgs = require('./adapters/tgs');
const gamechanger = require('./adapters/gamechanger');
const leagueapps = require('./adapters/leagueapps');
const sportsconnect = require('./adapters/sportsconnect');

const adapters = {
  [sportsaffinity.PLATFORM_ID]: sportsaffinity,
  [gotsport.PLATFORM_ID]: gotsport,
  [pointstreak.PLATFORM_ID]: pointstreak,
  [demosphere.PLATFORM_ID]: demosphere,
  [tgs.PLATFORM_ID]: tgs,
  [gamechanger.PLATFORM_ID]: gamechanger,
  [leagueapps.PLATFORM_ID]: leagueapps,
  [sportsconnect.PLATFORM_ID]: sportsconnect,
  [sportsaffinityAsp.PLATFORM_ID]: sportsaffinityAsp,
};

/**
 * Get an adapter by platform ID
 * @param {string} platformId - One of: sportsaffinity, gotsport, pointstreak, demosphere, tgs
 * @returns {Object} Adapter module with collectStandings function
 * @throws {Error} If platform is not supported
 */
function getAdapter(platformId) {
  const adapter = adapters[platformId];
  if (!adapter) {
    const supported = Object.keys(adapters).join(', ');
    throw new Error(`Unsupported platform: "${platformId}". Supported: ${supported}`);
  }
  return adapter;
}

/**
 * List all supported platform IDs
 * @returns {string[]}
 */
function listPlatforms() {
  return Object.keys(adapters);
}

module.exports = { getAdapter, listPlatforms };

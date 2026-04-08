/**
 * SportsEngine Adapter
 *
 * JSON API adapter for SportsEngine (sportngin.com) platform.
 * Used by: Youth hockey, lacrosse, and other sports — one of the largest
 * youth sports platforms in North America.
 *
 * API base: https://se-api.sportsengine.com/v3/microsites/
 * Key endpoints (no auth required):
 *   - standings?program_id={seasonId}  — standings with W/L/T/GP/PTS
 *   - divisions?program_id={seasonId}  — division list
 *   - settings?program_id={seasonId}   — season config
 *
 * Season IDs are 24-char MongoDB ObjectIds, found in microsite URLs:
 *   https://season-microsites.ui.sportsengine.com/seasons/{seasonId}/standings
 *
 * sourceConfig schema:
 * {
 *   seasonId: '659dce0a4ca97d0095e3dfae',  // 24-char MongoDB ObjectId
 *   allSeasonIds: ['id1', 'id2', ...]       // Optional: collect from multiple seasons
 * }
 */

const axios = require('axios');
const { inferAgeGroup } = require('../lib/age-group-parser');

const PLATFORM_ID = 'sportsengine';
const API_BASE = 'https://se-api.sportsengine.com/v3/microsites';

/**
 * Collect standings for a SportsEngine league season
 */
async function collectStandings(leagueConfig) {
  const { seasonId, allSeasonIds } = leagueConfig.sourceConfig;
  const seasonIds = allSeasonIds && allSeasonIds.length > 0
    ? allSeasonIds
    : (seasonId ? [seasonId] : []);

  if (seasonIds.length === 0) {
    console.warn('SportsEngine: No seasonId configured');
    return { divisions: [], standings: [] };
  }

  const allDivisions = [];
  const allStandings = [];

  for (const sid of seasonIds) {
    const result = await collectFromSeason(sid, leagueConfig);
    allDivisions.push(...result.divisions);
    allStandings.push(...result.standings);
  }

  console.log(`SportsEngine: Total collected — ${allDivisions.length} divisions, ${allStandings.length} standings`);
  return { divisions: allDivisions, standings: allStandings };
}

/**
 * Collect standings from a single SE season
 */
async function collectFromSeason(seasonId, leagueConfig) {
  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  try {
    // Fetch division names first for proper labeling
    const divNameMap = {};
    try {
      const divResp = await axios.get(`${API_BASE}/divisions`, {
        params: { program_id: seasonId },
        timeout: 15000,
        headers: { Accept: 'application/json', 'User-Agent': 'TeamsUnited-Standings/1.0' },
      });
      for (const d of (divResp.data.result || [])) {
        divNameMap[d.id] = d.name;
      }
    } catch (e) { /* divisions endpoint optional */ }

    // Fetch standings (includes division groupings)
    const standingsResp = await axios.get(`${API_BASE}/standings`, {
      params: { program_id: seasonId },
      timeout: 30000,
      headers: { Accept: 'application/json', 'User-Agent': 'TeamsUnited-Standings/1.0' },
    });

    const groups = (standingsResp.data.result || []);
    if (groups.length === 0) {
      console.log(`SportsEngine: No standings for season ${seasonId}`);
      return { divisions, standings };
    }

    console.log(`SportsEngine: Season ${seasonId} — ${groups.length} standing groups`);

    // Process each standings group (each group is a division/flight)
    for (const group of groups) {
      const teamRecords = group.teamRecords || [];
      if (teamRecords.length === 0) continue;

      // Also check childNodes for nested divisions
      const childNodes = group.childNodes || [];

      // Use division name from divisions API if available, fall back to standings node name
      const flightId = group.flight_id || group.standings_node_id;
      const divName = divNameMap[flightId] || group.standings_node_name || `Division ${flightId?.substring(0, 8) || 'unknown'}`;
      const ancestorNames = group.ancestor_division_names;
      const fullName = ancestorNames ? `${ancestorNames} - ${divName}` : divName;

      const divisionId = `${leagueConfig.id}-${group.standings_node_id || group.id}`;
      const { ageGroup, gender } = inferAgeGroup(fullName);

      divisions.push({
        id: divisionId,
        leagueId: leagueConfig.id,
        seasonId: leagueConfig.seasonId || seasonId,
        name: fullName,
        ageGroup,
        gender,
        level: null,
        platformDivisionId: group.standings_node_id || group.id,
        status: 'active',
      });

      // Map team records to standings
      for (let i = 0; i < teamRecords.length; i++) {
        const rec = teamRecords[i];
        const vals = rec.values || {};
        const teamName = rec.team_name || rec.team_short_name || 'Unknown';

        standings.push({
          teamName,
          position: i + 1,
          gamesPlayed: vals.games || 0,
          wins: vals.w || 0,
          losses: vals.l || 0,
          ties: vals.t || 0,
          points: vals.st_pts || vals.pts || 0,
          scored: vals.pf || vals.gf || 0,
          allowed: vals.pa || vals.ga || 0,
          differential: vals.pd || vals.gd || ((vals.pf || 0) - (vals.pa || 0)),
          winPct: vals.gq || null,
          gamesBack: null,
          streak: null,
          shutouts: 0,
          yellowCards: vals.ycards || 0,
          redCards: vals.rcards || 0,
          clubKey: null,
          teamKey: rec.team_id || null,
          leagueId: leagueConfig.id,
          divisionId,
          seasonId: leagueConfig.seasonId || seasonId,
          collectedAt: now,
        });
      }

      // Process child nodes recursively if present
      for (const child of childNodes) {
        const childRecs = child.teamRecords || [];
        if (childRecs.length === 0) continue;

        const childName = child.standings_node_name || 'Unknown';
        const childFullName = `${fullName} - ${childName}`;
        const childDivId = `${leagueConfig.id}-${child.standings_node_id || child.id}`;
        const childInferred = inferAgeGroup(childFullName);

        divisions.push({
          id: childDivId,
          leagueId: leagueConfig.id,
          seasonId: leagueConfig.seasonId || seasonId,
          name: childFullName,
          ageGroup: childInferred.ageGroup,
          gender: childInferred.gender,
          level: null,
          platformDivisionId: child.standings_node_id || child.id,
          status: 'active',
        });

        for (let i = 0; i < childRecs.length; i++) {
          const rec = childRecs[i];
          const vals = rec.values || {};
          standings.push({
            teamName: rec.team_name || rec.team_short_name || 'Unknown',
            position: i + 1,
            gamesPlayed: vals.games || 0,
            wins: vals.w || 0,
            losses: vals.l || 0,
            ties: vals.t || 0,
            points: vals.st_pts || vals.pts || 0,
            scored: vals.pf || vals.gf || 0,
            allowed: vals.pa || vals.ga || 0,
            differential: vals.pd || vals.gd || ((vals.pf || 0) - (vals.pa || 0)),
            winPct: vals.gq || null,
            gamesBack: null, streak: null, shutouts: 0,
            yellowCards: vals.ycards || 0, redCards: vals.rcards || 0,
            clubKey: null, teamKey: rec.team_id || null,
            leagueId: leagueConfig.id,
            divisionId: childDivId,
            seasonId: leagueConfig.seasonId || seasonId,
            collectedAt: now,
          });
        }
      }
    }
  } catch (err) {
    console.error(`SportsEngine: API error for season ${seasonId}: ${err.message}`);
  }

  return { divisions, standings };
}

/**
 * Discover SportsEngine program IDs from an org's website.
 *
 * SportsEngine orgs embed season microsites as iframes pointing to
 * season-microsites.ui.sportsengine.com/seasons/{programId}/...
 *
 * This function scrapes a given URL (and optionally its internal links)
 * looking for those iframe embeds and extracts the 24-char program IDs.
 *
 * If no programIds are found via iframe scraping, falls back to checking
 * the sportngin game_schedule widget config embedded in page JavaScript.
 *
 * @param {string} orgUrl - The SportsEngine org website URL (e.g., https://www.example-hockey.org)
 * @param {Object} [options] - Options
 * @param {boolean} [options.followLinks=true] - Follow internal links one level deep
 * @param {number} [options.maxPages=10] - Max pages to check
 * @returns {Promise<{programIds: string[], sources: Object[]}>}
 */
async function discoverProgramIds(orgUrl, options = {}) {
  const { followLinks = true, maxPages = 10 } = options;
  const cheerio = require('cheerio');
  const found = new Map(); // programId -> source info
  const visited = new Set();
  const baseUrl = new URL(orgUrl);

  async function scrapePage(url) {
    if (visited.has(url) || visited.size >= maxPages) return;
    visited.add(url);

    try {
      const resp = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'TeamsUnited-Standings/1.0', Accept: 'text/html' },
        maxRedirects: 3,
      });
      const $ = cheerio.load(resp.data);

      // Method 1: Look for iframes pointing to season-microsites.ui.sportsengine.com
      $('iframe').each((_, el) => {
        const src = $(el).attr('src') || '';
        const match = src.match(/season-microsites\.ui\.sportsengine\.com\/seasons\/([a-f0-9]{24})/i);
        if (match) {
          found.set(match[1], { programId: match[1], method: 'iframe', pageUrl: url, iframeSrc: src });
        }
      });

      // Method 2: Look for links to season microsites
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/season-microsites\.ui\.sportsengine\.com\/seasons\/([a-f0-9]{24})/i);
        if (match) {
          found.set(match[1], { programId: match[1], method: 'link', pageUrl: url, linkHref: href });
        }
      });

      // Method 3: Check for programId in inline JavaScript / widget config
      const html = resp.data;
      const jsMatches = html.matchAll(/program_id['":\s]+['"]?([a-f0-9]{24})['"]?/gi);
      for (const m of jsMatches) {
        if (!found.has(m[1])) {
          found.set(m[1], { programId: m[1], method: 'js_config', pageUrl: url });
        }
      }

      // Method 4: Check AJAX tab containers (sportngin uses layout_container tabs)
      const tabLinks = [];
      $('a.tab-remote').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
          const tabUrl = href.startsWith('http') ? href : `${baseUrl.origin}${href}`;
          tabLinks.push(tabUrl);
        }
      });
      for (const tabUrl of tabLinks) {
        if (visited.size >= maxPages) break;
        await scrapePage(tabUrl);
      }

      // Collect internal links for follow-up (one level deep)
      if (followLinks && visited.size === 1) {
        const internalLinks = [];
        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          const text = $(el).text().toLowerCase();
          if ((text.includes('standings') || text.includes('schedule') || text.includes('scores') ||
               text.includes('league') || text.includes('season') || text.includes('game')) &&
              (href.startsWith('/') || href.startsWith(baseUrl.origin))) {
            const fullUrl = href.startsWith('http') ? href : `${baseUrl.origin}${href}`;
            if (!visited.has(fullUrl)) internalLinks.push(fullUrl);
          }
        });
        for (const link of internalLinks.slice(0, maxPages - 1)) {
          await scrapePage(link);
        }
      }
    } catch (err) {
      console.warn(`SportsEngine discover: Failed to scrape ${url}: ${err.message}`);
    }
  }

  await scrapePage(orgUrl);

  const sources = Array.from(found.values());
  console.log(`SportsEngine discover: Found ${sources.length} program IDs from ${visited.size} pages`);
  return { programIds: sources.map(s => s.programId), sources };
}

module.exports = { PLATFORM_ID, collectStandings, discoverProgramIds };

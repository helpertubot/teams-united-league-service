/**
 * ScoreBookLive / High School On SI adapter
 *
 * Parses server-rendered standings props from si.com/high-school/stats pages.
 * sourceConfig schema:
 * {
 *   standingsUrl: 'https://www.si.com/high-school/stats/<state>/<sport>/leagues/<id-slug>/standings'
 *   // OR baseUrl + leaguePath
 *   baseUrl: 'https://www.si.com/high-school/stats',
 *   leaguePath: '/arkansas/baseball/leagues/1797-4a-4',
 *   sport: 'baseball', state: 'ar'
 * }
 */
const axios = require('axios');
const cheerio = require('cheerio');

const PLATFORM_ID = 'scorebooklive-si';
const USER_AGENT = 'TeamsUnited-Standings/1.0';
const REQUEST_TIMEOUT_MS = 25000;

async function collectStandings(leagueConfig) {
  const cfg = leagueConfig.sourceConfig || {};
  const url = resolveStandingsUrl(cfg);
  if (!url) {
    throw new Error('scorebooklive-si adapter requires sourceConfig.standingsUrl or {baseUrl, leaguePath}');
  }
  const html = await fetchHtml(url);
  return parseStandingsHtml(html, leagueConfig, url);
}

function resolveStandingsUrl(cfg = {}) {
  if (cfg.standingsUrl) return String(cfg.standingsUrl);
  if (cfg.sourceUrl && String(cfg.sourceUrl).includes('/standings')) return String(cfg.sourceUrl);
  if (cfg.baseUrl && cfg.leaguePath) {
    const base = String(cfg.baseUrl).replace(/\/+$/, '');
    const path = String(cfg.leaguePath).replace(/^\/?/, '/').replace(/\/+$/, '');
    return `${base}${path}/standings`;
  }
  return null;
}

async function fetchHtml(url) {
  const resp = await axios.get(url, {
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml',
    },
    responseType: 'text',
    transformResponse: [(d) => d],
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return resp.data;
}

function parseStandingsHtml(html, leagueConfig, sourceUrl = null) {
  const $ = cheerio.load(html);
  let props = null;
  $('[data-react-class="organizations/Standings"]').each((_, el) => {
    if (props) return;
    const raw = $(el).attr('data-react-props');
    if (!raw) return;
    props = parseJsonAttr(raw);
  });
  if (!props) {
    throw new Error('scorebooklive-si standings props not found');
  }

  const organization = props?.query?.organization || props?.organization;
  const teamStandings = organization?.teamStandings || [];
  if (!organization || !Array.isArray(teamStandings)) {
    throw new Error('scorebooklive-si organization/teamStandings not found');
  }

  const orgSlug = organization.slug || extractSlugFromPath(organization.webStandingsPath || organization.webPath || sourceUrl) || 'standings';
  const sportName = organization.genderSport?.name || leagueConfig.sourceConfig?.sport || leagueConfig.sport || '';
  const divisionName = [organization.fullName || organization.name || orgSlug, sportName].filter(Boolean).join(' ').trim();
  const platformDivisionId = String(orgSlug);
  const divisionId = `${leagueConfig.id}-${slugify(platformDivisionId)}`;
  const seasonId = leagueConfig.seasonId || leagueConfig.sourceConfig?.seasonId || 'current';
  const now = new Date().toISOString();

  const divisions = [];
  const standings = [];
  if (teamStandings.length > 0) {
    divisions.push({
      id: divisionId,
      leagueId: leagueConfig.id,
      seasonId,
      name: divisionName,
      ageGroup: leagueConfig.ageGroup || 'HS',
      gender: leagueConfig.gender || null,
      level: leagueConfig.level || null,
      platformDivisionId,
      status: 'active',
    });
  }

  teamStandings.forEach((entry, idx) => {
    const team = entry.team || {};
    const standing = entry.standing || {};
    const leagueRecord = parseRecord(standing.leagueRecord);
    const overallRecord = parseRecord(standing.overallRecord);
    standings.push({
      leagueId: leagueConfig.id,
      divisionId,
      seasonId,
      teamName: team.name || `Team ${idx + 1}`,
      position: idx + 1,
      gamesPlayed: sumRecord(leagueRecord),
      wins: leagueRecord.wins,
      losses: leagueRecord.losses,
      ties: leagueRecord.ties,
      points: parseNumber(standing.points) || 0,
      scored: null,
      allowed: null,
      differential: null,
      overallWins: overallRecord.wins,
      overallLosses: overallRecord.losses,
      overallTies: overallRecord.ties,
      winPercentage: parseNumber(standing.overallWinPercentage),
      gamesBack: parseNumber(standing.leagueGamesBack),
      homeRecord: standing.homeRecord || null,
      awayRecord: standing.awayRecord || null,
      clubKey: null,
      teamKey: team.id ? String(team.id) : null,
      teamUrl: team.webPath || null,
      collectedAt: now,
    });
  });

  return {
    divisions,
    standings,
    _meta: {
      source: PLATFORM_ID,
      sourceUrl: sourceUrl || organization.webStandingsPath || null,
      organizationSlug: orgSlug,
      standingsRows: standings.length,
    },
  };
}

function parseJsonAttr(raw) {
  const decoded = String(raw)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return JSON.parse(decoded);
}

function extractSlugFromPath(path) {
  const m = String(path || '').match(/\/leagues\/([^/]+)/);
  return m ? m[1] : null;
}

function parseRecord(value) {
  const parts = String(value || '').trim().split('-').map(v => Number(v));
  return {
    wins: Number.isFinite(parts[0]) ? parts[0] : 0,
    losses: Number.isFinite(parts[1]) ? parts[1] : 0,
    ties: Number.isFinite(parts[2]) ? parts[2] : 0,
  };
}

function sumRecord(record) {
  return (record.wins || 0) + (record.losses || 0) + (record.ties || 0);
}

function parseNumber(value) {
  if (value == null || value === '' || value === '-') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'standings';
}

module.exports = {
  PLATFORM_ID,
  collectStandings,
  parseStandingsHtml,
  resolveStandingsUrl,
};

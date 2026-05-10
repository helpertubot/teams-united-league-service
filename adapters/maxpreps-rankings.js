/**
 * MaxPreps rankings adapter.
 *
 * This adapter treats public MaxPreps class/division ranking pages as TU standings feeds:
 * position = ranking position; W/L/T = team's overall record on the ranking page.
 * sourceConfig schema:
 *   { sourceUrl|rankingsUrl, matchedSlug, matchedKind, sport, state, statedivisionid }
 */
const axios = require('axios');
const cheerio = require('cheerio');

const PLATFORM_ID = 'maxpreps-rankings';
const USER_AGENT = 'TeamsUnited-Standings/1.0';
const REQUEST_TIMEOUT_MS = 25000;

async function collectStandings(leagueConfig) {
  const cfg = leagueConfig.sourceConfig || {};
  const url = resolveRankingsUrl(cfg);
  if (!url) throw new Error('maxpreps-rankings adapter requires sourceConfig.sourceUrl or rankingsUrl');
  const html = await fetchHtml(url);
  return parseRankingsHtml(html, leagueConfig, url);
}

function resolveRankingsUrl(cfg = {}) {
  return cfg.rankingsUrl || cfg.sourceUrl || cfg.proposedSourceUrl || null;
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

function parseRankingsHtml(html, leagueConfig, sourceUrl = null) {
  const $ = cheerio.load(html);
  const raw = $('#__NEXT_DATA__').html();
  if (!raw) throw new Error('maxpreps __NEXT_DATA__ not found');
  const data = JSON.parse(raw);
  const page = data?.props?.pageProps || {};
  const list = page.rankingsListData || page.initRankingsStoreData?.rankingsListData || {};
  const rankings = list.rankings || [];
  if (!Array.isArray(rankings) || rankings.length === 0) throw new Error('maxpreps rankings list empty');

  const cfg = leagueConfig.sourceConfig || {};
  const divisionSlug = slugify(cfg.matchedSlug || cfg.targetSlug || cfg.statedivisionid || extractSlugFromUrl(sourceUrl) || 'rankings');
  const divisionId = `${leagueConfig.id}-${divisionSlug}`;
  const seasonId = leagueConfig.seasonId || cfg.seasonId || list.year || 'current';
  const divisionName = leagueConfig.name || page.pageTitle || cfg.matchedSlug || 'MaxPreps Rankings';
  const now = new Date().toISOString();

  const divisions = [{
    id: divisionId,
    leagueId: leagueConfig.id,
    seasonId,
    name: divisionName,
    ageGroup: leagueConfig.ageGroup || 'HS',
    gender: leagueConfig.gender || null,
    level: leagueConfig.level || 'varsity',
    platformDivisionId: cfg.statedivisionid || cfg.matchedSlug || divisionSlug,
    status: 'active',
  }];

  const standings = rankings.map((row, idx) => {
    const record = parseRecord(row.overall);
    return {
      leagueId: leagueConfig.id,
      divisionId,
      seasonId,
      teamName: row.schoolName || row.schoolFormattedName || `Team ${idx + 1}`,
      position: toInt(row.rank) || idx + 1,
      gamesPlayed: sumRecord(record),
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      points: 0,
      scored: null,
      allowed: null,
      differential: null,
      overallWins: record.wins,
      overallLosses: record.losses,
      overallTies: record.ties,
      rating: toNumber(row.rating),
      strength: toNumber(row.strength),
      movement: row.movement == null ? null : String(row.movement),
      clubKey: null,
      teamKey: row.schoolId ? String(row.schoolId) : null,
      teamUrl: row.teamLink || null,
      collectedAt: now,
      sourceLastUpdated: row.lastUpdated || list.lastUpdated || null,
    };
  });

  return {
    divisions,
    standings,
    _meta: {
      source: PLATFORM_ID,
      sourceUrl,
      lastUpdated: list.lastUpdated || null,
      totalCount: list.totalCount || standings.length,
      standingsRows: standings.length,
    },
  };
}

function parseRecord(value) {
  const parts = String(value || '').trim().split('-').map(v => Number(v));
  return {
    wins: Number.isFinite(parts[0]) ? parts[0] : 0,
    losses: Number.isFinite(parts[1]) ? parts[1] : 0,
    ties: Number.isFinite(parts[2]) ? parts[2] : 0,
  };
}
function sumRecord(record) { return (record.wins || 0) + (record.losses || 0) + (record.ties || 0); }
function toInt(value) { const n = Number(value); return Number.isInteger(n) ? n : null; }
function toNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rankings';
}
function extractSlugFromUrl(url) {
  const m = String(url || '').match(/\/(class|division|section|region)\/([^/?#]+)/);
  return m ? m[2] : null;
}

module.exports = { PLATFORM_ID, collectStandings, parseRankingsHtml, resolveRankingsUrl };

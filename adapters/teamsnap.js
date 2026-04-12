/**
 * TeamSnap Adapter (v3 Collection+JSON API)
 *
 * sourceConfig schema:
 * {
 *   accessToken: string,               // TeamSnap OAuth bearer token (required)
 *   teamIds?: string[] | number[],     // Preferred: one or more team IDs
 *   teamId?: string | number,          // Single-team shortcut
 *   divisionIds?: string[] | number[], // Optional: seed by division IDs
 *   divisionId?: string | number,      // Single-division shortcut
 *   seasonId?: string,                 // Optional override
 *   ageGroup?: string,                 // Optional default metadata
 *   gender?: string                    // Optional default metadata
 * }
 */

const axios = require('axios');

const PLATFORM_ID = 'teamsnap';
const API_BASE = 'https://api.teamsnap.com/v3';
const DEFAULT_PAGE_SIZE = 250;

async function collectStandings(leagueConfig) {
  const cfg = leagueConfig.sourceConfig || {};
  const token = cfg.accessToken || cfg.token || cfg.apiToken || cfg.bearerToken;

  if (!token) {
    throw new Error('TeamSnap adapter requires sourceConfig.accessToken (or token/apiToken/bearerToken).');
  }

  const teamIds = normalizeIdList(cfg.teamIds, cfg.teamId);
  const divisionIds = normalizeIdList(cfg.divisionIds, cfg.divisionId);

  if (teamIds.length === 0 && divisionIds.length === 0) {
    throw new Error('TeamSnap adapter requires at least one teamId/teamIds or divisionId/divisionIds.');
  }

  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

  // Resolve teams from explicit team IDs and optional division seeds.
  const teamsById = new Map();
  for (const teamId of teamIds) {
    const items = await searchCollection('/teams/search', { team_id: teamId }, authHeader);
    for (const item of items) {
      const data = getItemData(item);
      const id = String(data.id || data.team_id || '');
      if (!id) continue;
      teamsById.set(id, {
        id,
        name: data.name || data.team_name || `Team ${id}`,
        divisionId: data.division_id != null ? String(data.division_id) : null,
      });
    }
  }

  for (const divisionId of divisionIds) {
    const items = await searchCollection('/teams/search', { division_id: divisionId }, authHeader);
    for (const item of items) {
      const data = getItemData(item);
      const id = String(data.id || data.team_id || '');
      if (!id) continue;
      teamsById.set(id, {
        id,
        name: data.name || data.team_name || `Team ${id}`,
        divisionId: data.division_id != null ? String(data.division_id) : String(divisionId),
      });
    }
  }

  if (teamsById.size === 0) {
    return { divisions: [], standings: [] };
  }

  // Fetch standings per team (TeamSnap query model is team-centric).
  const standingsByKey = new Map();
  for (const team of teamsById.values()) {
    const items = await searchCollection('/division_team_standings/search', { team_id: team.id }, authHeader);
    for (const item of items) {
      const data = getItemData(item);
      const links = getItemLinks(item);

      const standingId = data.id != null ? String(data.id) : null;
      const rowTeamId = String(data.team_id || links.team || team.id || '');
      if (!rowTeamId) continue;

      const rowDivisionId = String(
        data.division_id ||
        links.division ||
        teamsById.get(rowTeamId)?.divisionId ||
        team.divisionId ||
        ''
      );
      if (!rowDivisionId) continue;

      const dedupeKey = `${rowDivisionId}:${standingId || rowTeamId}`;
      standingsByKey.set(dedupeKey, {
        data,
        links,
        divisionId: rowDivisionId,
        teamId: rowTeamId,
      });
    }
  }

  if (standingsByKey.size === 0) {
    return { divisions: [], standings: [] };
  }

  // Optional schedule-game fetch for team game count fallback.
  const teamGameCounts = new Map();
  for (const team of teamsById.values()) {
    try {
      const games = await searchCollection('/events/search_games', { team_id: team.id }, authHeader);
      teamGameCounts.set(team.id, games.length);
    } catch (_) {
      // Best-effort: standings are still usable without schedule fallback.
    }
  }

  // Fetch division metadata for discovered division IDs.
  const divisionMeta = new Map();
  const discoveredDivisionIds = new Set([
    ...divisionIds.map(String),
    ...Array.from(standingsByKey.values()).map((v) => v.divisionId),
    ...Array.from(teamsById.values()).map((v) => v.divisionId).filter(Boolean),
  ]);

  for (const divisionId of discoveredDivisionIds) {
    const items = await searchCollection('/divisions/search', { id: divisionId }, authHeader);
    for (const item of items) {
      const data = getItemData(item);
      const id = String(data.id || divisionId);
      divisionMeta.set(id, {
        id,
        name: data.name || data.full_name || `Division ${id}`,
        seasonId: String(data.season_id || cfg.seasonId || new Date().getFullYear()),
      });
    }
  }

  const divisions = [];
  const seenDivisionIds = new Set();
  for (const standing of standingsByKey.values()) {
    const dId = standing.divisionId;
    if (seenDivisionIds.has(dId)) continue;
    seenDivisionIds.add(dId);

    const meta = divisionMeta.get(dId) || {
      id: dId,
      name: `Division ${dId}`,
      seasonId: String(cfg.seasonId || new Date().getFullYear()),
    };

    divisions.push({
      id: `${leagueConfig.id}-${dId}`,
      leagueId: leagueConfig.id,
      seasonId: meta.seasonId,
      name: meta.name,
      ageGroup: cfg.ageGroup || 'open',
      gender: cfg.gender || 'mixed',
      level: null,
      platformDivisionId: dId,
      status: 'active',
    });
  }

  const standings = [];
  const now = new Date().toISOString();

  for (const standing of standingsByKey.values()) {
    const data = standing.data;
    const teamId = standing.teamId;
    const teamName = teamsById.get(teamId)?.name || data.team_name || `Team ${teamId}`;

    const wins = toInt(pick(data, ['wins', 'win', 'w']));
    const losses = toInt(pick(data, ['losses', 'loss', 'l']));
    const ties = toInt(pick(data, ['ties', 'tie', 'draws', 'draw', 't']));
    const scored = toInt(pick(data, ['runs_scored', 'goals_for', 'points_for', 'scores_for', 'scored', 'for']));
    const allowed = toInt(pick(data, ['runs_allowed', 'goals_against', 'points_against', 'scores_against', 'allowed', 'against']));
    const differential = toInt(pick(data, ['run_differential', 'goal_differential', 'point_differential', 'differential']));
    const explicitGp = toInt(pick(data, ['games_played', 'games', 'gp']));
    const fallbackGp = wins + losses + ties;
    const scheduleGp = teamGameCounts.get(teamId) || 0;
    const gamesPlayed = explicitGp > 0 ? explicitGp : (fallbackGp > 0 ? fallbackGp : scheduleGp);

    standings.push({
      teamName,
      position: toInt(pick(data, ['rank', 'position', 'place'])) || null,
      gamesPlayed,
      wins,
      losses,
      ties,
      points: toInt(pick(data, ['points', 'pts'])),
      scored,
      allowed,
      differential: differential !== 0 ? differential : scored - allowed,
      winPct: toFloat(pick(data, ['win_percentage', 'winning_percentage', 'pct', 'percentage'])),
      gamesBack: pick(data, ['games_back', 'gb']) != null ? String(pick(data, ['games_back', 'gb'])) : null,
      streak: pick(data, ['streak']) != null ? String(pick(data, ['streak'])) : null,
      homeRecord: null,
      awayRecord: null,
      shutouts: 0,
      yellowCards: 0,
      redCards: 0,
      clubKey: null,
      teamKey: teamId,
      leagueId: leagueConfig.id,
      divisionId: `${leagueConfig.id}-${standing.divisionId}`,
      seasonId: String((divisionMeta.get(standing.divisionId) || {}).seasonId || cfg.seasonId || new Date().getFullYear()),
      collectedAt: now,
    });
  }

  standings.sort((a, b) => {
    if (a.divisionId !== b.divisionId) return a.divisionId.localeCompare(b.divisionId);
    const pa = a.position != null ? a.position : Number.MAX_SAFE_INTEGER;
    const pb = b.position != null ? b.position : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.teamName.localeCompare(b.teamName);
  });

  return { divisions, standings };
}

function normalizeIdList(list, single) {
  const out = [];
  if (Array.isArray(list)) out.push(...list);
  if (single != null) out.push(single);
  return Array.from(new Set(out.map((v) => String(v).trim()).filter(Boolean)));
}

function getItemData(item) {
  const out = {};
  for (const entry of item.data || []) {
    out[entry.name] = entry.value;
  }
  return out;
}

function getItemLinks(item) {
  const out = {};
  for (const link of item.links || []) {
    if (!link.rel || !link.href) continue;
    const idMatch = String(link.href).match(/\/(\d+)(?:\?.*)?$/);
    out[link.rel] = idMatch ? idMatch[1] : link.href;
  }
  return out;
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== '') return obj[key];
  }
  return null;
}

function toInt(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toFloat(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function searchCollection(path, params, authHeader) {
  const all = [];
  let page = 1;
  const pageSize = DEFAULT_PAGE_SIZE;

  while (true) {
    const resp = await axios.get(`${API_BASE}${path}`, {
      headers: {
        Accept: 'application/vnd.collection+json',
        Authorization: authHeader,
        'User-Agent': 'TeamsUnited-Standings/1.0',
      },
      params: {
        ...params,
        page_size: pageSize,
        page_number: page,
      },
      timeout: 20000,
    });

    const coll = resp.data && resp.data.collection ? resp.data.collection : {};
    if (coll.error && coll.error.message) {
      throw new Error(`TeamSnap API error for ${path}: ${coll.error.message}`);
    }

    const items = coll.items || [];
    all.push(...items);

    if (items.length < pageSize) break;
    page += 1;
  }

  return all;
}

module.exports = { PLATFORM_ID, collectStandings };

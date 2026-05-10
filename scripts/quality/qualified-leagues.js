'use strict';

const DEFAULT_MAX_FRESHNESS_DAYS = 30;

function normalizeArrayPayload(payload, keys) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function normalizeDivisionsPayload(payload) {
  return normalizeArrayPayload(payload, ['divisions', 'items']);
}

function normalizeStandingsPayload(payload) {
  return normalizeArrayPayload(payload, ['standings', 'teams', 'items']);
}

function normalizePlatform(league) {
  return league?.sourcePlatform || league?.platform || league?.adapter || '';
}

function ageDays(isoValue, now) {
  if (!isoValue) return Number.POSITIVE_INFINITY;
  const t = Date.parse(isoValue);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - t) / (24 * 60 * 60 * 1000);
}

function evaluateLeagueQuality({
  league,
  divisionsPayload,
  standingsByDivision = {},
  now = new Date(),
  maxFreshnessDays = DEFAULT_MAX_FRESHNESS_DAYS,
}) {
  const leagueId = league?.id || league?.leagueId || '';
  const leagueName = league?.name || league?.leagueName || leagueId;
  const status = String(league?.status || '').toLowerCase();
  const platform = normalizePlatform(league);
  const divisions = normalizeDivisionsPayload(divisionsPayload);

  const base = {
    leagueId,
    leagueName,
    sport: league?.sport || null,
    state: league?.state || league?.states || null,
    platform: platform || null,
    status: league?.status || null,
    qualified: false,
    reason: 'unknown',
    divisionCount: divisions.length,
    standingsTeamCount: 0,
    checkedAt: now.toISOString(),
    lastCollected: league?.lastCollected || null,
  };

  if (status !== 'active') return { ...base, reason: 'not_active' };
  if (!platform) return { ...base, reason: 'missing_source_platform' };
  if (divisions.length === 0) return { ...base, reason: 'no_divisions' };

  const days = ageDays(league?.lastCollected || league?.lastDataChange, now);
  if (days > maxFreshnessDays) {
    return { ...base, reason: 'stale_collection', freshnessAgeDays: Number.isFinite(days) ? Number(days.toFixed(1)) : null };
  }

  let standingsTeamCount = 0;
  let divisionsWithStandings = 0;
  for (const division of divisions) {
    const divisionId = division?.id || division?.divisionId;
    if (!divisionId) continue;
    const standings = normalizeStandingsPayload(standingsByDivision[divisionId]);
    standingsTeamCount += standings.length;
    if (standings.length > 0) divisionsWithStandings += 1;
  }

  if (standingsTeamCount === 0) {
    return { ...base, reason: 'no_standings', standingsTeamCount, divisionsWithStandings };
  }

  return {
    ...base,
    qualified: true,
    reason: 'qualified',
    standingsTeamCount,
    divisionsWithStandings,
    freshnessAgeDays: Number.isFinite(days) ? Number(days.toFixed(1)) : null,
  };
}

function buildQualifiedManifest(evaluations, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const qualified = evaluations.filter((row) => row.qualified);
  const failed = evaluations.filter((row) => !row.qualified);
  const failuresByReason = {};
  for (const row of failed) {
    failuresByReason[row.reason || 'unknown'] = (failuresByReason[row.reason || 'unknown'] || 0) + 1;
  }

  return {
    generatedAt,
    mode: options.mode || 'read_only',
    criteria: {
      status: 'active',
      sourcePlatform: 'present',
      divisions: '>0 from getDivisions',
      standings: '>0 teams from getStandings across discovered divisions',
      maxFreshnessDays: options.maxFreshnessDays || DEFAULT_MAX_FRESHNESS_DAYS,
      writes: false,
    },
    counts: {
      checked: evaluations.length,
      qualified: qualified.length,
      failed: failed.length,
    },
    qualifiedLeagueIds: qualified.map((row) => row.leagueId).sort(),
    leagues: qualified.map((row) => ({
      id: row.leagueId,
      name: row.leagueName,
      sport: row.sport,
      state: row.state,
      platform: row.platform,
      divisionCount: row.divisionCount,
      standingsTeamCount: row.standingsTeamCount,
      lastCollected: row.lastCollected,
      checkedAt: row.checkedAt,
    })),
    failuresByReason,
    failures: failed.map((row) => ({
      id: row.leagueId,
      name: row.leagueName,
      sport: row.sport,
      state: row.state,
      platform: row.platform,
      reason: row.reason,
      divisionCount: row.divisionCount,
      standingsTeamCount: row.standingsTeamCount,
      lastCollected: row.lastCollected,
    })),
  };
}

module.exports = {
  DEFAULT_MAX_FRESHNESS_DAYS,
  normalizeDivisionsPayload,
  normalizeStandingsPayload,
  evaluateLeagueQuality,
  buildQualifiedManifest,
};

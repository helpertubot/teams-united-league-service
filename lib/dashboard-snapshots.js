const fs = require('fs');
const path = require('path');

const CORE_SPORTS = ['soccer', 'baseball', 'softball', 'basketball', 'football', 'hockey', 'lacrosse', 'volleyball'];

function normalizeState(stateValue) {
  if (!stateValue) return 'UNKNOWN';
  return String(stateValue)
    .split(',')
    .map((part) => part.trim().toUpperCase() || 'UNKNOWN')
    .join(',');
}

function normalizeSport(sportValue) {
  return (sportValue ? String(sportValue).trim().toLowerCase() : 'unknown') || 'unknown';
}

function classifyPending(status) {
  if (!status) return false;
  return /^(pending_|unknown$)/i.test(String(status));
}

function configuredStates(repoRoot) {
  const statesRoot = path.join(repoRoot, 'config', 'states');
  if (!fs.existsSync(statesRoot)) return [];
  return fs.readdirSync(statesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[A-Z]{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function buildDashboardSnapshots(leagues, divCounts = {}, options = {}) {
  const now = new Date().toISOString();
  const repoRoot = options.repoRoot || path.join(__dirname, '..');
  const rolloutStates = configuredStates(repoRoot);

  const summaryLeagues = leagues
    .filter((league) => league.status !== 'template')
    .map((league) => ({
      id: league.id,
      name: league.name,
      sport: league.sport,
      state: league.state || league.states || '',
      platform: league.sourcePlatform,
      status: league.status,
      region: league.region || null,
      autoUpdate: league.autoUpdate || false,
      lastCollected: league.lastCollected || null,
      lastDataChange: league.lastDataChange || null,
      monitorStatus: league.monitorStatus || null,
      divisionCount: divCounts[league.id] || 0,
    }));

  const byStatus = {};
  const bySport = {};
  const byState = {};
  const coverageMatrix = {};

  for (const league of summaryLeagues) {
    const state = normalizeState(league.state);
    const sport = normalizeSport(league.sport);
    const status = league.status || 'unknown';

    byStatus[status] = (byStatus[status] || 0) + 1;
    bySport[sport] = (bySport[sport] || 0) + 1;
    byState[state] = (byState[state] || 0) + 1;

    if (/^[A-Z]{2}$/.test(state) && CORE_SPORTS.includes(sport)) {
      const key = `${state}_${sport}`;
      if (!coverageMatrix[key]) coverageMatrix[key] = { active: 0, pending: 0, total: 0 };
      coverageMatrix[key].total += 1;
      if (status === 'active') coverageMatrix[key].active += 1;
      if (classifyPending(status)) coverageMatrix[key].pending += 1;
    }
  }

  const gaps = [];
  let coveredCombos = 0;
  const totalCombos = rolloutStates.length * CORE_SPORTS.length;

  for (const state of rolloutStates) {
    for (const sport of CORE_SPORTS) {
      const key = `${state}_${sport}`;
      if (coverageMatrix[key]?.total > 0) {
        coveredCombos += 1;
      } else {
        gaps.push(`${state} ${sport}`);
      }
    }
  }

  return {
    summary: {
      generatedAt: now,
      count: summaryLeagues.length,
      leagues: summaryLeagues,
    },
    coverageStatus: {
      timestamp: now,
      agent: options.agent || 'system',
      total: summaryLeagues.length,
      by_status: byStatus,
      by_sport: bySport,
      by_state: byState,
      coverage_matrix: coverageMatrix,
      gaps,
      coverage_pct: totalCombos ? Number(((coveredCombos / totalCombos) * 100).toFixed(1)) : 0,
      covered_combos: coveredCombos,
      total_combos: totalCombos,
    },
  };
}

module.exports = {
  CORE_SPORTS,
  buildDashboardSnapshots,
};

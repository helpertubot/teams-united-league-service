const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDivisionsPayload,
  normalizeStandingsPayload,
  evaluateLeagueQuality,
  buildQualifiedManifest,
} = require('../qualified-leagues');

test('normalizes Cloud Function division and standings payload shapes', () => {
  assert.deepEqual(normalizeDivisionsPayload({ divisions: [{ id: 'd1' }] }), [{ id: 'd1' }]);
  assert.deepEqual(normalizeDivisionsPayload([{ id: 'd2' }]), [{ id: 'd2' }]);
  assert.deepEqual(normalizeStandingsPayload({ standings: [{ teamName: 'A' }] }), [{ teamName: 'A' }]);
  assert.deepEqual(normalizeStandingsPayload({ teams: [{ teamName: 'B' }] }), [{ teamName: 'B' }]);
});

test('qualifies only active platformed leagues with divisions and standings', () => {
  const league = {
    id: 'rcl-wa',
    name: 'RCL Washington',
    status: 'active',
    sourcePlatform: 'gotsport',
    lastCollected: '2026-05-01T12:00:00Z',
  };
  const result = evaluateLeagueQuality({
    league,
    divisionsPayload: { divisions: [{ id: 'rcl-wa-u13', name: 'U13' }] },
    standingsByDivision: {
      'rcl-wa-u13': { standings: [{ teamName: 'PacNW', wins: 5, losses: 1 }] },
    },
    now: new Date('2026-05-02T12:00:00Z'),
    maxFreshnessDays: 14,
  });

  assert.equal(result.qualified, true);
  assert.equal(result.reason, 'qualified');
  assert.equal(result.divisionCount, 1);
  assert.equal(result.standingsTeamCount, 1);
});

test('rejects phantom-active rows even when status says active', () => {
  const result = evaluateLeagueQuality({
    league: { id: 'phantom', name: 'Phantom', status: 'active' },
    divisionsPayload: { divisions: [{ id: 'd1' }] },
    standingsByDivision: { d1: { standings: [{ teamName: 'A' }] } },
    now: new Date('2026-05-02T12:00:00Z'),
  });

  assert.equal(result.qualified, false);
  assert.equal(result.reason, 'missing_source_platform');
});

test('rejects stale collection timestamps', () => {
  const result = evaluateLeagueQuality({
    league: {
      id: 'stale',
      status: 'active',
      sourcePlatform: 'sportsengine',
      lastCollected: '2025-01-01T00:00:00Z',
    },
    divisionsPayload: { divisions: [{ id: 'd1' }] },
    standingsByDivision: { d1: { standings: [{ teamName: 'A' }] } },
    now: new Date('2026-05-02T12:00:00Z'),
    maxFreshnessDays: 30,
  });

  assert.equal(result.qualified, false);
  assert.equal(result.reason, 'stale_collection');
});

test('builds a site manifest with qualified leagues and failure reasons', () => {
  const manifest = buildQualifiedManifest([
    { leagueId: 'ok', leagueName: 'OK League', sport: 'soccer', state: 'WA', qualified: true, reason: 'qualified', divisionCount: 2, standingsTeamCount: 20 },
    { leagueId: 'bad', leagueName: 'Bad League', sport: 'baseball', state: 'OR', qualified: false, reason: 'no_standings', divisionCount: 1, standingsTeamCount: 0 },
  ], { generatedAt: '2026-05-02T12:00:00.000Z', mode: 'read_only' });

  assert.deepEqual(manifest.qualifiedLeagueIds, ['ok']);
  assert.equal(manifest.counts.qualified, 1);
  assert.equal(manifest.counts.failed, 1);
  assert.equal(manifest.failuresByReason.no_standings, 1);
});

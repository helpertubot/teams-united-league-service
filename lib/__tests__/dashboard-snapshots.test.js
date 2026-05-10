const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardSnapshots } = require('../dashboard-snapshots');

test('dashboard snapshots can be gated to QA-qualified site leagues', () => {
  const snapshots = buildDashboardSnapshots([
    { id: 'ok', name: 'OK League', sport: 'soccer', state: 'WA', sourcePlatform: 'gotsport', status: 'active' },
    { id: 'phantom', name: 'Phantom League', sport: 'baseball', state: 'OR', status: 'active' },
    { id: 'template', name: 'Template', sport: 'soccer', state: 'WA', status: 'template' },
  ], { ok: 2, phantom: 5 }, {
    agent: 'test',
    requireQualified: true,
    qualifiedLeagueIds: new Set(['ok']),
  });

  assert.equal(snapshots.summary.count, 1);
  assert.deepEqual(snapshots.summary.leagues.map((l) => l.id), ['ok']);
  assert.equal(snapshots.summary.quality.mode, 'qualified_only');
  assert.equal(snapshots.summary.quality.excluded, 1);
  assert.equal(snapshots.coverageStatus.total, 1);
});

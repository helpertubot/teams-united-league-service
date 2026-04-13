const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'ingest-research.js');
const FIXTURES = path.resolve(__dirname, '..', '__fixtures__');

function runIngest(args, opts = {}) {
  const env = { ...process.env };
  if (opts.configRoot) env.TU_CONFIG_ROOT = opts.configRoot;
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || path.resolve(__dirname, '..', '..', '..'),
    env
  });
}

test('ingest-research exits 1 when no path given', () => {
  const r = runIngest([]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/);
});

test('ingest-research resolves state and kind from filename (dry-run)', () => {
  const r = runIngest([path.join(FIXTURES, 'CA-leagues-sample.md'), '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[CA\/soccer\]/);
  assert.match(r.stdout, /leagues:/);
});

test('ingest-research exits 1 when state cannot be inferred', () => {
  const tmp = path.join(os.tmpdir(), `ingest-test-${Date.now()}.md`);
  fs.writeFileSync(tmp, '# garbage\n');
  const r = runIngest([tmp, '--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /state/i);
  fs.unlinkSync(tmp);
});

test('ingest-research --state flag overrides filename', () => {
  const r = runIngest([
    path.join(FIXTURES, 'CA-leagues-sample.md'),
    '--state', 'WA',
    '--dry-run'
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[WA\/soccer\]/);
});

test('ingest-research leagues --dry-run reports per-sport row counts', () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tu-ingest-empty-'));
  try {
    const r = runIngest([path.join(FIXTURES, 'CA-leagues-sample.md'), '--dry-run'], { configRoot: emptyRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[CA\/soccer\] leagues: \+3 new/);
    assert.match(r.stdout, /\[CA\/volleyball\] leagues: \+2 new/);
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});

test('ingest-research tournaments --dry-run reports per-sport row counts', () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tu-ingest-empty-'));
  try {
    const r = runIngest([path.join(FIXTURES, 'CA-tournaments-sample.md'), '--dry-run'], { configRoot: emptyRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[CA\/soccer\] tournaments: \+3 new/);
    assert.match(r.stdout, /\[CA\/volleyball\] tournaments: \+2 new/);
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});

const { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs');

function withTempRepo(fn) {
  const tmpRepo = mkdtempSync(path.join(os.tmpdir(), 'tu-ingest-'));
  try {
    mkdirSync(path.join(tmpRepo, 'config', 'states'), { recursive: true });
    fn(tmpRepo);
  } finally {
    rmSync(tmpRepo, { recursive: true, force: true });
  }
}

test('ingest writes leagues.json on new config', () => {
  withTempRepo((repo) => {
    const r = runIngest(
      [path.join(FIXTURES, 'CA-leagues-sample.md')],
      { configRoot: repo }
    );
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(readFileSync(path.join(repo, 'config', 'states', 'CA', 'soccer', 'leagues.json'), 'utf8'));
    assert.equal(out.leagues.length, 3);
    assert.equal(out.leagues[0].id, 'norcal-youth-premier-league-gold');
  });
});

test('ingest preserves existing fields on merge (existing wins)', () => {
  withTempRepo((repo) => {
    const leaguesPath = path.join(repo, 'config', 'states', 'CA', 'soccer', 'leagues.json');
    mkdirSync(path.dirname(leaguesPath), { recursive: true });
    writeFileSync(
      leaguesPath,
      JSON.stringify({
        _description: 'CA soccer leagues',
        _lastUpdated: '2025-01-01',
        leagues: [
          {
            id: 'norcal-youth-premier-league-gold',
            name: 'NorCal Youth Premier League – Gold',
            notes: 'HAND-CURATED NOTE',
            customField: 'should survive'
          }
        ]
      }, null, 2)
    );
    const r = runIngest(
      [path.join(FIXTURES, 'CA-leagues-sample.md')],
      { configRoot: repo }
    );
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(readFileSync(leaguesPath, 'utf8'));
    const row = out.leagues.find((l) => l.id === 'norcal-youth-premier-league-gold');
    assert.equal(row.notes, 'HAND-CURATED NOTE');
    assert.equal(row.customField, 'should survive');
    assert.equal(row.level, 'competitive');
  });
});

test('ingest preserves tournament sticky fields on merge', () => {
  withTempRepo((repo) => {
    const tournPath = path.join(repo, 'config', 'states', 'CA', 'soccer', 'tournaments.json');
    mkdirSync(path.dirname(tournPath), { recursive: true });
    writeFileSync(
      tournPath,
      JSON.stringify({
        _description: 'CA soccer tournaments',
        _lastUpdated: '2025-01-01',
        tournaments: [
          {
            id: '2026-dublin-united-clover-cup-tournament',
            name: '2026 Dublin United Clover Cup Tournament',
            lifecycle: 'stale',
            lastChecked: '2026-04-10',
            lastHttpStatus: 404,
            consecutiveFailures: 2
          }
        ]
      }, null, 2)
    );
    const r = runIngest(
      [path.join(FIXTURES, 'CA-tournaments-sample.md')],
      { configRoot: repo }
    );
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(readFileSync(tournPath, 'utf8'));
    const row = out.tournaments.find((t) => t.id === '2026-dublin-united-clover-cup-tournament');
    assert.equal(row.lifecycle, 'stale');
    assert.equal(row.lastChecked, '2026-04-10');
    assert.equal(row.lastHttpStatus, 404);
    assert.equal(row.consecutiveFailures, 2);
    assert.equal(row.venue, 'Fallon Sports Park - Dublin');
  });
});

test('ingest-research exits 1 when no parseable tables', () => {
  const tmp = path.join(os.tmpdir(), `ingest-empty-${Date.now()}.md`);
  fs.writeFileSync(tmp, '# CA Leagues\n\nNo tables here.\n');
  const r = runIngest([tmp, '--state', 'CA', '--kind', 'leagues', '--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no parseable.*tables/i);
  fs.unlinkSync(tmp);
});

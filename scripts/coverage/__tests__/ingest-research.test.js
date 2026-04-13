const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'ingest-research.js');
const FIXTURES = path.resolve(__dirname, '..', '__fixtures__');

function runIngest(args, opts = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || path.resolve(__dirname, '..', '..', '..')
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
  const r = runIngest([path.join(FIXTURES, 'CA-leagues-sample.md'), '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[CA\/soccer\] leagues: \+3 new/);
  assert.match(r.stdout, /\[CA\/volleyball\] leagues: \+2 new/);
});

test('ingest-research tournaments --dry-run reports per-sport row counts', () => {
  const r = runIngest([path.join(FIXTURES, 'CA-tournaments-sample.md'), '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[CA\/soccer\] tournaments: \+3 new/);
  assert.match(r.stdout, /\[CA\/volleyball\] tournaments: \+2 new/);
});

test('ingest-research exits 1 when no parseable tables', () => {
  const tmp = path.join(os.tmpdir(), `ingest-empty-${Date.now()}.md`);
  fs.writeFileSync(tmp, '# CA Leagues\n\nNo tables here.\n');
  const r = runIngest([tmp, '--state', 'CA', '--kind', 'leagues', '--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no parseable.*tables/i);
  fs.unlinkSync(tmp);
});

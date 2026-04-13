const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib');

test('normalizeCell returns undefined for absent sentinels', () => {
  for (const v of ['', ' ', 'n/a', 'N/A', '-', '—', 'TBD', 'tbd']) {
    assert.equal(L.normalizeCell(v), undefined, `sentinel ${JSON.stringify(v)}`);
  }
});

test('normalizeCell trims and collapses internal whitespace', () => {
  assert.equal(L.normalizeCell('  hello   world  '), 'hello world');
});

test('normalizeCell passes real values through', () => {
  assert.equal(L.normalizeCell('Santa Monica Little League'), 'Santa Monica Little League');
});

test('normalizeCell returns undefined for non-string null/undefined', () => {
  assert.equal(L.normalizeCell(null), undefined);
  assert.equal(L.normalizeCell(undefined), undefined);
});

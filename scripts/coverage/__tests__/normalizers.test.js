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

test('normalizeGender maps aliases to Boys+Girls', () => {
  for (const v of ['Both', 'Mixed', 'Coed', 'Co-ed', 'Boys and Girls', 'BOTH', 'mixed']) {
    assert.equal(L.normalizeGender(v), 'Boys+Girls', `alias ${JSON.stringify(v)}`);
  }
});

test('normalizeGender passes canonical values through', () => {
  assert.equal(L.normalizeGender('Boys'), 'Boys');
  assert.equal(L.normalizeGender('Girls'), 'Girls');
  assert.equal(L.normalizeGender('Boys+Girls'), 'Boys+Girls');
});

test('normalizeGender returns undefined for empty/absent', () => {
  assert.equal(L.normalizeGender(''), undefined);
  assert.equal(L.normalizeGender(undefined), undefined);
});

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

test('stripUrlWrapper removes google.com/search?q= raw wrapper', () => {
  assert.equal(
    L.stripUrlWrapper('https://www.google.com/search?q=https%3A%2F%2Fexample.com'),
    'https://example.com'
  );
});

test('stripUrlWrapper removes markdown-link wrapper', () => {
  assert.equal(
    L.stripUrlWrapper('[https://example.com](https://www.google.com/search?q=https%3A%2F%2Fexample.com)'),
    'https://example.com'
  );
});

test('stripUrlWrapper passes unwrapped URLs through', () => {
  assert.equal(L.stripUrlWrapper('https://example.com'), 'https://example.com');
});

test('stripUrlWrapper returns undefined for empty/absent', () => {
  assert.equal(L.stripUrlWrapper(''), undefined);
  assert.equal(L.stripUrlWrapper(undefined), undefined);
});

test('stripUrlWrapper handles google.com/search?q= without protocol on inner', () => {
  assert.equal(
    L.stripUrlWrapper('https://www.google.com/search?q=example.com%2Fpath'),
    'example.com/path'
  );
});

test('slugWithoutYear strips leading 4-digit year', () => {
  assert.equal(L.slugWithoutYear('2026 Dublin United Clover Cup'), 'dublin-united-clover-cup');
});

test('slugWithoutYear strips trailing 4-digit year', () => {
  assert.equal(L.slugWithoutYear('Spring Rose Classic 2026'), 'spring-rose-classic');
});

test('slugWithoutYear strips internal 4-digit year', () => {
  assert.equal(L.slugWithoutYear('2026 Pacific Coast Cup'), 'pacific-coast-cup');
});

test('slugWithoutYear leaves 2-digit numbers intact', () => {
  assert.equal(L.slugWithoutYear('26 IR Elk Grove Cup'), '26-ir-elk-grove-cup');
  assert.equal(L.slugWithoutYear('24 Hour Showdown'), '24-hour-showdown');
});

test('slugWithoutYear leaves numbers that are not years', () => {
  assert.equal(L.slugWithoutYear('Surf Cup Olders U15'), 'surf-cup-olders-u15');
});

test('slugWithoutYear collapses resulting whitespace', () => {
  assert.equal(L.slugWithoutYear('  2026   Extra   Spaces  2026  '), 'extra-spaces');
});

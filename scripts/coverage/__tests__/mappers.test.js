const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../mappers');

test('researchLeagueToConfigV2 maps a full 12-col row', () => {
  const row = {
    name: 'NorCal Youth Premier League – Gold',
    sport: 'Soccer',
    level: 'competitive',
    ageGroups: 'U14-U19',
    gender: 'Boys+Girls',
    season: 'year-round',
    geography: 'regional (NorCal)',
    governingBody: 'NorCal Premier',
    sanctioning: 'US Club Soccer',
    website: 'https://norcalpremier.com',
    sourceUrl: 'https://norcalpremier.com/competition/ypl/',
    notes: 'Tier row: Gold division.'
  };
  const out = M.researchLeagueToConfigV2(row);
  assert.deepEqual(out, {
    id: 'norcal-youth-premier-league-gold',
    name: 'NorCal Youth Premier League – Gold',
    level: 'competitive',
    ageGroups: 'U14-U19',
    gender: 'Boys+Girls',
    season: 'year-round',
    region: 'regional (NorCal)',
    governingBody: 'NorCal Premier',
    sanctioning: 'US Club Soccer',
    website: 'https://norcalpremier.com',
    sourceUrl: 'https://norcalpremier.com/competition/ypl/',
    notes: 'Tier row: Gold division.'
  });
});

test('researchLeagueToConfigV2 drops absent fields', () => {
  const row = {
    name: 'NCVA Coed Mixer',
    sport: 'Volleyball',
    gender: 'Both',
    geography: 'regional (NorCal)',
    website: '',
    sourceUrl: 'https://ncva.com/events',
    notes: 'n/a'
  };
  const out = M.researchLeagueToConfigV2(row);
  assert.deepEqual(out, {
    id: 'ncva-coed-mixer',
    name: 'NCVA Coed Mixer',
    gender: 'Boys+Girls',
    region: 'regional (NorCal)',
    sourceUrl: 'https://ncva.com/events'
  });
});

test('researchLeagueToConfigV2 returns null when name is absent', () => {
  assert.equal(M.researchLeagueToConfigV2({ name: '' }), null);
  assert.equal(M.researchLeagueToConfigV2({ name: 'n/a' }), null);
});

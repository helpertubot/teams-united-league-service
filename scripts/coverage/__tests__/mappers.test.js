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

test('researchTournamentToConfigV2 maps a full 19-col row with derived fields', () => {
  const row = {
    name: '2026 Dublin United Clover Cup Tournament',
    sport: 'Soccer',
    startDate: '2026-03-14',
    endDate: '2026-03-15',
    venue: 'Fallon Sports Park - Dublin',
    city: 'Dublin',
    state: 'CA',
    entryFee: '$700-$800',
    teamCount: 'n/a',
    platform: 'GotSport',
    registrationUrl: 'https://system.gotsport.com/event_regs/394b04f09d',
    ageGroups: 'U9-U14',
    gender: 'Boys+Girls',
    format: '3GG',
    organizer: 'Dublin United Soccer',
    sanctioning: 'n/a',
    confidence: 'high',
    sourceUrl: 'https://system.gotsport.com/event_regs/394b04f09d',
    notes: 'Fees and venue listed.'
  };
  const out = M.researchTournamentToConfigV2(row);
  assert.deepEqual(out, {
    id: '2026-dublin-united-clover-cup-tournament',
    seriesId: 'dublin-united-clover-cup-tournament',
    year: 2026,
    lifecycle: 'upcoming',
    name: '2026 Dublin United Clover Cup Tournament',
    startDate: '2026-03-14',
    endDate: '2026-03-15',
    venue: 'Fallon Sports Park - Dublin',
    city: 'Dublin',
    entryFee: '$700-$800',
    sourcePlatform: 'gotsport',
    registrationUrl: 'https://system.gotsport.com/event_regs/394b04f09d',
    ageGroups: 'U9-U14',
    gender: 'Boys+Girls',
    format: '3GG',
    organizer: 'Dublin United Soccer',
    confidence: 'high',
    sourceUrl: 'https://system.gotsport.com/event_regs/394b04f09d',
    notes: 'Fees and venue listed.'
  });
});

test('researchTournamentToConfigV2 drops malformed date field but keeps row', () => {
  const row = {
    name: 'SoCal Cup: 14/13 Tourney 3',
    startDate: 'bad-date',
    endDate: '2026-04-11',
    venue: 'AIM Sportsplex',
    city: 'Seal Beach',
    sourceUrl: 'https://example.com'
  };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const out = M.researchTournamentToConfigV2(row);
    assert.equal(out.name, 'SoCal Cup: 14/13 Tourney 3');
    assert.equal(out.startDate, undefined);
    assert.equal(out.endDate, '2026-04-11');
    assert.equal(out.year, null);
    assert.equal(out.lifecycle, 'upcoming');
  } finally {
    console.warn = origWarn;
  }
});

test('researchTournamentToConfigV2 returns null when name is absent', () => {
  assert.equal(M.researchTournamentToConfigV2({ name: '' }), null);
});

test('researchTournamentToConfigV2 seriesId equals id when no year in name', () => {
  const out = M.researchTournamentToConfigV2({
    name: 'California Cup',
    startDate: '2026-05-23',
    endDate: '2026-05-25'
  });
  assert.equal(out.id, 'california-cup');
  assert.equal(out.seriesId, 'california-cup');
  assert.equal(out.year, 2026);
});

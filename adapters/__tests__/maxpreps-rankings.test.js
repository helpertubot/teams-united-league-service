const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRankingsHtml, resolveRankingsUrl, PLATFORM_ID } = require('../maxpreps-rankings');

test('maxpreps-rankings parses __NEXT_DATA__ rankings into standings rows', () => {
  const nextData = {
    props: {
      pageProps: {
        pageTitle: 'Connecticut Class M High School Football Rankings',
        rankingsListData: {
          sportSeasonName: 'Boys Varsity Football Fall 25-26',
          year: '25-26',
          lastUpdated: '2025-12-26T15:25:39',
          totalCount: 2,
          rankings: [
            { rank: 1, schoolId: 'school-1', schoolName: 'Berlin', schoolFormattedName: 'Berlin (CT)', overall: '13-0', rating: 28.8, strength: 0.31, teamLink: 'https://www.maxpreps.com/ct/berlin/berlin-redcoats/football/' },
            { rank: 2, schoolId: 'school-2', schoolName: 'St. Joseph', schoolFormattedName: 'St. Joseph (Trumbull, CT)', overall: '9-3', rating: 27.2, strength: 18.14, teamLink: 'https://www.maxpreps.com/ct/trumbull/st-joseph-cadets/football/' }
          ]
        }
      }
    }
  };
  const html = `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></head></html>`;
  const result = parseRankingsHtml(html, {
    id: 'ct-ciac-mp-football-class-m',
    name: 'CIAC Football — Class M',
    sport: 'football',
    sourceConfig: { sourceUrl: 'https://www.maxpreps.com/ct/football/25-26/class/class-m/rankings/1/?statedivisionid=abc', matchedKind: 'class', matchedSlug: 'class-m' }
  });

  assert.equal(PLATFORM_ID, 'maxpreps-rankings');
  assert.equal(result.divisions.length, 1);
  assert.equal(result.divisions[0].id, 'ct-ciac-mp-football-class-m-class-m');
  assert.equal(result.divisions[0].name, 'CIAC Football — Class M');
  assert.deepEqual(result.standings.map(r => [r.position, r.teamName, r.wins, r.losses, r.overallWins, r.overallLosses, r.rating, r.teamKey]), [
    [1, 'Berlin', 13, 0, 13, 0, 28.8, 'school-1'],
    [2, 'St. Joseph', 9, 3, 9, 3, 27.2, 'school-2'],
  ]);
});

test('maxpreps-rankings resolves URL from sourceConfig', () => {
  const url = 'https://www.maxpreps.com/ct/football/25-26/class/class-m/rankings/1/?statedivisionid=abc';
  assert.equal(resolveRankingsUrl({ sourceUrl: url }), url);
  assert.equal(resolveRankingsUrl({ rankingsUrl: url }), url);
});

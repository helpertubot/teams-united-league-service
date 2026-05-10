const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStandingsHtml, resolveStandingsUrl, PLATFORM_ID } = require('../scorebooklive-si');

test('scorebooklive-si parses server-rendered High School On SI standings props', () => {
  const props = {
    query: {
      organization: {
        fullName: '4A 4',
        slug: '1797-4a-4',
        state: { name: 'Arkansas', slug: 'arkansas' },
        genderSport: { name: 'Baseball', slug: 'baseball' },
        webStandingsPath: '/arkansas/baseball/leagues/1797-4a-4/standings',
        teamStandings: [
          {
            team: { id: '272080', name: 'Dardanelle', webPath: '/arkansas/baseball/teams/272080-dardanelle-sand-lizards' },
            standing: { leagueRecord: '9-0', leagueGamesBack: '-', overallRecord: '19-4', overallWinPercentage: '.826', homeRecord: '11-2', awayRecord: '8-2' }
          },
          {
            team: { id: '274380', name: 'Pottsville', webPath: '/arkansas/baseball/teams/274380-pottsville-apaches' },
            standing: { leagueRecord: '8-2', leagueGamesBack: '1.5', overallRecord: '14-6', overallWinPercentage: '.700', homeRecord: '9-2', awayRecord: '5-4' }
          }
        ]
      }
    }
  };
  const escaped = JSON.stringify(props).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const html = `<html><body><div data-react-class="organizations/Standings" data-react-props="${escaped}"></div></body></html>`;

  const result = parseStandingsHtml(html, { id: 'arkansas-activities-association-4a-4-baseball', sourceConfig: { sport: 'baseball' } });

  assert.equal(PLATFORM_ID, 'scorebooklive-si');
  assert.equal(result.divisions.length, 1);
  assert.equal(result.divisions[0].id, 'arkansas-activities-association-4a-4-baseball-1797-4a-4');
  assert.equal(result.divisions[0].name, '4A 4 Baseball');
  assert.equal(result.standings.length, 2);
  assert.deepEqual(result.standings.map(r => [r.position, r.teamName, r.wins, r.losses, r.overallWins, r.overallLosses, r.teamKey]), [
    [1, 'Dardanelle', 9, 0, 19, 4, '272080'],
    [2, 'Pottsville', 8, 2, 14, 6, '274380'],
  ]);
});

test('scorebooklive-si resolves standings URL from approved sourceConfig shapes', () => {
  assert.equal(
    resolveStandingsUrl({ standingsUrl: 'https://www.si.com/high-school/stats/arkansas/baseball/leagues/1797-4a-4/standings' }),
    'https://www.si.com/high-school/stats/arkansas/baseball/leagues/1797-4a-4/standings'
  );
  assert.equal(
    resolveStandingsUrl({ baseUrl: 'https://www.si.com/high-school/stats', leaguePath: '/arkansas/baseball/leagues/1797-4a-4' }),
    'https://www.si.com/high-school/stats/arkansas/baseball/leagues/1797-4a-4/standings'
  );
});

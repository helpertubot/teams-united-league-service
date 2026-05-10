const test = require('node:test');
const assert = require('node:assert/strict');
const { parseScheduleStandingsHtml } = require('../teamsideline');

function table(headers, rows) {
  return `<html><body><div id="standingsGrid"><table class="rgMasterTable"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((row, idx) => `<tr class="${idx % 2 ? 'rgAltRow' : 'rgRow'}">${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div></body></html>`;
}

test('teamsideline parses Team/Coach/W/L/T/GP/PTS standings without using coach as team', () => {
  const html = table(
    ['Team', 'Coach', 'W', 'L', 'T', 'GP', 'PTS'],
    [['Cheh Waltrip Construction', 'Pennington', '4', '0', '0', '4', '12']]
  );

  const rows = parseScheduleStandingsHtml(html, { scheduleId: '700668', name: 'U12 Boys' });

  assert.deepEqual(rows, [
    {
      teamName: 'Cheh Waltrip Construction',
      position: 1,
      gamesPlayed: 4,
      wins: 4,
      losses: 0,
      ties: 0,
      points: 12,
      differential: 0,
      teamKey: null,
    },
  ]);
});

test('teamsideline parses Team/Coach/PTS/GP/W/L/T/SP standings by header labels', () => {
  const html = table(
    ['Team', 'Coach', 'PTS', 'GP', 'W', 'L', 'T', 'SP'],
    [['TSC Falcons', 'Zack McKissick', '9', '4', '3', '1', '0', '0.000']]
  );

  const rows = parseScheduleStandingsHtml(html, { scheduleId: '701970', name: 'BU13 Green' });

  assert.deepEqual(rows, [
    {
      teamName: 'TSC Falcons',
      position: 1,
      gamesPlayed: 4,
      wins: 3,
      losses: 1,
      ties: 0,
      points: 9,
      differential: 0,
      teamKey: null,
    },
  ]);
});

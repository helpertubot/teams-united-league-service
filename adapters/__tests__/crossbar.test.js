const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { collectStandings } = require('../crossbar');

test('crossbar skips stale 404 division standings pages instead of failing the whole league', async () => {
  const originalGet = axios.get;
  axios.get = async (url) => {
    if (String(url).includes('/division/17083/standings')) {
      const err = new Error('Request failed with status code 404');
      err.response = { status: 404 };
      throw err;
    }
    throw new Error(`unexpected URL ${url}`);
  };

  try {
    const result = await collectStandings({
      id: 'omaha-hockey-club-house-league',
      name: 'Omaha Hockey Club House League',
      sourceConfig: {
        baseUrl: 'https://www.omahahockey.net',
        divisionIds: ['17083'],
      },
    });

    assert.deepEqual(result, { divisions: [], standings: [] });
  } finally {
    axios.get = originalGet;
  }
});

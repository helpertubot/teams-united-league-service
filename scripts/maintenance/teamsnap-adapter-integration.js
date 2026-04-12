#!/usr/bin/env node
/**
 * TeamSnap Adapter Integration Test (live API)
 *
 * Usage:
 *   node scripts/maintenance/test-teamsnap-adapter.js --token=$TEAMSNAP_ACCESS_TOKEN --teamId=123456
 *   node scripts/maintenance/test-teamsnap-adapter.js --token=$TEAMSNAP_ACCESS_TOKEN --divisionId=98765
 *
 * Notes:
 * - Requires a valid TeamSnap API v3 OAuth token with access to the target team/division.
 * - You must provide either --teamId or --divisionId.
 */

const { getAdapter } = require('../../registry');

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--') || !arg.includes('=')) continue;
    const [k, v] = arg.slice(2).split('=');
    out[k] = v;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const token = args.token || process.env.TEAMSNAP_ACCESS_TOKEN;
  const teamId = args.teamId;
  const divisionId = args.divisionId;

  if (!token) {
    throw new Error('Missing token. Provide --token=... or TEAMSNAP_ACCESS_TOKEN env var.');
  }
  if (!teamId && !divisionId) {
    throw new Error('Provide one of: --teamId=... or --divisionId=...');
  }

  const leagueConfig = {
    id: 'teamsnap-integration-test',
    name: 'TeamSnap Integration Test',
    sourcePlatform: 'teamsnap',
    sourceConfig: {
      accessToken: token,
      ...(teamId ? { teamId } : {}),
      ...(divisionId ? { divisionId } : {}),
    },
  };

  const adapter = getAdapter('teamsnap');
  const start = Date.now();
  const result = await adapter.collectStandings(leagueConfig);
  const durationMs = Date.now() - start;

  const divisions = result.divisions || [];
  const standings = result.standings || [];

  if (divisions.length === 0) {
    throw new Error('Integration test failed: no divisions returned.');
  }
  if (standings.length === 0) {
    throw new Error('Integration test failed: no standings returned.');
  }

  const firstDivision = divisions[0];
  const teamsInFirstDivision = standings.filter((s) => s.divisionId === firstDivision.id).length;

  console.log('TeamSnap integration test passed.');
  console.log(`- durationMs: ${durationMs}`);
  console.log(`- divisions: ${divisions.length}`);
  console.log(`- standings: ${standings.length}`);
  console.log(`- sampleDivision: ${firstDivision.name}`);
  console.log(`- sampleTeamsInFirstDivision: ${teamsInFirstDivision}`);
}

main().catch((err) => {
  console.error(`TeamSnap integration test failed: ${err.message}`);
  process.exit(1);
});

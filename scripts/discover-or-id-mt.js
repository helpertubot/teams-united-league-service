/**
 * Discover leagues in OR, ID, MT — currently zero coverage
 *
 * Strategy:
 *   1. Run GameChanger discovery for baseball/softball in OR, ID, MT
 *   2. Search for known Pointstreak/LeagueApps/Demosphere leagues in those states
 *   3. Check for SportsConnect (Little League) programs
 *
 * Run on deploy VM:
 *   node scripts/discover-or-id-mt.js [--dry-run] [--state=OR]
 */

const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios');
const db = new Firestore();

// ── GameChanger discovery (reuses logic from discover-gc.js) ──
const { discoverOrgIds, validateOrg, registerOrg, mapSport, getTeamCount } = require('../discover-gc');

const PHASE1_NEW_STATES = ['OR', 'ID', 'MT'];
const SPORTS = ['baseball', 'softball'];

// ── Known league programs in OR/ID/MT (manually researched) ──
// These are well-known organizations that we know exist but haven't been added yet
const KNOWN_LEAGUES = [
  // Oregon
  {
    id: 'pointstreak-portland-interscholastic-baseball',
    name: 'Portland Interscholastic League Baseball',
    state: 'OR',
    sport: 'baseball',
    sourcePlatform: 'pointstreak',
    status: 'pending_config',
    notes: 'PIL baseball — need leagueId + seasonId from pointstreak',
  },
  // Little League districts in OR/ID/MT — SportsConnect websites
  {
    id: 'sc-district1-or',
    name: 'Oregon District 1 Little League',
    state: 'OR',
    sport: 'baseball',
    sourcePlatform: 'sportsconnect',
    status: 'pending_tabid',
    sourceConfig: { baseUrl: 'https://www.oregondistrict1ll.com' },
    notes: 'Need to find standings tabId on their SportsConnect site',
  },
  {
    id: 'sc-district4-or',
    name: 'Oregon District 4 Little League',
    state: 'OR',
    sport: 'baseball',
    sourcePlatform: 'sportsconnect',
    status: 'pending_tabid',
    sourceConfig: { baseUrl: 'https://www.oregondistrict4.com' },
    notes: 'Need to find standings tabId on their SportsConnect site',
  },
  {
    id: 'sc-boise-id',
    name: 'Boise Little League',
    state: 'ID',
    sport: 'baseball',
    sourcePlatform: 'sportsconnect',
    status: 'pending_tabid',
    sourceConfig: { baseUrl: 'https://www.boiselittleleague.com' },
    notes: 'Need to find standings tabId on their SportsConnect site',
  },
  {
    id: 'sc-billings-mt',
    name: 'Billings Little League',
    state: 'MT',
    sport: 'baseball',
    sourcePlatform: 'sportsconnect',
    status: 'pending_tabid',
    sourceConfig: { baseUrl: 'https://www.billingslittleleague.org' },
    notes: 'Need to find standings tabId on their SportsConnect site',
  },
  {
    id: 'sc-missoula-mt',
    name: 'Missoula Little League',
    state: 'MT',
    sport: 'baseball',
    sourcePlatform: 'sportsconnect',
    status: 'pending_tabid',
    sourceConfig: { baseUrl: 'https://www.missoulalittleleague.com' },
    notes: 'Need to find standings tabId on their SportsConnect site',
  },
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const stateFilter = process.argv.find(a => a.startsWith('--state='));
  const targetStates = stateFilter
    ? [stateFilter.split('=')[1].toUpperCase()]
    : PHASE1_NEW_STATES;

  console.log(`\n=== Discover Leagues in ${targetStates.join(', ')} ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  const results = {
    gcDiscovered: [],
    gcSaved: 0,
    gcSkipped: 0,
    knownAdded: [],
    knownSkipped: [],
    errors: [],
  };

  // ── Step 1: GameChanger discovery via DuckDuckGo + API ──
  console.log('--- Step 1: GameChanger Discovery ---\n');

  for (const state of targetStates) {
    for (const sport of SPORTS) {
      console.log(`\nDiscovering GC orgs: ${state} + ${sport}`);

      try {
        const orgIds = await discoverOrgIds(state, sport);
        console.log(`  Found ${orgIds.length} candidate org IDs`);

        for (const orgId of orgIds) {
          try {
            const org = await validateOrg(orgId);
            if (!org) continue;

            // Skip tournaments
            if (org.type === 'tournament') continue;

            // Must be in a target state
            const orgState = (org.state || '').toUpperCase();
            if (!targetStates.includes(orgState)) continue;

            const tuSport = mapSport(org.sport);
            if (!tuSport) continue;

            const teamCount = await getTeamCount(orgId);

            if (dryRun) {
              console.log(`  [DRY RUN] Would register: ${org.name} (${org.city}, ${orgState}) — ${org.sport}, ${teamCount} teams`);
              results.gcDiscovered.push({ orgId, name: org.name, state: orgState, sport: tuSport, teamCount });
            } else {
              const reg = await registerOrg(org, tuSport, teamCount);
              if (reg.status === 'created') {
                console.log(`  ✓ Registered: ${org.name} (${org.city}, ${orgState}) — ${teamCount} teams`);
                results.gcSaved++;
                results.gcDiscovered.push({ orgId, name: org.name, state: orgState, sport: tuSport, teamCount, leagueId: reg.id });
              } else {
                console.log(`  ~ Already exists: ${org.name}`);
                results.gcSkipped++;
              }
            }

            await sleep(300);
          } catch (err) {
            results.errors.push({ orgId, error: err.message });
          }
        }
      } catch (err) {
        console.error(`  Error discovering ${state}+${sport}: ${err.message}`);
        results.errors.push({ state, sport, error: err.message });
      }
    }
  }

  // ── Step 2: Register known leagues ──
  console.log('\n\n--- Step 2: Register Known Leagues ---\n');

  const knownForStates = KNOWN_LEAGUES.filter(l => targetStates.includes(l.state));

  for (const league of knownForStates) {
    try {
      const existing = await db.collection('leagues').doc(league.id).get();
      if (existing.exists) {
        console.log(`  ~ Already exists: ${league.id} — ${league.name}`);
        results.knownSkipped.push(league.id);
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would add: ${league.id} — ${league.name} (${league.state}, ${league.sourcePlatform})`);
        results.knownAdded.push(league.id);
        continue;
      }

      const leagueData = {
        name: league.name,
        state: league.state,
        sport: league.sport,
        sourcePlatform: league.sourcePlatform,
        status: league.status,
        sourceConfig: league.sourceConfig || {},
        discoveredAt: new Date().toISOString(),
        discoveredBy: 'discover-or-id-mt',
        notes: league.notes || null,
      };

      await db.collection('leagues').doc(league.id).set(leagueData);
      console.log(`  ✓ Added: ${league.id} — ${league.name}`);
      results.knownAdded.push(league.id);
    } catch (err) {
      console.error(`  Error adding ${league.id}: ${err.message}`);
      results.errors.push({ leagueId: league.id, error: err.message });
    }
  }

  // ── Summary ──
  console.log('\n\n=== Discovery Summary ===');
  console.log(`GameChanger: ${results.gcDiscovered.length} discovered, ${results.gcSaved} saved, ${results.gcSkipped} already existed`);
  console.log(`Known leagues: ${results.knownAdded.length} added, ${results.knownSkipped.length} already existed`);
  if (results.errors.length > 0) {
    console.log(`Errors: ${results.errors.length}`);
    results.errors.forEach(e => console.log(`  - ${JSON.stringify(e)}`));
  }

  // Log the discovery run
  if (!dryRun) {
    await db.collection('discoveryLogs').add({
      function: 'discover-or-id-mt',
      states: targetStates,
      gcDiscovered: results.gcDiscovered.length,
      gcSaved: results.gcSaved,
      knownAdded: results.knownAdded.length,
      errors: results.errors.length,
      timestamp: new Date().toISOString(),
    });
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

/**
 * Register OR Soccer Leagues — Oregon Expansion
 *
 * Registers discovered Oregon youth soccer leagues into Firestore.
 * Covers OYSA competitive leagues (SportsAffinity), PMSL, and ECNL/TGS
 * conferences that include Oregon teams.
 *
 * OYSA SportsAffinity organizationId discovery:
 *   Found via indexed sctour.sportsaffinity.com URLs that matched "OYSA OR oregon":
 *   - /schedules/e458918e-4e02-4816-b41d-7d7a079fe51c/8bb24159-... (league schedules)
 *   URL path structure is /schedules/{orgId}/{seasonGuid}, confirmed by comparison
 *   with known Iowa org (77BF583F) and WA org (7379E8F5) URL patterns.
 *
 * IMPORTANT: The sctour.sportsaffinity.com API is currently returning Azure 404
 * for ALL endpoints (as of March 2026). The old /api/standings endpoint and the
 * newer Blazor /standings/ pages are both down. Leagues are registered as
 * pending_config until the API recovers or a migration is identified.
 *
 * PMSL (Portland Metro Soccer League) uses a separate SportsAffinity org:
 *   6857D9A0-8945-44E1-84E8-F3DECC87D56C (from indexed standings URL on sctour)
 *
 * Run on deploy VM:
 *   node scripts/or-soccer-expansion.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

// ═══════════════════════════════════════════════════════════════
// OYSA Competitive Leagues (SportsAffinity)
// ═══════════════════════════════════════════════════════════════
//
// OYSA 2025-26 league structure (3 conferences):
//   - Fall U11-U15 Competitive (Sep–Jan)
//   - Winter U15-U19 Competitive (Nov–Feb)
//   - Spring U11-U14 Competitive (Mar–Jun)
//   - Valley Academy League U9-U10 (Developmental)
//   - Development League U8 (Developmental)
//
// organizationId: e458918e-4e02-4816-b41d-7d7a079fe51c
// Verified from: sctour.sportsaffinity.com/schedules/{orgId}/{seasonGuid}
//
// Season GUIDs found/indexed:
//   8bb24159-807d-4e6b-964a-cea1c7861cf7 — one season (likely Fall 2025)
//
// NOTE: Additional season GUIDs need discovery once the SportsAffinity API
// recovers. Use the tournaments endpoint:
//   GET sctour.sportsaffinity.com/api/tournaments?organizationId={orgId}

const OYSA_ORG_ID = 'e458918e-4e02-4816-b41d-7d7a079fe51c';
const PMSL_ORG_ID = '6857D9A0-8945-44E1-84E8-F3DECC87D56C';

const LEAGUES = [
  // ── OYSA Fall Competitive (U11-U15) ──
  {
    id: 'oysa-fall-competitive',
    name: 'OYSA Fall Competitive League (U11-U15)',
    state: 'OR',
    sport: 'soccer',
    region: 'Statewide',
    sourcePlatform: 'sportsaffinity',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      organizationId: OYSA_ORG_ID,
      seasonGuid: '8bb24159-807d-4e6b-964a-cea1c7861cf7', // needs verification — may be this season
    },
    seasonStart: '2025-09-06',
    seasonEnd: '2026-01-31',
    notes: 'OYSA Fall competitive, U11-U15. 3 conferences (local/statewide/platform). SportsAffinity API currently offline (Azure 404 as of Mar 2026). seasonGuid needs verification once API recovers. organizationId discovered from indexed sctour.sportsaffinity.com schedule URLs.',
  },

  // ── OYSA Winter Competitive (U15-U19) ──
  {
    id: 'oysa-winter-competitive',
    name: 'OYSA Winter Competitive League (U15-U19)',
    state: 'OR',
    sport: 'soccer',
    region: 'Statewide',
    sourcePlatform: 'sportsaffinity',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      organizationId: OYSA_ORG_ID,
      // seasonGuid TBD — needs discovery via API when it recovers
    },
    seasonStart: '2025-11-01',
    seasonEnd: '2026-02-28',
    notes: 'OYSA Winter competitive, U15-U19. seasonGuid needs discovery once SportsAffinity API recovers. Use GET /api/tournaments?organizationId={orgId} to find.',
  },

  // ── OYSA Spring Competitive (U11-U14) ──
  {
    id: 'oysa-spring-competitive',
    name: 'OYSA Spring Competitive League (U11-U14)',
    state: 'OR',
    sport: 'soccer',
    region: 'Statewide',
    sourcePlatform: 'sportsaffinity',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      organizationId: OYSA_ORG_ID,
      // seasonGuid TBD — needs discovery via API when it recovers
    },
    seasonStart: '2026-03-07',
    seasonEnd: '2026-06-15',
    notes: 'OYSA Spring competitive, U11-U14. seasonGuid needs discovery once SportsAffinity API recovers.',
  },

  // ── OYSA Valley Academy League (U9-U10) — Developmental ──
  {
    id: 'oysa-valley-academy',
    name: 'OYSA Valley Academy League (U9-U10)',
    state: 'OR',
    sport: 'soccer',
    region: 'Willamette Valley',
    sourcePlatform: 'sportsaffinity',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      organizationId: OYSA_ORG_ID,
      // seasonGuid TBD
    },
    notes: 'OYSA Valley Academy developmental league, U9-U10. seasonGuid needs discovery.',
  },

  // ── PMSL (Portland Metro Soccer League) ──
  {
    id: 'pmsl-or',
    name: 'Portland Metro Soccer League (PMSL)',
    state: 'OR',
    sport: 'soccer',
    region: 'Portland Metro',
    sourcePlatform: 'sportsaffinity',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      organizationId: PMSL_ORG_ID,
      seasonGuid: '72FE5B3C-57AA-44DC-AE48-95DA4D0536E4', // from indexed standings URL: 24/25 PMSL (Fall)
    },
    seasonStart: '2025-09-01',
    seasonEnd: '2026-06-30',
    notes: 'Portland Metro Soccer League. Separate SportsAffinity org from OYSA. Indexed standings page showed flights: 13UB-15UG PL. API currently offline. seasonGuid from indexed 24/25 PMSL (Fall) standings URL.',
  },

  // ── US Youth Soccer Northwest Conference (GotSport) ──
  // Multi-state league including OR, WA, ID, WY, MT, AK, HI teams
  {
    id: 'usys-nw-conference',
    name: 'US Youth Soccer Northwest Conference',
    state: 'OR',
    sport: 'soccer',
    region: 'Pacific Northwest',
    sourcePlatform: 'gotsport',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      leagueEventId: '24590', // 2023-2024 event, needs current season ID
      groups: [],
    },
    notes: 'Multi-state conference: OR, WA, ID, WY, MT, AK, HI. GotSport event 24590 is 2023-2024. Need to find current 2025-2026 event ID and group IDs. U13-U19 boys and girls.',
  },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== OR Soccer Expansion: Registering ${LEAGUES.length} leagues ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  const results = { created: [], skipped: [], errors: [] };

  for (const league of LEAGUES) {
    try {
      const existing = await db.collection('leagues').doc(league.id).get();
      if (existing.exists) {
        console.log(`  ~ Already exists: ${league.id} — ${league.name}`);
        results.skipped.push(league.id);
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would add: ${league.id} — ${league.name} (${league.sourcePlatform}, ${league.status})`);
        results.created.push(league.id);
        continue;
      }

      const leagueData = {
        name: league.name,
        state: league.state,
        sport: league.sport,
        region: league.region || null,
        sourcePlatform: league.sourcePlatform,
        sourceConfig: league.sourceConfig || {},
        status: league.status,
        autoUpdate: league.autoUpdate || false,
        seasonStart: league.seasonStart || null,
        seasonEnd: league.seasonEnd || null,
        notes: league.notes || null,
        discoveredAt: new Date().toISOString(),
        discoveredBy: 'or-soccer-expansion',
      };

      await db.collection('leagues').doc(league.id).set(leagueData);
      console.log(`  + Created: ${league.id} — ${league.name} (${league.status})`);
      results.created.push(league.id);
    } catch (err) {
      console.error(`  ! Error on ${league.id}: ${err.message}`);
      results.errors.push({ id: league.id, error: err.message });
    }
  }

  // Summary
  console.log('\n=== Registration Summary ===');
  console.log(`Created: ${results.created.length}`);
  console.log(`Skipped (already exist): ${results.skipped.length}`);
  console.log(`Errors: ${results.errors.length}`);

  if (results.created.length > 0) {
    console.log('\nCreated leagues:');
    results.created.forEach(id => console.log(`  - ${id}`));
  }

  // Status breakdown
  const pending = LEAGUES.filter(l => l.status === 'pending_config');
  const active = LEAGUES.filter(l => l.status === 'active');

  console.log(`\n--- Status Breakdown ---`);
  console.log(`Active (ready to collect): ${active.length}`);
  console.log(`Pending config: ${pending.length}`);
  pending.forEach(l => console.log(`  - ${l.id}: ${l.name}`));

  console.log('\n--- Next Steps ---');
  console.log('1. Monitor sctour.sportsaffinity.com for API recovery');
  console.log('2. Once API is back, verify OYSA organizationId: ' + OYSA_ORG_ID);
  console.log('3. Discover season GUIDs via GET /api/tournaments?organizationId=' + OYSA_ORG_ID);
  console.log('4. Update sourceConfig.seasonGuid for each league');
  console.log('5. Set status to active and autoUpdate to true');

  // Log the run
  if (!dryRun) {
    await db.collection('discoveryLogs').add({
      function: 'or-soccer-expansion',
      leaguesCreated: results.created.length,
      leaguesSkipped: results.skipped.length,
      errors: results.errors.length,
      timestamp: new Date().toISOString(),
    });
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

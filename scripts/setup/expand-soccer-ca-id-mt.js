/**
 * Register soccer leagues for CA, ID, and MT
 *
 * All leagues are on GotSport — no new adapter work needed.
 * After running this script, run discoverGroups for each league to auto-populate
 * division groups.
 *
 * New registrations:
 *   CA: SOCAL Soccer League, CCSL (Cal North), NorCal NPL
 *   ID: Idaho State League, D3 League, Snake River League
 *   MT: MSSL Spring 2026, MSSL Fall (dormant)
 *
 * Updates to existing:
 *   CA: norcal-premier — update event ID to 44142
 *   ID: id-premier-league — update event ID to 45021
 *
 * Run on deploy VM:
 *   node scripts/expand-soccer-ca-id-mt.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

const NOW = new Date().toISOString();

// ── New league registrations ──

const NEW_LEAGUES = [
  // ── California ──
  {
    id: 'socal-soccer-league',
    name: 'SOCAL Soccer League',
    state: 'CA',
    sport: 'soccer',
    region: 'Southern California',
    sourcePlatform: 'gotsport',
    status: 'pending_groups',
    autoUpdate: false,
    sourceConfig: {
      leagueEventId: '43086',
      groups: [],
    },
    seasonStart: '2025-09-01',
    seasonEnd: '2026-06-30',
    staleDays: 14,
    notes: 'Largest SoCal competitive youth soccer league. US Club Soccer sanctioned. 170+ clubs, U7-U19. Includes NPL divisions. Former SCDSL merged into this. Event 43086 is Fall 2025-2026.',
    discoveryConfig: {
      platform: 'gotsport',
      searchTerms: ['SOCAL Soccer League', 'SOCAL Fall League', 'SOCAL Spring League'],
    },
  },
  {
    id: 'ccsl-cal-north',
    name: 'CCSL (Cal North Competitive Soccer League)',
    state: 'CA',
    sport: 'soccer',
    region: 'Northern California',
    sourcePlatform: 'gotsport',
    status: 'pending_groups',
    autoUpdate: false,
    sourceConfig: {
      leagueEventId: '6160',
      groups: [],
    },
    seasonStart: '2025-09-01',
    seasonEnd: '2026-06-30',
    staleDays: 14,
    notes: 'Cal North (US Youth Soccer affiliate) competitive league. 50+ year history. Gold/Silver/Bronze/Copper tiers, U8-U19. Event 6160 may be persistent multi-season.',
    discoveryConfig: {
      platform: 'gotsport',
      searchTerms: ['CCSL', 'Cal North Competitive Soccer League'],
    },
  },
  {
    id: 'norcal-premier-npl',
    name: 'NorCal Premier NPL',
    state: 'CA',
    sport: 'soccer',
    region: 'Northern California',
    sourcePlatform: 'gotsport',
    status: 'pending_groups',
    autoUpdate: false,
    sourceConfig: {
      leagueEventId: '41823',
      groups: [],
    },
    seasonStart: '2025-09-01',
    seasonEnd: '2026-06-30',
    staleDays: 14,
    notes: 'NorCal Premier National Pathway League. US Club Soccer NPL. Event 41823 is 2025 Spring NPL.',
    discoveryConfig: {
      platform: 'gotsport',
      searchTerms: ['NorCal Premier NPL'],
    },
  },

  // ── Idaho ──
  {
    id: 'isl-id-spring',
    name: 'Idaho State League',
    state: 'ID',
    sport: 'soccer',
    region: 'Statewide',
    sourcePlatform: 'gotsport',
    status: 'pending_groups',
    autoUpdate: false,
    sourceConfig: {
      leagueEventId: '50328',
      groups: [],
    },
    seasonStart: '2026-03-07',
    seasonEnd: '2026-06-15',
    staleDays: 14,
    notes: 'Idaho State League Spring 2026. 12 groups, U12-U17/19 boys & girls. In season as of March 7. Idaho Rush, Boise Timbers/Thorns, Idaho Surf, ALBION SC Idaho, etc.',
    discoveryConfig: {
      platform: 'gotsport',
      searchTerms: ['Idaho State League', 'ISL Idaho'],
    },
  },
  {
    id: 'd3l-id',
    name: 'D3 League',
    state: 'ID',
    sport: 'soccer',
    region: 'Southwest Idaho',
    sourcePlatform: 'gotsport',
    status: 'pending_groups',
    autoUpdate: false,
    sourceConfig: {
      leagueEventId: '45057',
      groups: [],
    },
    seasonStart: '2025-09-01',
    seasonEnd: '2026-06-15',
    staleDays: 14,
    notes: 'D3 League — Boise/Treasure Valley competitive. 32 groups, U9-U16 boys & girls, Gold/Silver/Bronze tiers. Spring starts Mar 28.',
    discoveryConfig: {
      platform: 'gotsport',
      searchTerms: ['D3 League Idaho', 'D3L Idaho'],
    },
  },
  {
    id: 'srl-id-spring',
    name: 'Snake River League',
    state: 'ID',
    sport: 'soccer',
    region: 'Southeast Idaho',
    sourcePlatform: 'gotsport',
    status: 'pending_groups',
    autoUpdate: false,
    sourceConfig: {
      leagueEventId: '50506',
      groups: [],
    },
    seasonStart: '2026-03-01',
    seasonEnd: '2026-06-15',
    staleDays: 14,
    notes: 'Snake River League Spring 2026. 46+ groups, U9-U19 boys & girls. SE Idaho (Idaho Falls area), run by Bonneville Youth Soccer League.',
    discoveryConfig: {
      platform: 'gotsport',
      searchTerms: ['Snake River League', 'SRL Idaho'],
    },
  },

  // ── Montana ──
  {
    id: 'mssl-mt-spring',
    name: 'Montana State Spring League',
    state: 'MT',
    sport: 'soccer',
    region: 'Statewide',
    sourcePlatform: 'gotsport',
    status: 'pending_groups',
    autoUpdate: false,
    sourceConfig: {
      leagueEventId: '43710',
      groups: [],
    },
    seasonStart: '2026-03-28',
    seasonEnd: '2026-06-15',
    staleDays: 14,
    notes: 'MSSL Spring 2026 — statewide competitive league run by MYSA. ~40 groups, U9-U19 boys & girls, Premier/Select/Classic tiers. 26 member clubs: Billings United, Strikers FC (Missoula), Montana Surf (Bozeman), Helena YSA, Montana Rush (Great Falls), etc.',
    discoveryConfig: {
      platform: 'gotsport',
      searchTerms: ['Montana State Spring League', 'MSSL Montana'],
      org: 'Montana Youth Soccer Association',
    },
  },
  {
    id: 'mssl-mt-fall',
    name: 'Montana State Fall League',
    state: 'MT',
    sport: 'soccer',
    region: 'Statewide',
    sourcePlatform: 'gotsport',
    status: 'dormant',
    autoUpdate: false,
    sourceConfig: {
      leagueEventId: '45401',
      groups: [],
    },
    seasonStart: '2025-08-15',
    seasonEnd: '2025-11-15',
    staleDays: 14,
    monitorStatus: 'dormant',
    monitorNotes: 'Fall 2025 season ended. Register as dormant — season monitor will discover Fall 2026 event when published.',
    notes: 'MSSL Fall — same statewide league, fall season. Event 45401 is 2025 fall. Uses promotion/relegation system.',
    discoveryConfig: {
      platform: 'gotsport',
      searchTerms: ['Montana State Fall League', 'Montana Fall State League'],
      org: 'Montana Youth Soccer Association',
    },
  },
];

// ── Updates to existing leagues ──

const UPDATES = [
  {
    id: 'norcal-premier',
    updates: {
      'sourceConfig.leagueEventId': '44142',
      seasonStart: '2025-09-01',
      seasonEnd: '2026-06-30',
      staleDays: 14,
      status: 'pending_groups',
      monitorNotes: `Updated event ID to 44142 (Fall 2025-26) by expand-soccer-ca-id-mt on ${NOW}`,
      discoveryConfig: {
        platform: 'gotsport',
        searchTerms: ['NorCal Premier', 'NorCal Premier League'],
      },
    },
    description: 'Update event ID to 44142 (Fall 2025-26)',
  },
  {
    id: 'id-premier-league',
    updates: {
      'sourceConfig.leagueEventId': '45021',
      seasonStart: '2025-09-01',
      seasonEnd: '2026-06-30',
      staleDays: 14,
      status: 'pending_groups',
      monitorNotes: `Updated event ID to 45021 (2025-26) by expand-soccer-ca-id-mt on ${NOW}`,
      discoveryConfig: {
        platform: 'gotsport',
        searchTerms: ['Idaho Premier League', 'IPL Idaho'],
      },
    },
    description: 'Update event ID to 45021 (2025-26)',
  },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== Soccer Expansion: CA + ID + MT ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  const results = { created: [], updated: [], skipped: [], errors: [] };

  // ── Step 1: Register new leagues ──
  console.log('--- Registering new leagues ---\n');

  for (const league of NEW_LEAGUES) {
    try {
      const existing = await db.collection('leagues').doc(league.id).get();
      if (existing.exists) {
        console.log(`  ~ Already exists: ${league.id} — ${league.name} (${existing.data().status})`);
        results.skipped.push(league.id);
        continue;
      }

      const leagueData = {
        name: league.name,
        state: league.state,
        sport: league.sport,
        region: league.region,
        sourcePlatform: league.sourcePlatform,
        sourceConfig: league.sourceConfig,
        status: league.status,
        autoUpdate: league.autoUpdate,
        seasonStart: league.seasonStart || null,
        seasonEnd: league.seasonEnd || null,
        staleDays: league.staleDays || 14,
        notes: league.notes || null,
        discoveryConfig: league.discoveryConfig || null,
        monitorStatus: league.monitorStatus || null,
        monitorNotes: league.monitorNotes || null,
        discoveredAt: NOW,
        discoveredBy: 'expand-soccer-ca-id-mt',
      };

      if (dryRun) {
        console.log(`  [DRY RUN] Would create: ${league.id} — ${league.name} (${league.state}, ${league.status})`);
      } else {
        await db.collection('leagues').doc(league.id).set(leagueData);
        console.log(`  + Created: ${league.id} — ${league.name} (${league.state})`);
      }
      results.created.push(league.id);
    } catch (err) {
      console.error(`  ! Error on ${league.id}: ${err.message}`);
      results.errors.push({ id: league.id, error: err.message });
    }
  }

  // ── Step 2: Update existing leagues ──
  console.log('\n--- Updating existing leagues ---\n');

  for (const entry of UPDATES) {
    try {
      const doc = await db.collection('leagues').doc(entry.id).get();
      if (!doc.exists) {
        console.log(`  ✗ ${entry.id} — NOT FOUND in Firestore`);
        results.errors.push({ id: entry.id, error: 'Not found' });
        continue;
      }

      const data = doc.data();
      console.log(`  ${entry.id} — ${data.name} (currently ${data.status})`);
      console.log(`    Action: ${entry.description}`);

      if (dryRun) {
        console.log(`    [DRY RUN] Would update`);
      } else {
        await db.collection('leagues').doc(entry.id).update(entry.updates);
        console.log(`    ✓ Updated`);
      }
      results.updated.push(entry.id);
    } catch (err) {
      console.error(`  ! Error on ${entry.id}: ${err.message}`);
      results.errors.push({ id: entry.id, error: err.message });
    }
  }

  // ── Summary ──
  console.log('\n=== Summary ===');
  console.log(`  Created: ${results.created.length}`);
  console.log(`  Updated: ${results.updated.length}`);
  console.log(`  Skipped (already exist): ${results.skipped.length}`);
  console.log(`  Errors: ${results.errors.length}`);

  // By state
  const byState = {};
  for (const l of NEW_LEAGUES) {
    byState[l.state] = (byState[l.state] || 0) + 1;
  }
  console.log('\n  By state:');
  for (const [state, count] of Object.entries(byState)) {
    console.log(`    ${state}: ${count} new`);
  }

  console.log('\n--- Next Steps ---');
  console.log('All new leagues are registered as pending_groups.');
  console.log('Run discoverGroups for each to auto-populate division groups:\n');

  const pendingGroups = NEW_LEAGUES.filter(l => l.status === 'pending_groups');
  for (const league of pendingGroups) {
    console.log(`  curl -X POST <discoverGroups-url> -H "Content-Type: application/json" -d '{"eventId":"${league.sourceConfig.leagueEventId}","leagueId":"${league.id}","save":true}'`);
  }

  for (const entry of UPDATES) {
    const eventId = entry.updates['sourceConfig.leagueEventId'];
    if (eventId) {
      console.log(`  curl -X POST <discoverGroups-url> -H "Content-Type: application/json" -d '{"eventId":"${eventId}","leagueId":"${entry.id}","save":true}'`);
    }
  }

  console.log('\nAfter groups are discovered, set status to active and autoUpdate to true.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

/**
 * Register OR Soccer Leagues — Phase 2
 *
 * Registers newly discovered Oregon youth soccer leagues into Firestore.
 * Phase 1 (or-soccer-expansion.js) registered the initial 5 OYSA + PMSL + USYS NW.
 * Phase 2 covers:
 *   - OYSA Fall leagues (dormant — season ended, registered for auto-discovery)
 *   - Any newly discovered PCL/SCL-specific tournaments
 *   - PMSL platform resolution (switched to sportsaffinity-asp if applicable)
 *
 * All dormant leagues include discoveryConfig so the season monitor can
 * auto-discover new tournament GUIDs when new seasons are created.
 *
 * Run discovery first:
 *   node scripts/discovery/discover-oysa-tournaments.js
 *
 * Then register:
 *   node scripts/setup/or-soccer-expansion-phase2.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

// ═══════════════════════════════════════════════════════════════
// LEAGUES TO REGISTER
// Update this array based on discover-oysa-tournaments.js output.
// GUIDs below are placeholders marked with TODO where discovery
// output is needed.
// ═══════════════════════════════════════════════════════════════

const LEAGUES = [
  // ── OYSA Fall Competitive League ──
  // Season: Sep–Nov. Dormant now (ended Nov 2025).
  // Registered so season monitor can auto-discover Fall 2026 GUID.
  {
    id: 'oysa-fall-competitive',
    name: 'OYSA Fall Competitive League',
    state: 'OR',
    sport: 'soccer',
    region: 'Statewide',
    sourcePlatform: 'sportsaffinity-asp',
    status: 'dormant',
    autoUpdate: false,
    sourceConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      tournamentGuid: null, // TODO: populate from discovery output
    },
    seasonStart: '2025-09-01',
    seasonEnd: '2025-11-30',
    discoveryConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      namePattern: 'Fall.*Competitive|Fall.*League',
    },
    notes: 'OYSA Fall competitive league. Season ended Nov 2025. Registered for auto-discovery of Fall 2026 season.',
  },

  // ── OYSA Fall League South ──
  {
    id: 'oysa-fall-south',
    name: 'OYSA Fall League - South',
    state: 'OR',
    sport: 'soccer',
    region: 'Southern Oregon',
    sourcePlatform: 'sportsaffinity-asp',
    status: 'dormant',
    autoUpdate: false,
    sourceConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      tournamentGuid: null, // TODO: populate from discovery output
    },
    seasonStart: '2025-09-01',
    seasonEnd: '2025-11-30',
    discoveryConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      namePattern: 'Fall.*South',
    },
    notes: 'OYSA Fall South region. Registered for auto-discovery.',
  },
];

// ═══════════════════════════════════════════════════════════════
// UPDATES TO EXISTING LEAGUES
// Add discoveryConfig to existing OYSA leagues so the season
// monitor can auto-discover new tournament GUIDs.
// ═══════════════════════════════════════════════════════════════

const UPDATES = [
  {
    id: 'oysa-spring-competitive',
    discoveryConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      namePattern: 'Spring.*Competitive|Spring.*League',
    },
  },
  {
    id: 'oysa-spring-south',
    discoveryConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      namePattern: 'Spring.*South',
    },
  },
  {
    id: 'oysa-winter-competitive',
    discoveryConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      namePattern: 'Winter.*Competitive|Winter.*League',
    },
  },
  {
    id: 'oysa-dev-league',
    discoveryConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      namePattern: 'Development|Dev.*League',
    },
  },
  {
    id: 'oysa-valley-academy',
    discoveryConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      namePattern: 'Valley.*Academy',
    },
  },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== OR Soccer Expansion Phase 2 ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // Filter out leagues with null tournamentGuid (need discovery first)
  const readyLeagues = LEAGUES.filter(l => {
    if (l.sourceConfig.tournamentGuid === null) {
      console.log(`  ⏭ Skipping ${l.id} — tournamentGuid is null (run discovery first)`);
      return false;
    }
    return true;
  });

  const results = { created: [], skipped: [], updated: [], errors: [] };

  // Register new leagues
  console.log(`\n--- Registering ${readyLeagues.length} new leagues ---\n`);

  for (const league of readyLeagues) {
    try {
      const existing = await db.collection('leagues').doc(league.id).get();
      if (existing.exists) {
        console.log(`  ~ Already exists: ${league.id}`);
        results.skipped.push(league.id);
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would create: ${league.id} — ${league.name} (${league.status})`);
        results.created.push(league.id);
        continue;
      }

      const leagueData = {
        name: league.name,
        state: league.state,
        sport: league.sport,
        region: league.region || null,
        sourcePlatform: league.sourcePlatform,
        sourceConfig: league.sourceConfig,
        status: league.status,
        autoUpdate: league.autoUpdate || false,
        seasonStart: league.seasonStart || null,
        seasonEnd: league.seasonEnd || null,
        discoveryConfig: league.discoveryConfig || null,
        notes: league.notes || null,
        discoveredAt: new Date().toISOString(),
        discoveredBy: 'or-soccer-expansion-phase2',
      };

      await db.collection('leagues').doc(league.id).set(leagueData);
      console.log(`  + Created: ${league.id} — ${league.name} (${league.status})`);
      results.created.push(league.id);
    } catch (err) {
      console.error(`  ! Error on ${league.id}: ${err.message}`);
      results.errors.push({ id: league.id, error: err.message });
    }
  }

  // Update existing leagues with discoveryConfig
  console.log(`\n--- Updating ${UPDATES.length} existing leagues with discoveryConfig ---\n`);

  for (const update of UPDATES) {
    try {
      const doc = await db.collection('leagues').doc(update.id).get();
      if (!doc.exists) {
        console.log(`  ? League ${update.id} not found in Firestore — skipping`);
        continue;
      }

      const existing = doc.data();
      if (existing.discoveryConfig) {
        console.log(`  ~ ${update.id} already has discoveryConfig — skipping`);
        results.skipped.push(`${update.id} (update)`);
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would update: ${update.id} — add discoveryConfig`);
        results.updated.push(update.id);
        continue;
      }

      await doc.ref.update({ discoveryConfig: update.discoveryConfig });
      console.log(`  ↻ Updated: ${update.id} — added discoveryConfig`);
      results.updated.push(update.id);
    } catch (err) {
      console.error(`  ! Error updating ${update.id}: ${err.message}`);
      results.errors.push({ id: update.id, error: err.message });
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Created: ${results.created.length}`);
  console.log(`Updated: ${results.updated.length}`);
  console.log(`Skipped: ${results.skipped.length}`);
  console.log(`Errors: ${results.errors.length}`);

  const skippedNull = LEAGUES.length - readyLeagues.length;
  if (skippedNull > 0) {
    console.log(`\n⚠ ${skippedNull} league(s) skipped due to null tournamentGuid.`);
    console.log('  Run discover-oysa-tournaments.js first, then update the GUIDs in this script.');
  }

  // Log the run
  if (!dryRun && (results.created.length > 0 || results.updated.length > 0)) {
    await db.collection('discoveryLogs').add({
      function: 'or-soccer-expansion-phase2',
      leaguesCreated: results.created.length,
      leaguesUpdated: results.updated.length,
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

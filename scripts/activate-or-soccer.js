/**
 * Activate OR Soccer Leagues — Resolve all 9 pending_config Oregon soccer leagues
 *
 * Actions:
 *   - Activate 4 OYSA spring leagues (sportsaffinity-asp) — config already complete
 *   - Activate PMSL (sportsaffinity) — SCTour API confirmed working
 *   - Set OYSA Winter to dormant (season ended Feb 2026)
 *   - Set USYS NW Conference to dormant (2024-2025 ended, 2025-2026 not created yet)
 *   - Deactivate 3 demosphere leagues (no public standings / adult-only / stale data)
 *
 * Run on deploy VM:
 *   node scripts/activate-or-soccer.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

const NOW = new Date().toISOString();

// ── Known-ID updates (from or-soccer-expansion.js) ──

const ACTIVATE = [
  'oysa-spring-competitive',
  'oysa-spring-south',
  'oysa-dev-league',
  'oysa-valley-academy',
  'pmsl-or',
];

const SET_DORMANT = [
  {
    id: 'oysa-winter-competitive',
    updates: {
      status: 'dormant',
      autoUpdate: false,
      monitorStatus: 'dormant',
      monitorNotes: 'Winter 2025-2026 season ended Feb 2026. Season monitor will discover next winter season.',
      activatedAt: NOW,
      activatedBy: 'activate-or-soccer',
    },
  },
  {
    id: 'usys-nw-conference',
    updates: {
      status: 'dormant',
      autoUpdate: false,
      monitorStatus: 'dormant',
      monitorNotes: '2024-2025 season ended Jan 2025. Event ID updated to 34040. 2025-2026 GotSport event not yet created — monitor will discover when available.',
      'sourceConfig.leagueEventId': '34040',
      activatedAt: NOW,
      activatedBy: 'activate-or-soccer',
    },
  },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== Activate OR Soccer Leagues ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  let activated = 0;
  let dormant = 0;
  let deactivated = 0;
  let errors = 0;

  // ── Step 1: Activate 5 leagues ──
  console.log('--- Activating leagues ---\n');

  for (const id of ACTIVATE) {
    try {
      const doc = await db.collection('leagues').doc(id).get();
      if (!doc.exists) {
        console.log(`  ✗ ${id} — NOT FOUND in Firestore`);
        errors++;
        continue;
      }

      const data = doc.data();
      console.log(`  ${id} — ${data.name} (${data.sourcePlatform}, currently ${data.status})`);

      if (data.status === 'active') {
        console.log(`    Already active, skipping`);
        continue;
      }

      const updates = {
        status: 'active',
        autoUpdate: true,
        monitorStatus: 'healthy',
        monitorNotes: `Activated by activate-or-soccer on ${NOW}`,
        activatedAt: NOW,
        activatedBy: 'activate-or-soccer',
      };

      if (dryRun) {
        console.log(`    [DRY RUN] Would set active + autoUpdate`);
      } else {
        await db.collection('leagues').doc(id).update(updates);
        console.log(`    ✓ Set to active`);
      }
      activated++;
    } catch (err) {
      console.error(`  ✗ ${id} — Error: ${err.message}`);
      errors++;
    }
  }

  // ── Step 2: Set 2 leagues to dormant ──
  console.log('\n--- Setting leagues to dormant ---\n');

  for (const entry of SET_DORMANT) {
    try {
      const doc = await db.collection('leagues').doc(entry.id).get();
      if (!doc.exists) {
        console.log(`  ✗ ${entry.id} — NOT FOUND in Firestore`);
        errors++;
        continue;
      }

      const data = doc.data();
      console.log(`  ${entry.id} — ${data.name} (currently ${data.status})`);

      if (dryRun) {
        console.log(`    [DRY RUN] Would set dormant`);
        if (entry.updates['sourceConfig.leagueEventId']) {
          console.log(`    [DRY RUN] Would update leagueEventId to ${entry.updates['sourceConfig.leagueEventId']}`);
        }
      } else {
        await db.collection('leagues').doc(entry.id).update(entry.updates);
        console.log(`    ✓ Set to dormant`);
      }
      dormant++;
    } catch (err) {
      console.error(`  ✗ ${entry.id} — Error: ${err.message}`);
      errors++;
    }
  }

  // ── Step 3: Deactivate OR demosphere pending_config leagues ──
  console.log('\n--- Deactivating demosphere leagues (no public standings) ---\n');

  try {
    const snap = await db.collection('leagues')
      .where('state', '==', 'OR')
      .where('sourcePlatform', '==', 'demosphere')
      .where('status', '==', 'pending_config')
      .get();

    if (snap.empty) {
      console.log('  No OR demosphere pending_config leagues found');
    } else {
      for (const doc of snap.docs) {
        const data = doc.data();
        const name = data.name || doc.id;

        let reason;
        if (name.includes('ALBION')) {
          reason = 'No public standings page (login-only)';
        } else if (name.includes('Greater Portland') || name.includes('GPSD')) {
          reason = 'Adult league (O30+), not youth soccer';
        } else if (name.includes('Oregon Soccer Club')) {
          reason = 'No current standings published (last data 2018-2019)';
        } else {
          reason = 'No public standings available';
        }

        console.log(`  ${doc.id} — ${name}`);
        console.log(`    Reason: ${reason}`);

        if (dryRun) {
          console.log(`    [DRY RUN] Would set to deactivated_phase1`);
        } else {
          await db.collection('leagues').doc(doc.id).update({
            status: 'deactivated_phase1',
            autoUpdate: false,
            monitorStatus: null,
            monitorNotes: `Deactivated: ${reason}`,
            deactivatedAt: NOW,
            deactivatedBy: 'activate-or-soccer',
          });
          console.log(`    ✓ Deactivated`);
        }
        deactivated++;
      }
    }
  } catch (err) {
    console.error(`  ✗ Demosphere query error: ${err.message}`);
    errors++;
  }

  // ── Summary ──
  console.log('\n=== Summary ===');
  console.log(`  Activated: ${activated}`);
  console.log(`  Set dormant: ${dormant}`);
  console.log(`  Deactivated: ${deactivated}`);
  console.log(`  Errors: ${errors}`);

  if (!dryRun && (activated + dormant + deactivated) > 0) {
    console.log('\n--- Next Steps ---');
    if (activated > 0) {
      console.log('1. Trigger test collection for activated leagues:');
      for (const id of ACTIVATE) {
        console.log(`   curl -X POST <collectLeague-url> -d \'{"leagueId":"${id}"}\'`);
      }
    }
    console.log('2. Check dashboard to verify status changes');
    console.log('3. Monitor first collection run for errors');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

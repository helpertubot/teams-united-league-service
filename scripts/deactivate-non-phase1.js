/**
 * Deactivate leagues outside Phase 1 states (WA, OR, ID, MT, CA)
 *
 * Phase 1 rollout covers only Pacific Northwest + California.
 * Leagues in other states should be set to status='deactivated_phase1'
 * so they can be reactivated later when we expand coverage.
 *
 * Run on deploy VM:
 *   node scripts/deactivate-non-phase1.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

const PHASE1_STATES = new Set(['WA', 'OR', 'ID', 'MT', 'CA']);

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\n=== Deactivate Non-Phase 1 Leagues ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // Get all active leagues
  const snap = await db.collection('leagues')
    .where('status', '==', 'active')
    .get();

  console.log(`Total active leagues: ${snap.size}`);

  const toDeactivate = [];
  const phase1Leagues = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const state = (data.state || data.states || '').toUpperCase().trim();

    // Check if the league's state(s) are all within Phase 1
    // Some leagues have comma-separated states like "WA,OR"
    const leagueStates = state.split(/[,\s\/]+/).map(s => s.trim()).filter(Boolean);
    const isPhase1 = leagueStates.length > 0 && leagueStates.every(s => PHASE1_STATES.has(s));

    if (isPhase1) {
      phase1Leagues.push({ id: doc.id, name: data.name, state, platform: data.sourcePlatform });
    } else {
      toDeactivate.push({ id: doc.id, name: data.name, state, sport: data.sport, platform: data.sourcePlatform });
    }
  }

  console.log(`\nPhase 1 leagues (keeping active): ${phase1Leagues.length}`);
  phase1Leagues.forEach(l => console.log(`  ✓ ${l.id} — ${l.name} (${l.state}, ${l.platform})`));

  console.log(`\nNon-Phase 1 leagues (to deactivate): ${toDeactivate.length}`);
  toDeactivate.forEach(l => console.log(`  ✗ ${l.id} — ${l.name} (${l.state}, ${l.sport}, ${l.platform})`));

  if (dryRun) {
    console.log('\n--- DRY RUN — no changes made ---');
    return;
  }

  if (toDeactivate.length === 0) {
    console.log('\nNo leagues to deactivate.');
    return;
  }

  // Deactivate in batches
  const BATCH_SIZE = 400;
  let deactivated = 0;

  for (let i = 0; i < toDeactivate.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = toDeactivate.slice(i, i + BATCH_SIZE);

    for (const league of chunk) {
      const ref = db.collection('leagues').doc(league.id);
      batch.update(ref, {
        status: 'deactivated_phase1',
        previousStatus: 'active',
        deactivatedAt: new Date().toISOString(),
        deactivatedReason: 'Outside Phase 1 states (WA/OR/ID/MT/CA)',
      });
    }

    await batch.commit();
    deactivated += chunk.length;
    console.log(`  Deactivated ${deactivated}/${toDeactivate.length}`);
  }

  console.log(`\nDone. Deactivated ${deactivated} leagues.`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

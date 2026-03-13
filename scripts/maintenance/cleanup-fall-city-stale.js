#!/usr/bin/env node
/**
 * Cleanup stale Fall City LL divisions and their orphaned standings.
 *
 * The old adapter run created divisions with long suffixed names like
 * "A Baseball (League Ages 6-7)" instead of the correct "A - 2026 Baseball".
 * This script deletes those 6 stale division docs and all standings docs
 * that reference them.
 *
 * Usage: node scripts/maintenance/cleanup-fall-city-stale.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

const STALE_DIVISION_IDS = [
  'wa-fall-city-ll-sc-2026-baseball-a-baseball-league-ages-6-7',
  'wa-fall-city-ll-sc-2026-baseball-aa-baseball-league-ages-7-8',
  'wa-fall-city-ll-sc-2025-baseball-aaa-baseball-league-ages-9-10',
  'wa-fall-city-ll-sc-2026-baseball-aaa-baseball-league-ages-9-10',
  'wa-fall-city-ll-sc-2025-baseball-coast-majors-baseball-league-ages-10-12',
  'wa-fall-city-ll-sc-2026-baseball-coast-majors-baseball-league-ages-10-12',
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Cleanup Fall City stale divisions${dryRun ? ' (DRY RUN)' : ''}`);
  console.log('='.repeat(60));

  let totalDivsDeleted = 0;
  let totalStandingsDeleted = 0;

  for (const divId of STALE_DIVISION_IDS) {
    // Check if division doc exists
    const divDoc = await db.collection('divisions').doc(divId).get();
    const exists = divDoc.exists;
    console.log(`\nDivision: ${divId}`);
    console.log(`  Doc exists: ${exists}`);

    // Find all standings for this division
    const standingsSnap = await db.collection('standings')
      .where('divisionId', '==', divId)
      .get();
    console.log(`  Standings docs: ${standingsSnap.size}`);

    if (dryRun) {
      if (exists) totalDivsDeleted++;
      totalStandingsDeleted += standingsSnap.size;
      continue;
    }

    // Delete standings in batches of 400
    const standingsDocs = standingsSnap.docs;
    for (let i = 0; i < standingsDocs.length; i += 400) {
      const batch = db.batch();
      const chunk = standingsDocs.slice(i, i + 400);
      for (const doc of chunk) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      console.log(`  Deleted ${chunk.length} standings docs`);
    }
    totalStandingsDeleted += standingsDocs.length;

    // Delete division doc
    if (exists) {
      await db.collection('divisions').doc(divId).delete();
      console.log(`  Deleted division doc`);
      totalDivsDeleted++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Summary: ${totalDivsDeleted} divisions, ${totalStandingsDeleted} standings ${dryRun ? 'would be' : ''} deleted`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

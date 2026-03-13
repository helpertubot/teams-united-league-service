/**
 * Backfill Little League Age Groups
 *
 * One-time script to update all existing Little League division docs in Firestore
 * that have ageGroup: "unknown" or missing. Looks up the parent league to check
 * if it's a Little League org, then resolves the age from the division level/name
 * using the shared LL_AGE_MAP.
 *
 * Run on deploy VM:
 *   node scripts/maintenance/backfill-ll-age-groups.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const { resolveLLAgeGroup, isLittleLeague } = require('../../lib/little-league-ages');

const db = new Firestore();

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== Backfill Little League Age Groups ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // 1. Load all leagues and identify LL ones
  const leaguesSnap = await db.collection('leagues').get();
  const llLeagueIds = new Set();

  for (const doc of leaguesSnap.docs) {
    const data = doc.data();
    if (isLittleLeague(data.name)) {
      llLeagueIds.add(doc.id);
    }
  }

  console.log(`Found ${llLeagueIds.size} Little League orgs out of ${leaguesSnap.size} total leagues\n`);

  if (llLeagueIds.size === 0) {
    console.log('No Little League orgs found. Nothing to backfill.');
    return;
  }

  // 2. Query all divisions and filter to LL leagues with unknown ageGroup
  const divsSnap = await db.collection('divisions').get();
  console.log(`Total divisions in Firestore: ${divsSnap.size}`);

  let updated = 0;
  let skipped = 0;
  let alreadySet = 0;
  let noMatch = 0;

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of divsSnap.docs) {
    const div = doc.data();

    // Skip non-LL divisions
    if (!llLeagueIds.has(div.leagueId)) continue;

    // Skip divisions that already have a valid ageGroup
    if (div.ageGroup && div.ageGroup !== 'unknown') {
      alreadySet++;
      continue;
    }

    // Try to resolve from level field first, then from name
    const resolved = resolveLLAgeGroup(div.level, div.name);

    if (!resolved) {
      noMatch++;
      console.log(`  [NO MATCH] ${doc.id}: level="${div.level || ''}" name="${div.name}" — could not resolve`);
      continue;
    }

    console.log(`  ${doc.id}: "${div.name}" level="${div.level || ''}" → ageGroup: "${resolved}"`);

    if (!dryRun) {
      batch.update(doc.ref, { ageGroup: resolved });
      batchCount++;

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    updated++;
  }

  // Commit remaining batch
  if (!dryRun && batchCount > 0) {
    await batch.commit();
  }

  console.log(`\n=== Summary ===`);
  console.log(`  LL divisions already set: ${alreadySet}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  No match (could not resolve): ${noMatch}`);
  console.log(`  Non-LL divisions skipped: ${skipped}`);
  if (dryRun) console.log(`  (DRY RUN — no changes written)`);
  console.log('');
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

/**
 * fix-platform-names.js — Fix inconsistent platform name strings in Firestore
 *
 * Corrects "bluesombrero" → "blue-sombrero" and any other known mismatches.
 *
 * Run: node scripts/maintenance/fix-platform-names.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

const PLATFORM_FIXES = {
  'bluesombrero': 'blue-sombrero',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\n=== Fix Platform Names ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  const snap = await db.collection('leagues').get();
  let fixed = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const platform = data.sourcePlatform;
    if (platform && PLATFORM_FIXES[platform]) {
      const newPlatform = PLATFORM_FIXES[platform];
      console.log(`  ${doc.id}: "${platform}" → "${newPlatform}"`);
      if (!dryRun) {
        await doc.ref.update({ sourcePlatform: newPlatform });
      }
      fixed++;
    }
  }

  console.log(`\n${fixed} league(s) ${dryRun ? 'would be' : ''} fixed.\n`);
}

main().catch(err => { console.error(err); process.exit(1); });

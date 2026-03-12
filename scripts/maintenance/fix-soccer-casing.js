/**
 * Fix Soccer Casing — Normalize sport field to lowercase
 *
 * The wa-soccer-expansion.js script registered leagues with sport: 'Soccer'
 * (capitalized), but the codebase convention is lowercase ('soccer').
 * The season-monitor STALE_THRESHOLDS uses lowercase keys, and the
 * discover-gc.js SPORT_MAP uses all-lowercase values.
 *
 * This script finds all leagues with sport == 'Soccer' and updates to 'soccer'.
 *
 * Run on deploy VM:
 *   node scripts/fix-soccer-casing.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== Fix Soccer Casing ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // Query all leagues — Firestore string matching is case-sensitive,
  // so sport == 'Soccer' won't match 'soccer'
  const snap = await db.collection('leagues').where('sport', '==', 'Soccer').get();

  if (snap.empty) {
    console.log('No leagues found with sport == "Soccer". Nothing to fix.');
    return;
  }

  console.log(`Found ${snap.size} leagues with sport == "Soccer":\n`);

  let updated = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    console.log(`  ${doc.id}: "${data.name}" — sport: "${data.sport}" → "soccer"`);

    if (!dryRun) {
      await doc.ref.update({ sport: 'soccer' });
      updated++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Found: ${snap.size}`);
  console.log(`Updated: ${dryRun ? '0 (dry run)' : updated}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

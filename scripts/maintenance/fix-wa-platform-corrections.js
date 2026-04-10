/**
 * Fix WA Platform Corrections — GST-58
 *
 * Platform validation of 8 pending WA leagues revealed significant
 * platform misidentification. This script corrects sourcePlatform
 * for each league based on verified URLs.
 *
 * Corrections:
 *   4× Blue Sombrero: sc-northshore-wa, sc-skagit-wa, sc-spokane-sysa, wa-ll-d8-ballard
 *   2× SportsEngine: wa-ll-d1-edmonds, wa-ll-d10-federal-way
 *   1× SportsConnect: wa-ll-d7-burien (confirm existing)
 *   1× Custom: wa-ll-d9-bellevue
 *
 * Run:
 *   node scripts/maintenance/fix-wa-platform-corrections.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

const corrections = [
  // Blue Sombrero leagues
  {
    id: 'sc-northshore-wa',
    sourcePlatform: 'blue-sombrero',
    sourceConfig: { baseUrl: 'https://tshq.bluesombrero.com/Default.aspx?tabid=2293688' },
  },
  {
    id: 'sc-skagit-wa',
    sourcePlatform: 'blue-sombrero',
    sourceConfig: { baseUrl: 'https://clubs.bluesombrero.com/default.aspx?portalid=50807', portalId: '50807' },
  },
  {
    id: 'sc-spokane-sysa',
    sourcePlatform: 'blue-sombrero',
    sourceConfig: { baseUrl: 'https://clubs.bluesombrero.com/spokaneysa' },
  },
  {
    id: 'wa-ll-d8-ballard',
    sourcePlatform: 'blue-sombrero',
    sourceConfig: { baseUrl: 'https://tshq.bluesombrero.com/ballardll' },
  },
  // SportsEngine leagues
  {
    id: 'wa-ll-d1-edmonds',
    sourcePlatform: 'sportsengine',
    sourceConfig: { orgUrl: 'https://www.sportsengine.com/org/pacific-little-league-of-edmonds-lynnwood' },
  },
  {
    id: 'wa-ll-d10-federal-way',
    sourcePlatform: 'sportsengine',
    sourceConfig: { orgUrl: 'https://www.sportsengine.com/org/federal-way-national-little-league' },
  },
  // SportsConnect (confirmed correct)
  {
    id: 'wa-ll-d7-burien',
    sourcePlatform: 'sportsconnect',
    sourceConfig: { baseUrl: 'https://www.pacwestlittleleague.com/' },
  },
  // Custom website
  {
    id: 'wa-ll-d9-bellevue',
    sourcePlatform: 'custom',
    sourceConfig: { baseUrl: 'https://www.bellevueeastll.org/' },
  },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== WA Platform Corrections (GST-58) ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  let updated = 0;
  let errors = 0;

  for (const corr of corrections) {
    const ref = db.collection('leagues').doc(corr.id);
    const doc = await ref.get();

    if (!doc.exists) {
      console.log(`  ⚠ ${corr.id}: NOT FOUND in Firestore — skipping`);
      errors++;
      continue;
    }

    const data = doc.data();
    const oldPlatform = data.sourcePlatform || '(null)';
    console.log(`  ${corr.id}: "${data.name}"`);
    console.log(`    sourcePlatform: ${oldPlatform} → ${corr.sourcePlatform}`);
    console.log(`    sourceConfig: ${JSON.stringify(corr.sourceConfig)}`);

    if (!dryRun) {
      await ref.update({
        sourcePlatform: corr.sourcePlatform,
        sourceConfig: corr.sourceConfig,
      });
      console.log(`    ✓ Updated`);
    } else {
      console.log(`    (dry run — no changes)`);
    }
    updated++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  ${updated} leagues ${dryRun ? 'would be' : ''} updated`);
  if (errors > 0) console.log(`  ${errors} leagues not found`);
  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

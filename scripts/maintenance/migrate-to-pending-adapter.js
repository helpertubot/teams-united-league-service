/**
 * Migrate 25 Leagues to pending_adapter Status
 *
 * These 25 leagues have been validated as having existing platform adapters.
 * Move them from pending_config to pending_adapter status for integration.
 *
 * **Scope (25 leagues across 7 platforms):**
 * - SportsEngine (3): Billings Scorpions Lacrosse, Billings Softball Association, Run N Gun Billings
 * - LeagueApps (4): All Out Sports League, Excel Sports League, Hardwood Palace Youth League, Inglewood Youth Basketball & Football
 * - Blue Sombrero (3): Anaconda Little League, Montana Softball Association (Missoula), Poway Pop Warner
 * - SportNgin (3): SDYLA, Southbay Lacrosse, Tri-Valley Minor Hockey Association
 * - DaySmart (1): Oakland Ice Youth Hockey
 * - REC1 (1): Livingston Recreation Youth Basketball League
 * - CMS Platforms (4): Helena Youth Soccer Association, Rising Lion (Missoula), NorCal Elite Basketball Club, NorCal AYF/AYC Football
 *
 * Run on deploy VM:
 *   node scripts/maintenance/migrate-to-pending-adapter.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

// Exact league IDs to migrate (verified 2026-04-10)
const LEAGUE_IDS = [
  // SportsEngine (3)
  'billingsscorpions-lax-mt',
  'billings-softball-mt',
  'runngun-billings-mt',
  // LeagueApps (4)
  'alloutsports-basketball-ca',
  'esl-ca',
  'hardwood-palace-ca',
  'iybl-ca', // Inglewood Youth Basketball & Football
  // Blue Sombrero (3)
  'mt-ll-anaconda',
  'missoula-softball-mt', // Montana Softball Association (Missoula)
  'poway-popwarner-ca',
  // SportNgin (3)
  'sdyla-ca',
  'southbay-lacrosse-ca',
  'tri-valley-hockey-ca',
  // DaySmart (1)
  'oakland-ice-youth-ca',
  // REC1 (1)
  'livingston-rec-basketball-mt',
  // CMS (4)
  'mt-helena-soccer',
  'risinglion-missoula-mt',
  'norcal-elite-basketball-ca',
  'norcal-ayf-ca',
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== Migrate to pending_adapter Status ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // Fetch all target leagues
  const refs = LEAGUE_IDS.map(id => db.collection('leagues').doc(id));
  const docs = await db.getAll(...refs);

  const leaguesToUpdate = [];
  const notFound = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const id = LEAGUE_IDS[i];

    if (!doc.exists) {
      notFound.push(id);
      continue;
    }

    const data = doc.data();
    if (data.status !== 'pending_config') {
      console.log(`  ⚠️  ${id}: "${data.name}" (status: ${data.status}) — skipping (not pending_config)`);
      continue;
    }

    leaguesToUpdate.push({
      id: doc.id,
      name: data.name,
      sourcePlatform: data.sourcePlatform
    });
  }

  if (notFound.length > 0) {
    console.log(`⚠️  Not found (${notFound.length}):`);
    notFound.forEach(id => console.log(`  - ${id}`));
    console.log();
  }

  if (leaguesToUpdate.length === 0) {
    console.log('No matching leagues found in pending_config status.');
    return;
  }

  console.log(`Found ${leaguesToUpdate.length} leagues to migrate:\n`);

  let updated = 0;
  for (const league of leaguesToUpdate) {
    console.log(`  ${league.id}: "${league.name}" (${league.sourcePlatform || 'unknown'}) → pending_adapter`);

    if (!dryRun) {
      const docRef = db.collection('leagues').doc(league.id);
      await docRef.update({
        status: 'pending_adapter',
        updatedAt: new Date().toISOString()
      });
      updated++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Expected: 25`);
  console.log(`Found: ${leaguesToUpdate.length}`);
  console.log(`Updated: ${dryRun ? '0 (dry run)' : updated}`);
  console.log(`Not found: ${notFound.length}`);

  if (leaguesToUpdate.length !== 25) {
    console.warn(`\n⚠️  WARNING: Found ${leaguesToUpdate.length} leagues, expected 25`);
    console.warn('Verify that league IDs are correct.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

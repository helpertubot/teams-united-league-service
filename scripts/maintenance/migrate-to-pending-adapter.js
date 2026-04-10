/**
 * Migrate 25 Leagues to pending_adapter Status
 *
 * These 25 leagues have been validated as having existing platform adapters.
 * Move them from pending_config to pending_adapter status for integration.
 *
 * **Scope:**
 * - SportsEngine (3 leagues): Billings Scorpions Lacrosse (MT), Montana Softball Assoc (MT), Run N Gun Billings (MT)
 * - LeagueApps (4 leagues): All Out Sports League, Excel Sports League, Hardwood Palace Youth League, Inglewood Youth Sports (CA)
 * - Blue Sombrero (3 leagues): Anaconda Little League (MT), Missoula YF (MT), Poway Pop Warner (CA)
 * - SportNgin (3 leagues): SDYLA (CA), Southbay Lacrosse (CA), Tri-Valley Hockey (CA)
 * - DaySmart (1 league): Oakland Ice Youth Hockey (CA)
 * - REC1 (1 league): Livingston Recreation Youth Basketball League (MT)
 * - CMS Platforms (4 leagues): Helena YSA-Squarespace (MT), Rising Lion-Shopify (MT), NorCal Elite-Wix (CA), SCLA-RAMP (CA)
 *
 * Run on deploy VM:
 *   node scripts/maintenance/migrate-to-pending-adapter.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

// Map of league names to their source platforms
const LEAGUES_TO_MIGRATE = {
  'Billings Scorpions Lacrosse': 'sportsengine',
  'Montana Softball Association': 'sportsengine',
  'Run N Gun Billings': 'sportsengine',
  'All Out Sports League': 'leagueapps',
  'Excel Sports League': 'leagueapps',
  'Hardwood Palace Youth League': 'leagueapps',
  'Inglewood Youth Sports': 'leagueapps',
  'Anaconda Little League': 'blue_sombrero',
  'Missoula Youth Foundation': 'blue_sombrero',
  'Poway Pop Warner': 'blue_sombrero',
  'SDYLA': 'sportngin',
  'Southbay Lacrosse': 'sportngin',
  'Tri-Valley Hockey': 'sportngin',
  'Oakland Ice Youth Hockey': 'daysmart',
  'Livingston Recreation Youth Basketball League': 'rec1',
  'Helena YSA-Squarespace': 'cms',
  'Rising Lion-Shopify': 'cms',
  'NorCal Elite-Wix': 'cms',
  'SCLA-RAMP': 'cms'
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== Migrate to pending_adapter Status ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // Query all pending_config leagues
  const snap = await db.collection('leagues').where('status', '==', 'pending_config').get();

  if (snap.empty) {
    console.log('No pending_config leagues found.');
    return;
  }

  const leaguesToUpdate = [];

  // Find matching leagues by name
  for (const doc of snap.docs) {
    const data = doc.data();
    for (const [targetName, platform] of Object.entries(LEAGUES_TO_MIGRATE)) {
      // Fuzzy match: check if the league name contains or is similar to target name
      if (data.name.toLowerCase().includes(targetName.toLowerCase()) ||
          targetName.toLowerCase().includes(data.name.toLowerCase()) ||
          data.name.toLowerCase() === targetName.toLowerCase()) {
        leaguesToUpdate.push({
          id: doc.id,
          name: data.name,
          platform,
          sourcePlatform: data.sourcePlatform
        });
        break; // Only match once per league
      }
    }
  }

  if (leaguesToUpdate.length === 0) {
    console.log('No matching leagues found. Listing all pending_config leagues:');
    for (const doc of snap.docs) {
      console.log(`  ${doc.id}: "${doc.data().name}" (${doc.data().sourcePlatform || 'unknown'})`);
    }
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
  console.log(`Found: ${leaguesToUpdate.length}`);
  console.log(`Updated: ${dryRun ? '0 (dry run)' : updated}`);
  console.log(`Expected: 25`);

  if (leaguesToUpdate.length !== 25) {
    console.warn(`\n⚠️  WARNING: Found ${leaguesToUpdate.length} leagues, expected 25`);
    console.warn('Please verify league names match exactly.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

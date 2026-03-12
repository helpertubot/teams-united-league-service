/**
 * Register Falls Little League Baseball (Fall City, WA) as a SportsConnect league
 *
 * The league was previously only matched to a GameChanger org, but has active
 * standings on SportsConnect at:
 *   https://tshq.bluesombrero.com/Default.aspx?tabid=2462466
 *
 * Programs available: 2025 Baseball, 2026 Baseball, 2026 Softball
 *
 * Run on deploy VM:
 *   node scripts/register-fall-city-ll.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

const LEAGUE_DOC = {
  name: 'Falls Little League Baseball',
  sport: 'baseball',
  state: 'WA',
  region: 'Snoqualmie Valley',
  sourcePlatform: 'sportsconnect',
  sourceConfig: {
    baseUrl: 'https://tshq.bluesombrero.com',
    standingsTabId: '2462466',
    portalId: '29397',
    // No programs filter — adapter will collect all available programs
    // (2025 Baseball, 2026 Baseball, 2026 Softball)
  },
  status: 'active',
  autoUpdate: true,
  seasonStart: '2026-03-01',
  seasonEnd: '2026-07-31',
  staleDays: 14,
  monitorStatus: 'healthy',
  monitorNotes: 'Registered via register-fall-city-ll.js',
  createdAt: new Date().toISOString(),
};

const LEAGUE_ID = 'wa-fall-city-ll-sc';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== Register Falls Little League (SportsConnect) ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // Check if league already exists
  const existing = await db.collection('leagues').doc(LEAGUE_ID).get();
  if (existing.exists) {
    console.log(`League ${LEAGUE_ID} already exists:`);
    console.log(`  Name: ${existing.data().name}`);
    console.log(`  Status: ${existing.data().status}`);
    console.log(`  Platform: ${existing.data().sourcePlatform}`);
    console.log('\nNo changes made. Delete or rename the existing doc first if re-registering.');
    return;
  }

  console.log(`League ID: ${LEAGUE_ID}`);
  console.log(`Name: ${LEAGUE_DOC.name}`);
  console.log(`Platform: ${LEAGUE_DOC.sourcePlatform}`);
  console.log(`Base URL: ${LEAGUE_DOC.sourceConfig.baseUrl}`);
  console.log(`Standings Tab: ${LEAGUE_DOC.sourceConfig.standingsTabId}`);
  console.log(`Status: ${LEAGUE_DOC.status}`);
  console.log(`Season: ${LEAGUE_DOC.seasonStart} → ${LEAGUE_DOC.seasonEnd}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would create league document. Run without --dry-run to apply.');
    return;
  }

  await db.collection('leagues').doc(LEAGUE_ID).set(LEAGUE_DOC);
  console.log(`\n✓ Created league ${LEAGUE_ID} in Firestore`);
  console.log(`\nNext steps:`);
  console.log(`  1. Trigger a collection: curl -X POST <collectLeague-url> -d '{"leagueId":"${LEAGUE_ID}"}'`);
  console.log(`  2. Verify standings appear in Firestore`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

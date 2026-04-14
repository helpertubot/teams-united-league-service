/**
 * Regenerate league-coverage-status.json
 *
 * Builds the hosted coverage snapshot used by dashboard/trust layers and uploads it to GCS.
 *
 * Usage:
 *   node scripts/maintenance/regenerate-coverage-status.js [--dry-run]
 */

const path = require('path');
const { Firestore } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');
const { buildDashboardSnapshots } = require('../../lib/dashboard-snapshots');

const db = new Firestore();
const storage = new Storage();

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Regenerate league-coverage-status.json          ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Date: ${new Date().toISOString()}\n`);

  const allLeaguesSnap = await db.collection('leagues').get();
  const divSnap = await db.collection('divisions').select('leagueId').get();
  const divCounts = {};
  for (const doc of divSnap.docs) {
    const leagueId = doc.data().leagueId;
    divCounts[leagueId] = (divCounts[leagueId] || 0) + 1;
  }

  const allLeagues = allLeaguesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const snapshots = buildDashboardSnapshots(allLeagues, divCounts, {
    agent: 'maintenance',
    repoRoot: path.join(__dirname, '..', '..'),
  });

  console.log(`Total leagues: ${snapshots.coverageStatus.total}`);
  console.log(`Coverage combos: ${snapshots.coverageStatus.covered_combos}/${snapshots.coverageStatus.total_combos}`);
  console.log(`Coverage pct: ${snapshots.coverageStatus.coverage_pct}%`);
  console.log(`Gap count: ${snapshots.coverageStatus.gaps.length}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would upload league-coverage-status.json with:');
    console.log(`  ${JSON.stringify(snapshots.coverageStatus).length} bytes`);
    return;
  }

  const bucket = storage.bucket('tu-league-dashboard');
  const file = bucket.file('league-coverage-status.json');
  await file.save(JSON.stringify(snapshots.coverageStatus), {
    contentType: 'application/json',
    metadata: { cacheControl: 'public, max-age=300' },
  });

  console.log(`\n✓ Uploaded league-coverage-status.json (${JSON.stringify(snapshots.coverageStatus).length} bytes)`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

/**
 * Regenerate leagues-summary.json
 *
 * Generates the static leagues-summary.json file and uploads to GCS.
 * This is the same logic used by collectAll, but standalone.
 *
 * Usage:
 *   node scripts/maintenance/regenerate-summary.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');
const db = new Firestore();
const storage = new Storage();

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Regenerate leagues-summary.json                  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Date: ${new Date().toISOString()}\n`);

  // Fetch all leagues
  const allLeaguesSnap = await db.collection('leagues').get();
  console.log(`Total leagues: ${allLeaguesSnap.size}`);

  // Fetch division counts
  const divSnap = await db.collection('divisions').select('leagueId').get();
  const divCounts = {};
  for (const doc of divSnap.docs) {
    const lid = doc.data().leagueId;
    divCounts[lid] = (divCounts[lid] || 0) + 1;
  }
  console.log(`Total divisions: ${divSnap.size}`);

  const summaryLeagues = allLeaguesSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(l => l.status !== 'template')
    .map(l => ({
      id: l.id,
      name: l.name,
      sport: l.sport,
      state: l.state || l.states || '',
      platform: l.sourcePlatform,
      status: l.status,
      region: l.region || null,
      autoUpdate: l.autoUpdate || false,
      lastCollected: l.lastCollected || null,
      lastDataChange: l.lastDataChange || null,
      monitorStatus: l.monitorStatus || null,
      divisionCount: divCounts[l.id] || 0,
    }));

  const summary = {
    generatedAt: new Date().toISOString(),
    count: summaryLeagues.length,
    leagues: summaryLeagues,
  };

  // Stats
  const byStatus = {};
  const bySport = {};
  for (const l of summaryLeagues) {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    bySport[l.sport || 'unknown'] = (bySport[l.sport || 'unknown'] || 0) + 1;
  }

  console.log('\nBy Status:');
  for (const [s, c] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${c}`);
  }
  console.log('\nBy Sport:');
  for (const [s, c] of Object.entries(bySport).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${c}`);
  }

  const withDivisions = summaryLeagues.filter(l => l.divisionCount > 0);
  const activeWithDivisions = summaryLeagues.filter(l => l.status === 'active' && l.divisionCount > 0);
  const activeZeroDivisions = summaryLeagues.filter(l => l.status === 'active' && l.divisionCount === 0);
  console.log(`\nLeagues with divisions: ${withDivisions.length}`);
  console.log(`Active with divisions: ${activeWithDivisions.length}`);
  console.log(`Active with 0 divisions: ${activeZeroDivisions.length}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would upload leagues-summary.json with:');
    console.log(`  ${summaryLeagues.length} leagues, ${JSON.stringify(summary).length} bytes`);
    return;
  }

  // Upload to GCS
  const bucket = storage.bucket('tu-league-dashboard');
  const file = bucket.file('leagues-summary.json');
  await file.save(JSON.stringify(summary), {
    contentType: 'application/json',
    metadata: { cacheControl: 'public, max-age=300' },
  });

  console.log(`\n✓ Uploaded leagues-summary.json (${summaryLeagues.length} leagues, ${JSON.stringify(summary).length} bytes)`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

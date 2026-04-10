/**
 * Register Teton Valley Youth Lacrosse (TVYLA) — LeagueApps clubteams
 *
 * TVYLA uses LeagueApps' /clubteams module (not /leagues), so we configure
 * explicit program paths pointing to /clubteams/{id}/standings.
 *
 * Season: Spring 2026, April 6 – June 8
 * State: ID (Driggs / Teton Valley)
 * 10 age divisions across boys and girls programs.
 *
 * Usage:
 *   node scripts/setup/register-tvyla-lacrosse.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

const LEAGUE_ID = 'la-tvyla-lacrosse-id';

const LEAGUE_DOC = {
  name: 'Teton Valley Youth Lacrosse Association',
  sport: 'lacrosse',
  state: 'ID',
  region: 'Eastern ID',
  city: 'Driggs',
  sourcePlatform: 'leagueapps',
  sourceConfig: {
    baseUrl: 'https://tetonlax.leagueapps.com',
    orgSlug: 'tetonlax',
    // Explicit programs — TVYLA uses /clubteams, not /leagues
    programs: [
      // Boys divisions
      { path: '/clubteams/4832835/standings', name: 'K/2 Boys', ageGroup: 'K-2', gender: 'Boys' },
      { path: '/clubteams/4832836/standings', name: '3/4 Boys', ageGroup: '3-4', gender: 'Boys' },
      { path: '/clubteams/4832837/standings', name: '5/6 Boys', ageGroup: '5-6', gender: 'Boys' },
      { path: '/clubteams/4832838/standings', name: '7/8 Boys', ageGroup: '7-8', gender: 'Boys' },
      { path: '/clubteams/4832839/standings', name: 'High School Boys', ageGroup: 'HS', gender: 'Boys' },
      // Girls divisions
      { path: '/clubteams/4832846/standings', name: 'K/2 Girls', ageGroup: 'K-2', gender: 'Girls' },
      { path: '/clubteams/4832847/standings', name: '3/4 Girls', ageGroup: '3-4', gender: 'Girls' },
      { path: '/clubteams/4832848/standings', name: '5/6 Girls', ageGroup: '5-6', gender: 'Girls' },
      { path: '/clubteams/4832849/standings', name: '7/8 Girls', ageGroup: '7-8', gender: 'Girls' },
      { path: '/clubteams/4832851/standings', name: 'High School Girls', ageGroup: 'HS', gender: 'Girls' },
    ],
  },
  status: 'active',
  autoUpdate: true,
  seasonStart: '2026-04-06',
  seasonEnd: '2026-06-08',
  discoveredAt: new Date().toISOString(),
  discoveredBy: 'league-buildout-agent',
  discoveryConfig: {
    type: 'leagueapps',
    orgSlug: 'tetonlax',
    sourceUrl: 'https://tetonlax.leagueapps.com/',
    note: 'Uses /clubteams module, not /leagues. Auto-discover will not work; explicit programs required.',
  },
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('Registering TVYLA Lacrosse (ID) in Firestore');
  console.log(`League ID: ${LEAGUE_ID}`);
  console.log(`Programs: ${LEAGUE_DOC.sourceConfig.programs.length} divisions`);
  console.log(`Dry run: ${dryRun}\n`);

  // Check if already exists
  const existing = await db.collection('leagues').doc(LEAGUE_ID).get();
  if (existing.exists) {
    console.log('⚠️  League already exists in Firestore. Updating config...');
    if (!dryRun) {
      await db.collection('leagues').doc(LEAGUE_ID).update(LEAGUE_DOC);
      console.log('✅ Updated existing league config');
    } else {
      console.log('[DRY RUN] Would update existing league config');
    }
    return;
  }

  if (dryRun) {
    console.log('[DRY RUN] Would create league document:');
    console.log(JSON.stringify(LEAGUE_DOC, null, 2));
    return;
  }

  await db.collection('leagues').doc(LEAGUE_ID).set(LEAGUE_DOC);
  console.log(`✅ League registered: ${LEAGUE_ID}`);
  console.log(`   Name: ${LEAGUE_DOC.name}`);
  console.log(`   Sport: ${LEAGUE_DOC.sport}`);
  console.log(`   State: ${LEAGUE_DOC.state}`);
  console.log(`   Platform: ${LEAGUE_DOC.sourcePlatform}`);
  console.log(`   Programs: ${LEAGUE_DOC.sourceConfig.programs.length}`);
  console.log(`   Season: ${LEAGUE_DOC.seasonStart} to ${LEAGUE_DOC.seasonEnd}`);
  console.log(`   Status: ${LEAGUE_DOC.status}`);
  console.log('\nNote: Standings not yet posted (season started April 6).');
  console.log('Daily collectAll will pick up standings once games are played.');
}

main().catch(err => {
  console.error('Registration failed:', err.message);
  process.exit(1);
});

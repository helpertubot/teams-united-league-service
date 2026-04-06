/**
 * Fix ALL Season Dates — Populate missing seasonStart/seasonEnd for active leagues
 *
 * Sets season dates based on sport, state, platform, and league naming patterns.
 * Only updates leagues that are currently missing BOTH seasonStart AND seasonEnd.
 *
 * Usage:
 *   node scripts/maintenance/fix-all-season-dates.js [--dry-run] [--json]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

// Current year context
const YEAR = 2026;

// ── Default season windows by sport and type ──

const SEASON_DEFAULTS = {
  baseball: {
    // Little League spring season
    ll_spring: { start: `${YEAR}-03-01`, end: `${YEAR}-06-30` },
    // Little League all-stars / summer
    ll_summer: { start: `${YEAR}-06-15`, end: `${YEAR}-08-15` },
    // Fall ball
    ll_fall: { start: `${YEAR - 1}-09-01`, end: `${YEAR - 1}-11-15` },
    // Professional / year-round
    pro: { start: `${YEAR}-03-15`, end: `${YEAR}-09-30` },
    // Default (spring)
    default: { start: `${YEAR}-03-01`, end: `${YEAR}-06-30` },
  },
  softball: {
    default: { start: `${YEAR}-03-01`, end: `${YEAR}-06-30` },
  },
  soccer: {
    // Club soccer (cross-season, fall through spring)
    club: { start: `${YEAR - 1}-09-01`, end: `${YEAR}-06-30` },
    // Spring competitive
    spring: { start: `${YEAR}-01-15`, end: `${YEAR}-06-15` },
    // Fall season
    fall: { start: `${YEAR}-09-01`, end: `${YEAR}-11-30` },
    // Year-round (e.g., RCL)
    yearround: { start: `${YEAR - 1}-09-01`, end: `${YEAR}-06-15` },
    // Default
    default: { start: `${YEAR - 1}-09-01`, end: `${YEAR}-06-30` },
  },
  hockey: {
    default: { start: `${YEAR - 1}-10-01`, end: `${YEAR}-04-30` },
  },
  lacrosse: {
    default: { start: `${YEAR}-03-01`, end: `${YEAR}-06-30` },
  },
};

/**
 * Determine the appropriate season window for a league
 */
function getSeasonDates(league) {
  const sport = (league.sport || '').toLowerCase();
  const name = (league.name || '').toLowerCase();
  const id = (league.id || '').toLowerCase();
  const sportDefaults = SEASON_DEFAULTS[sport];

  if (!sportDefaults) return SEASON_DEFAULTS.soccer?.default || null;

  if (sport === 'baseball') {
    // Professional leagues
    if (name.includes('professional') || name.includes('atlantic league') ||
        name.includes('american association') || name.includes('frontier league')) {
      return sportDefaults.pro;
    }
    // Fall ball detection
    if (name.includes('fall') || id.includes('fall')) {
      return sportDefaults.ll_fall;
    }
    // Summer / all-stars
    if (name.includes('summer') || name.includes('all-star') || name.includes('all star')) {
      return sportDefaults.ll_summer;
    }
    return sportDefaults.default;
  }

  if (sport === 'soccer') {
    // Spring leagues
    if (name.includes('spring') || id.includes('spring')) {
      return sportDefaults.spring;
    }
    // Fall leagues
    if (name.includes('fall') || name.includes('autumn') || id.includes('fall')) {
      return sportDefaults.fall;
    }
    // Club / year-round
    if (name.includes('club') || name.includes('premier') || name.includes('competitive') ||
        name.includes('rcl') || name.includes('ecnl')) {
      return sportDefaults.yearround;
    }
    return sportDefaults.default;
  }

  return sportDefaults.default;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const jsonOutput = args.includes('--json');

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Fix All Season Dates                            ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Options: dryRun=${dryRun}`);

  // Get all active leagues
  const snap = await db.collection('leagues').where('status', '==', 'active').get();
  const leagues = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  let updated = 0;
  let skipped = 0;
  let alreadySet = 0;
  const results = [];

  for (const league of leagues) {
    // Skip if both dates already set
    if (league.seasonStart && league.seasonEnd) {
      alreadySet++;
      continue;
    }

    const dates = getSeasonDates(league);
    if (!dates) {
      skipped++;
      results.push({ id: league.id, status: 'skipped', reason: 'no defaults for sport: ' + league.sport });
      continue;
    }

    const update = {};
    if (!league.seasonStart) update.seasonStart = dates.start;
    if (!league.seasonEnd) update.seasonEnd = dates.end;

    if (Object.keys(update).length === 0) {
      alreadySet++;
      continue;
    }

    console.log(`${league.id} (${league.sport}): ${update.seasonStart || league.seasonStart} → ${update.seasonEnd || league.seasonEnd}`);

    if (!dryRun) {
      await db.collection('leagues').doc(league.id).update(update);
    }

    updated++;
    results.push({ id: league.id, sport: league.sport, ...update });
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total active leagues: ${leagues.length}`);
  console.log(`Already had dates: ${alreadySet}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);

  if (jsonOutput) {
    console.log('\n' + JSON.stringify(results, null, 2));
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

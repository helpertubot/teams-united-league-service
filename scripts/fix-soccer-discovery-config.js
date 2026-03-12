/**
 * Fix Soccer Discovery Config — Add discoveryConfig for auto-season discovery
 *
 * The season-monitor uses discoveryConfig to auto-discover new seasons:
 *   - GotSport: discoveryConfig.orgUrl — page listing org events (links with /events/ in href)
 *   - TGS:      discoveryConfig.seasonListUrl — page listing season IDs
 *
 * Without discoveryConfig, the season monitor can only do basic reachability
 * checks and cannot find newer seasons when current ones expire.
 *
 * This script adds discoveryConfig to all GotSport and TGS soccer leagues
 * that don't already have one.
 *
 * GotSport WPL org URLs:
 *   The WPL website (wpl-soccer.com) links to their GotSport events.
 *   We use the leagues overview page which contains links to all GotSport events.
 *
 * TGS/ECNL org URLs:
 *   ECNL standings pages on theecnl.com — the TGS adapter already auto-detects
 *   seasons from these pages, but discoveryConfig.seasonListUrl helps the
 *   season monitor discover new seasons independently.
 *
 * Run on deploy VM:
 *   node scripts/fix-soccer-discovery-config.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

// Discovery configs to apply
const DISCOVERY_CONFIGS = {
  // ── GotSport WPL leagues ──
  // All WPL leagues share the same org — the WPL leagues page links to GotSport events
  'ewsl-wa': {
    orgUrl: 'https://wpl-soccer.com/leagues/',
    orgName: 'Washington Premier League (WPL)',
    notes: 'EWSL is run under WPL umbrella. Org page lists all GotSport events.',
  },
  'wpl-girls-hs-spring': {
    orgUrl: 'https://wpl-soccer.com/leagues/',
    orgName: 'Washington Premier League (WPL)',
  },
  'wpl-spring-1114u': {
    orgUrl: 'https://wpl-soccer.com/leagues/',
    orgName: 'Washington Premier League (WPL)',
  },
  'wpl-wwa-dev-spring': {
    orgUrl: 'https://wpl-soccer.com/leagues/',
    orgName: 'Washington Premier League (WPL)',
  },
  // Existing GotSport WPL leagues that may already be in Firestore
  'wpl-boys-hs-fall': {
    orgUrl: 'https://wpl-soccer.com/leagues/',
    orgName: 'Washington Premier League (WPL)',
  },
  'wpl-ewa-dev-spring': {
    orgUrl: 'https://wpl-soccer.com/leagues/',
    orgName: 'Washington Premier League (WPL)',
  },
  'wpl-spring-npl': {
    orgUrl: 'https://wpl-soccer.com/leagues/',
    orgName: 'Washington Premier League (WPL)',
  },
  'wa-cup-boys-hs': {
    orgUrl: 'https://wpl-soccer.com/leagues/',
    orgName: 'Washington Premier League (WPL)',
  },

  // ── TGS/ECNL leagues ──
  // ECNL standings pages contain data-org-season-id that changes per season.
  // The TGS adapter reads these automatically, but the season monitor can also
  // use seasonListUrl for independent discovery.
  'ecnl-boys': {
    seasonListUrl: 'https://theecnl.com/sports/2023/8/8/ECNLB_0808235537.aspx',
    orgName: 'ECNL Boys',
  },
  'ecnl-girls': {
    seasonListUrl: 'https://theecnl.com/sports/2023/8/8/ECNLG_0808235238.aspx',
    orgName: 'ECNL Girls',
  },
  'ecnl-rl-boys': {
    seasonListUrl: 'https://theecnl.com/sports/2023/8/8/ECNLRLB_0808235620.aspx',
    orgName: 'ECNL Regional League Boys',
  },
  'ecnl-rl-girls': {
    seasonListUrl: 'https://theecnl.com/sports/2023/8/8/ECNLRLG_0808235356.aspx',
    orgName: 'ECNL Regional League Girls',
  },
  'pre-ecnl-boys': {
    seasonListUrl: 'https://theecnl.com/sports/2023/8/8/Pre-ECNLB_0808230956.aspx',
    orgName: 'Pre-ECNL Boys',
  },
  'pre-ecnl-girls': {
    seasonListUrl: 'https://theecnl.com/sports/2023/8/8/Pre-ECNLG_0808230711.aspx',
    orgName: 'Pre-ECNL Girls',
  },
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== Fix Soccer Discovery Config ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const [leagueId, config] of Object.entries(DISCOVERY_CONFIGS)) {
    const doc = await db.collection('leagues').doc(leagueId).get();
    if (!doc.exists) {
      console.log(`  - ${leagueId}: not found in Firestore (skipping)`);
      notFound++;
      continue;
    }

    const data = doc.data();

    // Check if discoveryConfig already exists and has the same values
    const existing = data.discoveryConfig || {};
    const hasOrgUrl = config.orgUrl && existing.orgUrl === config.orgUrl;
    const hasSeasonListUrl = config.seasonListUrl && existing.seasonListUrl === config.seasonListUrl;

    if ((config.orgUrl && hasOrgUrl) || (config.seasonListUrl && hasSeasonListUrl)) {
      console.log(`  ~ ${leagueId}: discoveryConfig already set (skipping)`);
      skipped++;
      continue;
    }

    // Build the new discoveryConfig (merge with existing)
    const newDiscoveryConfig = { ...existing, ...config };
    delete newDiscoveryConfig.notes; // notes is for logging, not storage

    console.log(`  + ${leagueId}: "${data.name}"`);
    if (config.orgUrl) console.log(`    orgUrl: ${config.orgUrl}`);
    if (config.seasonListUrl) console.log(`    seasonListUrl: ${config.seasonListUrl}`);
    if (config.notes) console.log(`    (${config.notes})`);

    if (!dryRun) {
      await doc.ref.update({ discoveryConfig: newDiscoveryConfig });
    }
    updated++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${dryRun ? `0 (dry run, ${updated} would update)` : updated}`);
  console.log(`Already configured: ${skipped}`);
  console.log(`Not found in Firestore: ${notFound}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

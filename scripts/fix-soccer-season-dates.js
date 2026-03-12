/**
 * Fix Soccer Season Dates — Update with verified dates from platform event pages
 *
 * The wa-soccer-expansion.js script had estimated season dates that need
 * correction based on actual platform event pages.
 *
 * Verified dates (March 2026):
 *
 * GotSport (WPL) leagues:
 *   wpl-girls-hs-spring  — Jan 3 – Apr 19, 2026 (confirmed from GotSport event 48496)
 *   wpl-spring-1114u     — Feb 7 – May 3, 2026   (confirmed from WPL website + 2025 precedent)
 *   wpl-wwa-dev-spring   — Feb 21 – Apr 26, 2026 (spring portion; full event Nov 3 – Apr 26)
 *   ewsl-wa              — Sep 1 – Nov 10, 2025  (fall 2025 only, already past season end)
 *
 * SportsAffinity leagues:
 *   rcl-wa               — Sep 1, 2025 – Jun 15, 2026 (unchanged, cross-season league)
 *   ssul-wa              — Apr 18 – Jun 30, 2026      (unchanged, spring-only)
 *
 * Demosphere:
 *   npsl-wa              — Sep 1, 2025 – Jun 30, 2026 (updated: fall 2025 data was stale,
 *                           but league runs fall-through-spring annually)
 *
 * TGS/ECNL leagues (if present):
 *   ecnl-boys, ecnl-girls, etc. — Aug 22, 2025 – Jun 30, 2026 (regular season)
 *
 * Run on deploy VM:
 *   node scripts/fix-soccer-season-dates.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

// Season date corrections — only leagues that need updating
const DATE_FIXES = {
  'wpl-girls-hs-spring': {
    seasonStart: '2026-01-03',
    seasonEnd: '2026-04-19',
    notes: 'Girls HS winter/spring 2026. 13 divisions across NPL, Classic, Copa tiers. Dates verified from GotSport event 48496.',
  },
  'wpl-spring-1114u': {
    seasonStart: '2026-02-07',
    seasonEnd: '2026-05-03',
    notes: 'Spring 2026, 57 groups. Full NPL + Classic + Copa coverage for 11U-14U boys and girls. Starts Feb 7 per WPL website.',
  },
  'wpl-wwa-dev-spring': {
    seasonStart: '2026-02-21',
    seasonEnd: '2026-04-26',
    notes: 'Western WA Development League for U8-U10. 27 groups. Spring portion: Feb 21 – Apr 26, 2026.',
  },
  'npsl-wa': {
    seasonStart: '2025-09-01',
    seasonEnd: '2026-06-30',
    notes: 'Competitive league for 11 WYS associations. U9-U19. Annual fall-through-spring season. standingsSlug will need updating each season.',
  },
  // TGS/ECNL leagues — update if they exist in Firestore
  'ecnl-boys': {
    seasonStart: '2025-08-22',
    seasonEnd: '2026-06-30',
    notes: 'ECNL Boys 2025-26 regular season. Auto-season detection via TGS adapter. 15 conferences.',
  },
  'ecnl-girls': {
    seasonStart: '2025-08-22',
    seasonEnd: '2026-06-30',
    notes: 'ECNL Girls 2025-26 regular season. Auto-season detection via TGS adapter. 10 conferences.',
  },
  'ecnl-rl-boys': {
    seasonStart: '2025-08-22',
    seasonEnd: '2026-06-30',
    notes: 'ECNL Regional League Boys 2025-26. Auto-season detection via TGS adapter.',
  },
  'ecnl-rl-girls': {
    seasonStart: '2025-08-22',
    seasonEnd: '2026-06-30',
    notes: 'ECNL Regional League Girls 2025-26. Auto-season detection via TGS adapter.',
  },
  'pre-ecnl-boys': {
    seasonStart: '2025-09-01',
    seasonEnd: '2026-05-31',
    notes: 'Pre-ECNL Boys 2025-26. Auto-season detection via TGS adapter.',
  },
  'pre-ecnl-girls': {
    seasonStart: '2025-09-01',
    seasonEnd: '2026-05-31',
    notes: 'Pre-ECNL Girls 2025-26. Auto-season detection via TGS adapter.',
  },
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== Fix Soccer Season Dates ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const [leagueId, fix] of Object.entries(DATE_FIXES)) {
    const doc = await db.collection('leagues').doc(leagueId).get();
    if (!doc.exists) {
      console.log(`  - ${leagueId}: not found in Firestore (skipping)`);
      notFound++;
      continue;
    }

    const current = doc.data();
    const changes = {};

    if (current.seasonStart !== fix.seasonStart) {
      changes.seasonStart = fix.seasonStart;
    }
    if (current.seasonEnd !== fix.seasonEnd) {
      changes.seasonEnd = fix.seasonEnd;
    }
    if (fix.notes && current.notes !== fix.notes) {
      changes.notes = fix.notes;
    }

    if (Object.keys(changes).length === 0) {
      console.log(`  ~ ${leagueId}: already correct (${current.seasonStart} – ${current.seasonEnd})`);
      skipped++;
      continue;
    }

    console.log(`  ${leagueId}: "${current.name}"`);
    if (changes.seasonStart) console.log(`    seasonStart: ${current.seasonStart || 'null'} → ${changes.seasonStart}`);
    if (changes.seasonEnd) console.log(`    seasonEnd:   ${current.seasonEnd || 'null'} → ${changes.seasonEnd}`);

    if (!dryRun) {
      await doc.ref.update(changes);
    }
    updated++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${dryRun ? `0 (dry run, ${updated} would update)` : updated}`);
  console.log(`Already correct: ${skipped}`);
  console.log(`Not found: ${notFound}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

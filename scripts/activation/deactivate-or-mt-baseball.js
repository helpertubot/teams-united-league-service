/**
 * Deactivate OR/MT Baseball Leagues — No public standings available
 *
 * These 2 GameChanger leagues have no discoverable standings on any supported platform:
 *   - or-ll-sw-portland (Southwest Portland LL) — SportsConnect site, no standings tab
 *   - mt-ll-riverside (Riverside LL) — SportsConnect site, no standings tab
 *
 * Investigation (GST-24):
 *   - Both websites use SportsConnect (Stack Sports), not GameChanger
 *   - Neither site has a standings/scores page (checked all tabids)
 *   - No GameChanger org pages found via web search
 *   - QA confirmed: likely use GC at team level only (coaches scoring games),
 *     not org level (no centralized league standings in GC)
 *
 * Run on deploy VM:
 *   node scripts/activation/deactivate-or-mt-baseball.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

const NOW = new Date().toISOString();

const DEACTIVATE = [
  {
    id: 'or-ll-sw-portland',
    reason: 'No public standings page. Website (swpll.org) is SportsConnect with no standings tab. No GC org found. Deactivated Apr 2026.',
  },
  {
    id: 'mt-ll-riverside',
    reason: 'No public standings page. Website (riversidell.org) is SportsConnect with no standings tab. No GC org found. Deactivated Apr 2026.',
  },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== Deactivate OR/MT Baseball Leagues ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  let deactivated = 0;
  let errors = 0;

  for (const { id, reason } of DEACTIVATE) {
    try {
      const doc = await db.collection('leagues').doc(id).get();
      if (!doc.exists) {
        console.log(`  ✗ ${id} — NOT FOUND in Firestore`);
        errors++;
        continue;
      }

      const data = doc.data();
      console.log(`  ${id} — ${data.name} (${data.sourcePlatform}, currently ${data.status})`);

      if (data.status === 'deactivated_phase1') {
        console.log(`    Already deactivated, skipping`);
        continue;
      }

      const updates = {
        status: 'deactivated_phase1',
        autoUpdate: false,
        monitorStatus: 'dormant',
        monitorNotes: reason,
        deactivatedAt: NOW,
        deactivatedBy: 'deactivate-or-mt-baseball',
      };

      if (dryRun) {
        console.log(`    [DRY RUN] Would deactivate: ${reason}`);
      } else {
        await db.collection('leagues').doc(id).update(updates);
        console.log(`    ✓ Deactivated: ${reason}`);
      }
      deactivated++;
    } catch (err) {
      console.error(`  ✗ ${id} — ERROR: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Deactivated: ${deactivated}`);
  console.log(`  Errors: ${errors}`);
  if (dryRun) console.log(`  (DRY RUN — no changes written)`);
}

main().catch(console.error);

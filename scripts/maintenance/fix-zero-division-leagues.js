/**
 * Fix Zero-Division Active Leagues
 *
 * After running diagnose-zero-division-leagues.js, this script fixes leagues
 * that are marked 'active' but have 0 divisions by:
 *
 * 1. Leagues with valid config → trigger collection (same as diagnose --collect)
 * 2. SportsConnect leagues missing tabId → set status to pending_tabid
 * 3. GotSport leagues missing groups → set status to pending_groups
 * 4. GameChanger leagues missing orgId → set status to pending_config
 * 5. Leagues missing platform → set status to pending_platform
 * 6. Leagues that have NEVER been collected → attempt first collection
 *
 * Usage:
 *   node scripts/maintenance/fix-zero-division-leagues.js [--dry-run] [--fix-status] [--collect] [--platform=X]
 *
 * Options:
 *   --dry-run       Show what would happen, don't write
 *   --fix-status    Fix status of misconfigured active leagues (→ pending_*)
 *   --collect       Trigger collection for valid-config leagues
 *   --platform=X    Only process one platform
 *   --limit=N       Limit collection to N leagues
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Determine the correct pending status for an invalid league
function getCorrectStatus(league) {
  const platform = league.sourcePlatform;
  const config = league.sourceConfig || {};

  if (!platform) return 'pending_platform';

  switch (platform) {
    case 'sportsconnect':
      if (!config.standingsTabId) return 'pending_tabid';
      if (!config.programs || config.programs.length === 0) return 'pending_config';
      return null; // config looks valid

    case 'gotsport':
      if (!config.groups || config.groups.length === 0) return 'pending_groups';
      if (!config.leagueEventId) return 'pending_config';
      return null;

    case 'gamechanger':
      if (!config.orgId) return 'pending_config';
      return null;

    case 'sportsaffinity':
      if (!config.organizationId || !config.seasonGuid) return 'pending_config';
      return null;

    case 'sportsaffinity-asp':
      if (!config.organizationId) return 'pending_config';
      return null;

    case 'tgs':
      if (!config.eventId) return 'pending_config';
      return null;

    case 'demosphere':
      if (!config.baseUrl || !config.divisions || config.divisions.length === 0) return 'pending_config';
      return null;

    case 'pointstreak':
      if (!config.leagueId || !config.seasonId) return 'pending_config';
      return null;

    case 'leagueapps':
      if (!config.baseUrl) return 'pending_config';
      return null;

    default:
      return 'pending_adapter';
  }
}

function isConfigValid(league) {
  return getCorrectStatus(league) === null;
}

function slugify(text) {
  return (text || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 100);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fixStatus = args.includes('--fix-status');
  const doCollect = args.includes('--collect');
  const platformFilter = args.find(a => a.startsWith('--platform='))?.split('=')[1];
  const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg) : Infinity;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Fix Zero-Division Active Leagues                 ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Options: dryRun=${dryRun}, fixStatus=${fixStatus}, collect=${doCollect}, platform=${platformFilter || 'all'}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  // 1. Fetch all active leagues
  const leaguesSnap = await db.collection('leagues').where('status', '==', 'active').get();
  console.log(`Total active leagues: ${leaguesSnap.size}`);

  // 2. Fetch division counts
  const divsSnap = await db.collection('divisions').select('leagueId').get();
  const divCounts = {};
  divsSnap.docs.forEach(d => {
    const lid = d.data().leagueId;
    divCounts[lid] = (divCounts[lid] || 0) + 1;
  });

  // 3. Find zero-division leagues
  const zeroDivLeagues = [];
  leaguesSnap.docs.forEach(d => {
    const data = d.data();
    const count = divCounts[d.id] || 0;
    if (count === 0) {
      const league = { id: d.id, ...data };
      if (!platformFilter || league.sourcePlatform === platformFilter) {
        zeroDivLeagues.push(league);
      }
    }
  });

  console.log(`Zero-division active leagues (filtered): ${zeroDivLeagues.length}\n`);

  if (zeroDivLeagues.length === 0) {
    console.log('Nothing to fix!');
    return;
  }

  // 4. Categorize
  const readyToCollect = [];      // Valid config, just needs collection
  const needsStatusFix = [];      // Wrong status (active but missing required config)
  const neverCollected = [];      // Has lastCollected === null/undefined

  for (const league of zeroDivLeagues) {
    if (isConfigValid(league)) {
      readyToCollect.push(league);
      if (!league.lastCollected) neverCollected.push(league);
    } else {
      const correctStatus = getCorrectStatus(league);
      needsStatusFix.push({ league, correctStatus });
    }
  }

  console.log(`Ready to collect (valid config): ${readyToCollect.length}`);
  console.log(`  Never collected before: ${neverCollected.length}`);
  console.log(`Needs status fix: ${needsStatusFix.length}`);

  // 5. Fix statuses
  if (needsStatusFix.length > 0) {
    console.log('\n═══ STATUS FIXES ═══');
    const statusGroups = {};
    for (const { league, correctStatus } of needsStatusFix) {
      if (!statusGroups[correctStatus]) statusGroups[correctStatus] = [];
      statusGroups[correctStatus].push(league);
    }

    for (const [status, leagues] of Object.entries(statusGroups)) {
      console.log(`\n  → ${status} (${leagues.length} leagues):`);
      for (const l of leagues) {
        console.log(`    ${l.id} — ${l.name} [${l.sourcePlatform || 'none'}]`);
      }
    }

    if (fixStatus && !dryRun) {
      console.log('\nApplying status fixes...');
      let fixed = 0;
      for (const { league, correctStatus } of needsStatusFix) {
        await db.collection('leagues').doc(league.id).update({
          status: correctStatus,
          previousStatus: 'active',
          statusFixedAt: new Date().toISOString(),
          statusFixReason: 'zero-division-fix: active with incomplete config',
        });
        console.log(`  ✓ ${league.id} → ${correctStatus}`);
        fixed++;
      }
      console.log(`\nFixed ${fixed} league statuses.`);
    } else if (fixStatus && dryRun) {
      console.log('\n[DRY RUN] Would fix statuses for:');
      for (const { league, correctStatus } of needsStatusFix) {
        console.log(`  ${league.id}: active → ${correctStatus}`);
      }
    } else {
      console.log('\n  ℹ Run with --fix-status to apply these fixes');
    }
  }

  // 6. Collect leagues
  if (doCollect && readyToCollect.length > 0) {
    const toCollect = readyToCollect.slice(0, limit);
    console.log(`\n═══ COLLECTING ${toCollect.length} LEAGUES ═══`);

    if (dryRun) {
      console.log('[DRY RUN] Would collect:');
      for (const l of toCollect) {
        console.log(`  ${l.id} — ${l.name} [${l.sourcePlatform}]`);
      }
      return;
    }

    const { getAdapter } = require('../../registry');
    const { hashStandings } = require('../../season-monitor');
    let llAges;
    try {
      llAges = require('../../lib/little-league-ages');
    } catch (e) {
      llAges = { resolveLLAgeGroup: () => null, isLittleLeague: () => false };
    }

    let success = 0, failed = 0, empty = 0;
    const errors = [];

    for (let i = 0; i < toCollect.length; i++) {
      const league = toCollect[i];
      console.log(`\n[${i + 1}/${toCollect.length}] ${league.id} (${league.sourcePlatform})...`);

      try {
        const adapter = getAdapter(league.sourcePlatform);
        const start = Date.now();
        const result = await adapter.collectStandings(league);
        const { divisions, standings } = result;
        const ms = Date.now() - start;

        if (divisions.length === 0) {
          console.log(`  ⚠ 0 divisions returned (${ms}ms)`);
          empty++;
          continue;
        }

        // Post-process LL ages
        if (llAges.isLittleLeague(league.name)) {
          for (const div of divisions) {
            if (!div.ageGroup || div.ageGroup === 'unknown') {
              const resolved = llAges.resolveLLAgeGroup(div.level, div.name);
              if (resolved) div.ageGroup = resolved;
            }
          }
        }

        // Write divisions
        for (let j = 0; j < divisions.length; j += 400) {
          const batch = db.batch();
          const chunk = divisions.slice(j, j + 400);
          for (const div of chunk) {
            batch.set(db.collection('divisions').doc(div.id), div, { merge: true });
          }
          await batch.commit();
        }

        // Write standings
        for (let j = 0; j < standings.length; j += 400) {
          const batch = db.batch();
          const chunk = standings.slice(j, j + 400);
          for (const s of chunk) {
            const sid = `${s.divisionId}-${slugify(s.teamName)}`;
            batch.set(db.collection('standings').doc(sid), s, { merge: true });
          }
          await batch.commit();
        }

        // Update league metadata
        const currentHash = hashStandings(standings);
        await db.collection('leagues').doc(league.id).update({
          lastStandingsHash: currentHash,
          lastCollected: new Date().toISOString(),
          lastDataChange: new Date().toISOString(),
        });

        console.log(`  ✓ ${divisions.length} divs, ${standings.length} standings (${ms}ms)`);
        success++;

        // Handle GC rotation
        if (result._rotatedToOrgId && league.sourcePlatform === 'gamechanger') {
          await db.collection('leagues').doc(league.id).update({
            'sourceConfig.orgId': result._rotatedToOrgId,
            'sourceConfig.previousOrgId': league.sourceConfig.orgId,
          });
          console.log(`  ↻ GC rotated to org ${result._rotatedToOrgId}`);
        }

      } catch (err) {
        console.log(`  ✗ ${err.message}`);
        errors.push({ id: league.id, error: err.message });
        failed++;
      }

      await sleep(1000);
    }

    console.log('\n═══ COLLECTION SUMMARY ═══');
    console.log(`  Success: ${success}`);
    console.log(`  Empty (0 divs): ${empty}`);
    console.log(`  Failed: ${failed}`);

    if (errors.length > 0) {
      console.log('\n--- Errors ---');
      for (const e of errors) {
        console.log(`  ${e.id}: ${e.error}`);
      }
    }
  } else if (!doCollect && readyToCollect.length > 0) {
    console.log(`\n  ℹ ${readyToCollect.length} leagues have valid config. Run with --collect to trigger collection.`);
  }

  // 7. Final summary
  console.log('\n═══ NEXT STEPS ═══');
  if (needsStatusFix.length > 0 && !fixStatus) {
    console.log(`  1. Run with --fix-status to correct ${needsStatusFix.length} league statuses`);
  }
  const pendingTabIds = needsStatusFix.filter(n => n.correctStatus === 'pending_tabid');
  const pendingGroups = needsStatusFix.filter(n => n.correctStatus === 'pending_groups');
  const pendingConfigs = needsStatusFix.filter(n => n.correctStatus === 'pending_config');

  if (pendingTabIds.length > 0) {
    console.log(`  2. Run resolve-all-pending.js --fix --category=pending_tabid for ${pendingTabIds.length} SC leagues`);
  }
  if (pendingGroups.length > 0) {
    console.log(`  3. Run discover-and-activate-gotsport.js for ${pendingGroups.length} GotSport leagues`);
  }
  if (pendingConfigs.length > 0) {
    console.log(`  4. Run resolve-all-pending.js --fix --category=pending_config for ${pendingConfigs.length} leagues`);
  }
  if (readyToCollect.length > 0 && !doCollect) {
    console.log(`  5. Run this script with --collect to trigger ${readyToCollect.length} collections`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

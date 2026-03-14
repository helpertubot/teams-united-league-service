/**
 * Diagnose Zero-Division Active Leagues
 *
 * Finds all active leagues that have 0 divisions in Firestore, categorizes them
 * by platform and likely issue, and optionally triggers collection for leagues
 * that appear properly configured.
 *
 * Usage:
 *   node scripts/maintenance/diagnose-zero-division-leagues.js [--collect] [--dry-run] [--platform=X] [--json]
 *
 * Options:
 *   --collect     Trigger collectLeague for leagues with valid config (sequential)
 *   --dry-run     Show what would be collected, but don't actually collect
 *   --platform=X  Only process one platform (gamechanger, sportsconnect, gotsport, etc.)
 *   --json        Output JSON report at end
 *   --limit=N     Limit collection attempts to N leagues (default: all)
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
// CONFIG VALIDATION per platform
// ═══════════════════════════════════════════════════════════════

function validateConfig(league) {
  const platform = league.sourcePlatform;
  const config = league.sourceConfig || {};
  const issues = [];

  if (!platform) {
    return { valid: false, issues: ['Missing sourcePlatform'] };
  }

  switch (platform) {
    case 'gamechanger':
      if (!config.orgId) issues.push('Missing sourceConfig.orgId');
      break;

    case 'sportsconnect':
      if (!config.baseUrl) issues.push('Missing sourceConfig.baseUrl');
      if (!config.standingsTabId) issues.push('Missing sourceConfig.standingsTabId');
      if (!config.programs || config.programs.length === 0) issues.push('Missing sourceConfig.programs[]');
      break;

    case 'gotsport':
      if (!config.leagueEventId) issues.push('Missing sourceConfig.leagueEventId');
      if (!config.groups || config.groups.length === 0) issues.push('Missing sourceConfig.groups[]');
      break;

    case 'sportsaffinity':
      if (!config.organizationId) issues.push('Missing sourceConfig.organizationId');
      if (!config.seasonGuid) issues.push('Missing sourceConfig.seasonGuid');
      break;

    case 'sportsaffinity-asp':
      if (!config.organizationId) issues.push('Missing sourceConfig.organizationId');
      break;

    case 'tgs':
      if (!config.eventId) issues.push('Missing sourceConfig.eventId');
      break;

    case 'demosphere':
      if (!config.baseUrl) issues.push('Missing sourceConfig.baseUrl');
      if (!config.divisions || config.divisions.length === 0) issues.push('Missing sourceConfig.divisions[]');
      break;

    case 'pointstreak':
      if (!config.leagueId) issues.push('Missing sourceConfig.leagueId');
      if (!config.seasonId) issues.push('Missing sourceConfig.seasonId');
      break;

    case 'leagueapps':
      if (!config.baseUrl) issues.push('Missing sourceConfig.baseUrl');
      break;

    default:
      issues.push(`Unknown platform: ${platform}`);
  }

  return { valid: issues.length === 0, issues };
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const doCollect = args.includes('--collect');
  const dryRun = args.includes('--dry-run');
  const jsonOutput = args.includes('--json');
  const platformFilter = args.find(a => a.startsWith('--platform='))?.split('=')[1];
  const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg) : Infinity;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Diagnose Zero-Division Active Leagues            ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Options: collect=${doCollect}, dryRun=${dryRun}, platform=${platformFilter || 'all'}, limit=${limit === Infinity ? 'none' : limit}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  // 1. Fetch all active leagues
  const leaguesSnap = await db.collection('leagues').where('status', '==', 'active').get();
  console.log(`Total active leagues: ${leaguesSnap.size}`);

  // 2. Fetch all division counts
  const divsSnap = await db.collection('divisions').select('leagueId').get();
  const divCounts = {};
  divsSnap.docs.forEach(d => {
    const lid = d.data().leagueId;
    divCounts[lid] = (divCounts[lid] || 0) + 1;
  });

  // 3. Find zero-division leagues
  const zeroDivLeagues = [];
  const hasDivLeagues = [];
  leaguesSnap.docs.forEach(d => {
    const data = d.data();
    const count = divCounts[d.id] || 0;
    if (count === 0) {
      zeroDivLeagues.push({ id: d.id, ...data });
    } else {
      hasDivLeagues.push({ id: d.id, name: data.name, divCount: count });
    }
  });

  console.log(`Active leagues WITH divisions: ${hasDivLeagues.length}`);
  console.log(`Active leagues with 0 divisions: ${zeroDivLeagues.length}\n`);

  if (zeroDivLeagues.length === 0) {
    console.log('All active leagues have divisions. Nothing to do!');
    return;
  }

  // 4. Categorize by platform and sport
  const byPlatform = {};
  const bySport = {};
  const byState = {};
  const configValid = [];
  const configInvalid = [];

  for (const league of zeroDivLeagues) {
    if (platformFilter && league.sourcePlatform !== platformFilter) continue;

    const p = league.sourcePlatform || 'unknown';
    const s = league.sport || 'unknown';
    const st = league.state || league.states || 'unknown';

    if (!byPlatform[p]) byPlatform[p] = [];
    if (!bySport[s]) bySport[s] = [];
    if (!byState[st]) byState[st] = [];
    byPlatform[p].push(league);
    bySport[s].push(league);
    byState[st].push(league);

    const validation = validateConfig(league);
    if (validation.valid) {
      configValid.push(league);
    } else {
      configInvalid.push({ league, issues: validation.issues });
    }
  }

  // 5. Print summary
  console.log('═══ BY PLATFORM ═══');
  for (const [platform, leagues] of Object.entries(byPlatform).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${platform}: ${leagues.length}`);
    for (const l of leagues.slice(0, 5)) {
      const v = validateConfig(l);
      console.log(`    ${v.valid ? '✓' : '✗'} ${l.id} — ${l.name} (${l.sport}, ${l.state || '?'})`);
      if (!v.valid) console.log(`      Issues: ${v.issues.join(', ')}`);
    }
    if (leagues.length > 5) console.log(`    ... and ${leagues.length - 5} more`);
  }

  console.log('\n═══ BY SPORT ═══');
  for (const [sport, leagues] of Object.entries(bySport).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${sport}: ${leagues.length}`);
  }

  console.log('\n═══ BY STATE ═══');
  for (const [state, leagues] of Object.entries(byState).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${state}: ${leagues.length}`);
  }

  console.log(`\n═══ CONFIG VALIDATION ═══`);
  console.log(`  Valid config (can collect): ${configValid.length}`);
  console.log(`  Invalid config (needs fix): ${configInvalid.length}`);

  // 6. Show invalid configs
  if (configInvalid.length > 0) {
    console.log('\n--- Leagues with Invalid Config ---');
    for (const { league, issues } of configInvalid) {
      console.log(`  ${league.id} (${league.sourcePlatform || 'no platform'})`);
      console.log(`    Name: ${league.name}`);
      console.log(`    Issues: ${issues.join(', ')}`);
    }
  }

  // 7. Show valid configs ready to collect
  if (configValid.length > 0) {
    console.log('\n--- Leagues Ready to Collect ---');
    for (const l of configValid) {
      const cfg = l.sourceConfig || {};
      let configSummary = '';
      switch (l.sourcePlatform) {
        case 'gamechanger': configSummary = `orgId=${cfg.orgId}`; break;
        case 'sportsconnect': configSummary = `tabId=${cfg.standingsTabId}, programs=${(cfg.programs || []).length}`; break;
        case 'gotsport': configSummary = `event=${cfg.leagueEventId}, groups=${(cfg.groups || []).length}`; break;
        case 'sportsaffinity': configSummary = `org=${cfg.organizationId}`; break;
        case 'sportsaffinity-asp': configSummary = `org=${cfg.organizationId}`; break;
        case 'tgs': configSummary = `event=${cfg.eventId}`; break;
        case 'demosphere': configSummary = `divs=${(cfg.divisions || []).length}`; break;
        case 'pointstreak': configSummary = `league=${cfg.leagueId}, season=${cfg.seasonId}`; break;
        case 'leagueapps': configSummary = `url=${cfg.baseUrl}`; break;
      }
      console.log(`  ${l.id} — ${l.name} [${l.sourcePlatform}] ${configSummary}`);
    }
  }

  // 8. Optionally collect
  if (doCollect && configValid.length > 0) {
    const toCollect = configValid.slice(0, limit);
    console.log(`\n═══ COLLECTING ${toCollect.length} LEAGUES ═══`);

    if (dryRun) {
      console.log('[DRY RUN] Would collect these leagues:');
      for (const l of toCollect) {
        console.log(`  ${l.id} — ${l.name} [${l.sourcePlatform}]`);
      }
      return;
    }

    // Dynamic import of adapter registry
    const { getAdapter } = require('../../registry');
    const { hashStandings } = require('../../season-monitor');
    const { resolveLLAgeGroup, isLittleLeague } = require('../../lib/little-league-ages');

    function slugify(text) {
      return (text || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .substring(0, 100);
    }

    const results = [];
    let collected = 0;
    let failed = 0;

    for (const league of toCollect) {
      console.log(`\n[${collected + failed + 1}/${toCollect.length}] Collecting: ${league.id} (${league.sourcePlatform})...`);

      try {
        const adapter = getAdapter(league.sourcePlatform);
        const startTime = Date.now();
        const result = await adapter.collectStandings(league);
        const { divisions, standings } = result;
        const durationMs = Date.now() - startTime;

        console.log(`  → ${divisions.length} divisions, ${standings.length} standings (${durationMs}ms)`);

        if (divisions.length === 0) {
          console.log(`  ⚠ No divisions returned — adapter ran but found nothing`);
          results.push({ id: league.id, name: league.name, platform: league.sourcePlatform, status: 'empty', divisions: 0, standings: 0, durationMs });
          failed++;
          continue;
        }

        // Post-process LL age groups
        if (isLittleLeague(league.name)) {
          for (const div of divisions) {
            if (!div.ageGroup || div.ageGroup === 'unknown') {
              const resolved = resolveLLAgeGroup(div.level, div.name);
              if (resolved) div.ageGroup = resolved;
            }
          }
        }

        // Write divisions (batched)
        for (let i = 0; i < divisions.length; i += 400) {
          const batch = db.batch();
          const chunk = divisions.slice(i, i + 400);
          for (const div of chunk) {
            batch.set(db.collection('divisions').doc(div.id), div, { merge: true });
          }
          await batch.commit();
        }

        // Write standings (batched)
        for (let i = 0; i < standings.length; i += 400) {
          const batch = db.batch();
          const chunk = standings.slice(i, i + 400);
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

        results.push({ id: league.id, name: league.name, platform: league.sourcePlatform, status: 'success', divisions: divisions.length, standings: standings.length, durationMs });
        collected++;

      } catch (err) {
        console.log(`  ✗ Error: ${err.message}`);
        results.push({ id: league.id, name: league.name, platform: league.sourcePlatform, status: 'error', error: err.message });
        failed++;
      }

      // Small delay between collections to avoid hammering external APIs
      await sleep(1000);
    }

    // Summary
    console.log('\n═══ COLLECTION RESULTS ═══');
    console.log(`  Collected: ${collected}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Total: ${collected + failed}`);

    const successResults = results.filter(r => r.status === 'success');
    const errorResults = results.filter(r => r.status === 'error');
    const emptyResults = results.filter(r => r.status === 'empty');

    if (successResults.length > 0) {
      const totalDivs = successResults.reduce((s, r) => s + r.divisions, 0);
      const totalStandings = successResults.reduce((s, r) => s + r.standings, 0);
      console.log(`  Total divisions created: ${totalDivs}`);
      console.log(`  Total standings created: ${totalStandings}`);
    }

    if (errorResults.length > 0) {
      console.log('\n--- Errors ---');
      for (const r of errorResults) {
        console.log(`  ${r.id}: ${r.error}`);
      }
    }

    if (emptyResults.length > 0) {
      console.log('\n--- Empty (no divisions returned) ---');
      for (const r of emptyResults) {
        console.log(`  ${r.id} — ${r.name} [${r.platform}]`);
      }
    }

    if (jsonOutput) {
      console.log('\n--- JSON Report ---');
      console.log(JSON.stringify({ collected, failed, results }, null, 2));
    }
  }

  // 9. Generate fix recommendations
  console.log('\n═══ RECOMMENDATIONS ═══');

  // Group invalid configs by issue type
  const missingTabId = configInvalid.filter(c => c.issues.some(i => i.includes('standingsTabId')));
  const missingGroups = configInvalid.filter(c => c.issues.some(i => i.includes('groups')));
  const missingOrgId = configInvalid.filter(c => c.issues.some(i => i.includes('orgId')));
  const missingPlatform = configInvalid.filter(c => c.issues.some(i => i.includes('sourcePlatform') || i.includes('Unknown platform')));

  if (missingTabId.length > 0) {
    console.log(`\n  [${missingTabId.length}] SportsConnect leagues need tabId discovery:`);
    console.log(`    → Run: node scripts/discovery/resolve-all-pending.js --fix --category=pending_tabid`);
    console.log(`    → Or change status to pending_tabid for auto-discovery`);
  }

  if (missingGroups.length > 0) {
    console.log(`\n  [${missingGroups.length}] GotSport leagues need group discovery:`);
    console.log(`    → Run: node scripts/discovery/discover-and-activate-gotsport.js`);
    console.log(`    → Or change status to pending_groups for auto-discovery`);
  }

  if (missingOrgId.length > 0) {
    console.log(`\n  [${missingOrgId.length}] GameChanger leagues need orgId:`);
    console.log(`    → Run: node scripts/discovery/resolve-all-pending.js --fix --category=pending_config`);
  }

  if (missingPlatform.length > 0) {
    console.log(`\n  [${missingPlatform.length}] Leagues need platform identification:`);
    console.log(`    → These need manual investigation or run resolve-all-pending.js --fix`);
  }

  if (configValid.length > 0 && !doCollect) {
    console.log(`\n  [${configValid.length}] Leagues have valid config but no divisions:`);
    console.log(`    → Run this script with --collect to trigger collection`);
    console.log(`    → Or run with --collect --dry-run to preview`);
  }

  if (jsonOutput) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalActive: leaguesSnap.size,
        withDivisions: hasDivLeagues.length,
        zeroDivisions: zeroDivLeagues.length,
        validConfig: configValid.length,
        invalidConfig: configInvalid.length,
      },
      byPlatform: Object.fromEntries(Object.entries(byPlatform).map(([k, v]) => [k, v.length])),
      bySport: Object.fromEntries(Object.entries(bySport).map(([k, v]) => [k, v.length])),
      byState: Object.fromEntries(Object.entries(byState).map(([k, v]) => [k, v.length])),
      invalidLeagues: configInvalid.map(c => ({ id: c.league.id, name: c.league.name, platform: c.league.sourcePlatform, issues: c.issues })),
      validLeagues: configValid.map(l => ({ id: l.id, name: l.name, platform: l.sourcePlatform })),
    };
    console.log('\n--- JSON Report ---');
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

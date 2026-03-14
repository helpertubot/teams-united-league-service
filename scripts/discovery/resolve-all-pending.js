/**
 * Resolve ALL Pending Leagues — Master Script
 *
 * Queries Firestore for all pending leagues and resolves each category:
 *   1. pending_tabid  → Auto-discover SportsConnect standings tabIds
 *   2. pending_config  → Re-discover GC orgIds, fill missing adapter configs
 *   3. pending_groups  → Discover GotSport groups (incl. large events)
 *   4. pending_platform → Identify platform for unresolved leagues
 *   5. pending_adapter  → Flag adapter development needs
 *
 * Usage:
 *   node scripts/discovery/resolve-all-pending.js [--dry-run] [--fix] [--category=pending_tabid]
 *
 * Options:
 *   --dry-run         Don't write to Firestore
 *   --fix             Auto-fix resolvable leagues (set active + update config)
 *   --category=X      Only process one category (pending_tabid, pending_config, etc.)
 *   --json            Output JSON report at end
 *   --league=ID       Process only a specific league
 */

const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios');
const cheerio = require('cheerio');
const db = new Firestore();

const GC_API_BASE = 'https://api.team-manager.gc.com/public';
const DELAY_MS = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const autoFix = args.includes('--fix');
  const jsonOutput = args.includes('--json');
  const categoryFilter = args.find(a => a.startsWith('--category='))?.split('=')[1];
  const leagueFilter = args.find(a => a.startsWith('--league='))?.split('=')[1];

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Resolve All Pending Leagues                     ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Options: dryRun=${dryRun}, autoFix=${autoFix}, category=${categoryFilter || 'all'}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  // Query all pending leagues
  const pendingStatuses = ['pending_config', 'pending_tabid', 'pending_groups', 'pending_platform', 'pending_adapter'];
  const allPending = [];

  for (const status of pendingStatuses) {
    if (categoryFilter && categoryFilter !== status) continue;
    const snap = await db.collection('leagues').where('status', '==', status).get();
    for (const doc of snap.docs) {
      if (leagueFilter && doc.id !== leagueFilter) continue;
      allPending.push({ id: doc.id, ...doc.data() });
    }
  }

  console.log(`Total pending leagues: ${allPending.length}`);

  // Categorize
  const byStatus = {};
  const byPlatform = {};
  for (const league of allPending) {
    const s = league.status;
    const p = league.sourcePlatform || 'unknown';
    if (!byStatus[s]) byStatus[s] = [];
    if (!byPlatform[p]) byPlatform[p] = [];
    byStatus[s].push(league);
    byPlatform[p].push(league);
  }

  console.log('\n--- By Status ---');
  for (const [status, leagues] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${leagues.length}`);
  }
  console.log('\n--- By Platform ---');
  for (const [platform, leagues] of Object.entries(byPlatform)) {
    console.log(`  ${platform}: ${leagues.length}`);
  }
  console.log('');

  const report = {
    timestamp: new Date().toISOString(),
    total: allPending.length,
    resolved: [],
    needsManual: [],
    unreachable: [],
    errors: [],
  };

  // Process each category
  if (byStatus.pending_tabid) {
    await resolvePendingTabId(byStatus.pending_tabid, { dryRun, autoFix, report });
  }
  if (byStatus.pending_config) {
    await resolvePendingConfig(byStatus.pending_config, { dryRun, autoFix, report });
  }
  if (byStatus.pending_groups) {
    await resolvePendingGroups(byStatus.pending_groups, { dryRun, autoFix, report });
  }
  if (byStatus.pending_platform) {
    await resolvePendingPlatform(byStatus.pending_platform, { dryRun, autoFix, report });
  }
  if (byStatus.pending_adapter) {
    await resolvePendingAdapter(byStatus.pending_adapter, { dryRun, autoFix, report });
  }

  // Summary
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  RESOLUTION SUMMARY                              ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`Total pending: ${allPending.length}`);
  console.log(`Resolved: ${report.resolved.length}`);
  console.log(`Needs manual: ${report.needsManual.length}`);
  console.log(`Unreachable: ${report.unreachable.length}`);
  console.log(`Errors: ${report.errors.length}`);

  if (report.resolved.length > 0) {
    console.log('\n--- Resolved ---');
    for (const r of report.resolved) {
      console.log(`  ✓ ${r.id} — ${r.name} (${r.resolution})`);
    }
  }
  if (report.needsManual.length > 0) {
    console.log('\n--- Needs Manual ---');
    for (const r of report.needsManual) {
      console.log(`  ⚠ ${r.id} — ${r.name}: ${r.reason}`);
    }
  }
  if (report.errors.length > 0) {
    console.log('\n--- Errors ---');
    for (const r of report.errors) {
      console.log(`  ✗ ${r.id} — ${r.error}`);
    }
  }

  // Log run
  if (!dryRun) {
    await db.collection('discoveryLogs').add({
      function: 'resolve-all-pending',
      total: allPending.length,
      resolved: report.resolved.length,
      needsManual: report.needsManual.length,
      errors: report.errors.length,
      timestamp: new Date().toISOString(),
    });
  }

  if (jsonOutput) {
    console.log('\n--- JSON Report ---');
    console.log(JSON.stringify(report, null, 2));
  }
}


// ═══════════════════════════════════════════════════════════════
// CATEGORY 1: pending_tabid — SportsConnect tab discovery
// ═══════════════════════════════════════════════════════════════

async function resolvePendingTabId(leagues, { dryRun, autoFix, report }) {
  console.log(`\n=== Resolving ${leagues.length} pending_tabid leagues ===\n`);

  for (const league of leagues) {
    const config = league.sourceConfig || {};
    const baseUrl = config.baseUrl;

    console.log(`${league.id} — ${league.name} (${league.state})`);

    if (!baseUrl) {
      report.needsManual.push({ id: league.id, name: league.name, reason: 'No baseUrl configured' });
      console.log('  ✗ No baseUrl');
      continue;
    }

    try {
      const tabId = await discoverSCTabId(baseUrl);
      if (tabId) {
        console.log(`  ✓ Found tabId: ${tabId}`);
        if (autoFix && !dryRun) {
          await db.collection('leagues').doc(league.id).update({
            'sourceConfig.standingsTabId': tabId,
            status: 'active',
            autoUpdate: true,
            resolvedAt: new Date().toISOString(),
            resolvedBy: 'resolve-all-pending',
          });
          console.log(`  ✓ Updated to active`);
        }
        report.resolved.push({ id: league.id, name: league.name, resolution: `tabId=${tabId}` });
      } else {
        console.log(`  ⚠ No tabId found`);
        report.needsManual.push({ id: league.id, name: league.name, reason: 'Site reachable but standings tab not found' });
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
      report.unreachable.push({ id: league.id, name: league.name, error: err.message });
    }

    await sleep(DELAY_MS);
  }
}

async function discoverSCTabId(baseUrl) {
  const resp = await axios.get(baseUrl, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    maxRedirects: 5,
  });

  const $ = cheerio.load(resp.data);
  const html = resp.data;

  // Strategy 1: Links with "standings" text and tabid
  let tabId = null;
  $('a').each((_, el) => {
    if (tabId) return;
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim().toLowerCase();
    if ((text.includes('standing') || text.includes('scores')) && href.toLowerCase().includes('tabid=')) {
      const m = href.match(/tabid=(\d+)/i);
      if (m) tabId = m[1];
    }
  });

  // Strategy 2: All tabid links, check for standings keywords
  if (!tabId) {
    $('a[href*="tabid="], a[href*="TabId="]').each((_, el) => {
      if (tabId) return;
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim().toLowerCase();
      if (text.includes('standing') || text.includes('league stand') || text.includes('scores & stand')) {
        const m = href.match(/tabid=(\d+)/i);
        if (m) tabId = m[1];
      }
    });
  }

  // Strategy 3: ViewStandings module in page source
  if (!tabId) {
    const m = html.match(/ViewStandings.*?tabid[=:](\d+)/i);
    if (m) tabId = m[1];
  }

  // Strategy 4: Check for DNN module with standings
  if (!tabId) {
    const m = html.match(/standings.*?tabid[=:](\d+)/i) || html.match(/tabid[=:](\d+).*?standings/i);
    if (m) tabId = m[1];
  }

  // Strategy 5: Look for iframe or redirect to standings page
  if (!tabId) {
    $('iframe').each((_, el) => {
      if (tabId) return;
      const src = $(el).attr('src') || '';
      if (src.includes('tabid=') && /stand/i.test(src)) {
        const m = src.match(/tabid=(\d+)/i);
        if (m) tabId = m[1];
      }
    });
  }

  return tabId;
}


// ═══════════════════════════════════════════════════════════════
// CATEGORY 2: pending_config — Batch resolve by platform
// ═══════════════════════════════════════════════════════════════

async function resolvePendingConfig(leagues, { dryRun, autoFix, report }) {
  console.log(`\n=== Resolving ${leagues.length} pending_config leagues ===\n`);

  // Sub-group by platform
  const byPlatform = {};
  for (const l of leagues) {
    const p = l.sourcePlatform || 'unknown';
    if (!byPlatform[p]) byPlatform[p] = [];
    byPlatform[p].push(l);
  }

  for (const [platform, pLeagues] of Object.entries(byPlatform)) {
    console.log(`\n--- ${platform}: ${pLeagues.length} leagues ---\n`);

    switch (platform) {
      case 'gamechanger':
        await resolveGCPendingConfig(pLeagues, { dryRun, autoFix, report });
        break;
      case 'sportsconnect':
        // SC pending_config likely needs both baseUrl AND tabId
        await resolveSCPendingConfig(pLeagues, { dryRun, autoFix, report });
        break;
      case 'gotsport':
        await resolveGotSportPendingConfig(pLeagues, { dryRun, autoFix, report });
        break;
      case 'demosphere':
        await resolveDemospherePendingConfig(pLeagues, { dryRun, autoFix, report });
        break;
      case 'leagueapps':
        await resolveLeagueAppsPendingConfig(pLeagues, { dryRun, autoFix, report });
        break;
      default:
        for (const l of pLeagues) {
          report.needsManual.push({
            id: l.id, name: l.name,
            reason: `Unknown platform "${platform}" — needs manual investigation`,
          });
          console.log(`  ⚠ ${l.id} — unknown platform "${platform}"`);
        }
    }
  }
}

/**
 * GameChanger pending_config — these need their orgId discovered.
 * Strategy: use the league name/city/state to search the GC API.
 */
async function resolveGCPendingConfig(leagues, { dryRun, autoFix, report }) {
  for (const league of leagues) {
    const config = league.sourceConfig || {};
    console.log(`${league.id} — ${league.name} (${league.state})`);

    // Check if orgId is already set but just invalid
    const orgId = config.orgId;
    if (orgId && orgId !== 'REPLACE_WITH_ORG_ID') {
      // Validate the existing orgId
      try {
        const org = await validateGCOrg(orgId);
        if (org) {
          // orgId is valid — what else is missing?
          const hasStandings = await checkGCStandings(orgId);
          if (hasStandings) {
            console.log(`  ✓ orgId ${orgId} is valid with standings`);
            if (autoFix && !dryRun) {
              await db.collection('leagues').doc(league.id).update({
                status: 'active',
                autoUpdate: true,
                resolvedAt: new Date().toISOString(),
                resolvedBy: 'resolve-all-pending',
              });
            }
            report.resolved.push({ id: league.id, name: league.name, resolution: `GC orgId ${orgId} validated` });
          } else {
            console.log(`  ⚠ orgId ${orgId} valid but no standings — may be wrong season`);
            report.needsManual.push({ id: league.id, name: league.name, reason: `GC orgId valid but no standings (season ended or not started)` });
          }
          await sleep(300);
          continue;
        }
      } catch (err) {
        console.log(`  orgId ${orgId} validation failed: ${err.message}`);
      }
    }

    // Need to discover the orgId via search
    console.log(`  Searching for GC org...`);
    const discovered = await searchGCOrg(league.name, league.state, league.sport);
    if (discovered) {
      console.log(`  ✓ Found: ${discovered.name} (${discovered.orgId})`);
      if (autoFix && !dryRun) {
        await db.collection('leagues').doc(league.id).update({
          'sourceConfig.orgId': discovered.orgId,
          'sourceConfig.gcOrgName': discovered.name,
          status: 'active',
          autoUpdate: true,
          resolvedAt: new Date().toISOString(),
          resolvedBy: 'resolve-all-pending',
        });
      }
      report.resolved.push({ id: league.id, name: league.name, resolution: `GC org discovered: ${discovered.orgId}` });
    } else {
      console.log(`  ⚠ No matching GC org found`);
      report.needsManual.push({ id: league.id, name: league.name, reason: 'No matching GC organization found via API search' });
    }

    await sleep(DELAY_MS);
  }
}

async function validateGCOrg(orgId) {
  try {
    const resp = await axios.get(`${GC_API_BASE}/organizations/${orgId}`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TeamsUnited-Resolver/1.0' },
    });
    return resp.data;
  } catch {
    return null;
  }
}

async function checkGCStandings(orgId) {
  try {
    const resp = await axios.get(`${GC_API_BASE}/organizations/${orgId}/standings`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TeamsUnited-Resolver/1.0' },
    });
    return Array.isArray(resp.data) && resp.data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Try to find a GC org by searching DuckDuckGo for the league name.
 */
async function searchGCOrg(name, state, sport) {
  const query = `site:web.gc.com/organizations "${name}" ${state || ''}`;
  try {
    const resp = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000,
    });

    const orgIds = new Set();
    const matches = resp.data.matchAll(/web\.gc\.com\/organizations\/([A-Za-z0-9]{12})/g);
    for (const m of matches) {
      orgIds.add(m[1]);
    }

    // Validate first match
    for (const orgId of orgIds) {
      const org = await validateGCOrg(orgId);
      if (org && org.type !== 'tournament') {
        return { orgId: org.id, name: org.name };
      }
      await sleep(300);
    }
  } catch {
    // Search failed — silent
  }

  return null;
}

/**
 * SportsConnect pending_config — needs both baseUrl and tabId
 */
async function resolveSCPendingConfig(leagues, { dryRun, autoFix, report }) {
  for (const league of leagues) {
    const config = league.sourceConfig || {};
    console.log(`${league.id} — ${league.name} (${league.state})`);

    if (!config.baseUrl) {
      report.needsManual.push({ id: league.id, name: league.name, reason: 'SportsConnect: no baseUrl — need to find the league website' });
      console.log('  ⚠ No baseUrl');
      continue;
    }

    if (config.standingsTabId) {
      // Has both — should be active
      console.log(`  Has baseUrl + tabId — should be active`);
      if (autoFix && !dryRun) {
        await db.collection('leagues').doc(league.id).update({
          status: 'active',
          autoUpdate: true,
          resolvedAt: new Date().toISOString(),
        });
      }
      report.resolved.push({ id: league.id, name: league.name, resolution: 'Already had config, set active' });
      continue;
    }

    // Try to discover tabId
    try {
      const tabId = await discoverSCTabId(config.baseUrl);
      if (tabId) {
        console.log(`  ✓ Found tabId: ${tabId}`);
        if (autoFix && !dryRun) {
          await db.collection('leagues').doc(league.id).update({
            'sourceConfig.standingsTabId': tabId,
            status: 'active',
            autoUpdate: true,
            resolvedAt: new Date().toISOString(),
          });
        }
        report.resolved.push({ id: league.id, name: league.name, resolution: `SC tabId=${tabId}` });
      } else {
        report.needsManual.push({ id: league.id, name: league.name, reason: 'SC site reachable but no standings tab found' });
      }
    } catch (err) {
      report.unreachable.push({ id: league.id, name: league.name, error: err.message });
    }

    await sleep(DELAY_MS);
  }
}

/**
 * GotSport pending_config — needs leagueEventId
 */
async function resolveGotSportPendingConfig(leagues, { dryRun, autoFix, report }) {
  for (const league of leagues) {
    const config = league.sourceConfig || {};
    const eventId = config.leagueEventId || config.eventId;
    console.log(`${league.id} — ${league.name} (${league.state})`);

    if (!eventId) {
      report.needsManual.push({ id: league.id, name: league.name, reason: 'GotSport: no leagueEventId — need to find the event on gotsport.com' });
      continue;
    }

    // Has event ID — try discovering groups
    try {
      const groups = await discoverGotSportGroups(eventId);
      if (groups.length > 0) {
        console.log(`  ✓ Found ${groups.length} groups`);
        if (autoFix && !dryRun) {
          await db.collection('leagues').doc(league.id).update({
            'sourceConfig.groups': groups,
            status: 'active',
            autoUpdate: true,
            resolvedAt: new Date().toISOString(),
          });
        }
        report.resolved.push({ id: league.id, name: league.name, resolution: `GotSport: ${groups.length} groups` });
      } else {
        report.needsManual.push({ id: league.id, name: league.name, reason: 'GotSport: event exists but no groups found' });
      }
    } catch (err) {
      report.errors.push({ id: league.id, error: err.message });
    }

    await sleep(2000);
  }
}

/**
 * Demosphere pending_config
 */
async function resolveDemospherePendingConfig(leagues, { dryRun, autoFix, report }) {
  for (const league of leagues) {
    const config = league.sourceConfig || {};
    console.log(`${league.id} — ${league.name} (${league.state})`);

    if (!config.baseUrl) {
      report.needsManual.push({ id: league.id, name: league.name, reason: 'Demosphere: no baseUrl' });
      continue;
    }

    // Try the auto-discover mode (iframe + elements.demosphere-secure.com)
    try {
      const standingsUrl = config.standingsSlug
        ? `${config.baseUrl}${config.standingsSlug}`
        : `${config.baseUrl}/standings`;

      const resp = await axios.get(standingsUrl, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      const $ = cheerio.load(resp.data);
      const iframe = $('iframe[data-src*="demosphere"], iframe[src*="demosphere"]');

      if (iframe.length > 0) {
        console.log(`  ✓ Found Demosphere iframe — auto-discover should work`);
        if (autoFix && !dryRun) {
          await db.collection('leagues').doc(league.id).update({
            status: 'active',
            autoUpdate: true,
            resolvedAt: new Date().toISOString(),
          });
        }
        report.resolved.push({ id: league.id, name: league.name, resolution: 'Demosphere iframe found' });
      } else {
        report.needsManual.push({ id: league.id, name: league.name, reason: 'Demosphere: no iframe found on standings page' });
      }
    } catch (err) {
      report.errors.push({ id: league.id, error: `Demosphere: ${err.message}` });
    }

    await sleep(DELAY_MS);
  }
}

/**
 * LeagueApps pending_config
 */
async function resolveLeagueAppsPendingConfig(leagues, { dryRun, autoFix, report }) {
  for (const league of leagues) {
    const config = league.sourceConfig || {};
    console.log(`${league.id} — ${league.name} (${league.state})`);

    if (!config.baseUrl && !config.orgSlug) {
      report.needsManual.push({ id: league.id, name: league.name, reason: 'LeagueApps: no baseUrl or orgSlug' });
      continue;
    }

    const baseUrl = config.baseUrl || `https://${config.orgSlug}.leagueapps.com`;

    try {
      const resp = await axios.get(baseUrl, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        maxRedirects: 5,
      });

      // Look for league program links
      const $ = cheerio.load(resp.data);
      const programs = [];
      $('a[href*="/leagues/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const m = href.match(/\/leagues\/(\d+)/);
        if (m && !programs.some(p => p.leagueId === m[1])) {
          programs.push({
            leagueId: m[1],
            name: $(el).text().trim() || `League ${m[1]}`,
            path: `/leagues/${m[1]}/standings`,
          });
        }
      });

      if (programs.length > 0) {
        console.log(`  ✓ Found ${programs.length} programs`);
        if (autoFix && !dryRun) {
          await db.collection('leagues').doc(league.id).update({
            'sourceConfig.programs': programs,
            'sourceConfig.baseUrl': baseUrl,
            status: 'active',
            autoUpdate: true,
            resolvedAt: new Date().toISOString(),
          });
        }
        report.resolved.push({ id: league.id, name: league.name, resolution: `LeagueApps: ${programs.length} programs` });
      } else {
        report.needsManual.push({ id: league.id, name: league.name, reason: 'LeagueApps: site reachable but no program links found' });
      }
    } catch (err) {
      report.errors.push({ id: league.id, error: `LeagueApps: ${err.message}` });
    }

    await sleep(DELAY_MS);
  }
}


// ═══════════════════════════════════════════════════════════════
// CATEGORY 3: pending_groups — GotSport group discovery
// ═══════════════════════════════════════════════════════════════

async function resolvePendingGroups(leagues, { dryRun, autoFix, report }) {
  console.log(`\n=== Resolving ${leagues.length} pending_groups leagues ===\n`);

  for (const league of leagues) {
    const config = league.sourceConfig || {};
    const eventId = config.leagueEventId || config.eventId;
    console.log(`${league.id} — ${league.name} (${league.state})`);

    if (!eventId) {
      report.needsManual.push({ id: league.id, name: league.name, reason: 'No eventId' });
      continue;
    }

    try {
      // Use paginated discovery for large events
      const groups = await discoverGotSportGroups(eventId);
      console.log(`  Found ${groups.length} groups`);

      if (groups.length === 0) {
        report.needsManual.push({ id: league.id, name: league.name, reason: 'No groups found — may need browser-based discovery' });
        continue;
      }

      // Show summary
      const genders = {};
      const ages = {};
      for (const g of groups) {
        genders[g.gender] = (genders[g.gender] || 0) + 1;
        ages[g.ageGroup] = (ages[g.ageGroup] || 0) + 1;
      }
      console.log(`  Genders: ${JSON.stringify(genders)}`);
      console.log(`  Age groups: ${Object.keys(ages).length} unique`);

      if (autoFix && !dryRun) {
        await db.collection('leagues').doc(league.id).update({
          'sourceConfig.groups': groups,
          status: 'active',
          autoUpdate: true,
          groupsDiscoveredAt: new Date().toISOString(),
          resolvedBy: 'resolve-all-pending',
        });
        console.log(`  ✓ Saved and activated`);
      }
      report.resolved.push({ id: league.id, name: league.name, resolution: `${groups.length} groups discovered` });
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
      report.errors.push({ id: league.id, error: err.message });
    }

    await sleep(2000);
  }
}

function parseGender(name) {
  const upper = name.toUpperCase();
  if (/\bB\d+U\b/.test(upper)) return 'male';
  if (/\bG\d+U\b/.test(upper)) return 'female';
  if (/FEMALE|GIRLS?/.test(upper)) return 'female';
  if (/MALE|BOYS?/.test(upper)) return 'male';
  if (/U\d+B\b/.test(upper)) return 'male';
  if (/U\d+G\b/.test(upper)) return 'female';
  return 'coed';
}

function parseAgeGroup(name) {
  let m = name.match(/\bU-?(\d+)\b/i);
  if (m) return `U${m[1]}`;
  m = name.match(/\b[BG](\d+)U\b/i);
  if (m) return `U${m[1]}`;
  m = name.match(/\b(\d+)\s*(?:&\s*)?[Uu](?:nder)?\b/);
  if (m) return `U${m[1]}`;
  return 'unknown';
}

function parseLevel(name) {
  const m = name.match(/\b(?:D|Div\.?\s*)(\d+)/i);
  if (m) return `D${m[1]}`;
  const upper = name.toUpperCase();
  if (upper.includes('NPL')) return 'NPL';
  if (upper.includes('PREMIER')) return 'Premier';
  if (upper.includes('GOLD')) return 'Gold';
  if (upper.includes('SILVER')) return 'Silver';
  if (upper.includes('BRONZE')) return 'Bronze';
  if (upper.includes('COPPER')) return 'Copper';
  if (upper.includes('SELECT')) return 'Select';
  if (upper.includes('CLASSIC')) return 'Classic';
  if (upper.includes('ACADEMY')) return 'Academy';
  return null;
}

/**
 * Discover groups from a GotSport event.
 * Handles large events by checking multiple page sources.
 */
async function discoverGotSportGroups(eventId) {
  const groups = [];
  const seen = new Set();

  // Strategy 1: Results page
  const resultsUrl = `https://system.gotsport.com/org_event/events/${eventId}/results`;
  console.log(`    Fetching results: ${resultsUrl}`);
  try {
    const resp = await axios.get(resultsUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });
    extractGroupsFromHtml(resp.data, groups, seen);
  } catch (err) {
    console.log(`    Results page error: ${err.message}`);
  }

  // Strategy 2: Standings and schedules page
  if (groups.length === 0) {
    const altUrl = `https://system.gotsport.com/org_event/events/${eventId}/standings_and_schedules`;
    console.log(`    Trying standings page: ${altUrl}`);
    try {
      const resp = await axios.get(altUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
      });
      extractGroupsFromHtml(resp.data, groups, seen);
    } catch (err) {
      console.log(`    Standings page error: ${err.message}`);
    }
  }

  // Strategy 3: Schedule page (some events put groups here)
  if (groups.length === 0) {
    const schedUrl = `https://system.gotsport.com/org_event/events/${eventId}/schedules`;
    console.log(`    Trying schedule page: ${schedUrl}`);
    try {
      const resp = await axios.get(schedUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
      });
      extractGroupsFromHtml(resp.data, groups, seen);
    } catch (err) {
      console.log(`    Schedule page error: ${err.message}`);
    }
  }

  // Strategy 4: For very large events, try the API if available
  if (groups.length === 0) {
    console.log(`    Trying GotSport API...`);
    try {
      const apiUrl = `https://system.gotsport.com/api/org_event/events/${eventId}/groups`;
      const resp = await axios.get(apiUrl, {
        timeout: 15000,
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      });
      if (Array.isArray(resp.data)) {
        for (const g of resp.data) {
          const gId = String(g.id || g.group_id);
          if (!seen.has(gId)) {
            seen.add(gId);
            const name = g.name || g.group_name || `Group ${gId}`;
            groups.push({
              groupId: gId,
              name,
              gender: parseGender(name),
              ageGroup: parseAgeGroup(name),
              level: parseLevel(name),
            });
          }
        }
      }
    } catch {
      // API may not exist — that's fine
    }
  }

  return groups;
}

function extractGroupsFromHtml(html, groups, seen) {
  const $ = cheerio.load(html);

  // Links with group= parameter
  $('a[href*="group="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/group=(\d+)/);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      const container = $(el).closest('.card, .panel, [class*="division"], [class*="group"]');
      const name = container.find('.card-title, .panel-heading, h4, h5, h3').first().text().trim()
        || $(el).text().trim()
        || `Group ${m[1]}`;

      groups.push({
        groupId: m[1],
        name: name.replace(/\s+/g, ' ').trim(),
        gender: parseGender(name),
        ageGroup: parseAgeGroup(name),
        level: parseLevel(name),
      });
    }
  });

  // Script tag fallback
  if (groups.length === 0) {
    $('script').each((_, el) => {
      const content = $(el).html() || '';
      const groupMatches = content.matchAll(/group[_\s]*(?:id|Id)[\s:"'=]+(\d{4,})/g);
      for (const gm of groupMatches) {
        if (!seen.has(gm[1])) {
          seen.add(gm[1]);
          groups.push({
            groupId: gm[1],
            name: `Group ${gm[1]}`,
            gender: 'unknown',
            ageGroup: 'unknown',
            level: null,
          });
        }
      }
    });
  }
}


// ═══════════════════════════════════════════════════════════════
// CATEGORY 4: pending_platform — Identify what platform to use
// ═══════════════════════════════════════════════════════════════

async function resolvePendingPlatform(leagues, { dryRun, autoFix, report }) {
  console.log(`\n=== Resolving ${leagues.length} pending_platform leagues ===\n`);

  for (const league of leagues) {
    console.log(`${league.id} — ${league.name} (${league.state})`);

    // For each league, try to identify its platform
    const platformGuess = await identifyPlatform(league);

    if (platformGuess.platform) {
      console.log(`  → Identified platform: ${platformGuess.platform}`);
      console.log(`  → Evidence: ${platformGuess.evidence}`);

      if (autoFix && !dryRun && platformGuess.config) {
        await db.collection('leagues').doc(league.id).update({
          sourcePlatform: platformGuess.platform,
          sourceConfig: platformGuess.config,
          status: platformGuess.nextStatus || 'pending_config',
          resolvedAt: new Date().toISOString(),
        });
        console.log(`  ✓ Updated platform to ${platformGuess.platform}`);
      }
      report.resolved.push({ id: league.id, name: league.name, resolution: `Platform: ${platformGuess.platform} — ${platformGuess.evidence}` });
    } else {
      report.needsManual.push({ id: league.id, name: league.name, reason: platformGuess.notes || 'Could not identify platform' });
    }
  }
}

async function identifyPlatform(league) {
  const name = (league.name || '').toLowerCase();
  const sport = (league.sport || '').toLowerCase();

  // Babe Ruth / Cal Ripken uses specific platforms
  if (name.includes('babe ruth') || name.includes('cal ripken')) {
    // Babe Ruth leagues typically use:
    // 1. Their official site (baberuthleague.org)
    // 2. Sports Connect / Blue Sombrero
    // 3. GameChanger for scoring
    // 4. LeagueApps

    // Check GameChanger first — most Babe Ruth leagues use it for scoring
    const query = `site:web.gc.com/organizations "babe ruth" "${league.state}"`;
    try {
      const resp = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      });
      const orgIds = new Set();
      const matches = resp.data.matchAll(/web\.gc\.com\/organizations\/([A-Za-z0-9]{12})/g);
      for (const m of matches) orgIds.add(m[1]);

      if (orgIds.size > 0) {
        const orgId = Array.from(orgIds)[0];
        const org = await validateGCOrg(orgId);
        if (org) {
          return {
            platform: 'gamechanger',
            config: { orgId: org.id, gcSport: org.sport },
            evidence: `Found GC org: ${org.name} (${org.id})`,
            nextStatus: 'active',
          };
        }
      }
    } catch { /* continue to other methods */ }

    // Check Sports Connect (common for Babe Ruth)
    try {
      const scQuery = `"babe ruth" "${league.state}" site:sportsconnect.com OR site:bluesombrero.com standings`;
      const resp = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: scQuery },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      });
      const urlMatch = resp.data.match(/https?:\/\/[^"'\s]*(?:sportsconnect|bluesombrero)\.com[^"'\s]*/i);
      if (urlMatch) {
        return {
          platform: 'sportsconnect',
          config: { baseUrl: urlMatch[0].replace(/\/[^/]*$/, '') },
          evidence: `Found SC site: ${urlMatch[0]}`,
          nextStatus: 'pending_tabid',
        };
      }
    } catch { /* continue */ }

    await sleep(3000); // Rate limit DuckDuckGo

    return {
      platform: null,
      notes: 'Babe Ruth league — likely on GameChanger or SportsConnect but could not auto-discover. Check baberuthleague.org for the local league website.',
    };
  }

  // Perfect Game — has its own website
  if (name.includes('perfect game')) {
    return {
      platform: null,
      notes: 'Perfect Game uses perfectgame.org with a proprietary scoring system. Needs a custom adapter (pending_adapter).',
    };
  }

  // Generic — try multiple platform searches
  return {
    platform: null,
    notes: `Could not auto-identify platform for "${league.name}". Try searching for the league website manually.`,
  };
}


// ═══════════════════════════════════════════════════════════════
// CATEGORY 5: pending_adapter — Needs new adapter development
// ═══════════════════════════════════════════════════════════════

async function resolvePendingAdapter(leagues, { dryRun, autoFix, report }) {
  console.log(`\n=== ${leagues.length} leagues need new adapters ===\n`);

  for (const league of leagues) {
    console.log(`${league.id} — ${league.name} (${league.state})`);

    const name = (league.name || '').toLowerCase();

    if (name.includes('perfect game')) {
      report.needsManual.push({
        id: league.id,
        name: league.name,
        reason: 'Needs PerfectGame adapter. Standings at perfectgame.org/Events/Default.aspx — HTML scraping required. ' +
          'URL pattern: /Events/Standings.aspx?event=XXX. Tables have Team, W, L, T, RS, RA columns.',
      });
    } else if (name.includes('maxpreps')) {
      report.needsManual.push({
        id: league.id,
        name: league.name,
        reason: 'Needs MaxPreps adapter. React SPA — may need API discovery or Puppeteer.',
      });
    } else {
      report.needsManual.push({
        id: league.id,
        name: league.name,
        reason: `Needs new adapter for unknown platform. Investigate league website.`,
      });
    }
  }
}


// ═══════════════════════════════════════════════════════════════

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

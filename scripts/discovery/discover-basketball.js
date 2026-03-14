/**
 * Discover Basketball Leagues — All Phase 1 States
 *
 * Discovers youth basketball leagues across WA, OR, ID, MT, CA.
 * Basketball typically uses different platforms than baseball/soccer:
 *   - GameChanger (growing — has basketball support)
 *   - LeagueApps (common for rec leagues)
 *   - SportsEngine (popular — may need new adapter)
 *   - MaxPreps (high school — may need new adapter)
 *   - GotSport (some basketball events)
 *   - iScore / Exposure Events (travel basketball)
 *
 * Usage:
 *   node scripts/discovery/discover-basketball.js [--dry-run] [--save] [--state=WA]
 */

const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios');
const db = new Firestore();

const PHASE1_STATES = ['WA', 'OR', 'ID', 'MT', 'CA'];
const GC_API_BASE = 'https://api.team-manager.gc.com/public';
const DELAY_MS = 300;
const SEARCH_DELAY_MS = 3000;

const STATE_NAMES = {
  WA: 'Washington', OR: 'Oregon', ID: 'Idaho', MT: 'Montana', CA: 'California',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const save = args.includes('--save');
  const jsonOutput = args.includes('--json');
  const stateFilter = args.find(a => a.startsWith('--state='))?.split('=')[1]?.toUpperCase();

  const states = stateFilter ? [stateFilter] : PHASE1_STATES;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Basketball League Discovery — Phase 1 States    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`States: ${states.join(', ')}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  const report = {
    timestamp: new Date().toISOString(),
    byState: {},
    totalDiscovered: 0,
    platformsNeeded: new Set(),
  };

  for (const state of states) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`=== ${state} Basketball Discovery ===`);
    console.log(`${'='.repeat(50)}\n`);

    const stateReport = {
      gc: [],
      leagueapps: [],
      sportsengine: [],
      gotsport: [],
      otherPlatforms: [],
      errors: [],
    };

    // 1. GameChanger basketball
    await discoverGCBasketball(state, stateReport, { save, dryRun });

    // 2. LeagueApps basketball
    await discoverLeagueAppsBasketball(state, stateReport);

    // 3. SportsEngine (may need new adapter)
    await discoverSportsEngine(state, stateReport);

    // 4. GotSport basketball
    await discoverGotSportBasketball(state, stateReport);

    // 5. Generic web search for other platforms
    await discoverOtherBasketball(state, stateReport);

    report.byState[state] = stateReport;
    const stateTotal = stateReport.gc.length + stateReport.leagueapps.length +
      stateReport.sportsengine.length + stateReport.gotsport.length + stateReport.otherPlatforms.length;
    report.totalDiscovered += stateTotal;

    if (stateReport.sportsengine.length > 0) report.platformsNeeded.add('sportsengine');

    console.log(`\n${state} total: ${stateTotal} basketball sources discovered`);
    console.log(`  GameChanger: ${stateReport.gc.length}`);
    console.log(`  LeagueApps: ${stateReport.leagueapps.length}`);
    console.log(`  SportsEngine: ${stateReport.sportsengine.length}`);
    console.log(`  GotSport: ${stateReport.gotsport.length}`);
    console.log(`  Other: ${stateReport.otherPlatforms.length}`);
  }

  // Summary
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  BASKETBALL DISCOVERY SUMMARY                    ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`Total discovered: ${report.totalDiscovered}`);
  for (const [state, sr] of Object.entries(report.byState)) {
    const total = sr.gc.length + sr.leagueapps.length + sr.sportsengine.length + sr.gotsport.length + sr.otherPlatforms.length;
    console.log(`  ${state}: ${total}`);
  }

  if (report.platformsNeeded.size > 0) {
    console.log(`\nNew adapters needed: ${Array.from(report.platformsNeeded).join(', ')}`);
  }

  if (jsonOutput) {
    console.log('\n--- JSON ---');
    console.log(JSON.stringify(report, null, 2));
  }
}


// ═══════════════════════════════════════════════════════════════
// GameChanger Basketball
// ═══════════════════════════════════════════════════════════════

async function discoverGCBasketball(state, stateReport, { save, dryRun }) {
  console.log(`\n--- GameChanger Basketball (${state}) ---`);

  const stateName = STATE_NAMES[state];
  const queries = [
    `site:web.gc.com/organizations basketball "${stateName}" league`,
    `site:web.gc.com/organizations "youth basketball" "${state}"`,
    `site:web.gc.com/organizations basketball "${stateName}" rec`,
  ];

  const allOrgIds = new Set();

  for (const query of queries) {
    console.log(`  Search: ${query}`);
    try {
      const resp = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000,
      });
      const matches = resp.data.matchAll(/web\.gc\.com\/organizations\/([A-Za-z0-9]{12})/g);
      for (const m of matches) allOrgIds.add(m[1]);
    } catch (err) {
      stateReport.errors.push({ platform: 'gc', query, error: err.message });
    }
    await sleep(SEARCH_DELAY_MS);
  }

  console.log(`  ${allOrgIds.size} candidate orgs`);

  for (const orgId of allOrgIds) {
    try {
      const org = await validateGCOrg(orgId);
      if (!org) continue;
      if (org.type === 'tournament') continue;
      const orgState = (org.state || '').toUpperCase();
      if (orgState !== state) continue;
      const gcSport = (org.sport || '').toLowerCase();
      if (gcSport !== 'basketball') continue;

      const teamCount = await getGCTeamCount(orgId);
      console.log(`  ✓ ${org.name} (${orgId}) — ${teamCount} teams`);

      stateReport.gc.push({
        orgId: org.id, name: org.name, city: org.city,
        teamCount, seasonName: org.season_name,
      });

      if (save && !dryRun) {
        await registerLeague({
          id: `gc-${org.id}`,
          name: org.name,
          sport: 'basketball',
          state: orgState,
          city: org.city,
          sourcePlatform: 'gamechanger',
          sourceConfig: { orgId: org.id, gcSport },
          discoveredBy: 'discover-basketball',
        });
      }
    } catch (err) {
      stateReport.errors.push({ orgId, error: err.message });
    }
    await sleep(DELAY_MS);
  }
}


// ═══════════════════════════════════════════════════════════════
// LeagueApps Basketball
// ═══════════════════════════════════════════════════════════════

async function discoverLeagueAppsBasketball(state, stateReport) {
  console.log(`\n--- LeagueApps Basketball (${state}) ---`);

  const stateName = STATE_NAMES[state];
  const queries = [
    `site:leagueapps.com basketball "${stateName}" league standings`,
    `site:leagueapps.com "youth basketball" "${stateName}"`,
  ];

  const seen = new Set();

  for (const query of queries) {
    try {
      const resp = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000,
      });
      const urlMatches = resp.data.matchAll(/https?:\/\/([a-z0-9-]+)\.leagueapps\.com/gi);
      for (const m of urlMatches) {
        const slug = m[1].toLowerCase();
        if (!seen.has(slug) && slug !== 'www' && slug !== 'app') {
          seen.add(slug);
          console.log(`  Found: ${slug}.leagueapps.com`);
          stateReport.leagueapps.push({ orgSlug: slug, url: `https://${slug}.leagueapps.com` });
        }
      }
    } catch (err) {
      stateReport.errors.push({ platform: 'leagueapps', error: err.message });
    }
    await sleep(SEARCH_DELAY_MS);
  }
}


// ═══════════════════════════════════════════════════════════════
// SportsEngine Discovery (may need new adapter)
// ═══════════════════════════════════════════════════════════════

async function discoverSportsEngine(state, stateReport) {
  console.log(`\n--- SportsEngine Basketball (${state}) ---`);

  const stateName = STATE_NAMES[state];
  const queries = [
    `site:sportsengine.com basketball "${stateName}" youth league standings`,
    `"sportsengine.com" basketball "${stateName}" standings`,
  ];

  const seen = new Set();

  for (const query of queries) {
    try {
      const resp = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000,
      });
      // Extract SportsEngine org URLs
      const urlMatches = resp.data.matchAll(/https?:\/\/([a-z0-9-]+\.sportsengine\.com)/gi);
      for (const m of urlMatches) {
        const domain = m[1].toLowerCase();
        if (!seen.has(domain)) {
          seen.add(domain);
          console.log(`  Found: ${domain}`);
          stateReport.sportsengine.push({ domain, url: `https://${domain}` });
        }
      }

      // Also check for app.sportsengine.com pattern
      const appMatches = resp.data.matchAll(/app\.sportsengine\.com\/[^\s"'<>]+/gi);
      for (const m of appMatches) {
        const url = m[0];
        if (!seen.has(url)) {
          seen.add(url);
          console.log(`  Found: ${url}`);
          stateReport.sportsengine.push({ url: `https://${url}` });
        }
      }
    } catch (err) {
      stateReport.errors.push({ platform: 'sportsengine', error: err.message });
    }
    await sleep(SEARCH_DELAY_MS);
  }

  if (stateReport.sportsengine.length > 0) {
    console.log(`\n  ⚠ SportsEngine adapter not yet built — these are discovery-only results`);
    console.log(`  SportsEngine uses a React SPA. Adapter development needed.`);
  }
}


// ═══════════════════════════════════════════════════════════════
// GotSport Basketball
// ═══════════════════════════════════════════════════════════════

async function discoverGotSportBasketball(state, stateReport) {
  console.log(`\n--- GotSport Basketball (${state}) ---`);

  const stateName = STATE_NAMES[state];
  const queries = [
    `site:system.gotsport.com basketball "${stateName}"`,
  ];

  const eventIds = new Set();

  for (const query of queries) {
    try {
      const resp = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000,
      });
      const matches = resp.data.matchAll(/events\/(\d{4,6})/g);
      for (const m of matches) eventIds.add(m[1]);
    } catch (err) {
      stateReport.errors.push({ platform: 'gotsport', error: err.message });
    }
    await sleep(SEARCH_DELAY_MS);
  }

  console.log(`  ${eventIds.size} candidate events`);
  for (const eid of eventIds) {
    stateReport.gotsport.push({ eventId: eid });
  }
}


// ═══════════════════════════════════════════════════════════════
// Other Platforms
// ═══════════════════════════════════════════════════════════════

async function discoverOtherBasketball(state, stateReport) {
  console.log(`\n--- Other Platforms Basketball (${state}) ---`);

  const stateName = STATE_NAMES[state];
  // Search for youth basketball leagues that aren't on our known platforms
  const query = `"youth basketball league" "${stateName}" standings 2026`;

  try {
    const resp = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    });

    // Look for common basketball platforms
    const platforms = {
      'maxpreps.com': [],
      'exposureevents.com': [],
      'iscore.com': [],
      'sportability.com': [],
      'playon.com': [],
    };

    for (const [domain, arr] of Object.entries(platforms)) {
      const regex = new RegExp(`https?://[^\\s"'<>]*${domain.replace('.', '\\.')}[^\\s"'<>]*`, 'gi');
      const matches = resp.data.matchAll(regex);
      for (const m of matches) {
        if (!arr.some(u => u.url === m[0])) {
          arr.push({ url: m[0] });
          console.log(`  ${domain}: ${m[0]}`);
        }
      }
    }

    for (const [domain, urls] of Object.entries(platforms)) {
      if (urls.length > 0) {
        stateReport.otherPlatforms.push({ platform: domain, urls });
      }
    }
  } catch (err) {
    stateReport.errors.push({ platform: 'other', error: err.message });
  }

  await sleep(SEARCH_DELAY_MS);
}


// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

async function validateGCOrg(orgId) {
  try {
    const resp = await axios.get(`${GC_API_BASE}/organizations/${orgId}`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TeamsUnited-Discovery/1.0' },
    });
    return resp.data;
  } catch { return null; }
}

async function getGCTeamCount(orgId) {
  try {
    const resp = await axios.get(`${GC_API_BASE}/organizations/${orgId}/teams`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TeamsUnited-Discovery/1.0' },
    });
    return Array.isArray(resp.data) ? resp.data.length : 0;
  } catch { return 0; }
}

async function registerLeague(league) {
  const existing = await db.collection('leagues').doc(league.id).get();
  if (existing.exists) return 'existing';

  await db.collection('leagues').doc(league.id).set({
    name: league.name,
    sport: league.sport,
    state: league.state,
    city: league.city || null,
    region: league.region || null,
    sourcePlatform: league.sourcePlatform,
    sourceConfig: league.sourceConfig,
    status: league.status || 'active',
    autoUpdate: true,
    discoveredAt: new Date().toISOString(),
    discoveredBy: league.discoveredBy,
    lastCollected: null,
    lastDataChange: null,
  });
  console.log(`  + Registered: ${league.id}`);
  return 'created';
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

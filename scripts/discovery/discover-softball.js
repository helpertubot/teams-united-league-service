/**
 * Discover Softball Leagues — All Phase 1 States
 *
 * Discovers youth softball leagues across WA, OR, ID, MT, CA using:
 *   1. GameChanger — search DuckDuckGo for GC softball orgs per state
 *   2. SportsConnect — check if existing LL orgs also have softball seasons
 *   3. GotSport — search for softball events
 *   4. LeagueApps — search for softball leagues
 *
 * Usage:
 *   node scripts/discovery/discover-softball.js [--dry-run] [--save] [--state=WA]
 *
 * Options:
 *   --dry-run   Don't write to Firestore
 *   --save      Register discovered leagues in Firestore
 *   --state=XX  Only search one state
 *   --json      Output JSON at end
 */

const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios');
const cheerio = require('cheerio');
const db = new Firestore();

const PHASE1_STATES = ['WA', 'OR', 'ID', 'MT', 'CA'];
const GC_API_BASE = 'https://api.team-manager.gc.com/public';
const DELAY_MS = 300;
const SEARCH_DELAY_MS = 3000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const save = args.includes('--save');
  const jsonOutput = args.includes('--json');
  const stateFilter = args.find(a => a.startsWith('--state='))?.split('=')[1]?.toUpperCase();

  const states = stateFilter ? [stateFilter] : PHASE1_STATES;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Softball League Discovery — Phase 1 States      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`States: ${states.join(', ')}`);
  console.log(`Options: dryRun=${dryRun}, save=${save}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  const report = {
    timestamp: new Date().toISOString(),
    byState: {},
    totalDiscovered: 0,
    totalSaved: 0,
    totalExisting: 0,
  };

  for (const state of states) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`=== ${state} Softball Discovery ===`);
    console.log(`${'='.repeat(50)}\n`);

    const stateReport = { gc: [], sc: [], gotsport: [], leagueapps: [], errors: [] };

    // 1. GameChanger discovery
    await discoverGCSoftball(state, stateReport, { save, dryRun });

    // 2. Check existing SportsConnect orgs for softball
    await checkSCSoftball(state, stateReport, { save, dryRun });

    // 3. GotSport softball events
    await discoverGotSportSoftball(state, stateReport, { save, dryRun });

    // 4. LeagueApps softball
    await discoverLeagueAppsSoftball(state, stateReport, { save, dryRun });

    report.byState[state] = stateReport;
    const stateTotal = stateReport.gc.length + stateReport.sc.length + stateReport.gotsport.length + stateReport.leagueapps.length;
    report.totalDiscovered += stateTotal;

    console.log(`\n${state} total: ${stateTotal} softball leagues discovered`);
    console.log(`  GameChanger: ${stateReport.gc.length}`);
    console.log(`  SportsConnect: ${stateReport.sc.length}`);
    console.log(`  GotSport: ${stateReport.gotsport.length}`);
    console.log(`  LeagueApps: ${stateReport.leagueapps.length}`);
  }

  // Summary
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  SOFTBALL DISCOVERY SUMMARY                      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`Total discovered: ${report.totalDiscovered}`);
  for (const [state, sr] of Object.entries(report.byState)) {
    const total = sr.gc.length + sr.sc.length + sr.gotsport.length + sr.leagueapps.length;
    console.log(`  ${state}: ${total} (GC:${sr.gc.length} SC:${sr.sc.length} GS:${sr.gotsport.length} LA:${sr.leagueapps.length})`);
  }

  if (jsonOutput) {
    console.log('\n--- JSON ---');
    console.log(JSON.stringify(report, null, 2));
  }
}


// ═══════════════════════════════════════════════════════════════
// GameChanger Softball
// ═══════════════════════════════════════════════════════════════

const STATE_NAMES = {
  WA: 'Washington', OR: 'Oregon', ID: 'Idaho', MT: 'Montana', CA: 'California',
};

async function discoverGCSoftball(state, stateReport, { save, dryRun }) {
  console.log(`\n--- GameChanger Softball (${state}) ---`);

  const stateName = STATE_NAMES[state];
  const queries = [
    `site:web.gc.com/organizations softball "${stateName}" league`,
    `site:web.gc.com/organizations "softball" "${state}" youth`,
    `site:web.gc.com/organizations "fastpitch" "${stateName}"`,
    `site:web.gc.com/organizations "ASA" softball "${stateName}"`,
    `site:web.gc.com/organizations "USA Softball" "${stateName}"`,
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
      console.log(`  → ${allOrgIds.size} unique orgs so far`);
    } catch (err) {
      console.log(`  Error: ${err.message}`);
      stateReport.errors.push({ platform: 'gc', query, error: err.message });
    }
    await sleep(SEARCH_DELAY_MS);
  }

  // Validate each org
  for (const orgId of allOrgIds) {
    try {
      const org = await validateGCOrg(orgId);
      if (!org) continue;
      if (org.type === 'tournament') continue; // league play only
      const orgState = (org.state || '').toUpperCase();
      if (orgState !== state) continue;
      const gcSport = (org.sport || '').toLowerCase();
      if (gcSport !== 'softball' && gcSport !== 'fastpitch') continue;

      const teamCount = await getGCTeamCount(orgId);
      console.log(`  ✓ ${org.name} (${orgId}) — ${teamCount} teams, ${org.season_name || ''} ${org.season_year || ''}`);

      stateReport.gc.push({
        orgId: org.id,
        name: org.name,
        city: org.city,
        state: orgState,
        sport: gcSport,
        teamCount,
        seasonName: org.season_name,
        seasonYear: org.season_year,
      });

      if (save && !dryRun) {
        await registerLeague({
          id: `gc-${org.id}`,
          name: org.name,
          sport: 'softball',
          state: orgState,
          city: org.city,
          sourcePlatform: 'gamechanger',
          sourceConfig: { orgId: org.id, gcSport },
          discoveredBy: 'discover-softball',
        });
      }
    } catch (err) {
      stateReport.errors.push({ orgId, error: err.message });
    }
    await sleep(DELAY_MS);
  }
}


// ═══════════════════════════════════════════════════════════════
// SportsConnect Softball (check existing LL orgs)
// ═══════════════════════════════════════════════════════════════

async function checkSCSoftball(state, stateReport, { save, dryRun }) {
  console.log(`\n--- SportsConnect Softball Check (${state}) ---`);

  // Find existing SC leagues in this state (many LL orgs run both baseball AND softball)
  const snap = await db.collection('leagues')
    .where('sourcePlatform', '==', 'sportsconnect')
    .get();

  const scLeagues = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(l => (l.state || '').toUpperCase() === state);

  console.log(`  Found ${scLeagues.length} existing SC leagues in ${state}`);

  for (const league of scLeagues) {
    const config = league.sourceConfig || {};
    if (!config.baseUrl) continue;

    // Check if the site has softball programs
    try {
      const resp = await axios.get(config.baseUrl, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        maxRedirects: 5,
      });

      const text = resp.data.toLowerCase();
      if (text.includes('softball') || text.includes('fastpitch')) {
        console.log(`  ✓ ${league.name} has softball content`);
        stateReport.sc.push({
          existingLeagueId: league.id,
          name: league.name,
          baseUrl: config.baseUrl,
          note: 'Existing SC org has softball programs — may share tabId or need separate config',
        });

        // Try to find a softball-specific tab
        const $ = cheerio.load(resp.data);
        let softballTabId = null;
        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          const linkText = $(el).text().trim().toLowerCase();
          if (linkText.includes('softball') && href.includes('tabid=')) {
            const m = href.match(/tabid=(\d+)/i);
            if (m) softballTabId = m[1];
          }
        });

        if (softballTabId) {
          console.log(`    → Softball tabId: ${softballTabId}`);
          stateReport.sc[stateReport.sc.length - 1].softballTabId = softballTabId;

          if (save && !dryRun) {
            const softballId = `${league.id}-softball`;
            await registerLeague({
              id: softballId,
              name: `${league.name} (Softball)`,
              sport: 'softball',
              state: league.state,
              region: league.region,
              sourcePlatform: 'sportsconnect',
              sourceConfig: { baseUrl: config.baseUrl, standingsTabId: softballTabId },
              discoveredBy: 'discover-softball',
              status: 'active',
            });
          }
        }
      }
    } catch {
      // Skip unreachable
    }
    await sleep(DELAY_MS);
  }
}


// ═══════════════════════════════════════════════════════════════
// GotSport Softball
// ═══════════════════════════════════════════════════════════════

async function discoverGotSportSoftball(state, stateReport, { save, dryRun }) {
  console.log(`\n--- GotSport Softball (${state}) ---`);

  const stateName = STATE_NAMES[state];
  const queries = [
    `site:system.gotsport.com softball "${stateName}"`,
    `site:system.gotsport.com "youth softball" "${state}"`,
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
      stateReport.errors.push({ platform: 'gotsport', query, error: err.message });
    }
    await sleep(SEARCH_DELAY_MS);
  }

  console.log(`  Found ${eventIds.size} candidate GotSport events`);

  for (const eid of eventIds) {
    try {
      const resp = await axios.get(`https://system.gotsport.com/org_event/events/${eid}`, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        maxRedirects: 5,
        validateStatus: s => s < 500,
      });
      if (resp.status === 200) {
        const text = resp.data.toLowerCase();
        // Only count if it looks like softball AND is in our state AND is league play (not tournament)
        if ((text.includes('softball') || text.includes('fastpitch')) && !text.includes('tournament bracket')) {
          const nameMatch = resp.data.match(/<title>([^<]+)<\/title>/i);
          const eventName = nameMatch ? nameMatch[1].trim() : `GotSport Event ${eid}`;
          console.log(`  ✓ Event ${eid}: ${eventName}`);
          stateReport.gotsport.push({ eventId: eid, name: eventName });
        }
      }
    } catch {
      // Skip
    }
    await sleep(1000);
  }
}


// ═══════════════════════════════════════════════════════════════
// LeagueApps Softball
// ═══════════════════════════════════════════════════════════════

async function discoverLeagueAppsSoftball(state, stateReport, { save, dryRun }) {
  console.log(`\n--- LeagueApps Softball (${state}) ---`);

  const stateName = STATE_NAMES[state];
  const queries = [
    `site:leagueapps.com softball "${stateName}" league standings`,
    `site:leagueapps.com "fastpitch" "${stateName}"`,
    `site:leagueapps.com "youth softball" "${stateName}"`,
  ];

  const seen = new Set();

  for (const query of queries) {
    try {
      const resp = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000,
      });
      // Extract LeagueApps org URLs
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
      stateReport.errors.push({ platform: 'leagueapps', query, error: err.message });
    }
    await sleep(SEARCH_DELAY_MS);
  }
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
  if (existing.exists) {
    console.log(`  ~ ${league.id} already exists`);
    return 'existing';
  }

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

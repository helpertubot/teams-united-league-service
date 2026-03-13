/**
 * Discover OR Soccer League Seasons
 *
 * HTTP-based discovery script for Oregon soccer league seasons.
 * No Puppeteer needed — uses plain HTTP requests + HTML parsing.
 *
 * Checks three platforms:
 *   1. OYSA (SportsAffinity ASP) — discovers league season GUIDs
 *   2. PMSL (Portland Metro Soccer League) — checks if ASP site exists or SCTour API is back
 *   3. USYS NW Conference (GotSport) — checks for 2025-2026 event
 *
 * Usage:
 *   node scripts/discovery/discover-or-soccer-seasons.js [--json]
 *
 * Run on deploy VM:
 *   curl -s -X POST http://35.209.45.82:8080/exec \
 *     -H "Authorization: Bearer $TU_DEPLOY_TOKEN" \
 *     -H 'Content-Type: application/json' \
 *     -d '{"cmd":"cd /home/deploy/workspace/league-standings && node scripts/discovery/discover-or-soccer-seasons.js"}'
 */

const axios = require('axios');

// ═══════════════════════════════════════════════════════════════
// OYSA DISCOVERY
// ═══════════════════════════════════════════════════════════════

const OYSA_BASE_URL = 'https://oysa.sportsaffinity.com';
const OYSA_LIST_URL = `${OYSA_BASE_URL}/tour/public/info/tournamentlist.asp?section=gaming`;

// Known league season GUIDs already registered in Firestore
const KNOWN_LEAGUE_GUIDS = {
  '2A349A09-F127-445D-9252-62C4D1029140': { id: 'oysa-spring-competitive', name: 'OYSA Spring Competitive League', status: 'active' },
  'D07BB454-E1CA-42C9-837D-DADFAADD9FCF': { id: 'oysa-spring-south', name: 'OYSA Spring League - South', status: 'active' },
  '72AD07B7-EE2C-43F5-9108-EDEB82F6B58A': { id: 'oysa-winter-competitive', name: 'OYSA Winter Competitive League', status: 'dormant' },
  'B7972C4B-4CA9-4F0F-91A2-6859C6AA36A2': { id: 'oysa-dev-league', name: 'OYSA Spring Dev League', status: 'active' },
  '5CDA2778-13D0-4E1D-BDC1-6EE6F3161633': { id: 'oysa-valley-academy', name: 'OYSA Spring Valley Academy', status: 'active' },
};

// Patterns that indicate a league season (not a tournament/cup)
const LEAGUE_SEASON_PATTERNS = [
  /\b(spring|fall|winter|summer)\b.*\b(league|competitive|recreational|challenge|premier|division|conference)\b/i,
  /\b(league|competitive|recreational|challenge|premier|division|conference)\b.*\b(spring|fall|winter|summer)\b/i,
  /\b(dev|development)\s+(league)\b/i,
  /\b(valley\s+academy)\b/i,
  /\b(PCL|SCL|RCL)\b/i,
  /\b(U\d{1,2})\b.*\b(league|division)\b/i,
  /\bOYSA\b.*\b(league|conference|division)\b/i,
];

// Patterns that indicate an actual tournament/cup (skip these)
const TOURNAMENT_PATTERNS = [
  /\b(cup|tournament|invitational|classic|showcase|shootout|jamboree|festival|friendly)\b/i,
  /\b(state\s+cup|presidents?\s+cup|national\s+cup)\b/i,
  /\b(playoff|championship|finals)\b/i,
];

function isLeagueSeason(name) {
  if (!name) return false;
  // If it matches a tournament pattern, skip it
  if (TOURNAMENT_PATTERNS.some(p => p.test(name))) return false;
  // If it matches a league pattern, it's a league season
  if (LEAGUE_SEASON_PATTERNS.some(p => p.test(name))) return true;
  // Unknown — include it but flag as uncertain
  return null;
}

async function discoverOYSA() {
  console.log('\n=== OYSA League Season Discovery ===');
  console.log(`Fetching: ${OYSA_LIST_URL}\n`);

  const results = { known: [], newLeagues: [], tournaments: [], uncertain: [], error: null };

  try {
    const resp = await axios.get(OYSA_LIST_URL, {
      timeout: 20000,
      headers: { 'User-Agent': 'TeamsUnited-SeasonDiscovery/1.0' },
    });

    const html = resp.data;
    console.log(`Got ${html.length} bytes of HTML`);

    // Extract all tournament GUIDs from the HTML
    const guidPattern = /tournamentguid=([A-Fa-f0-9-]+)/gi;
    const entries = [];
    let match;
    while ((match = guidPattern.exec(html)) !== null) {
      const guid = match[1].toUpperCase();
      if (!entries.some(e => e.guid === guid)) {
        // Extract name from nearby HTML context
        const pos = match.index;
        const contextStart = Math.max(0, pos - 300);
        const contextEnd = Math.min(html.length, pos + 300);
        const context = html.substring(contextStart, contextEnd);

        // Look for link text or nearby visible text
        let name = null;
        // Try: <a href="...tournamentguid=X">NAME</a>
        const linkMatch = context.match(new RegExp(`tournamentguid=${guid.replace(/-/g, '[-]?')}[^>]*>([^<]{3,100})<`, 'i'));
        if (linkMatch) {
          name = linkMatch[1].trim();
        }
        // Try: nearby text content between > and <
        if (!name) {
          const textMatches = context.match(/>([^<]{5,100})</g);
          if (textMatches) {
            for (const tm of textMatches) {
              const text = tm.replace(/^>|<$/g, '').trim();
              if (text && !text.includes('tournamentguid') && text.length > 4) {
                name = text;
                break;
              }
            }
          }
        }

        entries.push({ guid, name, position: pos });
      }
    }

    console.log(`Found ${entries.length} entries on the OYSA page\n`);

    if (entries.length === 0) {
      console.log('WARNING: No GUIDs found. The page may be JS-rendered (needs Puppeteer).');
      console.log('Checking if page has content...');
      const hasContent = html.includes('tournamentlist') || html.includes('gaming');
      console.log(`Page has relevant content: ${hasContent}`);
      if (html.length < 1000) {
        console.log('Page is very small — likely a redirect or error page');
      }
      results.error = 'No GUIDs found in HTML. Page may be JS-rendered.';
      return results;
    }

    // Classify each entry
    for (const entry of entries) {
      const upperGuid = entry.guid.toUpperCase();

      if (KNOWN_LEAGUE_GUIDS[upperGuid]) {
        const known = KNOWN_LEAGUE_GUIDS[upperGuid];
        results.known.push({
          guid: entry.guid,
          name: entry.name || known.name,
          firestoreId: known.id,
          currentStatus: known.status,
        });
        console.log(`  [KNOWN] ${entry.name || known.name} → ${known.id} (${known.status})`);
        continue;
      }

      const classification = isLeagueSeason(entry.name);
      if (classification === true) {
        results.newLeagues.push({ guid: entry.guid, name: entry.name });
        console.log(`  [NEW LEAGUE] ${entry.name} — GUID: ${entry.guid}`);
      } else if (classification === false) {
        results.tournaments.push({ guid: entry.guid, name: entry.name });
        console.log(`  [TOURNAMENT — skip] ${entry.name}`);
      } else {
        results.uncertain.push({ guid: entry.guid, name: entry.name });
        console.log(`  [UNCERTAIN] ${entry.name || '(unnamed)'} — GUID: ${entry.guid}`);
      }
    }

    // Check for conference tiers (PCL/SCL/RCL) in names
    const allNames = entries.map(e => e.name).filter(Boolean);
    const tiers = { PCL: false, SCL: false, RCL: false };
    for (const name of allNames) {
      if (/\bPCL\b/i.test(name)) tiers.PCL = true;
      if (/\bSCL\b/i.test(name)) tiers.SCL = true;
      if (/\bRCL\b/i.test(name)) tiers.RCL = true;
    }
    if (Object.values(tiers).some(Boolean)) {
      console.log(`\n  Conference tiers found: ${Object.entries(tiers).filter(([, v]) => v).map(([k]) => k).join(', ')}`);
    }

  } catch (err) {
    console.error(`OYSA discovery failed: ${err.message}`);
    if (err.response) {
      console.error(`  HTTP ${err.response.status}: ${err.response.statusText}`);
    }
    results.error = err.message;
  }

  return results;
}


// ═══════════════════════════════════════════════════════════════
// PMSL DISCOVERY
// ═══════════════════════════════════════════════════════════════

async function discoverPMSL() {
  console.log('\n=== PMSL Platform Check ===\n');

  const results = { platform: null, status: null, details: null };

  // Check 1: Does PMSL have its own SportsAffinity ASP site?
  const pmslAspUrls = [
    'https://pmsl.sportsaffinity.com/tour/public/info/tournamentlist.asp?section=gaming',
    'https://portlandmetrosoccerleague.sportsaffinity.com/tour/public/info/tournamentlist.asp?section=gaming',
  ];

  for (const url of pmslAspUrls) {
    const domain = new URL(url).hostname;
    console.log(`Checking ASP site: ${domain}...`);
    try {
      const resp = await axios.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'TeamsUnited-Discovery/1.0' },
        maxRedirects: 3,
      });
      console.log(`  HTTP ${resp.status} — ${resp.data.length} bytes`);

      // Check if it has tournament GUIDs
      const guidMatch = resp.data.match(/tournamentguid=([A-Fa-f0-9-]+)/i);
      if (guidMatch) {
        console.log(`  FOUND league season GUIDs on ${domain}`);
        results.platform = 'sportsaffinity-asp';
        results.status = 'found';
        results.details = { baseUrl: `https://${domain}`, sampleGuid: guidMatch[1] };

        // Count total GUIDs
        const allGuids = new Set();
        let m;
        const re = /tournamentguid=([A-Fa-f0-9-]+)/gi;
        while ((m = re.exec(resp.data)) !== null) allGuids.add(m[1].toUpperCase());
        results.details.totalEntries = allGuids.size;
        console.log(`  Total entries: ${allGuids.size}`);
        return results;
      } else {
        console.log(`  Page loaded but no GUIDs found (may be JS-rendered)`);
      }
    } catch (err) {
      if (err.response) {
        console.log(`  HTTP ${err.response.status} — ${err.response.statusText}`);
      } else if (err.code === 'ENOTFOUND') {
        console.log(`  DNS not found — domain doesn't exist`);
      } else {
        console.log(`  Error: ${err.message}`);
      }
    }
  }

  // Check 2: Is the SCTour JSON API back?
  const sctourUrl = 'https://sctour.sportsaffinity.com/api/tournaments?organizationId=6857D9A0-8945-44E1-84E8-F3DECC87D56C';
  console.log(`\nChecking SCTour JSON API...`);
  try {
    const resp = await axios.get(sctourUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'TeamsUnited-Discovery/1.0' },
    });
    console.log(`  HTTP ${resp.status} — API is BACK!`);
    if (Array.isArray(resp.data) && resp.data.length > 0) {
      console.log(`  Found ${resp.data.length} season(s)`);
      results.platform = 'sportsaffinity';
      results.status = 'found';
      results.details = { seasons: resp.data.map(s => ({ name: s.name, guid: s.tournamentKey || s.tournamentGuid, status: s.tournamentStatus })) };
      return results;
    }
    console.log(`  API returned empty/invalid data`);
  } catch (err) {
    if (err.response) {
      console.log(`  HTTP ${err.response.status} — API still down`);
    } else {
      console.log(`  Error: ${err.message}`);
    }
  }

  // Check 3: Is PMSL on a different subdomain of OYSA?
  // PMSL org GUID: 6857D9A0-8945-44E1-84E8-F3DECC87D56C
  // Check if PMSL is hosted within OYSA's system
  const oysaPmslUrl = `${OYSA_BASE_URL}/tour/public/info/tournamentlist.asp?section=gaming&org=6857D9A0-8945-44E1-84E8-F3DECC87D56C`;
  console.log(`\nChecking if PMSL is within OYSA system...`);
  try {
    const resp = await axios.get(oysaPmslUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'TeamsUnited-Discovery/1.0' },
    });
    console.log(`  HTTP ${resp.status} — ${resp.data.length} bytes`);
    // This likely returns the same OYSA list regardless of org param,
    // but worth checking
    const hasPmsl = /PMSL|Portland\s+Metro/i.test(resp.data);
    if (hasPmsl) {
      console.log(`  PMSL content found in OYSA system!`);
      results.platform = 'sportsaffinity-asp';
      results.status = 'within-oysa';
      results.details = { baseUrl: OYSA_BASE_URL, note: 'PMSL may be hosted within OYSA SportsAffinity' };
      return results;
    }
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }

  // Check 4: Try common SportsAffinity base URLs
  const otherUrls = [
    'https://sctour.sportsaffinity.com/tour/public/info/tournamentlist.asp?section=gaming',
  ];
  for (const url of otherUrls) {
    console.log(`\nChecking: ${url}...`);
    try {
      const resp = await axios.get(url, { timeout: 10000 });
      console.log(`  HTTP ${resp.status} — ${resp.data.length} bytes`);
      const hasPmsl = /PMSL|Portland\s+Metro/i.test(resp.data);
      if (hasPmsl) {
        console.log(`  PMSL content found!`);
        results.platform = 'sportsaffinity-asp';
        results.status = 'found';
        results.details = { url };
        return results;
      }
    } catch (err) {
      if (err.response) {
        console.log(`  HTTP ${err.response.status}`);
      } else {
        console.log(`  Error: ${err.message}`);
      }
    }
  }

  results.platform = 'unknown';
  results.status = 'not-found';
  results.details = { note: 'PMSL platform not discovered. May need manual investigation or the org is on a platform we have not checked.' };
  console.log('\nPMSL: Could not determine platform. Manual investigation needed.');

  return results;
}


// ═══════════════════════════════════════════════════════════════
// USYS NW CONFERENCE DISCOVERY (GotSport)
// ═══════════════════════════════════════════════════════════════

async function discoverUSYSNW() {
  console.log('\n=== USYS NW Conference Check ===\n');

  const results = { found: false, eventId: null, details: null };

  // Known: 2024-2025 event was 34040
  // Check if the old event still has standings
  const knownEventId = '34040';
  const baseUrl = 'https://system.gotsport.com';

  console.log(`Checking known event ${knownEventId} (2024-2025)...`);
  try {
    const url = `${baseUrl}/org_event/events/${knownEventId}`;
    const resp = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'TeamsUnited-Discovery/1.0' },
      maxRedirects: 5,
    });
    console.log(`  HTTP ${resp.status} — ${resp.data.length} bytes`);
    // Look for event name/year in the page
    const yearMatch = resp.data.match(/20[0-9]{2}[-/]20[0-9]{2}/);
    if (yearMatch) {
      console.log(`  Event year: ${yearMatch[0]}`);
    }
    // Check if event has results
    const hasResults = /results|standings|group/i.test(resp.data);
    console.log(`  Has results/standings: ${hasResults}`);
  } catch (err) {
    if (err.response) {
      console.log(`  HTTP ${err.response.status} — event may be archived`);
    } else {
      console.log(`  Error: ${err.message}`);
    }
  }

  // Search for new event IDs (try incremental from known)
  // GotSport event IDs are sequential, so new seasons get higher IDs
  const candidates = [];
  // Try a range around what we'd expect for 2025-2026
  // Also try some search URLs
  console.log(`\nSearching for 2025-2026 USYS NW Conference event...`);

  // Method 1: Check GotSport search/org page for US Youth Soccer events
  const searchUrls = [
    `${baseUrl}/org_event/events?search=Northwest+Conference`,
    `${baseUrl}/org_event/events?search=USYS+NW`,
    `${baseUrl}/org_event/events?search=US+Youth+Soccer+Northwest`,
  ];

  for (const url of searchUrls) {
    console.log(`  Searching: ${url}`);
    try {
      const resp = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'TeamsUnited-Discovery/1.0' },
        maxRedirects: 5,
      });

      // Look for event IDs in the response
      const eventPattern = /events\/(\d{4,6})/g;
      let m;
      while ((m = eventPattern.exec(resp.data)) !== null) {
        const eid = m[1];
        if (eid !== knownEventId && !candidates.includes(eid)) {
          candidates.push(eid);
        }
      }

      // Check for "2025-2026" or "2025/2026" in context near event links
      if (/2025[-/]2026/i.test(resp.data)) {
        console.log(`  Found "2025-2026" reference!`);
        // Extract the event ID near the 2025-2026 text
        const idx = resp.data.indexOf('2025-2026') >= 0 ? resp.data.indexOf('2025-2026') : resp.data.indexOf('2025/2026');
        if (idx >= 0) {
          const nearContext = resp.data.substring(Math.max(0, idx - 500), idx + 500);
          const nearEvent = nearContext.match(/events\/(\d{4,6})/);
          if (nearEvent) {
            console.log(`  → Candidate event ID: ${nearEvent[1]}`);
            results.found = true;
            results.eventId = nearEvent[1];
          }
        }
      }
    } catch (err) {
      if (err.response) {
        console.log(`  HTTP ${err.response.status}`);
      } else {
        console.log(`  Error: ${err.message}`);
      }
    }
  }

  // Method 2: Try sequential IDs near the known event
  if (!results.found) {
    console.log(`\n  Trying sequential event IDs near ${knownEventId}...`);
    // Try IDs from knownEventId+1000 to knownEventId+5000 (sample a few)
    const base = parseInt(knownEventId);
    const probe = [base + 1000, base + 2000, base + 3000, base + 4000, base + 5000,
                   base + 6000, base + 7000, base + 8000, base + 9000, base + 10000];
    for (const eid of probe) {
      try {
        const url = `${baseUrl}/org_event/events/${eid}`;
        const resp = await axios.get(url, {
          timeout: 8000,
          headers: { 'User-Agent': 'TeamsUnited-Discovery/1.0' },
          maxRedirects: 5,
          validateStatus: s => s < 500,
        });
        if (resp.status === 200 && /northwest.*conference|usys.*nw/i.test(resp.data)) {
          console.log(`  → Found USYS NW at event ${eid}!`);
          results.found = true;
          results.eventId = String(eid);
          break;
        }
      } catch (err) {
        // Skip network errors on probing
      }
    }
    if (!results.found) {
      console.log(`  No match found in sequential probe.`);
    }
  }

  if (candidates.length > 0) {
    console.log(`\n  Other event ID candidates from search: ${candidates.join(', ')}`);
    results.details = { candidates };
  }

  if (!results.found) {
    console.log('\nUSYS NW Conference: 2025-2026 event NOT found.');
    console.log('The event may not have been created yet, or uses a different name.');
    results.details = { ...results.details, note: 'Event not found. May not exist yet for 2025-2026 season.' };
  }

  return results;
}


// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const jsonOutput = process.argv.includes('--json');

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  OR Soccer League Season Discovery           ║');
  console.log('║  HTTP-based — no Puppeteer required          ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`Date: ${new Date().toISOString()}\n`);

  const report = {
    timestamp: new Date().toISOString(),
    oysa: null,
    pmsl: null,
    usysNw: null,
  };

  // 1. OYSA
  report.oysa = await discoverOYSA();

  // 2. PMSL
  report.pmsl = await discoverPMSL();

  // 3. USYS NW Conference
  report.usysNw = await discoverUSYSNW();

  // ── Summary ──
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  DISCOVERY SUMMARY                           ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // OYSA
  console.log('OYSA:');
  console.log(`  Known league seasons: ${report.oysa.known.length}`);
  console.log(`  New league seasons: ${report.oysa.newLeagues.length}`);
  console.log(`  Tournaments (skipped): ${report.oysa.tournaments.length}`);
  console.log(`  Uncertain: ${report.oysa.uncertain.length}`);
  if (report.oysa.error) console.log(`  Error: ${report.oysa.error}`);

  if (report.oysa.newLeagues.length > 0) {
    console.log('\n  New leagues to register:');
    for (const l of report.oysa.newLeagues) {
      console.log(`    → ${l.name} (GUID: ${l.guid})`);
    }
  }
  if (report.oysa.uncertain.length > 0) {
    console.log('\n  Uncertain entries (review manually):');
    for (const u of report.oysa.uncertain) {
      console.log(`    ? ${u.name || '(unnamed)'} (GUID: ${u.guid})`);
    }
  }

  // PMSL
  console.log(`\nPMSL: ${report.pmsl.status || 'unknown'}`);
  if (report.pmsl.platform) console.log(`  Platform: ${report.pmsl.platform}`);
  if (report.pmsl.details) console.log(`  Details: ${JSON.stringify(report.pmsl.details)}`);

  // USYS NW
  console.log(`\nUSYS NW Conference: ${report.usysNw.found ? 'FOUND' : 'not found'}`);
  if (report.usysNw.eventId) console.log(`  Event ID: ${report.usysNw.eventId}`);
  if (report.usysNw.details) console.log(`  Details: ${JSON.stringify(report.usysNw.details)}`);

  // ── Next Steps ──
  console.log('\n--- Next Steps ---');
  const steps = [];

  if (report.oysa.newLeagues.length > 0) {
    steps.push('Register new OYSA league seasons via or-soccer-expansion-phase2.js');
  }
  if (report.oysa.known.length > 0) {
    const dormant = report.oysa.known.filter(k => k.currentStatus === 'dormant');
    if (dormant.length > 0) {
      steps.push(`Update discoveryConfig for ${dormant.length} dormant OYSA league(s)`);
    }
  }
  if (report.pmsl.status === 'found') {
    steps.push(`Update PMSL league to use ${report.pmsl.platform} adapter`);
  } else {
    steps.push('PMSL: manual investigation needed — platform not auto-discovered');
  }
  if (report.usysNw.found) {
    steps.push(`Update USYS NW Conference with new event ID: ${report.usysNw.eventId}`);
  } else {
    steps.push('USYS NW: 2025-2026 event not found yet — check back later');
  }

  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

  if (jsonOutput) {
    console.log('\n--- JSON Report ---');
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

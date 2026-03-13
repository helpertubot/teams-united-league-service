/**
 * Discover OYSA Tournaments
 *
 * Puppeteer-based script that discovers all tournaments on the OYSA
 * SportsAffinity ASP system. Navigates the tournament list page,
 * extracts all tournament GUIDs and names, then checks each for
 * active flights (divisions).
 *
 * Cross-references against known GUIDs to identify NEW tournaments.
 *
 * Usage:
 *   node scripts/discovery/discover-oysa-tournaments.js [--dry-run] [--json] [--base-url=URL]
 *
 * Run on deploy VM (needs Puppeteer):
 *   curl -s -X POST http://35.209.45.82:8080/exec \
 *     -H "Authorization: Bearer $TU_DEPLOY_TOKEN" \
 *     -H 'Content-Type: application/json' \
 *     -d '{"cmd":"cd /home/deploy/workspace/league-standings && node scripts/discovery/discover-oysa-tournaments.js"}'
 */

const { launchBrowser } = require('../../browser');

const DEFAULT_BASE_URL = 'https://oysa.sportsaffinity.com';

// Known tournament GUIDs already registered in Firestore
const KNOWN_GUIDS = {
  '2A349A09-F127-445D-9252-62C4D1029140': 'oysa-spring-competitive',
  'D07BB454-E1CA-42C9-837D-DADFAADD9FCF': 'oysa-spring-south',
  '72AD07B7-EE2C-43F5-9108-EDEB82F6B58A': 'oysa-winter-competitive',
  'B7972C4B-4CA9-4F0F-91A2-6859C6AA36A2': 'oysa-dev-league',
  '5CDA2778-13D0-4E1D-BDC1-6EE6F3161633': 'oysa-valley-academy',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function discoverTournaments(baseUrl) {
  const url = `${baseUrl}/tour/public/info/tournamentlist.asp?section=gaming`;
  console.log(`\nDiscovering tournaments from: ${url}\n`);

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 TeamsUnited-Discovery/1.0');

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(5000); // Wait for JS rendering

    // Extract all tournament links from the page
    const tournaments = await page.evaluate(() => {
      const results = [];

      // Look for links containing tournamentguid parameter
      const links = document.querySelectorAll('a[href*="tournamentguid"], a[href*="TournamentGUID"]');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/tournamentguid=([A-Fa-f0-9-]+)/i);
        if (match) {
          const guid = match[1].toUpperCase();
          const name = link.textContent.trim();
          if (!results.some(r => r.guid === guid)) {
            results.push({ guid, name: name || null, href });
          }
        }
      }

      // Also check table cells and list items for tournament info
      const rows = document.querySelectorAll('tr, li');
      for (const row of rows) {
        const link = row.querySelector('a[href*="tournamentguid"], a[href*="TournamentGUID"]');
        if (!link) continue;

        const href = link.getAttribute('href') || '';
        const match = href.match(/tournamentguid=([A-Fa-f0-9-]+)/i);
        if (!match) continue;

        const guid = match[1].toUpperCase();
        if (results.some(r => r.guid === guid)) {
          // Update name if we find a better one from the row context
          const existing = results.find(r => r.guid === guid);
          if (!existing.name || existing.name.length < 5) {
            const rowText = row.textContent.trim();
            if (rowText.length > existing.name?.length) {
              existing.name = rowText.split('\n')[0].trim();
            }
          }
          continue;
        }

        results.push({
          guid,
          name: link.textContent.trim() || row.textContent.trim().split('\n')[0].trim(),
          href,
        });
      }

      // Also try to extract any dates visible near tournament names
      // This is heuristic — ASP pages vary in structure
      const pageText = document.body.innerText;
      for (const r of results) {
        if (r.name) {
          // Look for date patterns near the tournament name
          const nameIdx = pageText.indexOf(r.name);
          if (nameIdx >= 0) {
            const context = pageText.substring(nameIdx, nameIdx + 200);
            const dateMatch = context.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
            if (dateMatch) {
              r.dateHint = dateMatch[1];
            }
          }
        }
      }

      return results;
    });

    console.log(`Found ${tournaments.length} tournaments on the list page.\n`);
    return { tournaments, page, browser };
  } catch (err) {
    console.error(`Failed to load tournament list: ${err.message}`);
    if (browser) await browser.close();
    return { tournaments: [], page: null, browser: null };
  }
}

async function countFlights(page, baseUrl, tournamentGuid) {
  const url = `${baseUrl}/tour/public/info/accepted_list.asp?tournamentguid=${tournamentGuid}`;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(5000); // Wait for JS rendering

    const flights = await page.evaluate(() => {
      const results = [];
      const links = document.querySelectorAll('a[href*="flightguid"], a[href*="FlightGUID"]');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/flightguid=([A-Fa-f0-9-]+)/i);
        if (match) {
          const guid = match[1];
          const name = link.textContent.trim();
          if (!results.some(r => r.flightGuid === guid)) {
            results.push({ flightGuid: guid, name: name || null });
          }
        }
      }
      return results;
    });

    return flights;
  } catch (err) {
    console.error(`  Failed to count flights for ${tournamentGuid}: ${err.message}`);
    return [];
  }
}

function classifyTournament(guid, name) {
  const upperGuid = guid.toUpperCase();
  if (KNOWN_GUIDS[upperGuid]) {
    return { status: 'known', firestoreId: KNOWN_GUIDS[upperGuid] };
  }
  return { status: 'new', firestoreId: null };
}

function detectConferenceTier(flightNames) {
  const tiers = new Set();
  for (const name of flightNames) {
    const upper = name.toUpperCase();
    if (upper.includes('PCL')) tiers.add('PCL');
    if (upper.includes('SCL')) tiers.add('SCL');
    if (upper.includes('RCL')) tiers.add('RCL');
  }
  return [...tiers];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const jsonOutput = process.argv.includes('--json');
  const baseUrlArg = process.argv.find(a => a.startsWith('--base-url='));
  const baseUrl = baseUrlArg ? baseUrlArg.split('=')[1] : DEFAULT_BASE_URL;

  console.log('=== OYSA Tournament Discovery ===');
  console.log(`Base URL: ${baseUrl}`);
  if (dryRun) console.log('(DRY RUN — no Firestore writes)');

  const { tournaments, page, browser } = await discoverTournaments(baseUrl);

  if (tournaments.length === 0) {
    console.log('No tournaments found. The page may require different scraping logic.');
    if (browser) await browser.close();
    process.exit(1);
  }

  const report = {
    baseUrl,
    discoveredAt: new Date().toISOString(),
    totalTournaments: tournaments.length,
    known: [],
    new: [],
    conferenceTiers: {},
  };

  for (const tournament of tournaments) {
    const classification = classifyTournament(tournament.guid, tournament.name);
    const entry = {
      guid: tournament.guid,
      name: tournament.name,
      dateHint: tournament.dateHint || null,
      ...classification,
      flights: [],
      conferenceTiers: [],
    };

    // Count flights for each tournament
    if (page) {
      console.log(`Checking flights for: ${tournament.name || tournament.guid}...`);
      const flights = await countFlights(page, baseUrl, tournament.guid);
      entry.flights = flights;
      entry.flightCount = flights.length;

      const flightNames = flights.map(f => f.name).filter(Boolean);
      entry.conferenceTiers = detectConferenceTier(flightNames);

      if (entry.conferenceTiers.length > 0) {
        for (const tier of entry.conferenceTiers) {
          if (!report.conferenceTiers[tier]) report.conferenceTiers[tier] = [];
          report.conferenceTiers[tier].push(tournament.guid);
        }
      }

      console.log(`  → ${flights.length} flights${entry.conferenceTiers.length > 0 ? ` (tiers: ${entry.conferenceTiers.join(', ')})` : ''}`);

      // Respectful delay between pages
      await sleep(2000);
    }

    if (classification.status === 'known') {
      report.known.push(entry);
    } else {
      report.new.push(entry);
    }
  }

  if (browser) await browser.close();

  // Output report
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n=== Discovery Report ===\n');

    console.log(`Total tournaments: ${report.totalTournaments}`);
    console.log(`Known (already registered): ${report.known.length}`);
    console.log(`New (not yet registered): ${report.new.length}`);

    if (report.known.length > 0) {
      console.log('\n--- Known Tournaments ---');
      for (const t of report.known) {
        console.log(`  ✓ ${t.name || '(unnamed)'}`);
        console.log(`    GUID: ${t.guid}`);
        console.log(`    Firestore ID: ${t.firestoreId}`);
        console.log(`    Flights: ${t.flightCount || 0}`);
        if (t.conferenceTiers.length > 0) {
          console.log(`    Conference tiers: ${t.conferenceTiers.join(', ')}`);
        }
      }
    }

    if (report.new.length > 0) {
      console.log('\n--- NEW Tournaments (not yet registered) ---');
      for (const t of report.new) {
        console.log(`  ★ ${t.name || '(unnamed)'}`);
        console.log(`    GUID: ${t.guid}`);
        console.log(`    Flights: ${t.flightCount || 0}`);
        if (t.dateHint) console.log(`    Date hint: ${t.dateHint}`);
        if (t.conferenceTiers.length > 0) {
          console.log(`    Conference tiers: ${t.conferenceTiers.join(', ')}`);
        }
        if (t.flights.length > 0) {
          console.log('    Sample flights:');
          for (const f of t.flights.slice(0, 5)) {
            console.log(`      - ${f.name || f.flightGuid}`);
          }
          if (t.flights.length > 5) {
            console.log(`      ... and ${t.flights.length - 5} more`);
          }
        }
      }
    }

    if (Object.keys(report.conferenceTiers).length > 0) {
      console.log('\n--- Conference Tier Analysis ---');
      console.log('This answers: Do PCL/SCL have separate GUIDs from RCL?');
      for (const [tier, guids] of Object.entries(report.conferenceTiers)) {
        console.log(`  ${tier}: found in ${guids.length} tournament(s)`);
        for (const guid of guids) {
          const t = tournaments.find(t => t.guid === guid);
          console.log(`    - ${t?.name || guid}`);
        }
      }
    }

    console.log('\n--- Next Steps ---');
    if (report.new.length > 0) {
      console.log('1. Review new tournaments above');
      console.log('2. Add to scripts/setup/or-soccer-expansion-phase2.js');
      console.log('3. Register via deploy VM');
    } else {
      console.log('No new tournaments found. All OYSA tournaments are already registered.');
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

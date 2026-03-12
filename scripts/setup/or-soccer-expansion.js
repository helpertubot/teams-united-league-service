/**
 * Register OR Soccer Leagues — Oregon Expansion
 *
 * Registers discovered Oregon youth soccer leagues into Firestore.
 * Covers OYSA competitive leagues, PMSL, and US Youth Soccer NW Conference.
 *
 * IMPORTANT: OYSA uses the OLD SportsAffinity ASP system at oysa.sportsaffinity.com,
 * NOT the SCTour JSON API used by WA (WYS). The old ASP system has completely
 * different URL patterns and requires browser automation:
 *
 *   Tournament list: oysa.sportsaffinity.com/tour/public/info/tournamentlist.asp?section=gaming
 *   Accepted teams:  oysa.sportsaffinity.com/tour/public/info/accepted_list.asp?tournamentguid={GUID}
 *   Standings:        oysa.sportsaffinity.com/tour/public/info/schedule_standings.asp?tournamentguid={GUID}&flightguid={GUID}
 *
 * The accepted_list and standings pages are JavaScript SPAs that require Puppeteer
 * to render. Flight GUIDs (divisions within a tournament) are discovered dynamically
 * from the accepted_list page.
 *
 * Tournament GUIDs discovered from the tournament list page (March 2026):
 *   2A349A09-F127-445D-9252-62C4D1029140 — 2026 OYSA Spring League
 *   D07BB454-E1CA-42C9-837D-DADFAADD9FCF — 2026 OYSA Spring League - South
 *   72AD07B7-EE2C-43F5-9108-EDEB82F6B58A — 2026 OYSA Winter League
 *   B7972C4B-4CA9-4F0F-91A2-6859C6AA36A2 — 2026 OYSA Spring Development League
 *   5CDA2778-13D0-4E1D-BDC1-6EE6F3161633 — 2026 Spring Valley Academy League
 *
 * PMSL (Portland Metro Soccer League) — separate org, also old ASP system.
 * PMSL org GUID 6857D9A0 was found on indexed sctour.sportsaffinity.com pages,
 * but PMSL may also use the old ASP system. Needs verification.
 *
 * Run on deploy VM:
 *   node scripts/or-soccer-expansion.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

const LEAGUES = [
  // ── OYSA Spring League (U11-U14 Competitive) ──
  {
    id: 'oysa-spring-competitive',
    name: 'OYSA Spring Competitive League (U11-U14)',
    state: 'OR',
    sport: 'soccer',
    region: 'Statewide',
    sourcePlatform: 'sportsaffinity-asp',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      tournamentGuid: '2A349A09-F127-445D-9252-62C4D1029140',
      // flightGuids: [] — needs discovery via browser on accepted_list page
    },
    seasonStart: '2026-03-07',
    seasonEnd: '2026-06-15',
    notes: 'OYSA Spring competitive, U11-U14. Uses OLD SportsAffinity ASP system (not SCTour JSON API). Tournament GUID verified from oysa.sportsaffinity.com tournament list. Flight GUIDs (divisions) need browser-based discovery from accepted_list page.',
  },

  // ── OYSA Spring League South ──
  {
    id: 'oysa-spring-south',
    name: 'OYSA Spring League - South',
    state: 'OR',
    sport: 'soccer',
    region: 'Southern Oregon',
    sourcePlatform: 'sportsaffinity-asp',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      tournamentGuid: 'D07BB454-E1CA-42C9-837D-DADFAADD9FCF',
    },
    seasonStart: '2026-03-07',
    seasonEnd: '2026-06-15',
    notes: 'OYSA Spring League South region. Separate tournament from main Spring League. Tournament GUID from oysa.sportsaffinity.com.',
  },

  // ── OYSA Winter League (U15-U19 Competitive) ──
  {
    id: 'oysa-winter-competitive',
    name: 'OYSA Winter Competitive League (U15-U19)',
    state: 'OR',
    sport: 'soccer',
    region: 'Statewide',
    sourcePlatform: 'sportsaffinity-asp',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      tournamentGuid: '72AD07B7-EE2C-43F5-9108-EDEB82F6B58A',
    },
    seasonStart: '2025-11-01',
    seasonEnd: '2026-02-28',
    notes: 'OYSA Winter competitive, U15-U19. Tournament GUID from oysa.sportsaffinity.com. Flight GUIDs need browser discovery.',
  },

  // ── OYSA Spring Development League (U8) ──
  {
    id: 'oysa-dev-league',
    name: 'OYSA Spring Development League (U8)',
    state: 'OR',
    sport: 'soccer',
    region: 'Statewide',
    sourcePlatform: 'sportsaffinity-asp',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      tournamentGuid: 'B7972C4B-4CA9-4F0F-91A2-6859C6AA36A2',
    },
    notes: 'OYSA developmental league, U8. Tournament GUID from oysa.sportsaffinity.com.',
  },

  // ── OYSA Valley Academy League (U9-U10) ──
  {
    id: 'oysa-valley-academy',
    name: 'OYSA Spring Valley Academy League (U9-U10)',
    state: 'OR',
    sport: 'soccer',
    region: 'Willamette Valley',
    sourcePlatform: 'sportsaffinity-asp',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      baseUrl: 'https://oysa.sportsaffinity.com',
      tournamentGuid: '5CDA2778-13D0-4E1D-BDC1-6EE6F3161633',
    },
    notes: 'OYSA Valley Academy developmental league, U9-U10. Tournament GUID from oysa.sportsaffinity.com.',
  },

  // ── PMSL (Portland Metro Soccer League) ──
  // PMSL org was found on indexed sctour pages but may use old ASP system too.
  // Registering as pending until platform is confirmed.
  {
    id: 'pmsl-or',
    name: 'Portland Metro Soccer League (PMSL)',
    state: 'OR',
    sport: 'soccer',
    region: 'Portland Metro',
    sourcePlatform: 'sportsaffinity', // may be sportsaffinity-asp — needs verification
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      organizationId: '6857D9A0-8945-44E1-84E8-F3DECC87D56C',
      seasonGuid: '72FE5B3C-57AA-44DC-AE48-95DA4D0536E4', // from indexed sctour standings URL
    },
    seasonStart: '2025-09-01',
    seasonEnd: '2026-06-30',
    notes: 'Portland Metro Soccer League. Org GUID from indexed sctour.sportsaffinity.com standings URL. SCTour API currently offline (Azure 404). May use old ASP system instead — needs verification when API recovers.',
  },

  // ── US Youth Soccer Northwest Conference (GotSport) ──
  {
    id: 'usys-nw-conference',
    name: 'US Youth Soccer Northwest Conference',
    state: 'OR',
    sport: 'soccer',
    region: 'Pacific Northwest',
    sourcePlatform: 'gotsport',
    status: 'pending_config',
    autoUpdate: false,
    sourceConfig: {
      leagueEventId: '24590', // 2023-2024 event, needs current season ID
      groups: [],
    },
    notes: 'Multi-state conference: OR, WA, ID, WY, MT, AK, HI. GotSport event 24590 is 2023-2024. Need current 2025-2026 event ID and group IDs. U13-U19 boys and girls.',
  },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== OR Soccer Expansion: Registering ${LEAGUES.length} leagues ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  const results = { created: [], skipped: [], errors: [] };

  for (const league of LEAGUES) {
    try {
      const existing = await db.collection('leagues').doc(league.id).get();
      if (existing.exists) {
        console.log(`  ~ Already exists: ${league.id} — ${league.name}`);
        results.skipped.push(league.id);
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would add: ${league.id} — ${league.name} (${league.sourcePlatform}, ${league.status})`);
        results.created.push(league.id);
        continue;
      }

      const leagueData = {
        name: league.name,
        state: league.state,
        sport: league.sport,
        region: league.region || null,
        sourcePlatform: league.sourcePlatform,
        sourceConfig: league.sourceConfig || {},
        status: league.status,
        autoUpdate: league.autoUpdate || false,
        seasonStart: league.seasonStart || null,
        seasonEnd: league.seasonEnd || null,
        notes: league.notes || null,
        discoveredAt: new Date().toISOString(),
        discoveredBy: 'or-soccer-expansion',
      };

      await db.collection('leagues').doc(league.id).set(leagueData);
      console.log(`  + Created: ${league.id} — ${league.name} (${league.status})`);
      results.created.push(league.id);
    } catch (err) {
      console.error(`  ! Error on ${league.id}: ${err.message}`);
      results.errors.push({ id: league.id, error: err.message });
    }
  }

  // Summary
  console.log('\n=== Registration Summary ===');
  console.log(`Created: ${results.created.length}`);
  console.log(`Skipped (already exist): ${results.skipped.length}`);
  console.log(`Errors: ${results.errors.length}`);

  if (results.created.length > 0) {
    console.log('\nCreated leagues:');
    results.created.forEach(id => console.log(`  - ${id}`));
  }

  // Status breakdown
  const byPlatform = {};
  for (const l of LEAGUES) {
    byPlatform[l.sourcePlatform] = (byPlatform[l.sourcePlatform] || 0) + 1;
  }

  console.log('\n--- Platform Breakdown ---');
  for (const [platform, count] of Object.entries(byPlatform)) {
    console.log(`  ${platform}: ${count} leagues`);
  }

  console.log('\n--- Next Steps ---');
  console.log('1. Build sportsaffinity-asp adapter (Puppeteer-based) for OYSA old ASP pages');
  console.log('2. Discover flight GUIDs from accepted_list pages for each tournament');
  console.log('3. Verify PMSL platform (sctour JSON API vs old ASP)');
  console.log('4. Find current USYS NW Conference GotSport event ID');
  console.log('5. Once adapter is ready, update status to active and autoUpdate to true');

  // Log the run
  if (!dryRun) {
    await db.collection('discoveryLogs').add({
      function: 'or-soccer-expansion',
      leaguesCreated: results.created.length,
      leaguesSkipped: results.skipped.length,
      errors: results.errors.length,
      timestamp: new Date().toISOString(),
    });
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

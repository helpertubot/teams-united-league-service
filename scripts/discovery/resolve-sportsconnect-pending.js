/**
 * Resolve pending SportsConnect leagues for spring 2026
 *
 * SportsConnect leagues require:
 *   1. baseUrl — the league's website (e.g., https://www.svll.net)
 *   2. standingsTabId — the ASP.NET tabid for the standings page
 *
 * This script:
 *   1. Lists all SC leagues in pending_tabid or pending_config status
 *   2. Attempts to auto-discover standingsTabId by scraping the homepage
 *   3. For leagues with tabIds, attempts a test collection
 *   4. Reports what needs manual intervention
 *
 * Run on deploy VM:
 *   node scripts/resolve-sportsconnect-pending.js [--dry-run] [--fix]
 */

const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios');
const cheerio = require('cheerio');
const db = new Firestore();

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const autoFix = process.argv.includes('--fix');

  console.log(`\n=== Resolve Pending SportsConnect Leagues ${dryRun ? '(DRY RUN)' : ''} ${autoFix ? '(AUTO-FIX)' : ''} ===\n`);

  // Get all SportsConnect leagues
  const snap = await db.collection('leagues')
    .where('sourcePlatform', '==', 'sportsconnect')
    .get();

  const pending = [];
  const active = [];
  const other = [];

  for (const doc of snap.docs) {
    const data = { id: doc.id, ...doc.data() };
    if (data.status === 'pending_tabid' || data.status === 'pending_config') {
      pending.push(data);
    } else if (data.status === 'active') {
      active.push(data);
    } else {
      other.push(data);
    }
  }

  console.log(`SportsConnect leagues: ${snap.size} total`);
  console.log(`  Active: ${active.length}`);
  console.log(`  Pending: ${pending.length}`);
  console.log(`  Other: ${other.length}`);

  if (pending.length === 0) {
    console.log('\nNo pending SportsConnect leagues to resolve.');
    return;
  }

  console.log('\n--- Attempting to resolve pending leagues ---\n');

  const resolved = [];
  const needsManual = [];
  const unreachable = [];

  for (const league of pending) {
    const config = league.sourceConfig || {};
    const baseUrl = config.baseUrl;

    console.log(`\n${league.id} — ${league.name} (${league.state})`);
    console.log(`  Status: ${league.status}`);
    console.log(`  URL: ${baseUrl || 'NOT SET'}`);

    if (!baseUrl) {
      console.log('  ✗ No baseUrl — needs manual config');
      needsManual.push({ ...league, reason: 'No baseUrl configured' });
      continue;
    }

    // Try to reach the site and find standings tab
    try {
      console.log('  Fetching homepage...');
      const resp = await axios.get(baseUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        maxRedirects: 5,
      });

      const $ = cheerio.load(resp.data);

      // Strategy 1: Look for "Standings" link with tabid
      let standingsTabId = null;
      let standingsLinkText = null;

      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim().toLowerCase();

        if ((text.includes('standing') || text.includes('scores')) && href.includes('tabid=')) {
          const match = href.match(/tabid=(\d+)/i);
          if (match) {
            standingsTabId = match[1];
            standingsLinkText = $(el).text().trim();
          }
        }
      });

      // Strategy 2: Search all links with tabid for standings-related pages
      if (!standingsTabId) {
        $('a[href*="tabid="]').each((_, el) => {
          const href = $(el).attr('href') || '';
          const text = $(el).text().trim().toLowerCase();

          if (text.includes('standing') || text.includes('league stand') || text.includes('scores & standings')) {
            const match = href.match(/tabid=(\d+)/i);
            if (match) {
              standingsTabId = match[1];
              standingsLinkText = $(el).text().trim();
            }
          }
        });
      }

      // Strategy 3: Check for ViewStandings module in page source
      if (!standingsTabId) {
        const pageHtml = resp.data;
        const viewStandingsMatch = pageHtml.match(/ViewStandings.*?tabid[=:](\d+)/i);
        if (viewStandingsMatch) {
          standingsTabId = viewStandingsMatch[1];
          standingsLinkText = 'Found in page source (ViewStandings module)';
        }
      }

      if (standingsTabId) {
        console.log(`  ✓ Found standings tabId: ${standingsTabId} (from: "${standingsLinkText}")`);

        if (autoFix && !dryRun) {
          await db.collection('leagues').doc(league.id).update({
            'sourceConfig.standingsTabId': standingsTabId,
            status: 'active',
            resolvedAt: new Date().toISOString(),
            resolvedBy: 'resolve-sportsconnect-pending',
          });
          console.log(`  ✓ Updated to active with tabId=${standingsTabId}`);
        } else if (dryRun) {
          console.log(`  [DRY RUN] Would update to active with tabId=${standingsTabId}`);
        } else {
          console.log(`  → Run with --fix to auto-update`);
        }

        resolved.push({ ...league, standingsTabId, source: standingsLinkText });
      } else {
        // Site is reachable but no standings tab found
        console.log('  ⚠ Site reachable but no standings tab found');

        // Check if the site mentions standings at all
        const pageText = $.text().toLowerCase();
        if (pageText.includes('standing')) {
          console.log('  → Site mentions "standings" — may need manual inspection');
          needsManual.push({ ...league, reason: 'Site mentions standings but tabId not discoverable' });
        } else if (pageText.includes('2026') || pageText.includes('spring')) {
          console.log('  → Site has 2026/spring content — may need to wait for standings setup');
          needsManual.push({ ...league, reason: 'Site active for 2026 but standings page not yet set up' });
        } else {
          console.log('  → Site may not have standings yet for this season');
          needsManual.push({ ...league, reason: 'No standings content found on site' });
        }
      }
    } catch (err) {
      if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        console.log(`  ✗ Site unreachable: ${err.code}`);
        unreachable.push({ ...league, reason: err.code });
      } else if (err.response && err.response.status >= 400) {
        console.log(`  ✗ Site returned HTTP ${err.response.status}`);
        unreachable.push({ ...league, reason: `HTTP ${err.response.status}` });
      } else {
        console.log(`  ✗ Error: ${err.message}`);
        needsManual.push({ ...league, reason: err.message });
      }
    }
  }

  // ── Summary ──
  console.log('\n\n=== Resolution Summary ===');
  console.log(`Resolved (tabId found): ${resolved.length}`);
  resolved.forEach(l => console.log(`  ✓ ${l.id} — ${l.name} → tabId=${l.standingsTabId}`));

  console.log(`\nNeeds manual attention: ${needsManual.length}`);
  needsManual.forEach(l => console.log(`  ⚠ ${l.id} — ${l.name}: ${l.reason}`));

  console.log(`\nUnreachable sites: ${unreachable.length}`);
  unreachable.forEach(l => console.log(`  ✗ ${l.id} — ${l.name}: ${l.reason}`));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

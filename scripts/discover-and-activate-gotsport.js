/**
 * Discover GotSport groups and activate leagues — standalone VM script
 *
 * For each pending_groups GotSport league, this script:
 *   1. Fetches the GotSport event results page
 *   2. Discovers division groups from the HTML
 *   3. Saves groups to the league's sourceConfig
 *   4. Sets the league to active with autoUpdate: true
 *
 * Run on deploy VM:
 *   node scripts/discover-and-activate-gotsport.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios');
const cheerio = require('cheerio');
const db = new Firestore();

const NOW = new Date().toISOString();

function parseGender(name) {
  const upper = name.toUpperCase();
  if (/\bB\d+U\b/.test(upper)) return 'male';
  if (/\bG\d+U\b/.test(upper)) return 'female';
  if (/FEMALE|GIRLS/.test(upper)) return 'female';
  if (/MALE|BOYS/.test(upper)) return 'male';
  if (/U\d+B\b/.test(upper)) return 'male';
  if (/U\d+G\b/.test(upper)) return 'female';
  return 'coed';
}

function parseAgeGroup(name) {
  let m = name.match(/\bU(\d+)\b/i);
  if (m) return `U${m[1]}`;
  m = name.match(/\b[BG](\d+)U\b/i);
  if (m) return `U${m[1]}`;
  m = name.match(/\b(\d+)U\b/i);
  if (m) return `U${m[1]}`;
  return 'unknown';
}

function parseLevel(name) {
  let m = name.match(/\b(?:D|Div\.?\s*)(\d+)/i);
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

async function discoverGroups(eventId) {
  const url = `https://system.gotsport.com/org_event/events/${eventId}/results`;
  console.log(`    Fetching ${url}`);

  const resp = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  const $ = cheerio.load(resp.data);
  const groups = [];
  const seen = new Set();

  // Strategy 1: Find links with group= parameter
  $('a[href*="group="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/group=(\d+)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      const container = $(el).closest('.card, .panel, [class*="division"], [class*="group"]');
      const name = container.find('.card-title, .panel-heading, h4, h5, h3').first().text().trim()
        || $(el).text().trim()
        || `Group ${match[1]}`;

      groups.push({
        groupId: match[1],
        name: name.replace(/\s+/g, ' ').trim(),
        gender: parseGender(name),
        ageGroup: parseAgeGroup(name),
        level: parseLevel(name),
      });
    }
  });

  // Strategy 2: Look in script tags for group data
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

  // Strategy 3: Try the standings_and_schedules page
  if (groups.length === 0) {
    const altUrl = `https://system.gotsport.com/org_event/events/${eventId}/standings_and_schedules`;
    console.log(`    No groups from results page, trying ${altUrl}`);
    try {
      const resp2 = await axios.get(altUrl, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      const $2 = cheerio.load(resp2.data);
      $2('a[href*="group="]').each((_, el) => {
        const href = $2(el).attr('href') || '';
        const match = href.match(/group=(\d+)/);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          const name = $2(el).text().trim() || `Group ${match[1]}`;
          groups.push({
            groupId: match[1],
            name: name.replace(/\s+/g, ' ').trim(),
            gender: parseGender(name),
            ageGroup: parseAgeGroup(name),
            level: parseLevel(name),
          });
        }
      });
    } catch (err) {
      console.log(`    Alt URL failed: ${err.message}`);
    }
  }

  return groups;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n=== Discover Groups & Activate GotSport Leagues ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // Find all pending_groups GotSport leagues
  const snap = await db.collection('leagues')
    .where('sourcePlatform', '==', 'gotsport')
    .where('status', '==', 'pending_groups')
    .get();

  if (snap.empty) {
    console.log('No pending_groups GotSport leagues found.');
    return;
  }

  console.log(`Found ${snap.size} pending_groups GotSport leagues\n`);

  let discovered = 0;
  let activated = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const eventId = data.sourceConfig?.leagueEventId || data.sourceConfig?.eventId;

    console.log(`\n${doc.id} — ${data.name} (${data.state})`);
    console.log(`  Event ID: ${eventId}`);

    if (!eventId) {
      console.log('  ✗ No event ID configured');
      failed++;
      continue;
    }

    try {
      const groups = await discoverGroups(eventId);
      console.log(`  Found ${groups.length} groups`);

      if (groups.length === 0) {
        console.log('  ⚠ No groups discovered — may need browser-based discovery');
        console.log('  Leaving as pending_groups');
        failed++;
        continue;
      }

      // Show first few groups
      const preview = groups.slice(0, 5);
      for (const g of preview) {
        console.log(`    ${g.groupId}: ${g.name} (${g.ageGroup} ${g.gender})`);
      }
      if (groups.length > 5) {
        console.log(`    ... and ${groups.length - 5} more`);
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would save ${groups.length} groups and set active`);
      } else {
        await db.collection('leagues').doc(doc.id).update({
          'sourceConfig.groups': groups,
          status: 'active',
          autoUpdate: true,
          monitorStatus: 'healthy',
          monitorNotes: `Groups discovered (${groups.length}) and activated by discover-and-activate-gotsport on ${NOW}`,
          groupsDiscoveredAt: NOW,
        });
        console.log(`  ✓ Saved ${groups.length} groups, set to active`);
      }

      discovered += groups.length;
      activated++;
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
      failed++;
    }

    // Respectful delay between GotSport requests
    await sleep(2000);
  }

  console.log('\n=== Summary ===');
  console.log(`  Leagues activated: ${activated}`);
  console.log(`  Total groups discovered: ${discovered}`);
  console.log(`  Failed/pending: ${failed}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

/**
 * discover-groups.js — GotSport Group Auto-Discovery Module
 * 
 * Self-registers the 'discoverGroups' Cloud Function.
 * Import this in index.js to enable the endpoint.
 * 
 * POST /discoverGroups
 * Body: { "leagueId": "asa-az", "save": true }
 *   or: { "eventId": "44446" }
 * 
 * Response: { eventId, leagueId, count, saved, groups: [...] }
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios');
const cheerio = require('cheerio');

const db = new Firestore();

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
  m = name.match(/\b20(0[7-9]|1[0-9])\b/);
  if (m) {
    const age = new Date().getFullYear() + 1 - parseInt(m[0]);
    return `U${age}`;
  }
  return 'unknown';
}

function parseLevel(name) {
  let m = name.match(/\b(?:D|Div\.?\s*)(\d+)/i);
  if (m) return `D${m[1]}`;
  const upper = name.toUpperCase();
  if (upper.includes('NPL')) return 'NPL';
  if (upper.includes('PREMIER')) return 'Premier';
  if (upper.includes('APL')) return 'APL';
  if (upper.includes('CLASSIC')) return 'Classic';
  if (upper.includes('COPA')) return 'Copa';
  return null;
}

/**
 * Discover groups from GotSport event page via HTTP
 * Note: GotSport JS-renders division cards, so HTTP-only approach
 * may only find groups on pages with server-rendered links.
 * For full discovery, use the browser-based discovery externally
 * and pass results via the save endpoint.
 */
async function discoverGroupsHttp(eventId) {
  const url = `https://system.gotsport.com/org_event/events/${eventId}/results`;
  
  const resp = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
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
      // Try to find the card/panel containing this link for the name
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

  // Strategy 2: Look in script tags for group data (some pages embed it in JS)
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

  return groups;
}

// Register the Cloud Function
functions.http('discoverGroups', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const { leagueId, eventId: rawEventId, save, groups: providedGroups } = req.body || {};
    
    // Mode 1: External groups provided (from browser-based discovery)
    if (providedGroups && leagueId) {
      const doc = await db.collection('leagues').doc(leagueId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: `League "${leagueId}" not found` });
      }
      const leagueData = doc.data();
      const sourceConfig = leagueData.sourceConfig || {};
      sourceConfig.groups = providedGroups;
      
      await db.collection('leagues').doc(leagueId).update({
        sourceConfig,
        status: providedGroups.length > 0 ? 'active' : 'pending_groups',
        groupsDiscoveredAt: new Date().toISOString(),
        groupCount: providedGroups.length,
      });
      
      return res.json({
        leagueId,
        count: providedGroups.length,
        saved: true,
        mode: 'external',
        groups: providedGroups,
      });
    }

    // Mode 2: Auto-discover via HTTP
    let gsEventId = rawEventId;
    let leagueConfig = null;
    
    if (leagueId) {
      const doc = await db.collection('leagues').doc(leagueId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: `League "${leagueId}" not found` });
      }
      leagueConfig = { id: leagueId, ...doc.data() };
      gsEventId = leagueConfig.sourceConfig?.leagueEventId || leagueConfig.sourceConfig?.eventId;
    }
    
    if (!gsEventId) {
      return res.status(400).json({ error: 'Either leagueId or eventId required' });
    }

    console.log(`Discovering groups for event ${gsEventId}...`);
    const groups = await discoverGroupsHttp(gsEventId);
    console.log(`Discovered ${groups.length} groups for event ${gsEventId}`);

    if (save && leagueId && leagueConfig) {
      const sourceConfig = leagueConfig.sourceConfig || {};
      sourceConfig.groups = groups;
      
      await db.collection('leagues').doc(leagueId).update({
        sourceConfig,
        status: groups.length > 0 ? 'active' : 'pending_groups',
        groupsDiscoveredAt: new Date().toISOString(),
        groupCount: groups.length,
      });
    }

    res.json({
      eventId: gsEventId,
      leagueId: leagueId || null,
      count: groups.length,
      saved: !!save,
      mode: 'auto',
      groups,
    });

  } catch (err) {
    console.error('discoverGroups error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { discoverGroupsHttp, parseGender, parseAgeGroup, parseLevel };

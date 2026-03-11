/**
 * discover-gc.js — GameChanger Organization Discovery Module
 * 
 * Self-registers the 'discoverGC' Cloud Function.
 * Import this in index.js to enable the endpoint.
 * 
 * Discovery strategy:
 *   1. DuckDuckGo HTML search for indexed GC org pages by state+sport
 *   2. Extract org IDs from result URLs (web.gc.com/organizations/{orgId}/...)
 *   3. Validate each org via the GC public API
 *   4. Filter: type='league' only (skip tournaments), US states only, matching sport
 *   5. Register new leagues in Firestore with sourcePlatform='gamechanger'
 * 
 * POST /discoverGC
 * Body: { "states": ["WA","OR"], "sports": ["baseball","softball"], "save": true }
 *   or: { "state": "WA", "sport": "baseball", "save": true }
 *   or: { "orgIds": ["abc123def456"], "save": true }  — direct org ID validation
 * 
 * Response: { discovered, saved, skipped, orgs: [...] }
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios');

const db = new Firestore();

const GC_API_BASE = 'https://api.team-manager.gc.com/public';

// Rate limiting
const DELAY_BETWEEN_API_CALLS_MS = 300;
const DELAY_BETWEEN_SEARCHES_MS = 3000;

// US state codes (for filtering out international results)
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
]);

// Full state names for search queries
const STATE_NAMES = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia'
};

// GC sport to TU sport mapping
const SPORT_MAP = {
  'baseball': 'baseball',
  'softball': 'baseball',
  'basketball': 'basketball',
  'soccer': 'soccer',
  'lacrosse': 'lacrosse',
  'hockey': 'hockey',
  'football': 'football',
  'volleyball': 'volleyball',
  'field-hockey': 'hockey',
  'field_hockey': 'hockey',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Search DuckDuckGo HTML for GC organization pages
 * Returns array of 12-char org IDs found in results
 */
async function searchDuckDuckGo(query) {
  try {
    const resp = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
    });

    const orgIds = new Set();
    const matches = resp.data.matchAll(/web\.gc\.com\/organizations\/([A-Za-z0-9]{12})/g);
    for (const m of matches) {
      orgIds.add(m[1]);
    }
    return Array.from(orgIds);
  } catch (err) {
    console.warn(`DuckDuckGo search error: ${err.message}`);
    return [];
  }
}

/**
 * Run multiple search queries to find GC orgs for a state+sport
 */
async function discoverOrgIds(state, sport) {
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode] || stateCode;
  const allOrgIds = new Set();

  // Multiple search query strategies for broader coverage
  const queries = [
    `site:web.gc.com/organizations ${sport} league "${stateCode}"`,
    `site:web.gc.com/organizations ${sport} "${stateName}" league standings`,
    `site:web.gc.com ${sport} league standings ${stateName}`,
  ];

  // Add sport-specific search variants
  if (sport === 'baseball') {
    queries.push(`site:web.gc.com/organizations "little league" "${stateName}"`);
    queries.push(`site:web.gc.com/organizations youth baseball "${stateName}"`);
  } else if (sport === 'softball') {
    queries.push(`site:web.gc.com/organizations softball league "${stateName}"`);
  } else if (sport === 'basketball') {
    queries.push(`site:web.gc.com/organizations youth basketball "${stateName}"`);
  }

  for (const query of queries) {
    console.log(`discoverGC: Searching: ${query}`);
    const ids = await searchDuckDuckGo(query);
    for (const id of ids) {
      allOrgIds.add(id);
    }
    console.log(`discoverGC: Found ${ids.length} IDs (total unique: ${allOrgIds.size})`);
    await sleep(DELAY_BETWEEN_SEARCHES_MS);
  }

  return Array.from(allOrgIds);
}

/**
 * Validate an org via GC public API
 */
async function validateOrg(orgId) {
  try {
    const resp = await axios.get(`${GC_API_BASE}/organizations/${orgId}`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TeamsUnited-Discovery/1.0' },
    });
    return resp.data;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return null;
    }
    console.warn(`GC API error for ${orgId}: ${err.message}`);
    return null;
  }
}

/**
 * Get team count for an org
 */
async function getTeamCount(orgId) {
  try {
    const resp = await axios.get(`${GC_API_BASE}/organizations/${orgId}/teams`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TeamsUnited-Discovery/1.0' },
    });
    return Array.isArray(resp.data) ? resp.data.length : 0;
  } catch (err) {
    return 0;
  }
}

/**
 * Known Australian/international cities that share US state codes
 * Perth = WA (Western Australia), Brisbane QLD, etc.
 */
const INTERNATIONAL_CITIES = new Set([
  'perth', 'brisbane', 'sydney', 'melbourne', 'adelaide', 'hobart',
  'darwin', 'canberra', 'gold coast', 'cairns', 'townsville',
  'wollongong', 'geelong', 'ballarat', 'bendigo', 'toowoomba',
  'rockingham', 'kalamunda', 'wanneroo', 'morley', 'carine',
  'balcatta', 'willetton', 'roleystone', 'alkimos', 'kelmscott',
  'grimshaw', 'dubai', 'abu dhabi', 'london', 'toronto',
]);

/**
 * Check if org is a valid US organization (not international)
 */
function isUSState(orgState) {
  if (!orgState) return false;
  return US_STATES.has(orgState.toUpperCase());
}

function isLikelyInternational(org) {
  const city = (org.city || '').toLowerCase().trim();
  if (INTERNATIONAL_CITIES.has(city)) return true;
  
  // State field contains non-US patterns
  const state = (org.state || '').trim();
  if (state.length > 2) return true; // US states are always 2-letter codes
  if (['QLD', 'NSW', 'VIC', 'SA', 'TAS', 'NT', 'ACT', 'AB', 'BC', 'ON', 'QC'].includes(state.toUpperCase())) return true;
  
  // Season pattern: Australian baseball is winter season (Oct-Mar)
  // But some US leagues also have winter seasons, so not a strong signal
  
  return false;
}

/**
 * Map GC sport to TU sport category
 */
function mapSport(gcSport) {
  if (!gcSport) return null;
  const lower = gcSport.toLowerCase().replace(/\s+/g, '_');
  return SPORT_MAP[lower] || null;
}

/**
 * Register a discovered GC org as a league in Firestore
 */
async function registerOrg(org, tuSport, teamCount) {
  const leagueId = `gc-${org.id}`;
  
  // Check if already exists
  const existing = await db.collection('leagues').doc(leagueId).get();
  if (existing.exists) {
    return { id: leagueId, status: 'already_exists' };
  }

  const leagueData = {
    name: org.name,
    sport: tuSport,
    state: (org.state || '').toUpperCase(),
    city: org.city || '',
    region: null,
    sourcePlatform: 'gamechanger',
    sourceConfig: {
      orgId: org.id,
      gcSport: org.sport,
      gcType: org.type || 'league',
      seasonName: org.season_name || '',
      seasonYear: org.season_year || null,
    },
    status: 'active', // GC orgs have /standings directly — no group discovery needed
    teamCount: teamCount || 0,
    discoveredAt: new Date().toISOString(),
    discoveredBy: 'discoverGC',
    lastCollected: null,
    lastDataChange: null,
  };

  await db.collection('leagues').doc(leagueId).set(leagueData);
  return { id: leagueId, status: 'created' };
}


// ═══════════════════════════════════════════════════════════════
// Cloud Function Registration
// ═══════════════════════════════════════════════════════════════

functions.http('discoverGC', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const body = req.body || {};

    // === Mode 1: Direct org ID validation ===
    if (body.orgIds && Array.isArray(body.orgIds)) {
      const save = body.save !== false;
      const results = [];
      let saved = 0, skipped = 0, existing = 0;

      for (const orgId of body.orgIds) {
        const org = await validateOrg(orgId);
        if (!org) { skipped++; continue; }

        // Skip tournaments
        if (org.type === 'tournament') {
          skipped++;
          results.push({ orgId: org.id, name: org.name, type: 'tournament', status: 'skipped_tournament' });
          continue;
        }

        // Must be US state
        if (!isUSState(org.state)) {
          skipped++;
          results.push({ orgId: org.id, name: org.name, state: org.state, status: 'skipped_non_us' });
          continue;
        }

        const tuSport = mapSport(org.sport);
        if (!tuSport) {
          skipped++;
          results.push({ orgId: org.id, name: org.name, sport: org.sport, status: 'skipped_unsupported_sport' });
          continue;
        }

        const teamCount = await getTeamCount(orgId);

        if (save) {
          const result = await registerOrg(org, tuSport, teamCount);
          if (result.status === 'created') saved++;
          else existing++;
          results.push({
            orgId: org.id, leagueId: result.id, name: org.name,
            city: org.city, state: org.state, sport: org.sport, tuSport,
            teamCount, type: org.type,
            seasonName: org.season_name, seasonYear: org.season_year,
            status: result.status,
          });
        } else {
          results.push({
            orgId: org.id, name: org.name, city: org.city, state: org.state,
            sport: org.sport, tuSport, teamCount, type: org.type,
            seasonName: org.season_name, seasonYear: org.season_year,
            status: 'discovered',
          });
        }

        await sleep(DELAY_BETWEEN_API_CALLS_MS);
      }

      return res.json({ mode: 'direct', discovered: results.length - skipped, saved, skipped, existing, orgs: results });
    }

    // === Mode 2: Search-based discovery ===
    let states = body.states || (body.state ? [body.state] : []);
    let sports = body.sports || (body.sport ? [body.sport] : []);
    const save = body.save !== false;

    states = states.map(s => s.toUpperCase()).filter(s => US_STATES.has(s));
    sports = sports.map(s => s.toLowerCase());

    if (states.length === 0) {
      return res.status(400).json({ error: 'At least one valid US state required (e.g., "WA")' });
    }
    if (sports.length === 0) {
      return res.status(400).json({ error: 'At least one sport required (e.g., "baseball")' });
    }

    console.log(`discoverGC: Discovery for ${states.join(',')} x ${sports.join(',')}, save=${save}`);

    const allResults = [];
    let totalDiscovered = 0, totalSaved = 0, totalSkipped = 0, totalExisting = 0;
    const errors = [];

    for (const state of states) {
      for (const sport of sports) {
        // Step 1: Search for org IDs
        const orgIds = await discoverOrgIds(state, sport);
        console.log(`discoverGC: ${state}+${sport} → ${orgIds.length} candidate orgs`);

        // Step 2: Validate each org
        for (const orgId of orgIds) {
          try {
            const org = await validateOrg(orgId);
            if (!org) { totalSkipped++; continue; }

            // Skip tournaments — league play only
            if (org.type === 'tournament') {
              totalSkipped++;
              allResults.push({ orgId: org.id, name: org.name, type: 'tournament', status: 'skipped_tournament' });
              continue;
            }

            // Filter to US states only (GC has international orgs)
            if (!isUSState(org.state) || isLikelyInternational(org)) {
              totalSkipped++;
              allResults.push({ orgId: org.id, name: org.name, city: org.city, state: org.state, status: 'skipped_non_us' });
              continue;
            }

            // Filter to target state (search can return neighboring states)
            // Be lenient — accept if the org is in ANY of the target states
            const orgState = (org.state || '').toUpperCase();
            if (!states.includes(orgState)) {
              // Still count it — it's a valid US league, just different state
              // We'll tag it so we know
            }

            const tuSport = mapSport(org.sport);
            if (!tuSport) {
              totalSkipped++;
              allResults.push({ orgId: org.id, name: org.name, sport: org.sport, status: 'skipped_unsupported_sport' });
              continue;
            }

            // Get team count for context
            const teamCount = await getTeamCount(orgId);
            totalDiscovered++;

            if (save) {
              const result = await registerOrg(org, tuSport, teamCount);
              if (result.status === 'created') {
                totalSaved++;
              } else {
                totalExisting++;
              }
              allResults.push({
                orgId: org.id, leagueId: result.id, name: org.name,
                city: org.city, state: org.state, sport: org.sport, tuSport,
                teamCount, type: org.type,
                seasonName: org.season_name, seasonYear: org.season_year,
                status: result.status,
              });
            } else {
              allResults.push({
                orgId: org.id, name: org.name, city: org.city, state: org.state,
                sport: org.sport, tuSport, teamCount, type: org.type,
                seasonName: org.season_name, seasonYear: org.season_year,
                status: 'discovered',
              });
            }

            await sleep(DELAY_BETWEEN_API_CALLS_MS);
          } catch (err) {
            errors.push({ orgId, error: err.message });
          }
        }
      }
    }

    // Log the discovery run
    await db.collection('discoveryLogs').add({
      function: 'discoverGC',
      states,
      sports,
      discovered: totalDiscovered,
      saved: totalSaved,
      skippedTournaments: totalSkipped,
      existing: totalExisting,
      errors: errors.length,
      timestamp: new Date().toISOString(),
    });

    console.log(`discoverGC: Done. Discovered=${totalDiscovered}, Saved=${totalSaved}, Skipped=${totalSkipped}, Existing=${totalExisting}`);

    res.json({
      mode: 'search',
      states,
      sports,
      discovered: totalDiscovered,
      saved: totalSaved,
      skipped: totalSkipped,
      existing: totalExisting,
      errors: errors.length > 0 ? errors : undefined,
      orgs: allResults,
    });

  } catch (err) {
    console.error('discoverGC error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { discoverOrgIds, validateOrg, registerOrg, mapSport, getTeamCount };

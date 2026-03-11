/**
 * seasonMonitor Cloud Function
 * 
 * Runs weekly via Cloud Scheduler. Detects stale leagues, attempts automatic
 * season discovery, and sends alerts when human intervention is needed.
 * 
 * Workflow:
 * 1. Check all active leagues for staleness (no data changes in N days)
 * 2. Check all dormant leagues for new season availability
 * 3. Auto-update configs when new seasons are discovered
 * 4. Generate a health report and send alerts for issues
 * 
 * Firestore fields used on league docs:
 * - lastDataChange: ISO timestamp — when standings data last changed
 * - lastStandingsHash: string — hash of standings for change detection
 * - seasonStart: ISO date — expected season start
 * - seasonEnd: ISO date — expected season end
 * - staleDays: number — days before flagging as stale (default per sport)
 * - discoveryConfig: object — platform-specific hints for finding new seasons
 * - monitorStatus: 'healthy' | 'stale' | 'dormant' | 'error' | 'needs_attention'
 * - monitorNotes: string — human-readable status notes
 * - lastMonitorCheck: ISO timestamp
 * 
 * Trigger: POST (no body needed) — called by Cloud Scheduler weekly
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');
const crypto = require('crypto');
const { getAdapter, listPlatforms } = require('./registry');

const db = new Firestore();

// Default stale thresholds per sport (days without data change)
const STALE_THRESHOLDS = {
  soccer: 14,     // Soccer seasons run ~9 months, 2 week gap is unusual
  baseball: 10,   // Baseball has tight schedules, 10 days is a lot
  softball: 10,
  hockey: 14,
  basketball: 10,
  lacrosse: 14,
  default: 14,
};

// How many days of staleness before auto-setting to dormant
const DORMANT_THRESHOLD_MULTIPLIER = 3; // 3x stale threshold

functions.http('seasonMonitor', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  const now = new Date();
  const report = {
    timestamp: now.toISOString(),
    totalLeagues: 0,
    healthy: [],
    stale: [],
    dormant: [],
    reactivated: [],
    needsAttention: [],
    errors: [],
  };

  try {
    // ═══════════════════════════════════════════════════════════
    // PHASE 0: Onboard newly-added leagues (never monitored before)
    // Any league in ANY status that has no lastMonitorCheck gets
    // an initial validation. This ensures leagues added between
    // monitor runs are picked up immediately on the next cycle.
    // ═══════════════════════════════════════════════════════════
    const allLeaguesSnap = await db.collection('leagues').get();
    const newLeagues = allLeaguesSnap.docs.filter(doc => {
      const data = doc.data();
      return !data.lastMonitorCheck && data.status !== 'template';
    });

    report.newLeaguesOnboarded = [];
    for (const doc of newLeagues) {
      const league = { id: doc.id, ...doc.data() };
      try {
        const validation = await validateNewLeague(league);
        await doc.ref.update({
          lastMonitorCheck: now.toISOString(),
          monitorStatus: validation.status,
          monitorNotes: validation.notes,
        });
        report.newLeaguesOnboarded.push({ 
          id: doc.id, name: league.name, status: league.status,
          validation: validation.status, notes: validation.notes,
        });
        if (validation.status === 'error' || validation.status === 'needs_attention') {
          report.needsAttention.push({
            id: doc.id, name: league.name,
            notes: `New league onboarding: ${validation.notes}`,
            action: validation.action || 'review_config',
          });
        }
      } catch (err) {
        await doc.ref.update({
          lastMonitorCheck: now.toISOString(),
          monitorStatus: 'error',
          monitorNotes: `Onboarding validation failed: ${err.message}`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 1: Check active leagues for staleness
    // ═══════════════════════════════════════════════════════════
    const activeSnap = await db.collection('leagues')
      .where('status', '==', 'active')
      .get();

    report.totalLeagues = activeSnap.size;

    for (const doc of activeSnap.docs) {
      const league = { id: doc.id, ...doc.data() };
      
      try {
        const result = await checkLeagueHealth(league, now);
        
        // Update the league doc with monitor status
        await doc.ref.update({
          monitorStatus: result.status,
          monitorNotes: result.notes,
          lastMonitorCheck: now.toISOString(),
        });

        if (result.status === 'healthy') {
          report.healthy.push({ id: doc.id, name: league.name, notes: result.notes });
        } else if (result.status === 'stale') {
          report.stale.push({ id: doc.id, name: league.name, notes: result.notes, daysSinceChange: result.daysSinceChange });
        } else if (result.status === 'dormant') {
          // Auto-transition to dormant
          await doc.ref.update({ status: 'dormant' });
          report.dormant.push({ id: doc.id, name: league.name, notes: result.notes });
        }
      } catch (err) {
        report.errors.push({ id: doc.id, name: league.name, error: err.message });
        await doc.ref.update({
          monitorStatus: 'error',
          monitorNotes: `Monitor check failed: ${err.message}`,
          lastMonitorCheck: now.toISOString(),
        });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: Check dormant leagues for new seasons
    // ═══════════════════════════════════════════════════════════
    const dormantSnap = await db.collection('leagues')
      .where('status', '==', 'dormant')
      .get();

    for (const doc of dormantSnap.docs) {
      const league = { id: doc.id, ...doc.data() };
      
      try {
        const discovery = await discoverNewSeason(league);
        
        if (discovery.found) {
          // New season found — update config and reactivate
          const updates = {
            status: 'active',
            sourceConfig: discovery.newConfig,
            seasonId: discovery.seasonId,
            monitorStatus: 'healthy',
            monitorNotes: `Auto-reactivated: ${discovery.notes}`,
            lastMonitorCheck: now.toISOString(),
            lastDataChange: null, // Reset — will be set on first successful collection
            lastStandingsHash: null,
          };
          
          if (discovery.seasonStart) updates.seasonStart = discovery.seasonStart;
          if (discovery.seasonEnd) updates.seasonEnd = discovery.seasonEnd;
          
          await doc.ref.update(updates);
          report.reactivated.push({ id: doc.id, name: league.name, notes: discovery.notes });
        } else {
          // No new season yet — update check timestamp
          await doc.ref.update({
            monitorNotes: `No new season found: ${discovery.notes}`,
            lastMonitorCheck: now.toISOString(),
          });
        }
      } catch (err) {
        // Discovery failed but that's expected for many leagues
        await doc.ref.update({
          monitorNotes: `Season discovery failed: ${err.message}`,
          lastMonitorCheck: now.toISOString(),
        });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 3: Check pending leagues that might now be ready
    // ═══════════════════════════════════════════════════════════
    const pendingSnap = await db.collection('leagues')
      .where('status', 'in', ['pending_config', 'pending_tabid', 'pending_groups'])
      .get();

    for (const doc of pendingSnap.docs) {
      const league = { id: doc.id, ...doc.data() };
      
      try {
        const ready = await checkPendingReady(league);
        if (ready.isReady) {
          report.needsAttention.push({
            id: doc.id,
            name: league.name,
            notes: `Pending league may be ready: ${ready.notes}`,
            action: ready.action,
          });
        }
      } catch (err) {
        // Silently skip — pending checks are best-effort
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 4: Store the report
    // ═══════════════════════════════════════════════════════════
    await db.collection('monitorReports').add({
      ...report,
      createdAt: now.toISOString(),
    });

    // Build summary for response
    const summary = {
      timestamp: report.timestamp,
      totalActive: activeSnap.size,
      totalDormant: dormantSnap.size,
      totalPending: pendingSnap.size,
      newLeaguesOnboarded: report.newLeaguesOnboarded.length,
      healthy: report.healthy.length,
      stale: report.stale.length,
      autoDormant: report.dormant.length,
      reactivated: report.reactivated.length,
      needsAttention: report.needsAttention.length,
      errors: report.errors.length,
    };

    // If there are issues, include details
    const alertItems = [];
    if (report.newLeaguesOnboarded.length > 0) {
      alertItems.push(...report.newLeaguesOnboarded.map(n => `🆕 ONBOARDED: ${n.name} (${n.status}) — ${n.notes}`));
    }
    if (report.stale.length > 0) {
      alertItems.push(...report.stale.map(s => `⚠️ STALE: ${s.name} (${s.daysSinceChange} days)`));
    }
    if (report.dormant.length > 0) {
      alertItems.push(...report.dormant.map(d => `💤 AUTO-DORMANT: ${d.name} — ${d.notes}`));
    }
    if (report.reactivated.length > 0) {
      alertItems.push(...report.reactivated.map(r => `✅ REACTIVATED: ${r.name} — ${r.notes}`));
    }
    if (report.needsAttention.length > 0) {
      alertItems.push(...report.needsAttention.map(n => `👀 NEEDS ATTENTION: ${n.name} — ${n.notes}`));
    }
    if (report.errors.length > 0) {
      alertItems.push(...report.errors.map(e => `❌ ERROR: ${e.name} — ${e.error}`));
    }

    res.json({
      summary,
      alerts: alertItems,
      details: report,
    });

  } catch (err) {
    console.error('seasonMonitor error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK — Is this active league's data still fresh?
// ═══════════════════════════════════════════════════════════════

async function checkLeagueHealth(league, now) {
  const sport = (league.sport || 'default').toLowerCase();
  const staleThreshold = league.staleDays || STALE_THRESHOLDS[sport] || STALE_THRESHOLDS.default;
  const dormantThreshold = staleThreshold * DORMANT_THRESHOLD_MULTIPLIER;

  // If no lastDataChange is set, the league hasn't been monitored yet
  if (!league.lastDataChange) {
    return {
      status: 'healthy',
      notes: 'No change tracking data yet — will baseline on next collection',
    };
  }

  const lastChange = new Date(league.lastDataChange);
  const daysSinceChange = Math.floor((now - lastChange) / (1000 * 60 * 60 * 24));

  // Check against known season end date
  if (league.seasonEnd) {
    const seasonEnd = new Date(league.seasonEnd);
    if (now > seasonEnd) {
      return {
        status: 'dormant',
        notes: `Past season end date (${league.seasonEnd}). Last data change: ${daysSinceChange} days ago.`,
        daysSinceChange,
      };
    }
  }

  if (daysSinceChange >= dormantThreshold) {
    return {
      status: 'dormant',
      notes: `No data changes in ${daysSinceChange} days (dormant threshold: ${dormantThreshold}). Season likely over.`,
      daysSinceChange,
    };
  }

  if (daysSinceChange >= staleThreshold) {
    return {
      status: 'stale',
      notes: `No data changes in ${daysSinceChange} days (stale threshold: ${staleThreshold}). May be between weeks or season winding down.`,
      daysSinceChange,
    };
  }

  return {
    status: 'healthy',
    notes: `Data changed ${daysSinceChange} day(s) ago. Healthy.`,
    daysSinceChange,
  };
}


// ═══════════════════════════════════════════════════════════════
// SEASON DISCOVERY — Can we find the next season for a dormant league?
// ═══════════════════════════════════════════════════════════════

async function discoverNewSeason(league) {
  const platform = league.sourcePlatform;
  
  // Platform-specific discovery strategies
  switch (platform) {
    case 'sportsaffinity':
      return discoverSportsAffinity(league);
    case 'gotsport':
      return discoverGotSport(league);
    case 'pointstreak':
      return discoverPointstreak(league);
    case 'demosphere':
      return discoverDemosphere(league);
    case 'sportsconnect':
      return discoverSportsConnect(league);
    case 'gamechanger':
      return discoverGameChanger(league);
    case 'leagueapps':
      return discoverLeagueApps(league);
    case 'tgs':
      return discoverTGS(league);
    default:
      return { found: false, notes: `No discovery strategy for platform: ${platform}` };
  }
}


// ─── SportsAffinity Discovery ────────────────────────────────
// SportsAffinity uses organizationId (stable) + seasonGuid (changes per season).
// NOTE: SportsAffinity's API calls seasons "tournaments" internally — we ignore
// that naming and treat them as league seasons. We query their season list
// endpoint to find the current/latest league season.
async function discoverSportsAffinity(league) {
  const axios = require('axios');
  const config = league.sourceConfig;
  const apiBase = config.baseUrl || 'https://sctour.sportsaffinity.com';
  
  try {
    // Query the org's season list (SA calls this endpoint "tournaments" but these are league seasons)
    const url = `${apiBase}/api/tournaments?organizationId=${config.organizationId}`;
    const resp = await axios.get(url, { timeout: 15000 });
    
    if (!resp.data || !Array.isArray(resp.data)) {
      return { found: false, notes: 'Season list API returned unexpected format' };
    }

    // Sort by start date descending to find the newest league season
    const seasons = resp.data
      .filter(t => t.tournamentStatus !== 'Archived')
      .sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));

    if (seasons.length === 0) {
      return { found: false, notes: 'No active league seasons found for this organization' };
    }

    const latest = seasons[0];
    const currentSeasonGuid = config.seasonGuid || config.tournamentId;

    // Check if the latest season is different from what we have
    if (latest.tournamentKey === currentSeasonGuid || latest.tournamentGuid === currentSeasonGuid) {
      return { found: false, notes: `Latest season (${latest.name}) is the same as current config` };
    }

    // New season found
    const newSeasonGuid = latest.tournamentKey || latest.tournamentGuid;
    
    // Verify it has standings data
    try {
      const standingsUrl = `${apiBase}/api/standings?organizationId=${config.organizationId}&tournamentId=${newSeasonGuid}`;
      const standingsResp = await axios.get(standingsUrl, { timeout: 15000 });
      
      if (!standingsResp.data || standingsResp.data.length === 0) {
        return { found: false, notes: `New season "${latest.name}" found but has no standings data yet` };
      }
    } catch (e) {
      return { found: false, notes: `New season "${latest.name}" found but standings not accessible yet` };
    }

    return {
      found: true,
      newConfig: { ...config, seasonGuid: newSeasonGuid },
      seasonId: deriveSeasonId(latest.startDate, latest.endDate),
      seasonStart: latest.startDate || null,
      seasonEnd: latest.endDate || null,
      notes: `New league season: "${latest.name}" (GUID: ${newSeasonGuid})`,
    };
  } catch (err) {
    return { found: false, notes: `API error: ${err.message}` };
  }
}


// ─── GotSport Discovery ─────────────────────────────────────
// GotSport uses leagueEventId + groupId for league seasons.
// NOTE: GotSport calls these "events" but we only track league seasons, not tournaments.
// Discovery strategy: check the org's page for newer league season entries.
async function discoverGotSport(league) {
  const axios = require('axios');
  const config = league.sourceConfig;
  const currentEventId = config.leagueEventId || config.eventId;
  const discovery = league.discoveryConfig || {};

  // If we have an org page URL, check it for newer league seasons
  if (discovery.orgUrl) {
    try {
      const cheerio = require('cheerio');
      const resp = await axios.get(discovery.orgUrl, {
        timeout: 15000,
        headers: { 'User-Agent': 'TeamsUnited-SeasonMonitor/1.0' },
      });
      const $ = cheerio.load(resp.data);
      
      // Look for league season links that are newer than our current one
      const seasonLinks = [];
      $('a[href*="/events/"]').each((i, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/events\/(\d+)/);
        if (match) {
          seasonLinks.push({
            leagueEventId: match[1],
            text: $(el).text().trim(),
          });
        }
      });

      const newerSeasons = seasonLinks.filter(s => 
        parseInt(s.leagueEventId) > parseInt(currentEventId)
      );

      if (newerSeasons.length > 0) {
        const newest = newerSeasons[newerSeasons.length - 1];
        return {
          found: true,
          newConfig: { ...config, leagueEventId: newest.leagueEventId, groups: [] }, // Groups need manual config
          seasonId: deriveSeasonIdFromName(newest.text),
          notes: `New league season found: "${newest.text}" (ID: ${newest.leagueEventId}). NOTE: Group IDs need manual configuration.`,
        };
      }
    } catch (err) {
      // Fall through to basic check
    }
  }

  // Basic check: try to load the current league season page
  try {
    const resp = await axios.get(
      `https://system.gotsport.com/org_event/events/${currentEventId}`,
      { timeout: 15000, maxRedirects: 0, validateStatus: s => s < 400 || s === 302 }
    );
    return { found: false, notes: 'Current league season still accessible. No newer season discovered.' };
  } catch (err) {
    return { found: false, notes: `Current league season may be gone (${err.message}). Set discoveryConfig.orgUrl for auto-discovery.` };
  }
}


// ─── Pointstreak Discovery ──────────────────────────────────
// Pointstreak uses leagueId (stable) + seasonId (increments).
// Try the next seasonId to see if it exists.
async function discoverPointstreak(league) {
  const axios = require('axios');
  const config = league.sourceConfig;
  const currentSeasonId = parseInt(config.seasonId);
  
  if (isNaN(currentSeasonId)) {
    return { found: false, notes: 'Cannot auto-discover: seasonId is not numeric' };
  }

  const sport = config.sport || 'baseball';
  const base = config.baseUrl || (sport === 'hockey' 
    ? 'https://stats.pointstreak.com' 
    : 'https://baseball.pointstreak.com');

  // Try the next few season IDs
  for (let nextId = currentSeasonId + 1; nextId <= currentSeasonId + 5; nextId++) {
    try {
      const url = `${base}/standings.html?leagueid=${config.leagueId}&seasonid=${nextId}`;
      const resp = await axios.get(url, { timeout: 15000 });
      
      // Check if the page has actual standings content
      const cheerio = require('cheerio');
      const $ = cheerio.load(resp.data);
      const hasTeams = $('table.nova-stats-table tr').length > 1 ||
                       $('table tr td a').length > 0;
      
      if (hasTeams) {
        return {
          found: true,
          newConfig: { ...config, seasonId: String(nextId) },
          seasonId: `season-${nextId}`,
          notes: `New season found: seasonId ${nextId} (was ${currentSeasonId})`,
        };
      }
    } catch (err) {
      continue; // Next ID
    }
  }

  return { found: false, notes: `Checked season IDs ${currentSeasonId + 1}-${currentSeasonId + 5}, none active yet` };
}


// ─── Demosphere Discovery ───────────────────────────────────
// Demosphere division URLs tend to stay stable but data resets.
// Check if the current URLs return data (tables with teams).
async function discoverDemosphere(league) {
  const axios = require('axios');
  const config = league.sourceConfig;
  
  if (!config.divisions || config.divisions.length === 0) {
    return { found: false, notes: 'No division paths configured' };
  }

  // Check the first division URL to see if new data has appeared
  const testDiv = config.divisions[0];
  const url = `${config.baseUrl}${testDiv.path}`;
  
  try {
    const resp = await axios.get(url, { timeout: 15000, maxRedirects: 5 });
    const cheerio = require('cheerio');
    const $ = cheerio.load(resp.data);
    
    // Look for standings tables with actual team data
    const tables = $('table');
    let hasTeamData = false;
    
    tables.each((i, table) => {
      const rows = $(table).find('tr');
      if (rows.length > 2) { // Header + at least 2 teams
        const text = $(table).text();
        if (text.match(/\d+/) && (text.includes('W') || text.includes('Pts'))) {
          hasTeamData = true;
        }
      }
    });

    if (hasTeamData) {
      return {
        found: true,
        newConfig: config, // Same config — Demosphere URLs usually persist
        seasonId: deriveSeasonIdFromDate(new Date()),
        notes: `Standings data found at existing URLs. Season appears to be underway.`,
      };
    }

    return { found: false, notes: 'Division URLs reachable but no standings data yet' };
  } catch (err) {
    return { found: false, notes: `Cannot reach division URL: ${err.message}` };
  }
}


// ─── SportsConnect Discovery ────────────────────────────────
// SportsConnect tabId stays the same — programs rotate per year.
// Check if the standings page has new program options.
async function discoverSportsConnect(league) {
  const axios = require('axios');
  const config = league.sourceConfig;
  
  // SportsConnect standings pages are ASP.NET — need to check if programs are listed
  const url = `${config.baseUrl}/Default.aspx?tabid=${config.standingsTabId}`;
  
  try {
    const resp = await axios.get(url, { timeout: 15000 });
    
    // Look for program dropdown options that suggest a new season
    const currentYear = new Date().getFullYear();
    const hasCurrentYear = resp.data.includes(String(currentYear));
    const hasNextYear = resp.data.includes(String(currentYear + 1));
    
    if (hasCurrentYear || hasNextYear) {
      return {
        found: true,
        newConfig: { ...config, programs: [] }, // Programs need discovery via browser
        seasonId: `${currentYear}`,
        notes: `Standings page shows ${currentYear} content. Programs need browser discovery.`,
      };
    }

    return { found: false, notes: 'Standings page accessible but no current-year programs detected' };
  } catch (err) {
    return { found: false, notes: `Cannot reach standings page: ${err.message}` };
  }
}


// ─── GameChanger Discovery ──────────────────────────────────
// GameChanger orgId is stable. New seasons appear as new program entries.
async function discoverGameChanger(league) {
  const axios = require('axios');
  const config = league.sourceConfig;
  const API_BASE = 'https://api.team-manager.gc.com/public';

  if (!config.orgId) {
    return { found: false, notes: 'No orgId configured' };
  }

  try {
    // Check current orgId via public API
    let currentOrg = null;
    let currentHasStandings = false;
    
    try {
      const orgResp = await axios.get(`${API_BASE}/organizations/${config.orgId}`, { timeout: 15000 });
      currentOrg = orgResp.data;
      const standingsResp = await axios.get(`${API_BASE}/organizations/${config.orgId}/standings`, { timeout: 15000 });
      currentHasStandings = Array.isArray(standingsResp.data) && standingsResp.data.length > 0;
    } catch (err) {
      // Current org may be gone (404)
    }

    if (currentOrg && currentHasStandings) {
      const currentYear = new Date().getFullYear();
      const orgYear = currentOrg.season_year || 0;
      if (orgYear >= currentYear) {
        return { found: false, notes: `Current org "${currentOrg.name}" has active standings (${currentOrg.season_name} ${orgYear}). No change needed.` };
      }
    }

    // Check allOrgIds for a newer season
    const allOrgIds = config.allOrgIds || [];
    if (allOrgIds.length === 0) {
      if (currentOrg && currentHasStandings) {
        return { found: false, notes: 'Current org still has data. No allOrgIds to check for rotation.' };
      }
      return { found: false, notes: 'Current org has no data and no allOrgIds available.' };
    }

    let bestOrg = null;
    let bestYear = 0;
    let bestSeason = null;

    for (const orgEntry of allOrgIds) {
      const orgId = orgEntry.publicId || orgEntry.public_id;
      if (!orgId || orgId === config.orgId) continue;

      try {
        const orgResp = await axios.get(`${API_BASE}/organizations/${orgId}`, { timeout: 10000 });
        const org = orgResp.data;
        const year = org.season_year || 0;
        
        if (year > bestYear) {
          const standingsResp = await axios.get(`${API_BASE}/organizations/${orgId}/standings`, { timeout: 10000 });
          if (Array.isArray(standingsResp.data) && standingsResp.data.length > 0) {
            bestOrg = { orgId, name: org.name, type: org.type, seasonName: org.season_name, seasonYear: year };
            bestYear = year;
            bestSeason = `${org.season_name || ''} ${year}`.trim();
          }
        }
      } catch (err) {
        continue;
      }
    }

    if (bestOrg && bestOrg.orgId !== config.orgId) {
      return {
        found: true,
        newConfig: { ...config, orgId: bestOrg.orgId, orgName: bestOrg.name, previousOrgId: config.orgId },
        seasonId: `${bestYear}`,
        notes: `Rotated to newer season: "${bestOrg.name}" (${bestSeason}). Previous: ${config.orgId}`,
      };
    }

    if (!currentHasStandings) {
      return { found: false, notes: `Current org (${config.orgId}) has no standings. Checked ${allOrgIds.length} alternatives — none have current data.` };
    }

    return { found: false, notes: `Current org is best available (${currentOrg?.season_name} ${currentOrg?.season_year}).` };
  } catch (err) {
    return { found: false, notes: `GC discovery error: ${err.message}` };
  }
}


// ─── LeagueApps Discovery ───────────────────────────────────
// LeagueApps program URLs change per season. Check if URLs are still valid.
async function discoverLeagueApps(league) {
  const axios = require('axios');
  const config = league.sourceConfig;
  
  if (!config.programs || config.programs.length === 0) {
    return { found: false, notes: 'No program paths configured' };
  }

  const testProgram = config.programs[0];
  const url = `${config.baseUrl}${testProgram.path}`;
  
  try {
    const resp = await axios.get(url, { timeout: 15000, maxRedirects: 5 });
    const cheerio = require('cheerio');
    const $ = cheerio.load(resp.data);
    
    const hasStandings = $('table').length > 0 && $('table tr').length > 2;
    
    if (hasStandings) {
      return {
        found: true,
        newConfig: config,
        seasonId: deriveSeasonIdFromDate(new Date()),
        notes: 'LeagueApps standings page has data. Season appears active.',
      };
    }

    return { found: false, notes: 'LeagueApps page reachable but no standings data' };
  } catch (err) {
    return { found: false, notes: `Cannot reach LeagueApps URL: ${err.message}` };
  }
}


// ─── TGS/ECNL Discovery ────────────────────────────────────
// TGS league season IDs change each season. Check for newer seasons.
// NOTE: TGS/AthleteOne calls these "events" but for ECNL/ECRL they represent league seasons.
async function discoverTGS(league) {
  const axios = require('axios');
  const config = league.sourceConfig;
  const discovery = league.discoveryConfig || {};

  // If we have a league page that lists seasons, check it
  if (discovery.seasonListUrl) {
    try {
      const resp = await axios.get(discovery.seasonListUrl, { timeout: 15000 });
      // Look for newer season IDs (TGS uses "event" in URLs but these are league seasons)
      const seasonMatches = resp.data.match(/event\/(\d+)/g) || [];
      const seasonIds = [...new Set(seasonMatches.map(m => m.match(/(\d+)/)[1]))];
      const newerSeasons = seasonIds.filter(id => parseInt(id) > parseInt(config.eventId));
      
      if (newerSeasons.length > 0) {
        const newest = newerSeasons[newerSeasons.length - 1];
        return {
          found: true,
          newConfig: { ...config, eventId: newest },
          seasonId: deriveSeasonIdFromDate(new Date()),
          notes: `New TGS league season found: ${newest} (was ${config.eventId})`,
        };
      }
    } catch (err) {
      // Fall through
    }
  }

  // Basic check: see if current season page still loads
  try {
    const resp = await axios.get(
      `https://app.athleteone.com/public/event/${config.eventId}/schedules-standings`,
      { timeout: 15000 }
    );
    if (resp.status === 200 && !resp.data.includes('Event not found')) {
      return { found: false, notes: 'Current TGS league season still accessible. Set discoveryConfig.seasonListUrl for auto-discovery.' };
    }
    return { found: false, notes: 'Current league season page may have expired' };
  } catch (err) {
    return { found: false, notes: `Cannot reach TGS league season: ${err.message}` };
  }
}


// ─── Pending league readiness check ─────────────────────────
// Checks all pending statuses to see if a league might now be ready to activate
async function checkPendingReady(league) {
  const axios = require('axios');

  // pending_tabid: SportsConnect leagues waiting for a standings tab ID
  if (league.status === 'pending_tabid' && league.sourceConfig?.baseUrl) {
    try {
      const resp = await axios.get(league.sourceConfig.baseUrl, { timeout: 10000 });
      const lower = resp.data.toLowerCase();
      const hasStandings = lower.includes('standings') || lower.includes('tabid');
      if (hasStandings) {
        return { isReady: true, notes: 'Website now mentions standings — tabId may be discoverable', action: 'discover_tabid' };
      }
    } catch (e) {
      // Site may be down or not set up yet
    }
  }

  // pending_groups: GotSport leagues waiting for group/division IDs
  if (league.status === 'pending_groups') {
    const config = league.sourceConfig || {};
    const eventId = config.leagueEventId || config.eventId;
    if (eventId) {
      try {
        const resp = await axios.get(
          `https://system.gotsport.com/org_event/events/${eventId}`,
          { timeout: 10000, headers: { 'User-Agent': 'TeamsUnited-SeasonMonitor/1.0' } }
        );
        // If the event page loads, check for group/division links
        const cheerio = require('cheerio');
        const $ = cheerio.load(resp.data);
        const groupLinks = $('a[href*="group="]');
        if (groupLinks.length > 0) {
          const groups = [];
          groupLinks.each((i, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(/group=(\d+)/);
            if (match) groups.push({ groupId: match[1], name: $(el).text().trim() });
          });
          if (groups.length > 0) {
            return { 
              isReady: true, 
              notes: `Found ${groups.length} division groups on GotSport event page: ${groups.map(g => g.name).join(', ')}`,
              action: 'configure_groups',
              discoveredGroups: groups,
            };
          }
        }
      } catch (e) {
        // Event may not be created yet
      }
    }
  }

  // pending_config: leagues that need full configuration
  if (league.status === 'pending_config') {
    // For SportsConnect: check if their website URL resolves
    if (league.sourcePlatform === 'sportsconnect' && league.sourceConfig?.baseUrl) {
      try {
        const resp = await axios.get(league.sourceConfig.baseUrl, { timeout: 10000 });
        if (resp.status === 200) {
          return { isReady: true, notes: 'Website is live — ready for standings page configuration', action: 'configure_standings' };
        }
      } catch (e) {
        // Not ready yet
      }
    }
    
    // For any platform: if we have a website URL, check if it's active
    if (league.websiteUrl) {
      try {
        const resp = await axios.get(league.websiteUrl, { timeout: 10000 });
        if (resp.status === 200) {
          const lower = resp.data.toLowerCase();
          if (lower.includes('standing') || lower.includes('schedule') || lower.includes('league')) {
            return { isReady: true, notes: 'Website is live with league content — may be ready for configuration', action: 'review_and_configure' };
          }
        }
      } catch (e) {
        // Not ready yet
      }
    }
  }
  
  return { isReady: false };
}


// ─── New league validation ──────────────────────────────────
// When a league is first added to Firestore, validate its configuration
// so issues are caught immediately rather than waiting for the next collection attempt.
async function validateNewLeague(league) {
  const axios = require('axios');
  const platform = league.sourcePlatform;
  const config = league.sourceConfig || {};

  // If the league is active, verify the adapter can reach the data source
  if (league.status === 'active') {
    if (!platform) {
      return { status: 'error', notes: 'Missing sourcePlatform — cannot collect data', action: 'fix_config' };
    }
    
    try {
      getAdapter(platform);
    } catch (e) {
      return { status: 'error', notes: `Unsupported platform: ${platform}`, action: 'add_adapter' };
    }

    // Platform-specific config validation
    switch (platform) {
      case 'sportsaffinity':
        if (!config.organizationId) return { status: 'error', notes: 'Missing organizationId in sourceConfig', action: 'fix_config' };
        if (!config.seasonGuid && !config.tournamentId) return { status: 'error', notes: 'Missing seasonGuid in sourceConfig', action: 'fix_config' };
        break;
      case 'gotsport':
        if (!config.leagueEventId && !config.eventId) return { status: 'error', notes: 'Missing leagueEventId in sourceConfig', action: 'fix_config' };
        if (!config.groups || config.groups.length === 0) return { status: 'needs_attention', notes: 'No groups configured — division standings cannot be collected', action: 'configure_groups' };
        break;
      case 'tgs':
        if (!config.eventId) return { status: 'error', notes: 'Missing eventId in sourceConfig', action: 'fix_config' };
        break;
      case 'demosphere':
        if (!config.baseUrl) return { status: 'error', notes: 'Missing baseUrl in sourceConfig', action: 'fix_config' };
        if (!config.divisions || config.divisions.length === 0) return { status: 'needs_attention', notes: 'No divisions configured', action: 'configure_divisions' };
        break;
      case 'pointstreak':
        if (!config.leagueId || !config.seasonId) return { status: 'error', notes: 'Missing leagueId or seasonId in sourceConfig', action: 'fix_config' };
        break;
      case 'sportsconnect':
        if (!config.baseUrl || !config.standingsTabId) return { status: 'error', notes: 'Missing baseUrl or standingsTabId in sourceConfig', action: 'fix_config' };
        break;
      case 'gamechanger':
        if (!config.orgId) return { status: 'error', notes: 'Missing orgId in sourceConfig', action: 'fix_config' };
        break;
      case 'leagueapps':
        if (!config.baseUrl) return { status: 'error', notes: 'Missing baseUrl in sourceConfig', action: 'fix_config' };
        if (!config.programs || config.programs.length === 0) return { status: 'needs_attention', notes: 'No programs configured', action: 'configure_programs' };
        break;
    }

    // Try a basic reachability check for the source
    try {
      const testUrl = getSourceTestUrl(league);
      if (testUrl) {
        await axios.get(testUrl, { timeout: 10000 });
      }
    } catch (err) {
      return { status: 'needs_attention', notes: `Source URL not reachable: ${err.message}. May not be in season yet.`, action: 'verify_source' };
    }

    return { status: 'healthy', notes: 'Config validated. Will begin collecting on next daily run.' };
  }

  // For pending/dormant leagues, just acknowledge them
  if (league.status === 'dormant') {
    return { status: 'dormant', notes: 'League is dormant. Will auto-check for new season weekly.' };
  }
  
  return { status: league.status, notes: `League is ${league.status}. Will be checked for readiness each cycle.` };
}

// Get a test URL to verify source reachability for a league
function getSourceTestUrl(league) {
  const config = league.sourceConfig || {};
  switch (league.sourcePlatform) {
    case 'sportsaffinity': {
      const saSeasonId = config.seasonGuid || config.tournamentId;
      return `${config.baseUrl || 'https://sctour.sportsaffinity.com'}/api/standings?organizationId=${config.organizationId}&tournamentId=${saSeasonId}`;
    }
    case 'gotsport': {
      const gsEventId = config.leagueEventId || config.eventId;
      return `https://system.gotsport.com/org_event/events/${gsEventId}`;
    }
    case 'tgs':
      return `https://app.athleteone.com/public/event/${config.eventId}/schedules-standings`;
    case 'demosphere':
      return config.baseUrl;
    case 'sportsconnect':
      return `${config.baseUrl}/Default.aspx?tabid=${config.standingsTabId}`;
    case 'gamechanger':
      return `https://web.gc.com/organizations/${config.orgId}/standings`;
    case 'leagueapps':
      return config.baseUrl;
    case 'pointstreak': {
      const sport = config.sport || 'baseball';
      const base = config.baseUrl || (sport === 'hockey' ? 'https://stats.pointstreak.com' : 'https://baseball.pointstreak.com');
      return `${base}/standings.html?leagueid=${config.leagueId}&seasonid=${config.seasonId}`;
    }
    default:
      return null;
  }
}


// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a hash of standings data for change detection
 */
function hashStandings(standings) {
  const key = standings
    .map(s => `${s.teamName}:${s.wins}-${s.losses}-${s.ties}:${s.points}`)
    .sort()
    .join('|');
  return crypto.createHash('md5').update(key).digest('hex');
}

function deriveSeasonId(startDate, endDate) {
  if (!startDate) return deriveSeasonIdFromDate(new Date());
  const start = new Date(startDate);
  const startYear = start.getFullYear();
  if (endDate) {
    const end = new Date(endDate);
    const endYear = end.getFullYear();
    if (endYear !== startYear) return `${startYear}-${endYear}`;
  }
  // Check if it's a fall season that spans years
  if (start.getMonth() >= 7) return `${startYear}-${startYear + 1}`;
  return `${startYear}`;
}

function deriveSeasonIdFromDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (month >= 7) return `${year}-${year + 1}`; // Aug+ is next academic year
  return `${year - 1}-${year}`;
}

function deriveSeasonIdFromName(name) {
  const yearMatch = name.match(/20\d{2}/);
  if (yearMatch) return yearMatch[0];
  return deriveSeasonIdFromDate(new Date());
}

// Export hashStandings for use by collectLeague
module.exports = { hashStandings };

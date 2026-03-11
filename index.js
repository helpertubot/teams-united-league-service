/**
 * collectLeague Cloud Function — Multi-Platform Version
 * 
 * This replaces the original SportsAffinity-only collectLeague function.
 * It reads the league config from Firestore, determines the platform,
 * loads the appropriate adapter, and stores results.
 * 
 * League config in Firestore must include:
 * - sourcePlatform: 'sportsaffinity' | 'gotsport' | 'pointstreak' | 'demosphere' | 'tgs'
 * - sourceConfig: platform-specific configuration (see each adapter for schema)
 * 
 * Trigger: POST { "leagueId": "rcl-wa" }
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');
const { getAdapter, listPlatforms } = require('./registry');
// season-monitor.js exports hashStandings AND self-registers the 'seasonMonitor' Cloud Function
const { hashStandings } = require('./season-monitor');
// sheets-sync.js self-registers the 'updateSheet' Cloud Function
require('./sheets-sync');
// discover-groups.js self-registers the 'discoverGroups' Cloud Function
require('./discover-groups');
// discover-gc.js self-registers the discoverGC Cloud Function
require('./discover-gc');

const db = new Firestore();

functions.http('collectLeague', async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const { leagueId } = req.body || {};
    if (!leagueId) {
      return res.status(400).json({ error: 'leagueId required in request body' });
    }

    // 1. Load league config from Firestore
    const leagueDoc = await db.collection('leagues').doc(leagueId).get();
    if (!leagueDoc.exists) {
      return res.status(404).json({ error: `League "${leagueId}" not found` });
    }
    const leagueConfig = { id: leagueId, ...leagueDoc.data() };

    // 2. Determine platform and get adapter
    const platform = leagueConfig.sourcePlatform;
    if (!platform) {
      return res.status(400).json({ 
        error: `League "${leagueId}" missing sourcePlatform field`,
        supportedPlatforms: listPlatforms(),
      });
    }

    let adapter;
    try {
      adapter = getAdapter(platform);
    } catch (err) {
      return res.status(400).json({ 
        error: err.message,
        supportedPlatforms: listPlatforms(),
      });
    }

    console.log(`Collecting league "${leagueId}" via ${platform} adapter...`);
    const startTime = Date.now();

    // 3. Run the adapter
    const result = await adapter.collectStandings(leagueConfig);
    const { divisions, standings } = result;

    // Handle GC season rotation — if adapter found data in a different org
    if (result._rotatedToOrgId && platform === 'gamechanger') {
      console.log(`GameChanger: Auto-rotated to org ${result._rotatedToOrgId} (${result._rotatedToOrgName})`);
      await db.collection('leagues').doc(leagueId).update({
        'sourceConfig.orgId': result._rotatedToOrgId,
        'sourceConfig.previousOrgId': leagueConfig.sourceConfig.orgId,
        'sourceConfig.orgName': result._rotatedToOrgName || null,
        lastSeasonRotation: new Date().toISOString(),
      });
    }

    console.log(`${platform}: Collected ${divisions.length} divisions, ${standings.length} standings in ${Date.now() - startTime}ms`);

    // 4. Write divisions to Firestore
    const divBatch = db.batch();
    for (const div of divisions) {
      const divRef = db.collection('divisions').doc(div.id);
      divBatch.set(divRef, div, { merge: true });
    }
    await divBatch.commit();

    // 5. Write standings to Firestore (in batches of 400 to stay under Firestore 500-op limit)
    const BATCH_SIZE = 400;
    let standingsWritten = 0;
    for (let i = 0; i < standings.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = standings.slice(i, i + BATCH_SIZE);
      for (const standing of chunk) {
        // Use composite key: divisionId + teamName slug
        const standingId = `${standing.divisionId}-${slugify(standing.teamName)}`;
        const standingRef = db.collection('standings').doc(standingId);
        batch.set(standingRef, standing, { merge: true });
      }
      await batch.commit();
      standingsWritten += chunk.length;
    }

    // 6. Track data changes for season monitoring
    const currentHash = hashStandings(standings);
    const leagueData = leagueDoc.data();
    const previousHash = leagueData.lastStandingsHash || null;
    
    const leagueUpdates = {
      lastStandingsHash: currentHash,
      lastCollected: new Date().toISOString(),
    };
    
    // Only update lastDataChange if standings actually changed
    if (currentHash !== previousHash && standings.length > 0) {
      leagueUpdates.lastDataChange = new Date().toISOString();
    }
    
    await db.collection('leagues').doc(leagueId).update(leagueUpdates);

    // 7. Log the collection
    await db.collection('collectionLogs').add({
      leagueId,
      platform,
      divisionsCollected: divisions.length,
      standingsCollected: standings.length,
      dataChanged: currentHash !== previousHash,
      durationMs: Date.now() - startTime,
      collectedAt: new Date().toISOString(),
      status: 'success',
    });

    res.json({
      leagueId,
      platform,
      divisionsCollected: divisions.length,
      standingsCollected: standings.length,
      durationMs: Date.now() - startTime,
    });

  } catch (err) {
    console.error('collectLeague error:', err);
    
    // Log the error
    try {
      await db.collection('collectionLogs').add({
        leagueId: req.body?.leagueId || 'unknown',
        platform: 'unknown',
        status: 'error',
        error: err.message,
        collectedAt: new Date().toISOString(),
      });
    } catch (logErr) {
      console.error('Failed to log error:', logErr);
    }

    res.status(500).json({ error: err.message });
  }
});

/**
 * collectAll Cloud Function — Updated for multi-platform
 * Triggered daily by Cloud Scheduler. Collects ALL active leagues.
 */
functions.http('collectAll', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const leaguesSnap = await db.collection('leagues')
      .where('status', '==', 'active')
      .get();

    const results = [];
    
    for (const doc of leaguesSnap.docs) {
      const leagueConfig = { id: doc.id, ...doc.data() };
      const platform = leagueConfig.sourcePlatform;

      try {
        const adapter = getAdapter(platform);
        const startTime = Date.now();
        const collectResult = await adapter.collectStandings(leagueConfig);
        const { divisions, standings } = collectResult;

        // Handle GC season rotation
        if (collectResult._rotatedToOrgId && platform === 'gamechanger') {
          console.log(`GameChanger: Auto-rotated ${doc.id} to org ${collectResult._rotatedToOrgId}`);
          await doc.ref.update({
            'sourceConfig.orgId': collectResult._rotatedToOrgId,
            'sourceConfig.previousOrgId': leagueConfig.sourceConfig.orgId,
            'sourceConfig.orgName': collectResult._rotatedToOrgName || null,
            lastSeasonRotation: new Date().toISOString(),
          });
        }

        // Write divisions
        const divBatch = db.batch();
        for (const div of divisions) {
          divBatch.set(db.collection('divisions').doc(div.id), div, { merge: true });
        }
        await divBatch.commit();

        // Write standings in batches
        for (let i = 0; i < standings.length; i += 400) {
          const batch = db.batch();
          const chunk = standings.slice(i, i + 400);
          for (const s of chunk) {
            const sid = `${s.divisionId}-${slugify(s.teamName)}`;
            batch.set(db.collection('standings').doc(sid), s, { merge: true });
          }
          await batch.commit();
        }

        // Track data changes for season monitoring
        const currentHash = hashStandings(standings);
        const previousHash = leagueConfig.lastStandingsHash || null;
        const dataChanged = currentHash !== previousHash && standings.length > 0;
        
        const leagueUpdates = {
          lastStandingsHash: currentHash,
          lastCollected: new Date().toISOString(),
        };
        if (dataChanged) {
          leagueUpdates.lastDataChange = new Date().toISOString();
        }
        await doc.ref.update(leagueUpdates);

        results.push({
          leagueId: doc.id,
          platform,
          divisions: divisions.length,
          standings: standings.length,
          dataChanged,
          durationMs: Date.now() - startTime,
          status: 'success',
        });

        await db.collection('collectionLogs').add({
          leagueId: doc.id,
          platform,
          divisionsCollected: divisions.length,
          standingsCollected: standings.length,
          dataChanged,
          durationMs: Date.now() - startTime,
          collectedAt: new Date().toISOString(),
          status: 'success',
        });

      } catch (err) {
        console.error(`Error collecting ${doc.id} (${platform}):`, err.message);
        results.push({
          leagueId: doc.id,
          platform,
          status: 'error',
          error: err.message,
        });

        await db.collection('collectionLogs').add({
          leagueId: doc.id,
          platform,
          status: 'error',
          error: err.message,
          collectedAt: new Date().toISOString(),
        });
      }
    }

    // After all collections, trigger Google Sheets sync
    try {
      const axios = require('axios');
      const sheetsUrl = process.env.FUNCTION_TARGET 
        ? 'https://us-central1-teams-united.cloudfunctions.net/updateSheet'
        : 'http://localhost:8080/updateSheet';
      console.log('collectAll: Triggering Google Sheets sync...');
      await axios.post(sheetsUrl, {}, { timeout: 120000 }).catch(e => {
        console.warn('collectAll: Sheets sync failed (non-fatal):', e.message);
      });
    } catch (sheetsErr) {
      console.warn('collectAll: Sheets sync trigger failed (non-fatal):', sheetsErr.message);
    }

    res.json({ collected: results.length, results });

  } catch (err) {
    console.error('collectAll error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// READ API FUNCTIONS — Called by the Replit app
// ═══════════════════════════════════════════════════════════════

/**
 * getLeagues — List leagues with optional filters
 * GET ?sport=soccer&state=WA&status=active
 */
functions.http('getLeagues', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const { sport, state, status } = req.query;
    let query = db.collection('leagues');

    if (status) {
      query = query.where('status', '==', status);
    }
    if (sport) {
      query = query.where('sport', '==', sport.toLowerCase());
    }

    const snap = await query.get();
    let leagues = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // State filter — client-side since state can be comma-separated
    if (state) {
      const stateUpper = state.toUpperCase();
      leagues = leagues.filter(l => {
        const states = (l.state || l.states || '').toUpperCase();
        return states.includes(stateUpper);
      });
    }

    // Don't return templates
    leagues = leagues.filter(l => l.status !== 'template');

    const cleaned = leagues.map(l => ({
      id: l.id,
      name: l.name,
      sport: l.sport,
      state: l.state || l.states || '',
      platform: l.sourcePlatform,
      status: l.status,
      region: l.region || null,
      autoUpdate: l.autoUpdate || false,
      lastCollected: l.lastCollected || null,
      lastDataChange: l.lastDataChange || null,
      monitorStatus: l.monitorStatus || null,
    }));

    res.json({ count: cleaned.length, leagues: cleaned });
  } catch (err) {
    console.error('getLeagues error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * getDivisions — List divisions for a league with optional filters
 * GET ?league=rcl-wa&gender=boys&ageGroup=U12
 */
functions.http('getDivisions', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const { league, gender, ageGroup } = req.query;
    if (!league) {
      return res.status(400).json({ error: 'league query parameter required' });
    }

    let query = db.collection('divisions').where('leagueId', '==', league);

    if (gender) {
      query = query.where('gender', '==', gender.toLowerCase());
    }

    const snap = await query.get();
    let divisions = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // ageGroup filter — client-side since format varies
    if (ageGroup) {
      const ag = ageGroup.toUpperCase();
      divisions = divisions.filter(d => {
        const divAge = (d.ageGroup || '').toUpperCase();
        return divAge === ag || divAge.includes(ag);
      });
    }

    divisions.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const cleaned = divisions.map(d => ({
      id: d.id,
      leagueId: d.leagueId,
      seasonId: d.seasonId || null,
      name: d.name,
      ageGroup: d.ageGroup || null,
      gender: d.gender || null,
      level: d.level || null,
      platformDivisionId: d.platformDivisionId || null,
      status: d.status || 'active',
    }));

    res.json({ leagueId: league, count: cleaned.length, divisions: cleaned });
  } catch (err) {
    console.error('getDivisions error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * getStandings — Get standings for a division
 * GET ?division=rcl-wa-8231a521-f281-4f3a-9354-5fcf9bee0fd8
 */
functions.http('getStandings', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const { division } = req.query;
    if (!division) {
      return res.status(400).json({ error: 'division query parameter required' });
    }

    const snap = await db.collection('standings')
      .where('divisionId', '==', division)
      .get();

    let standings = snap.docs.map(doc => doc.data());

    standings.sort((a, b) => {
      if (a.position && b.position) return a.position - b.position;
      return (b.points || 0) - (a.points || 0);
    });

    const leagueId = standings.length > 0 ? standings[0].leagueId : null;

    res.json({
      divisionId: division,
      leagueId,
      count: standings.length,
      standings,
    });
  } catch (err) {
    console.error('getStandings error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════

function slugify(text) {
  return (text || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 100);
}

/**
 * WA-Conference Adapter (WPA Network)
 *
 * HTML parser for WIAA conference standings hosted on WPA Network's widget endpoints.
 * Used by: KingCo, Metro, WesCo, Greater Spokane, Olympic, etc. — most WA HS conferences
 * publish through wpanetwork.com or {conference-domain}.com/sport (which proxies WPA).
 *
 * Supported URL patterns:
 *   https://www.wpanetwork.com/widgets/widget-league-sport-standings.php?school_year=Y&league_id=L&sport_id=S&level_id=V&output_mode=plain
 *   https://www.kingcoathletics.com/sport/?leagueid=7&sport_id=12&school_year=2025-26&level_id=12&output_mode=plain
 *
 * Each page renders 1+ <div class='standings_container'> blocks, each containing a
 * <table class='standings_table'> with team rows. Multiple containers = sub-divisions
 * (e.g., KingCo Crown-Crest / Mountain / Lake).
 *
 * sourceConfig schema:
 * {
 *   wpaNetworkUrl: 'https://www.wpanetwork.com/widgets/widget-league-sport-standings.php?...'
 *   // OR
 *   conference: 'kingco',  // canonical slug, used for division naming
 *   leagueId: 7, sportId: 12, levelId: 12, schoolYear: '2025-26'
 *   conferenceUrl: 'https://www.kingcoathletics.com'
 * }
 */

const axios = require('axios');
const cheerio = require('cheerio');

const PLATFORM_ID = 'wa-conference';
const USER_AGENT = 'TeamsUnited-Standings/1.0';
const REQUEST_TIMEOUT_MS = 25000;

async function collectStandings(leagueConfig) {
  const cfg = leagueConfig.sourceConfig || {};
  const url = resolveUrl(cfg);

  if (!url) {
    throw new Error('wa-conference adapter requires sourceConfig.wpaNetworkUrl or {leagueId, sportId, levelId, schoolYear}');
  }

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const conference = (cfg.conference || leagueConfig.conferenceSlug || 'conference').toString();
  const levelTag = (cfg.levelId || leagueConfig.level || '').toString();
  const schoolYear = (cfg.schoolYear || '').toString();

  const containers = $('div.standings_container').toArray();
  const divisions = [];
  const standings = [];
  const now = new Date().toISOString();

  if (containers.length === 0) {
    // Page exists but has no containers — likely off-season or empty source
    return { divisions, standings, _meta: { source: 'wa-conference', url, html_bytes: html.length } };
  }

  containers.forEach((container, idx) => {
    const $c = $(container);
    const containerId = $c.attr('id') || `div-${idx}`;
    // Division name: try to find <button> showStandings button text matching this id
    const divIdMatch = containerId.match(/standings_container_(\d+)/);
    const divId = divIdMatch ? divIdMatch[1] : `${idx}`;

    // Find the button label that targets this container
    let divisionName = `${conference}-division-${divId}`;
    $('a.c-btn').each((_, btn) => {
      const href = $(btn).attr('href') || '';
      if (href.includes(`"${divId}"`) || href.includes(`'${divId}'`)) {
        divisionName = $(btn).text().trim() || divisionName;
      }
    });

    const divisionRecord = {
      id: `${conference}-${divId}`,
      leagueId: leagueConfig.id,
      seasonId: schoolYear || null,
      name: divisionName,
      ageGroup: leagueConfig.ageGroup || 'HS',
      gender: leagueConfig.gender || null,
      level: leagueConfig.level || null,
      platformDivisionId: divId,
      status: 'active',
    };
    divisions.push(divisionRecord);

    // Parse the standings table
    const $table = $c.find('table.standings_table').first();
    if (!$table.length) return;

    // Read the header row (second <tr> with column letters: TM, CL, W, L, [T,] PF, PA, +/-, W, L, [T,] PF, PA, +/-)
    // Different sports expose different column sets; we map by header label.
    const headerRows = $table.find('tr').filter((_, tr) => $(tr).find('th').length > 0).toArray();
    let colMap = null;
    if (headerRows.length > 0) {
      // The detailed header is usually the LAST header row (the first is the grouping row WIAA/League/Overall)
      const headerCells = $(headerRows[headerRows.length - 1]).find('th').toArray();
      colMap = buildColMap(headerCells.map(th => $(th).text().trim()));
    }
    if (!colMap) {
      colMap = { team: 0, cl: 1, leagueW: 2, leagueL: 3, overallW: 7, overallL: 8 };
    }

    const rows = $table.find('tr').toArray();
    let position = 0;
    rows.forEach((tr) => {
      const $tr = $(tr);
      // Skip header rows (they contain th)
      if ($tr.find('th').length > 0) return;
      const tds = $tr.find('td').toArray();
      if (tds.length < 4) return;

      const cellText = (i) => {
        if (i == null || i < 0 || i >= tds.length) return null;
        return $(tds[i]).text().replace(/\s+/g, ' ').trim();
      };
      const num = (i) => {
        const v = cellText(i);
        if (v == null || v === '' || v === '-') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };

      const teamName = cellText(colMap.team);
      if (!teamName) return;

      position += 1;
      standings.push({
        divisionId: divisionRecord.id,
        teamName,
        position,
        classification: cellText(colMap.cl),
        gamesPlayed: (num(colMap.leagueW) || 0) + (num(colMap.leagueL) || 0) + (num(colMap.leagueT) || 0),
        wins: num(colMap.leagueW),
        losses: num(colMap.leagueL),
        ties: num(colMap.leagueT),
        points: null,
        scored: num(colMap.leaguePF),
        allowed: num(colMap.leaguePA),
        differential: num(colMap.leagueDiff),
        overallWins: num(colMap.overallW),
        overallLosses: num(colMap.overallL),
        overallTies: num(colMap.overallT),
        overallScored: num(colMap.overallPF),
        overallAllowed: num(colMap.overallPA),
        overallDifferential: num(colMap.overallDiff),
        collectedAt: now,
      });
    });
  });

  return {
    divisions,
    standings,
    _meta: {
      source: 'wa-conference',
      url,
      divisions: divisions.length,
      standingsRows: standings.length,
    },
  };
}

function resolveUrl(cfg) {
  if (cfg.wpaNetworkUrl) return cfg.wpaNetworkUrl;
  if (cfg.url) return cfg.url;
  if (cfg.leagueId && cfg.sportId && cfg.levelId && cfg.schoolYear) {
    const params = new URLSearchParams({
      school_year: cfg.schoolYear,
      league_id: String(cfg.leagueId),
      sport_id: String(cfg.sportId),
      level_id: String(cfg.levelId),
      output_mode: 'plain',
    });
    return `https://www.wpanetwork.com/widgets/widget-league-sport-standings.php?${params.toString()}`;
  }
  return null;
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml',
    },
    responseType: 'text',
    transformResponse: [(d) => d],
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return res.data;
}

module.exports = {
  PLATFORM_ID,
  collectStandings,
};

/**
 * Build a column index map from header labels.
 * The header sequence is: TM | CL | League{W L [T] PF PA +/-} | Overall{W L [T] PF PA +/-}
 * The `T`, `PF`, `PA`, `+/-` cells are sport-dependent (basketball lacks T; football has T;
 * soccer has T, and PF/PA are GF/GA). The first W column belongs to League, the second to Overall.
 */
function buildColMap(labels) {
  const norm = labels.map(l => (l || '').replace(/\s+/g, ' ').trim().toUpperCase());
  const map = { team: 0, cl: 1 };
  let seenW = 0;
  let target = 'league';
  for (let i = 2; i < norm.length; i++) {
    const lbl = norm[i];
    if (lbl === 'W') {
      seenW += 1;
      if (seenW === 1) {
        target = 'league';
        map.leagueW = i;
      } else {
        target = 'overall';
        map.overallW = i;
      }
    } else if (lbl === 'L') {
      map[target + 'L'] = i;
    } else if (lbl === 'T') {
      map[target + 'T'] = i;
    } else if (lbl === 'PF' || lbl === 'GF') {
      map[target + 'PF'] = i;
    } else if (lbl === 'PA' || lbl === 'GA') {
      map[target + 'PA'] = i;
    } else if (lbl === '+/-' || lbl === '+/–' || lbl === '+/-' || lbl.includes('/-')) {
      map[target + 'Diff'] = i;
    }
  }
  // Sanity: must have at least leagueW, leagueL, overallW, overallL
  if (map.leagueW == null || map.leagueL == null || map.overallW == null || map.overallL == null) {
    return null;
  }
  return map;
}

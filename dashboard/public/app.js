(function () {
  'use strict';

  const SUMMARY_URL = 'https://storage.googleapis.com/tu-league-dashboard/leagues-summary.json';
  const COVERAGE_URL = 'https://storage.googleapis.com/tu-league-dashboard/league-coverage-status.json';
  const OPS_URL = 'https://storage.googleapis.com/tu-league-dashboard/research-progress.json';
  const TOURNAMENTS_SUMMARY_URL = 'https://storage.googleapis.com/tu-league-dashboard/tournaments-summary.json';
  const API_URL = 'https://us-central1-teams-united.cloudfunctions.net/getLeagues';
  const DIVISIONS_URL = 'https://us-central1-teams-united.cloudfunctions.net/getDivisions';
  const STANDINGS_URL = 'https://us-central1-teams-united.cloudfunctions.net/getStandings';
  const SPORT_ORDER = ['soccer', 'baseball', 'softball', 'basketball', 'football', 'hockey', 'lacrosse', 'volleyball'];
  const US_STATE_CODES = new Set(['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']);
  const PENDING_STATUSES = new Set(['pending_config', 'pending_adapter', 'pending_platform', 'pending_groups', 'pending_tabid', 'unknown']);
  const DORMANT_STATUSES = new Set(['dormant', 'inactive', 'deactivated_phase1']);

  const state = {
    view: 'system',
    activeSport: 'soccer',
    summary: null,
    coverage: null,
    ops: null,
    tournamentSummary: null,
    leagues: [],
    selectedTournamentState: '',
    selectedTournamentSport: '',
    tournamentsBySlice: {},
    selectedLeagueId: '',
    selectedDivisionId: '',
    divisionsByLeague: {},
    standingsByDivision: {},
    filters: {
      state: '',
      status: '',
      league: '',
      search: '',
    },
  };

  const dom = {
    mastheadTitle: document.querySelector('.masthead h1'),
    mastheadLede: document.querySelector('.masthead .lede'),
    heroKicker: document.querySelector('.hero-kicker'),
    heroCopy: document.getElementById('heroCopy'),
    heroStrips: document.getElementById('heroStrips'),
    metricGrid: document.getElementById('metricGrid'),
    viewTabs: document.getElementById('viewTabs'),
    controlBar: document.getElementById('controlBar'),
    leagueWorkspace: document.getElementById('leagueWorkspace'),
    sportTabs: document.getElementById('sportTabs'),
    filterState: document.getElementById('filterState'),
    filterStatus: document.getElementById('filterStatus'),
    filterLeague: document.getElementById('filterLeague'),
    filterSearch: document.getElementById('filterSearch'),
    scopeLine: document.getElementById('scopeLine'),
    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),
    errorText: document.getElementById('errorText'),
    pipelineBars: document.getElementById('pipelineBars'),
    sportFocusTitle: document.getElementById('sportFocusTitle'),
    sportFocus: document.getElementById('sportFocus'),
    selectedLeagueStrip: document.getElementById('selectedLeagueStrip'),
    currentSlicePanel: document.getElementById('currentSlicePanel'),
    stateBuildoutPanel: document.getElementById('stateBuildoutPanel'),
    stateCards: document.getElementById('stateCards'),
    leagueCountNote: document.getElementById('leagueCountNote'),
    leagueRows: document.getElementById('leagueRows'),
    researchMetrics: document.getElementById('researchMetrics'),
    gapList: document.getElementById('gapList'),
    matrixGrid: document.getElementById('matrixGrid'),
    tournamentMetrics: document.getElementById('tournamentMetrics'),
    tournamentSportGrid: document.getElementById('tournamentSportGrid'),
    selectedTournamentPanel: document.getElementById('selectedTournamentPanel'),
    tournamentStateGrid: document.getElementById('tournamentStateGrid'),
    systemRail: document.getElementById('systemRail'),
    blockerList: document.getElementById('blockerList'),
    detailPanel: document.getElementById('detailPanel'),
    detailTitle: document.getElementById('detailTitle'),
    detailMeta: document.getElementById('detailMeta'),
    detailBackButton: document.getElementById('detailBackButton'),
    detailTrail: document.getElementById('detailTrail'),
    detailSummary: document.getElementById('detailSummary'),
    selectedDivisionStrip: document.getElementById('selectedDivisionStrip'),
    divisionRows: document.getElementById('divisionRows'),
    standingsTitle: document.getElementById('standingsTitle'),
    standingsMeta: document.getElementById('standingsMeta'),
    standingRows: document.getElementById('standingRows'),
    opsGenerated: document.getElementById('opsGenerated'),
    opsSummaryGrid: document.getElementById('opsSummaryGrid'),
    opsFlagList: document.getElementById('opsFlagList'),
    opsAgentGrid: document.getElementById('opsAgentGrid'),
    opsStandbyGrid: document.getElementById('opsStandbyGrid'),
    opsPausedGrid: document.getElementById('opsPausedGrid'),
    opsRolloutGrid: document.getElementById('opsRolloutGrid'),
    opsLogList: document.getElementById('opsLogList'),
    panels: Array.from(document.querySelectorAll('.view-panel')),
    tabButtons: Array.from(document.querySelectorAll('.view-tab')),
  };

  function setupChrome() {
    if (dom.mastheadTitle) dom.mastheadTitle.textContent = 'League Operations Dashboard';
    if (dom.mastheadLede) {
      dom.mastheadLede.textContent = 'Research finds tournaments and leagues. Ingest makes them trackable. Agents build them out. TeamsUnited exposes the result. This page is the operating view of that system.';
    }
    if (dom.heroKicker) dom.heroKicker.textContent = 'Operating Pulse';

    const labels = {
      system: 'System Map',
      leagues: 'League Operations',
      research: 'Research Rollout',
      tournaments: 'Tournament Rollout',
      ops: 'Agents',
      trust: 'Trust Layer',
    };

    dom.tabButtons.forEach((button) => {
      if (labels[button.dataset.view]) button.textContent = labels[button.dataset.view];
      if (button.dataset.view === 'trust') button.hidden = true;
    });

    const opsPanelTitle = document.querySelector('[data-view="ops"] .panel-head h2');
    if (opsPanelTitle) opsPanelTitle.textContent = 'Agent status, rollout progress, flags, and recent logs from the current ops payload.';
    const opsPanelKicker = document.querySelector('[data-view="ops"] .panel-kicker');
    if (opsPanelKicker) opsPanelKicker.textContent = 'Agents';

    const systemTitle = document.querySelector('[data-view="system"] .panel h2');
    if (systemTitle) systemTitle.textContent = 'Research feeds ingest. Ingest feeds buildout. Buildout feeds live TeamsUnited data.';

    const blockerTitle = document.querySelector('[data-view="system"] .blocker-list')?.closest('.panel')?.querySelector('h2');
    if (blockerTitle) blockerTitle.textContent = 'Trust and blockers that matter right now.';
  }

  async function fetchJSON(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function desiredSports() {
    return SPORT_ORDER.slice();
  }

  function isTrackedStateCode(code) {
    return US_STATE_CODES.has(String(code || '').trim().toUpperCase());
  }

  function sanitizeCoverage(coverage) {
    const payload = coverage && typeof coverage === 'object' ? coverage : {};
    const matrix = {};
    Object.entries(payload.coverage_matrix || {}).forEach(([key, value]) => {
      const [stateCode, sport] = key.split('_');
      if (!isTrackedStateCode(stateCode)) return;
      if (!SPORT_ORDER.includes(sport)) return;
      matrix[`${stateCode}_${sport}`] = value;
    });

    const gaps = Array.isArray(payload.gaps)
      ? payload.gaps.filter((entry) => {
          const [stateCode, sport] = String(entry || '').trim().split(/\s+/, 2);
          return isTrackedStateCode(stateCode) && SPORT_ORDER.includes((sport || '').toLowerCase());
        })
      : [];

    const byState = {};
    Object.entries(payload.by_state || {}).forEach(([key, value]) => {
      if (isTrackedStateCode(key)) byState[key] = value;
    });

    const coveredCombos = Object.keys(matrix).length;
    const totalCombos = US_STATE_CODES.size * SPORT_ORDER.length;

    return {
      ...payload,
      by_state: byState,
      coverage_matrix: matrix,
      gaps,
      covered_combos: coveredCombos,
      total_combos: totalCombos,
      coverage_pct: totalCombos ? Math.round((coveredCombos / totalCombos) * 1000) / 10 : 0,
    };
  }

  function normalizeSport(value) {
    return String(value || '').trim().toLowerCase();
  }

  function humanSport(sport) {
    if (!sport) return 'Unknown';
    return sport.charAt(0).toUpperCase() + sport.slice(1);
  }

  function displayTournamentGender(value) {
    const normalized = String(value || '').toLowerCase();
    if (!normalized) return 'Coed';
    if (normalized.includes('female') || normalized.includes('girl')) return 'Girls';
    if (normalized.includes('male') || normalized.includes('boy')) return 'Boys';
    return 'Coed';
  }

  function formatDateRange(startDate, endDate) {
    if (!startDate) return 'Date not published';
    const start = new Date(`${startDate}T00:00:00`);
    const end = endDate ? new Date(`${endDate}T00:00:00`) : null;
    const sameDay = end && start.toDateString() === end.toDateString();
    const startLabel = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
    if (!end || sameDay) return startLabel;
    const endLabel = end.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${startLabel} – ${endLabel}`;
  }

  function formatTournamentPlatform(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'Source not published';
    return raw
      .split(/[-_]/g)
      .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
      .join(' ');
  }

  function todayIso() {
    return new Date().toISOString().split('T')[0];
  }

  function isUpcomingTournament(item) {
    const date = item?.endDate || item?.startDate || '';
    if (!date) return true;
    return date >= todayIso();
  }

  function humanStatus(status) {
    return String(status || 'unknown')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatStamp(timestamp) {
    if (!timestamp) return 'unknown';
    return new Date(timestamp).toLocaleString([], {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function ageMinutes(timestamp) {
    if (!timestamp) return null;
    const millis = new Date(timestamp).getTime();
    if (!Number.isFinite(millis)) return null;
    return Math.max(0, Math.round((Date.now() - millis) / 60000));
  }

  function shortTime(timestamp) {
    const minutes = ageMinutes(timestamp);
    if (minutes == null) return 'unknown';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function freshnessLabel(timestamp) {
    const minutes = ageMinutes(timestamp);
    if (minutes == null) return 'unknown freshness';
    if (minutes < 60) return `${minutes}m old`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    if (hours < 24) return `${hours}h ${rem}m old`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h old`;
  }

  function freshnessTone(timestamp, warnAfterMinutes = 180, staleAfterMinutes = 720) {
    const minutes = ageMinutes(timestamp);
    if (minutes == null) return 'red';
    if (minutes >= staleAfterMinutes) return 'red';
    if (minutes >= warnAfterMinutes) return 'amber';
    return 'green';
  }

  function coverageCombo(stateCode, sport) {
    if (!state.coverage || !state.coverage.coverage_matrix) return null;
    return state.coverage.coverage_matrix[`${stateCode}_${sport}`] || null;
  }

  function leagueStateCodes(league) {
    return String(league.state || '')
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
  }

  function statusTone(status) {
    if (status === 'active') return 'active';
    if (PENDING_STATUSES.has(status)) return 'pending';
    if (DORMANT_STATUSES.has(status)) return 'dormant';
    return 'other';
  }

  function countByStatus(leagues, matcher) {
    return leagues.filter((league) => matcher(league.status || '')).length;
  }

  function rollupForLeagues(leagues) {
    const active = leagues.filter((league) => league.status === 'active').length;
    const pending = countByStatus(leagues, (status) => PENDING_STATUSES.has(status));
    const dormant = countByStatus(leagues, (status) => DORMANT_STATUSES.has(status));
    const withDivisions = leagues.filter((league) => (league.divisionCount || 0) > 0).length;
    const platforms = new Set(leagues.map((league) => league.platform).filter(Boolean)).size;
    const states = new Set();
    leagues.forEach((league) => leagueStateCodes(league).forEach((code) => {
      if (code && code !== 'NATIONAL' && code.length === 2) states.add(code);
    }));
    return {
      leagues,
      active,
      pending,
      dormant,
      withDivisions,
      platforms,
      states: Array.from(states).sort(),
    };
  }

  function overallRollup() {
    return rollupForLeagues(state.leagues);
  }

  function leaguesForSport() {
    return state.leagues.filter((league) => normalizeSport(league.sport) === state.activeSport);
  }

  function filteredLeaguesBase(options = {}) {
    const {
      includeLeagueFilter = true,
      includeSearch = true,
      includeStatus = true,
      includeState = true,
    } = options;

    return leaguesForSport().filter((league) => {
      if (includeState && state.filters.state) {
        const codes = leagueStateCodes(league);
        if (!codes.includes(state.filters.state)) return false;
      }
      if (includeStatus && state.filters.status && (league.status || '') !== state.filters.status) return false;
      if (includeLeagueFilter && state.filters.league && league.id !== state.filters.league) return false;
      if (includeSearch && state.filters.search) {
        const haystack = [
          league.name,
          league.id,
          league.platform,
          league.region,
          league.state,
          league.monitorStatus,
        ].join(' ').toLowerCase();
        if (!haystack.includes(state.filters.search)) return false;
      }
      return true;
    });
  }

  function filteredLeagues() {
    return filteredLeaguesBase();
  }

  function sortLeagueRows(rows) {
    return rows.slice().sort((a, b) => {
      const order = { active: 0, pending: 1, dormant: 2, other: 3 };
      const toneDiff = order[statusTone(a.status || '')] - order[statusTone(b.status || '')];
      if (toneDiff !== 0) return toneDiff;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  function sportRollup() {
    return rollupForLeagues(leaguesForSport());
  }

  function filteredRollup() {
    return rollupForLeagues(filteredLeagues());
  }

  function stateSummariesForSport(rows = leaguesForSport()) {
    const byState = new Map();
    for (const league of rows) {
      for (const code of leagueStateCodes(league)) {
        if (code === 'NATIONAL' || code.length !== 2) continue;
        if (state.filters.state && code !== state.filters.state) continue;
        if (!byState.has(code)) {
          byState.set(code, { code, total: 0, active: 0, pending: 0, dormant: 0, withDivisions: 0 });
        }
        const item = byState.get(code);
        item.total += 1;
        if (league.status === 'active') item.active += 1;
        else if (PENDING_STATUSES.has(league.status || '')) item.pending += 1;
        else if (DORMANT_STATUSES.has(league.status || '')) item.dormant += 1;
        if ((league.divisionCount || 0) > 0) item.withDivisions += 1;
      }
    }

    return Array.from(byState.values()).sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  }

  function sportGaps() {
    return sportGapList(state.activeSport);
  }

  function sportGapList(sport) {
    if (!state.coverage || !Array.isArray(state.coverage.gaps)) return [];
    return state.coverage.gaps
      .filter((entry) => entry.toLowerCase().endsWith(` ${sport}`))
      .sort();
  }

  function trackedStates() {
    const states = new Set();
    if (state.coverage && state.coverage.coverage_matrix) {
      Object.keys(state.coverage.coverage_matrix).forEach((key) => {
        const code = key.split('_')[0];
        if (isTrackedStateCode(code)) states.add(code);
      });
    }
    state.leagues.forEach((league) => leagueStateCodes(league).forEach((code) => {
      if (isTrackedStateCode(code)) states.add(code);
    }));
    return Array.from(states).sort((a, b) => a.localeCompare(b));
  }

  function sportCoverageStats() {
    return desiredSports().map((sport) => {
      let coveredStates = 0;
      let active = 0;
      let pending = 0;
      let total = 0;
      trackedStates().forEach((code) => {
        const combo = coverageCombo(code, sport);
        if (!combo) return;
        coveredStates += 1;
        active += combo.active || 0;
        pending += combo.pending || 0;
        total += combo.total || 0;
      });
      const gaps = sportGapList(sport);
      const owner = !gaps.length
        ? 'League Buildout'
        : coveredStates === 0
          ? 'League Discovery'
          : pending > active
            ? 'League Discovery + Adapter Builder'
            : 'League Buildout + Adapter Builder';
      const nextMove = !gaps.length
        ? 'Keep this sport current and turn pending inventory into active/division-visible leagues.'
        : coveredStates === 0
          ? 'Research and ingest missing states first, then classify platforms.'
          : pending > active
            ? 'Clean platform/config blockers before pushing broad buildout.'
            : 'Push active-ready rows through buildout and close the remaining state gaps.';
      return { sport, coveredStates, active, pending, total, gaps, owner, nextMove };
    });
  }

  function researchStateCards() {
    return Array.from(US_STATE_CODES)
      .sort((a, b) => a.localeCompare(b))
      .map((code) => {
        const sportDetails = desiredSports().map((sport) => {
          const combo = coverageCombo(code, sport);
          const gap = sportGapList(sport).includes(`${code} ${sport}`);
          const tone = combo?.total ? 'valid' : (gap ? 'partial' : '');
          return {
            sport,
            tone,
            label: combo?.total ? `${combo.total}` : '—',
          };
        });
        const covered = sportDetails.filter((item) => item.tone === 'valid').length;
        const active = desiredSports().reduce((sum, sport) => sum + (coverageCombo(code, sport)?.active || 0), 0);
        const pending = desiredSports().reduce((sum, sport) => sum + (coverageCombo(code, sport)?.pending || 0), 0);
        return { code, covered, active, pending, sportDetails };
      });
  }

  function populateSportTabs() {
    const sports = desiredSports();
    if (!sports.includes(state.activeSport)) state.activeSport = sports[0] || 'soccer';
    dom.sportTabs.innerHTML = sports.map((sport) => {
      const count = state.leagues.filter((league) => normalizeSport(league.sport) === sport).length;
      return `<button class="sport-pill ${sport === state.activeSport ? 'active' : ''}" data-sport="${sport}" type="button">${humanSport(sport)} · ${count}</button>`;
    }).join('');
  }

  function populateFilters() {
    const sportLeagues = leaguesForSport();
    const states = new Set();
    const statuses = new Set();
    const leagueOptions = filteredLeaguesBase({ includeLeagueFilter: false });

    sportLeagues.forEach((league) => {
      leagueStateCodes(league).forEach((code) => {
        if (code && code !== 'NATIONAL') states.add(code);
      });
      if (league.status) statuses.add(league.status);
    });

    dom.filterState.innerHTML = ['<option value="">All states</option>']
      .concat(Array.from(states).sort().map((code) => `<option value="${code}">${code}</option>`))
      .join('');
    dom.filterStatus.innerHTML = ['<option value="">All statuses</option>']
      .concat(Array.from(statuses).sort().map((status) => `<option value="${status}">${humanStatus(status)}</option>`))
      .join('');
    dom.filterLeague.innerHTML = ['<option value="">All leagues</option>']
      .concat(leagueOptions
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((league) => `<option value="${league.id}">${escapeHtml(league.name || league.id)}</option>`))
      .join('');

    dom.filterState.value = state.filters.state;
    dom.filterStatus.value = state.filters.status;
    dom.filterLeague.value = state.filters.league;
    dom.filterSearch.value = state.filters.search;
  }

  function renderHero() {
    const overall = overallRollup();
    const sport = sportRollup();
    const coverage = state.coverage || { coverage_pct: 0, covered_combos: 0, total_combos: 0, gaps: [] };
    const summaryStamp = state.summary?.generatedAt || state.summary?.timestamp || null;
    const summaryTone = freshnessTone(summaryStamp, 180, 720);
    const coverageTone = freshnessTone(coverage.timestamp, 180, 720);

    let heroCopy = '';
    let strips = [];
    let metrics = [];

    if (state.view === 'system') {
      heroCopy = `${overall.leagues.length} leagues are tracked across ${desiredSports().length} sports. ${overall.active} are active now, ${overall.pending} are still in buildout, and ${overall.withDivisions} already expose divisions in the hosted snapshot.`;
      strips = [
        { tone: summaryStamp ? summaryTone : 'blue', text: summaryStamp ? `league snapshot ${shortTime(summaryStamp)}` : `${overall.leagues.length} tracked leagues` },
        { tone: coverageTone, text: `coverage ${shortTime(coverage.timestamp)}` },
        { tone: coverage.gaps?.length ? 'amber' : 'green', text: `${coverage.gaps?.length || 0} tracked gaps` },
        { tone: 'blue', text: `${trackedStates().length} states represented` },
      ];
      metrics = [
        { label: 'Total Leagues', value: overall.leagues.length, note: 'Hosted league inventory across all sports.' },
        { label: 'Pipeline', value: overall.pending, note: 'Pending config, adapter, platform, and unknown statuses.' },
        { label: 'Active Now', value: overall.active, note: 'League records currently marked active.' },
        { label: 'With Divisions', value: overall.withDivisions, note: 'Leagues that already surface division-level structure.' },
      ];
    } else if (state.view === 'leagues') {
      const filtered = filteredRollup();
      const scopeLabel = state.filters.state ? `${state.filters.state} ${humanSport(state.activeSport)}` : humanSport(state.activeSport);
      heroCopy = `${scopeLabel} has ${filtered.leagues.length} leagues in the current slice, ${filtered.active} active now, ${filtered.pending} in the pipeline, and ${filtered.withDivisions} already exposing divisions. Click any league row to open its live division and standings detail above the directory.`;
      strips = [
        { tone: 'green', text: `${filtered.active} Active` },
        { tone: filtered.pending ? 'amber' : 'green', text: `${filtered.pending} Pipeline` },
        { tone: filtered.dormant ? 'red' : 'green', text: `${filtered.dormant} Dormant` },
        { tone: 'blue', text: `${filtered.withDivisions} With Divisions` },
      ];
      metrics = [
        { label: 'Total Leagues', value: filtered.leagues.length, note: `Current ${scopeLabel} slice.` },
        { label: 'Pipeline', value: filtered.pending, note: 'League rows still waiting on config, adapters, platform fixes, or buildout.' },
        { label: 'Active Now', value: filtered.active, note: 'League rows currently marked active.' },
        { label: 'With Divisions', value: filtered.withDivisions, note: 'Leagues with division data visible in the hosted snapshot.' },
      ];
    } else if (state.view === 'research') {
      const sportStats = sportCoverageStats();
      const uncoveredSports = sportStats.filter((item) => item.gaps.length).length;
      const totalGaps = (coverage.gaps || []).length;
      heroCopy = `Research Rollout now reads as an all-sports control layer. ${coverage.coverage_pct || 0}% of tracked state-sport combinations are covered, ${totalGaps} combinations are still open, and ${uncoveredSports} sports still need gap-closing work before full national buildout pressure makes sense.`;
      strips = [
        { tone: coverageTone, text: `coverage ${shortTime(coverage.timestamp)}` },
        { tone: totalGaps ? 'red' : 'green', text: `${totalGaps} open gaps` },
        { tone: 'blue', text: `${coverage.covered_combos || 0}/${coverage.total_combos || 0} covered combos` },
        { tone: 'amber', text: `${overall.pending} still in pipeline` },
      ];
      metrics = [
        { label: 'Coverage %', value: `${coverage.coverage_pct || 0}%`, note: 'Tracked state-sport combinations covered by hosted coverage status.' },
        { label: 'Covered Combos', value: coverage.covered_combos || 0, note: `Out of ${coverage.total_combos || 0} tracked combinations.` },
        { label: 'Open Gaps', value: totalGaps, note: 'State-sport combinations still needing research, ingest, or cleanup.' },
        { label: 'Tracked States', value: trackedStates().length, note: 'US states visible across hosted coverage plus hosted inventory.' },
      ];
    } else if (state.view === 'tournaments') {
      const payload = state.ops || {};
      const tournamentStates = (payload.states || []).filter((entry) => entry.tournaments?.aggregated?.exists || entry.tournaments?.existingSports);
      const tournamentSummary = state.tournamentSummary || { tournaments: [] };
      const totalEvents = Array.isArray(tournamentSummary.tournaments) ? tournamentSummary.tournaments.length : 0;
      const statesRepresented = new Set((tournamentSummary.tournaments || []).map((item) => item.state).filter(Boolean)).size;
      const sportsRepresented = new Set((tournamentSummary.tournaments || []).map((item) => item.sport).filter(Boolean)).size;
      heroCopy = `${totalEvents} repo-backed tournament events are available across ${statesRepresented} states and ${sportsRepresented} sports. Click a state, then a sport, to see the actual event cards from the git-backed inventory.`;
      strips = [
        { tone: 'green', text: `${totalEvents} tournament events` },
        { tone: 'blue', text: `${statesRepresented} states represented` },
        { tone: 'blue', text: `${sportsRepresented} sports represented` },
        { tone: 'blue', text: 'repo-backed event cards' },
      ];
      metrics = [
        { label: 'Tournament Events', value: totalEvents, note: 'Repo-backed tournament cards currently available in the hosted snapshot.' },
        { label: 'States Represented', value: statesRepresented, note: 'States with at least one tournament event in the git-backed inventory.' },
        { label: 'Sports Represented', value: sportsRepresented, note: 'Sports carrying tournament events in the hosted snapshot.' },
        { label: 'Tracked Sports', value: desiredSports().length, note: 'Tournament sport lanes expected across the rollout.' },
      ];
    } else {
      heroCopy = 'The Agents tab is the readable operator board: recent agent outcomes, flags, state rollout, and run logs. Use it for agent health, not for league detail drill-down.';
      strips = [
        { tone: summaryStamp ? summaryTone : 'blue', text: summaryStamp ? `league snapshot ${shortTime(summaryStamp)}` : `${overall.leagues.length} tracked leagues` },
        { tone: coverageTone, text: `coverage ${shortTime(coverage.timestamp)}` },
        { tone: 'blue', text: 'agent board embedded' },
      ];
      metrics = [
        { label: 'Tracked Leagues', value: overall.leagues.length, note: 'Current hosted inventory feeding league operations.' },
        { label: 'Coverage %', value: `${coverage.coverage_pct || 0}%`, note: 'Hosted coverage snapshot for research and rollout.' },
        { label: 'Top Blockers', value: currentAttention().filter((item) => item.tone !== 'green').length, note: 'Manual or agent-owned issues surfaced in the system map.' },
        { label: 'Use This For', value: 'Agents', note: 'Recent fleet outcomes, flags, rollout status, and run logs.' },
      ];
    }

    dom.heroCopy.textContent = heroCopy;
    dom.heroStrips.innerHTML = strips.map((item) => `<span class="status-pill ${item.tone}">${item.text}</span>`).join('');
    dom.metricGrid.innerHTML = metrics.map((metric) => `
      <article class="metric-card">
        <div class="metric-label">${metric.label}</div>
        <div class="metric-value">${metric.value}</div>
        <div class="metric-note">${metric.note}</div>
      </article>
    `).join('');
  }

  function currentAttention() {
    const coverage = state.coverage || {};
    const items = [
      {
        tone: 'red',
        title: 'GST-135 still needs new source inputs',
        owner: 'Adapter Builder + PC',
        note: 'Billings still needs valid season identifiers, and Helena still returns 403 from the runtime path that was tested.',
        next: 'Provide usable source inputs or choose a new access strategy before expecting adapter progress.',
      },
      {
        tone: 'amber',
        title: 'Buildout still relies on resolver fallback',
        owner: 'League Buildout',
        note: 'Buildout is moving leagues, but the resolver path is still not the clean fast path.',
        next: 'Keep throughput moving while the resolver path gets repaired.',
      },
    ];

    if (freshnessTone(coverage.timestamp, 180, 720) === 'green') {
      items.unshift({
        tone: 'green',
        title: 'Hosted coverage snapshot is healthy again',
        owner: 'Dashboard Publishing',
        note: `Coverage snapshot is fresh at ${formatStamp(coverage.timestamp)} and no longer stuck at the old stale value.`,
        next: 'Use it as a trust signal, but still compare against league detail for buildout quality.',
      });
    } else {
      items.unshift({
        tone: 'amber',
        title: 'Hosted coverage snapshot needs trust caution',
        owner: 'Dashboard Publishing',
        note: `Coverage snapshot age is ${shortTime(coverage.timestamp)}. Freshness affects how much trust to place in the coverage percentage.`,
        next: 'Regenerate coverage status before using it as the primary truth source.',
      });
    }

    return items;
  }

  function renderSystemView() {
    const overall = overallRollup();
    const coverage = state.coverage || { coverage_pct: 0, covered_combos: 0, total_combos: 0, gaps: [] };
    const summaryStamp = state.summary?.generatedAt || state.summary?.timestamp || null;
    const summaryTone = freshnessTone(summaryStamp, 180, 720);
    const coverageTone = freshnessTone(coverage.timestamp, 180, 720);

    const steps = [
      {
        title: 'Research',
        tone: coverage.coverage_pct >= 50 ? 'green' : 'amber',
        metric: `${coverage.coverage_pct || 0}%`,
        note: `${coverage.covered_combos || 0} of ${coverage.total_combos || 0} tracked state-sport combinations are covered. Research Rollout is where you watch breadth expand and see the tracked gaps by sport.`,
      },
      {
        title: 'Ingest',
        tone: 'blue',
        metric: `${overall.leagues.length}`,
        note: `${trackedStates().length} states and ${desiredSports().length} sports are already represented in hosted league inventory. Ingest is what turns research into tracked records.`,
      },
      {
        title: 'Buildout',
        tone: overall.pending ? 'amber' : 'green',
        metric: `${overall.active} active · ${overall.pending} pipeline`,
        note: `${overall.active} active now, ${overall.pending} still in pipeline. This is the league-status layer, not the research-complete layer.`,
      },
      {
        title: 'Live',
        tone: overall.withDivisions > 0 ? 'green' : summaryTone,
        metric: `${overall.withDivisions} with divisions`,
        note: `${overall.withDivisions} leagues already expose divisions in the hosted snapshot. League Operations is where you inspect state, sport, league, and live division detail.`,
      },
    ];

    dom.systemRail.innerHTML = steps.map((step) => `
      <article class="system-step">
        <div class="system-step-top">
          <h3>${step.title}</h3>
          <span class="status-pill ${step.tone}">${step.metric}</span>
        </div>
        <p>${step.note}</p>
      </article>
    `).join('');

    const attention = currentAttention();
    dom.blockerList.innerHTML = attention.map((item) => `
      <article class="blocker-item">
        <div class="blocker-top">
          <h3>${item.title}</h3>
          <span class="status-pill ${item.tone}">${item.owner}</span>
        </div>
        <p>${item.note}</p>
        <p style="margin-top:10px;"><strong>Next:</strong> ${item.next}</p>
      </article>
    `).join('');

  }

  function renderLeaguesView() {
    const rows = filteredLeagues();
    const rollup = rollupForLeagues(rows);
    const selected = selectedLeague();
    const total = Math.max(rollup.leagues.length, 1);
    const scopeParts = [
      state.filters.state || 'All states',
      humanSport(state.activeSport),
      state.filters.status ? humanStatus(state.filters.status) : 'All statuses',
      `${rows.length} leagues`,
    ];
    dom.scopeLine.textContent = `Viewing: ${scopeParts.join(' · ')}`;
    const bars = [
      {
        title: 'Active',
        value: rollup.active,
        width: (rollup.active / total) * 100,
        tone: 'green',
        note: 'Leagues collecting successfully and represented as live.',
      },
      {
        title: 'Pipeline',
        value: rollup.pending,
        width: (rollup.pending / total) * 100,
        tone: 'amber',
        note: 'Discovered leagues still waiting on config, adapters, or source fixes.',
      },
      {
        title: 'Dormant / Deactivated',
        value: rollup.dormant,
        width: (rollup.dormant / total) * 100,
        tone: 'red',
        note: 'Known leagues intentionally out of active collection flow.',
      },
      {
        title: 'With Divisions',
        value: rollup.withDivisions,
        width: (rollup.withDivisions / total) * 100,
        tone: 'blue',
        note: 'Leagues already surfacing division-level structure in the hosted snapshot.',
      },
    ];

    dom.pipelineBars.innerHTML = bars.map((bar) => `
      <article class="bar-card">
        <div class="bar-top">
          <div class="bar-title">${bar.title}</div>
          <div class="bar-value">${bar.value}</div>
        </div>
        <div class="bar-track"><div class="bar-fill ${bar.tone}" style="width:${Math.min(bar.width, 100)}%"></div></div>
        <div class="bar-note">${bar.note}</div>
      </article>
    `).join('');

    dom.sportFocusTitle.textContent = state.filters.state
      ? `${state.filters.state} ${humanSport(state.activeSport)} operating view`
      : `${humanSport(state.activeSport)} operating view`;
    const focusCards = [
      { label: 'Platforms', value: rollup.platforms, note: 'Distinct source platforms in this sport.' },
      { label: 'States', value: rollup.states.length, note: 'States represented in this sport slice.' },
      { label: 'Coverage Gaps', value: sportGaps().length, note: 'Tracked state-sport combinations still uncovered.' },
      { label: 'Filtered Rows', value: rows.length, note: 'Current league directory result set.' },
    ];
    dom.sportFocus.innerHTML = focusCards.map((card) => `
      <article class="focus-card">
        <span>${card.label}</span>
        <strong>${card.value}</strong>
        <p>${card.note}</p>
      </article>
    `).join('');

    if (selected) {
      dom.selectedLeagueStrip.hidden = false;
      dom.selectedLeagueStrip.innerHTML = `
        <div class="selected-league-head">
          <div>
            <div class="panel-kicker">Selected League</div>
            <div class="selected-league-name">${escapeHtml(selected.name || selected.id)}</div>
          </div>
          <button class="detail-back-button" id="selectedLeagueBackButton" type="button">Back to league directory</button>
        </div>
        <div class="selected-league-meta">
          ${escapeHtml(selected.state || '—')} · ${escapeHtml(humanSport(selected.sport))} · ${escapeHtml(humanStatus(selected.status || 'unknown'))} · ${escapeHtml(selected.platform || 'unknown platform')} · ${selected.divisionCount || 0} divisions
        </div>
      `;
    } else {
      dom.selectedLeagueStrip.hidden = true;
      dom.selectedLeagueStrip.innerHTML = '';
    }

    const states = stateSummariesForSport(rows);
    dom.stateCards.innerHTML = states.length
      ? states.map((item) => {
          const combo = coverageCombo(item.code, state.activeSport);
          return `
            <article class="state-card">
              <div class="state-top">
                <div>
                  <div class="state-code">${item.code}</div>
                  <div class="state-total">${item.total}</div>
                  <div class="state-name">${humanSport(state.activeSport)} leagues tracked</div>
                </div>
                <div class="status-pill ${combo ? 'green' : 'amber'}">${combo ? 'tracked' : 'not tracked'}</div>
              </div>
              <div class="mini-grid">
                <div class="mini-stat">
                  <label>Active</label>
                  <strong>${item.active}</strong>
                  <p>${item.withDivisions} with divisions</p>
                </div>
                <div class="mini-stat">
                  <label>Pipeline</label>
                  <strong>${item.pending}</strong>
                  <p>${combo ? `${combo.pending} pending in matrix` : 'summary only'}</p>
                </div>
                <div class="mini-stat">
                  <label>Dormant</label>
                  <strong>${item.dormant}</strong>
                  <p>${combo ? `${combo.total} total tracked` : 'local summary only'}</p>
                </div>
              </div>
            </article>
          `;
        }).join('')
      : '<article class="state-card"><div class="state-code">No states</div><div class="state-name">No league rows match the selected sport yet.</div></article>';

    const sortedRows = sortLeagueRows(rows);
    if (state.selectedLeagueId && !sortedRows.some((league) => league.id === state.selectedLeagueId)) {
      state.selectedLeagueId = '';
      state.selectedDivisionId = '';
    }
    dom.leagueCountNote.textContent = `${sortedRows.length} leagues in current filter`;
    dom.leagueRows.innerHTML = sortedRows.map((league) => {
      const selected = league.id === state.selectedLeagueId;
      const selectedStyle = selected ? ' style="background: rgba(36, 106, 75, 0.12);"' : '';
      return `
        <tr data-league-id="${league.id}"${selectedStyle}>
          <td><strong>${escapeHtml(league.name || league.id)}</strong><br><span class="panel-note">${escapeHtml(league.region || league.id)}</span></td>
          <td>${escapeHtml(league.state || '—')}</td>
          <td><span class="status-badge ${statusTone(league.status || '')}">${escapeHtml(humanStatus(league.status || 'unknown'))}</span></td>
          <td>${escapeHtml(league.platform || '—')}</td>
          <td>${league.divisionCount || 0}</td>
          <td>${escapeHtml(league.monitorStatus || '—')}</td>
          <td>${league.lastCollected ? shortTime(league.lastCollected) : 'never'}</td>
        </tr>
      `;
    }).join('');

    renderLeagueDetail();
  }

  function renderResearchView() {
    const coverage = state.coverage || {
      coverage_pct: 0,
      covered_combos: 0,
      total_combos: 0,
      gaps: [],
      total: 0,
      by_status: {},
    };
    const sportStats = sportCoverageStats();
    const totalGapCount = sportStats.reduce((sum, item) => sum + item.gaps.length, 0);
    const readyLeagueStates = state.ops?.summary?.validLeagueStates || 0;
    const readyTournamentStates = state.ops?.summary?.validTournamentStates || 0;
    const metrics = [
      {
        label: 'Coverage %',
        value: `${coverage.coverage_pct || 0}%`,
        note: `${coverage.covered_combos || 0} of ${coverage.total_combos || 0} tracked combinations currently covered.`,
      },
      {
        label: 'Open Gaps',
        value: totalGapCount,
        note: 'Tracked state-sport combinations still missing from the current research/buildout map.',
      },
      {
        label: 'League States Ready',
        value: readyLeagueStates,
        note: 'States whose league research files are already substantial enough to work from.',
      },
      {
        label: 'Tournament States Ready',
        value: readyTournamentStates,
        note: 'States with substantive tournament research already landed in the current ops payload.',
      },
    ];

    dom.researchMetrics.innerHTML = metrics.map((card) => `
      <article class="submetric">
        <span>${card.label}</span>
        <strong>${card.value}</strong>
        <p>${card.note}</p>
      </article>
    `).join('');

    dom.gapList.innerHTML = sportStats.map((item) => {
      const tone = !item.gaps.length ? 'green' : item.coveredStates === 0 ? 'red' : 'amber';
      return `
        <article class="ops-flag ${tone}">
          <span class="ops-flag-pill">${item.gaps.length ? `${item.gaps.length} gaps` : 'covered'}</span>
          <strong>${escapeHtml(humanSport(item.sport))}</strong>
          <p>${item.coveredStates}/50 states currently covered. ${item.total} tracked leagues are in the current hosted matrix for this sport.</p>
          <div class="ops-flag-meta">
            <div class="ops-flag-meta-item"><span>Owner</span><div>${escapeHtml(item.owner)}</div></div>
            <div class="ops-flag-meta-item"><span>Pipeline</span><div>${item.pending} pending</div></div>
            <div class="ops-flag-meta-item"><span>Active</span><div>${item.active} active</div></div>
          </div>
          <p><strong>Next:</strong> ${escapeHtml(item.nextMove)}</p>
        </article>
      `;
    }).join('');

    const matrixStates = researchStateCards();
    dom.matrixGrid.innerHTML = matrixStates.map((item) => `
      <article class="ops-rollout ${item.covered === desiredSports().length ? 'active' : ''}">
        <div class="ops-rollout-head">
          <div>
            <span>Research State</span>
            <strong>${item.code}</strong>
          </div>
          <div class="ops-agent-meta">${item.covered}/8 covered</div>
        </div>
        <div class="ops-kind">
          <div class="ops-kind-top">
            <div class="ops-kind-title">Sport Coverage</div>
            <div class="ops-kind-metric">${item.active} active · ${item.pending} pending</div>
          </div>
          <div class="ops-kind-bar"><span style="width:${(item.covered / desiredSports().length) * 100}%"></span></div>
          <div class="ops-kind-dots">
            ${item.sportDetails.map((sport) => `
              <div class="ops-kind-dot ${sport.tone}">
                <span>${sportShortLabel(sport.sport)}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="ops-rollout-footer">
          <div class="ops-rollout-note">
            <strong>${item.covered === desiredSports().length ? 'Complete' : item.covered ? 'In Progress' : 'Discovery Needed'}</strong>
            ${item.covered === desiredSports().length ? 'All sports are represented in this state’s current research/buildout matrix.' : 'Use the sport ownership cards above to decide whether Discovery, Adapter Builder, or Buildout should move this state next.'}
          </div>
          <div class="ops-rollout-time">${item.pending} pending lanes</div>
        </div>
      </article>
    `).join('');
  }

  function renderTournamentView() {
    const payload = state.ops;
    if (!payload) {
      dom.tournamentMetrics.innerHTML = '';
      dom.tournamentSportGrid.innerHTML = '<article class="submetric"><span>Tournaments</span><strong>Unavailable</strong><p>The ops payload did not load, so tournament rollout cannot render yet.</p></article>';
      dom.tournamentStateGrid.innerHTML = '';
      return;
    }

    const tournamentStates = (payload.states || [])
      .filter((entry) => entry.tournaments?.aggregated?.exists || entry.tournaments?.existingSports)
      .sort((a, b) => (a.state || '').localeCompare(b.state || ''));

    const tournamentSummary = state.tournamentSummary || { tournaments: [] };
    const totalEvents = Array.isArray(tournamentSummary.tournaments) ? tournamentSummary.tournaments.length : 0;
    const statesWithEvents = new Set((tournamentSummary.tournaments || []).map((item) => item.state).filter(Boolean)).size;
    const sportsWithEvents = new Set((tournamentSummary.tournaments || []).map((item) => item.sport).filter(Boolean)).size;
    const freshestTouch = tournamentStates.reduce((latest, entry) => Math.max(latest, entry.tournaments?.latestMtime || 0), 0);

    const metricCards = [
      ['Tournament Events', totalEvents, 'Repo-backed tournament cards currently available in the hosted snapshot.'],
      ['States Represented', statesWithEvents, 'States with at least one tournament event in the repo snapshot.'],
      ['Sports Represented', sportsWithEvents, 'Sports currently carrying tournament events in the snapshot.'],
      ['Freshest Touch', freshestTouch ? shortAgeFromMs(freshestTouch) : 'n/a', freshestTouch ? `Latest tournament artifact touched ${formatStamp(freshestTouch)}.` : 'No tournament touches found in the payload.'],
    ];
    dom.tournamentMetrics.innerHTML = metricCards.map(([label, value, note]) => `
      <article class="submetric">
        <span>${label}</span>
        <strong>${value}</strong>
        <p>${note}</p>
      </article>
    `).join('');

    const sportStats = desiredSports().map((sport) => {
      const items = (tournamentSummary.tournaments || []).filter((item) => item.sport === sport);
      const states = new Set(items.map((item) => item.state).filter(Boolean));
      return { sport, count: items.length, states: states.size };
    });

    dom.tournamentSportGrid.innerHTML = sportStats.map((item) => `
      <article class="submetric">
        <span>${escapeHtml(humanSport(item.sport))}</span>
        <strong>${item.count}</strong>
        <p>${item.states} states currently carry this sport in the snapshot.</p>
      </article>
    `).join('');

    const selectedState = tournamentStates.find((entry) => entry.state === state.selectedTournamentState) || null;
    if (selectedState) {
      const sports = [...(selectedState.tournaments?.sports || [])].sort((a, b) => (a.sport || '').localeCompare(b.sport || ''));
      const activeSport = state.selectedTournamentSport && sports.some((sport) => sport.sport === state.selectedTournamentSport)
        ? state.selectedTournamentSport
        : (sports.find((sport) => sport.valid)?.sport || sports[0]?.sport || '');
      state.selectedTournamentSport = activeSport;
      const cacheKey = `${selectedState.state}:${activeSport}`;
      const tournamentCache = activeSport ? state.tournamentsBySlice[cacheKey] : null;
      const stateEvents = Array.isArray(state.tournamentSummary?.tournaments)
        ? state.tournamentSummary.tournaments.filter((item) => (item.state || '').toUpperCase() === selectedState.state)
        : [];
      dom.selectedTournamentPanel.hidden = false;
      dom.selectedTournamentPanel.innerHTML = `
        <div class="selected-tournament-head">
          <div>
            <div class="panel-kicker">Selected State</div>
            <div class="selected-league-name">${escapeHtml(selectedState.state)} tournaments</div>
            <div class="selected-league-meta">
              ${stateEvents.length} event cards in the repo-backed tournament snapshot
            </div>
          </div>
          <div class="selected-tournament-actions">
            <button class="detail-back-button" id="clearTournamentStateButton" type="button">Back to state cards</button>
          </div>
        </div>
        <div class="tournament-sport-pills">
          ${sports.map((sport) => `
            <button class="mini-toggle${sport.sport === activeSport ? ' active' : ''}" data-tournament-sport="${escapeHtml(sport.sport)}" type="button">
              ${escapeHtml(humanSport(sport.sport))} · ${stateEvents.filter((item) => (item.sport || '').toLowerCase() === sport.sport).length}
            </button>
          `).join('')}
        </div>
        <div class="tournament-results-shell">
          <div class="panel-head tournament-results-head">
            <div>
              <div class="panel-kicker">Selected Sport Tournaments</div>
              <h2>${activeSport ? `${escapeHtml(selectedState.state)} ${escapeHtml(humanSport(activeSport))}` : 'Choose a sport'} event cards</h2>
            </div>
            <div class="panel-note">${tournamentCache?.loading ? 'Loading tournament cards' : tournamentCache?.error ? 'Tournament load failed' : tournamentCache?.items ? `${tournamentCache.items.length} upcoming events` : 'Waiting for selection'}</div>
          </div>
          <div class="tournament-card-grid">
            ${!activeSport ? '<article class="submetric"><span>No sport</span><strong>Select one</strong><p>Choose a sport chip above to load the tournament events for this state.</p></article>' : tournamentCache?.loading ? '<article class="submetric"><span>Loading</span><strong>Fetching events</strong><p>Pulling tournament cards for this state and sport.</p></article>' : tournamentCache?.error ? `<article class="submetric"><span>Error</span><strong>Load failed</strong><p>${escapeHtml(tournamentCache.error)}</p></article>` : (tournamentCache?.items || []).length ? tournamentCache.items.map((item) => `
              <article class="tournament-event-card">
                <div class="tournament-event-top">
                  <div class="tournament-tag-row">
                    <span class="tournament-tag">${escapeHtml(humanSport(item.sport || activeSport))}</span>
                    <span class="tournament-tag source">${escapeHtml(formatTournamentPlatform(item.sourcePlatform))}</span>
                  </div>
                  <div class="tournament-date">${escapeHtml(formatDateRange(item.startDate, item.endDate))}</div>
                </div>
                <h3>${escapeHtml(item.name || 'Unnamed tournament')}</h3>
                <div class="tournament-facts">
                  <div class="tournament-fact"><span>Venue</span><strong>${escapeHtml(item.venue || 'Venue not published')}</strong></div>
                  <div class="tournament-fact"><span>Location</span><strong>${escapeHtml(item.city ? `${item.city}, ${selectedState.state}` : selectedState.state)}</strong></div>
                  <div class="tournament-fact"><span>Host</span><strong>${escapeHtml(item.organizer || 'Organizer not published')}</strong></div>
                  <div class="tournament-fact"><span>Cost</span><strong>${escapeHtml(item.entryFee || 'Fee not published')}</strong></div>
                </div>
                <div class="tournament-chip-row">
                  ${(String(item.ageGroups || '').split(/\s*,\s*/).filter(Boolean).slice(0, 3)).map((chip) => `<span class="tournament-chip">${escapeHtml(chip)}</span>`).join('')}
                  <span class="tournament-chip">${escapeHtml(displayTournamentGender(item.gender))}</span>
                </div>
                <div class="tournament-card-actions">
                  ${item.registrationUrl ? `<a class="tournament-link" href="${escapeHtml(item.registrationUrl)}" target="_blank" rel="noreferrer">Register ↗</a>` : '<span class="tournament-link disabled">Registration unavailable</span>'}
                </div>
              </article>
            `).join('') : '<article class="submetric"><span>No events</span><strong>No tournament cards yet</strong><p>The repo-backed tournament snapshot has no events for this state and sport.</p></article>'}
          </div>
        </div>
      `;
      if (activeSport && !tournamentCache) loadTournamentCards(selectedState.state, activeSport);
    } else {
      dom.selectedTournamentPanel.hidden = true;
      dom.selectedTournamentPanel.innerHTML = '';
    }

    dom.tournamentStateGrid.innerHTML = tournamentStates.map((entry) => `
      <article class="ops-rollout${entry.state === state.selectedTournamentState ? ' active' : ''}" data-tournament-state="${escapeHtml(entry.state)}">
        <div class="ops-rollout-head">
          <div>
            <span>State</span>
            <strong>${escapeHtml(entry.state)}</strong>
          </div>
          <div class="ops-pill blue">
            ${(entry.tournaments?.validSports || 0)}/${entry.tournaments?.totalSports || 8} sports
          </div>
        </div>
        ${rolloutKindMarkup(entry.tournaments)}
        <div class="ops-rollout-footer">
          <div class="ops-rollout-note">
            <strong>${escapeHtml(entry.tournaments.kind)}</strong> ${escapeHtml(rolloutQualityNote(entry.tournaments))}
          </div>
          <div class="ops-rollout-time">last touch ${entry.tournaments?.latestMtime ? formatStamp(entry.tournaments.latestMtime) : 'n/a'}</div>
        </div>
      </article>
    `).join('');
  }

  function selectedLeague() {
    return state.leagues.find((league) => league.id === state.selectedLeagueId) || null;
  }

  function selectedDivision(divisions) {
    return (divisions || []).find((division) => division.id === state.selectedDivisionId) || null;
  }

  function renderStandingsPanel(league, divisions) {
    const division = selectedDivision(divisions);
    if (!division) {
      dom.standingsTitle.textContent = 'Select a division to view live team tables.';
      dom.standingsMeta.textContent = 'No division selected';
      dom.standingRows.innerHTML = '<tr><td colspan="8">Choose a division row to load its live standings.</td></tr>';
      return;
    }

    const cacheEntry = state.standingsByDivision[division.id] || null;
    dom.standingsTitle.textContent = division.name || division.id;
    dom.standingsMeta.textContent = `${league.name || league.id} · ${displayAgeGroup(division.ageGroup)} · ${resolvedDivisionGender(division, league)} · ${division.seasonId || 'season unknown'}`;

    if (cacheEntry?.loading) {
      dom.standingRows.innerHTML = '<tr><td colspan="8">Loading live standings...</td></tr>';
      return;
    }

    if (cacheEntry?.error) {
      dom.standingRows.innerHTML = `<tr><td colspan="8">Could not load standings: ${escapeHtml(cacheEntry.error)}</td></tr>`;
      return;
    }

    if (!cacheEntry) {
      dom.standingRows.innerHTML = '<tr><td colspan="8">Choose a division row to load its live standings.</td></tr>';
      return;
    }

    const standings = Array.isArray(cacheEntry.standings) ? cacheEntry.standings : [];
    if (!standings.length) {
      dom.standingRows.innerHTML = '<tr><td colspan="8">No standings rows are visible for this division yet. The division exists, but standings may not be published or recollection may still be needed.</td></tr>';
      return;
    }

    const freshAt = standings[0]?.collectedAt ? shortTime(standings[0].collectedAt) : 'unknown time';
    dom.standingsMeta.textContent += ` · ${standings.length} teams · collected ${freshAt}`;
    dom.standingRows.innerHTML = standings.map((team) => `
      <tr>
        <td>${escapeHtml(String(team.position ?? '—'))}</td>
        <td><strong>${escapeHtml(team.teamName || 'Unknown team')}</strong></td>
        <td>${escapeHtml(String(team.points ?? '—'))}</td>
        <td>${escapeHtml(String(team.gamesPlayed ?? '—'))}</td>
        <td>${escapeHtml(String(team.wins ?? '—'))}</td>
        <td>${escapeHtml(String(team.losses ?? '—'))}</td>
        <td>${escapeHtml(String(team.ties ?? '—'))}</td>
        <td>${escapeHtml(String(team.differential ?? '—'))}</td>
      </tr>
    `).join('');
  }

  function renderLeagueDetail() {
    const league = selectedLeague();
    if (!league) {
      dom.detailPanel.hidden = true;
      dom.leagueWorkspace?.classList.remove('detail-focus');
      if (dom.currentSlicePanel) dom.currentSlicePanel.hidden = false;
      if (dom.stateBuildoutPanel) dom.stateBuildoutPanel.hidden = false;
      if (dom.detailTrail) dom.detailTrail.innerHTML = '';
      return;
    }

    const cacheEntry = state.divisionsByLeague[league.id] || null;
    const divisions = Array.isArray(cacheEntry?.divisions) ? cacheEntry.divisions : [];
    const ageGroups = Array.from(new Set(divisions.map((division) => division.ageGroup).filter(Boolean))).sort();
    const genders = Array.from(new Set(divisions.map((division) => division.gender).filter(Boolean))).sort();
    const activeDivisions = divisions.filter((division) => (division.status || 'active') === 'active').length;
    const activeDivision = selectedDivision(divisions);

    dom.detailPanel.hidden = false;
    dom.leagueWorkspace?.classList.add('detail-focus');
    if (dom.currentSlicePanel) dom.currentSlicePanel.hidden = true;
    if (dom.stateBuildoutPanel) dom.stateBuildoutPanel.hidden = true;
    dom.detailTitle.textContent = league.name || league.id;
    dom.detailMeta.textContent = `${league.state || '—'} · ${humanSport(league.sport)} · ${humanStatus(league.status)} · ${league.platform || 'unknown platform'}`;
    dom.detailTrail.innerHTML = `
      <div class="detail-chip"><strong>League</strong> ${escapeHtml(league.name || league.id)}</div>
      <span class="detail-arrow">→</span>
      <div class="detail-chip ${activeDivision ? '' : 'current'}"><strong>Divisions</strong> ${cacheEntry?.loading ? 'Loading' : `${divisions.length || 0} rows`}</div>
      ${activeDivision ? `
        <span class="detail-arrow">→</span>
        <div class="detail-chip current"><strong>Standings</strong> ${escapeHtml(activeDivision.name || activeDivision.id)}</div>
      ` : ''}
    `;
    if (activeDivision) {
      dom.selectedDivisionStrip.hidden = false;
      dom.selectedDivisionStrip.innerHTML = `
        <div class="selected-league-head">
          <div>
            <div class="panel-kicker">Selected Division</div>
            <div class="selected-league-name">${escapeHtml(activeDivision.name || activeDivision.id)}</div>
          </div>
          <button class="detail-back-button" id="selectedDivisionBackButton" type="button">Back to divisions</button>
        </div>
        <div class="selected-league-meta">
          ${escapeHtml(displayAgeGroup(activeDivision.ageGroup))} · ${escapeHtml(resolvedDivisionGender(activeDivision, league))} · ${escapeHtml(activeDivision.level || 'Level not published')} · ${escapeHtml(activeDivision.seasonId || 'season unknown')}
        </div>
      `;
    } else {
      dom.selectedDivisionStrip.hidden = true;
      dom.selectedDivisionStrip.innerHTML = '';
    }

    const cards = [
      {
        label: 'League Status',
        value: humanStatus(league.status),
        note: `${league.monitorStatus || 'No monitor status'} · last collected ${league.lastCollected ? shortTime(league.lastCollected) : 'never'}.`,
      },
      {
        label: 'Snapshot Divisions',
        value: league.divisionCount || 0,
        note: 'Division count stored in the hosted league summary snapshot.',
      },
      {
        label: 'API Divisions',
        value: cacheEntry?.loading ? '…' : divisions.length,
        note: cacheEntry?.loading ? 'Loading fresh division detail from getDivisions.' : 'Live division rows returned from the divisions API.',
      },
      {
        label: 'Age Groups',
        value: cacheEntry?.loading ? '…' : (ageGroups.length || 0),
        note: ageGroups.length ? ageGroups.join(', ') : 'No age groups returned yet.',
      },
    ];

    dom.detailSummary.innerHTML = cards.map((card) => `
      <article class="detail-card">
        <span>${card.label}</span>
        <strong>${card.value}</strong>
        <p>${card.note}</p>
      </article>
    `).join('');

    if (cacheEntry?.loading) {
      dom.divisionRows.innerHTML = '<tr><td colspan="6">Loading division detail...</td></tr>';
      renderStandingsPanel(league, divisions);
      return;
    }

    if (cacheEntry?.error) {
      dom.divisionRows.innerHTML = `<tr><td colspan="6">Could not load division detail: ${escapeHtml(cacheEntry.error)}</td></tr>`;
      renderStandingsPanel(league, divisions);
      return;
    }

    if (!cacheEntry) {
      dom.divisionRows.innerHTML = '<tr><td colspan="6">Clicking a league loads its live divisions here.</td></tr>';
      renderStandingsPanel(league, divisions);
      return;
    }

    if (!divisions.length) {
      const reason = (league.divisionCount || 0) > 0
        ? 'The hosted snapshot says divisions exist, but the live divisions endpoint returned none. That usually means recollection or verification is needed.'
        : 'No divisions are visible for this league yet. Buildout is either incomplete or the league truly has no collected divisions.';
      dom.divisionRows.innerHTML = `<tr><td colspan="6">${escapeHtml(reason)}</td></tr>`;
      renderStandingsPanel(league, divisions);
      return;
    }

    const visibleDivisions = activeDivision ? [activeDivision] : divisions;
    dom.divisionRows.innerHTML = visibleDivisions.map((division) => `
      <tr data-division-id="${escapeHtml(division.id)}"${division.id === state.selectedDivisionId ? ' style="background: rgba(52, 107, 137, 0.12);"' : ''}>
        <td>${escapeHtml(division.name || division.id)}</td>
        <td>${escapeHtml(displayAgeGroup(division.ageGroup))}</td>
        <td>${escapeHtml(resolvedDivisionGender(division, league))}</td>
        <td>${escapeHtml(division.level || '—')}</td>
        <td><span class="status-badge ${statusTone((division.status || 'active') === 'active' ? 'active' : 'other')}">${escapeHtml(humanStatus(division.status || 'active'))}</span></td>
        <td>${escapeHtml(division.seasonId || '—')}</td>
      </tr>
    `).join('');

    dom.detailMeta.textContent += ` · ${activeDivisions}/${divisions.length} active divisions · ${genders.length ? genders.join(', ') : 'gender not published'}`;
    renderStandingsPanel(league, divisions);
  }

  async function loadDivisionsForLeague(leagueId) {
    if (!leagueId) return;
    const existing = state.divisionsByLeague[leagueId];
    if (existing?.loading || existing?.loaded) return;

    state.divisionsByLeague[leagueId] = { loading: true, loaded: false, divisions: [] };
    renderLeagueDetail();

    try {
      const payload = await fetchJSON(`${DIVISIONS_URL}?league=${encodeURIComponent(leagueId)}`);
      const divisions = Array.isArray(payload.divisions) ? payload.divisions : [];
      state.divisionsByLeague[leagueId] = {
        loading: false,
        loaded: true,
        divisions,
      };
      const currentLeague = selectedLeague();
      if (currentLeague?.id === leagueId) {
        const stillValid = divisions.some((division) => division.id === state.selectedDivisionId);
        state.selectedDivisionId = stillValid ? state.selectedDivisionId : '';
      }
    } catch (error) {
      state.divisionsByLeague[leagueId] = {
        loading: false,
        loaded: false,
        error: error.message || 'Unknown division load error.',
        divisions: [],
      };
    }

    renderLeagueDetail();
  }

  async function loadTournamentCards(stateCode, sport) {
    const key = `${stateCode}:${sport}`;
    const items = Array.isArray(state.tournamentSummary?.tournaments)
      ? state.tournamentSummary.tournaments
          .filter((item) => (item.state || '').toUpperCase() === stateCode && (item.sport || '').toLowerCase() === sport)
          .filter((item) => isUpcomingTournament(item))
          .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || (a.name || '').localeCompare(b.name || ''))
      : [];
    state.tournamentsBySlice[key] = { loading: false, items };
    renderTournamentView();
  }

  async function loadStandingsForDivision(divisionId) {
    if (!divisionId) return;
    const existing = state.standingsByDivision[divisionId];
    if (existing?.loading || existing?.loaded) return;

    state.standingsByDivision[divisionId] = { loading: true, loaded: false, standings: [] };
    renderLeagueDetail();

    try {
      const payload = await fetchJSON(`${STANDINGS_URL}?division=${encodeURIComponent(divisionId)}`);
      state.standingsByDivision[divisionId] = {
        loading: false,
        loaded: true,
        standings: Array.isArray(payload.standings) ? payload.standings : [],
      };
    } catch (error) {
      state.standingsByDivision[divisionId] = {
        loading: false,
        loaded: false,
        error: error.message || 'Unknown standings load error.',
        standings: [],
      };
    }

    renderLeagueDetail();
  }

  function renderView() {
    document.querySelectorAll('.view-tab').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === state.view);
    });
    dom.panels.forEach((panel) => {
      if (panel.hidden) return;
      panel.classList.toggle('active', panel.dataset.view === state.view);
    });
    const needsControls = state.view === 'leagues';
    dom.controlBar.classList.toggle('hidden', !needsControls);
  }

  function shortAgeFromMs(mtimeMs) {
    if (!mtimeMs) return 'unknown';
    const minutes = Math.max(0, Math.round((Date.now() - mtimeMs) / 60000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function formatClockFromMs(mtimeMs) {
    if (!mtimeMs) return 'missing';
    return new Date(mtimeMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function displayAgeGroup(value) {
    if (!value || String(value).toLowerCase() === 'unknown') return 'Not published';
    return value;
  }

  function inferGenderFromText(...values) {
    const text = values.filter(Boolean).join(' ').toLowerCase();
    if (!text) return '';
    if (/(^|[^a-z])(girls?|g\d{1,4}|u\d{1,2}\s*g|female)([^a-z]|$)/.test(text)) return 'Girls';
    if (/(^|[^a-z])(boys?|b\d{1,4}|u\d{1,2}\s*b|m\d{1,4}|male)([^a-z]|$)/.test(text)) return 'Boys';
    return '';
  }

  function displayGender(value, ...context) {
    const raw = String(value || '').toLowerCase();
    const inferred = inferGenderFromText(...context);
    if (!raw || raw === 'unknown') return inferred || 'Not published';
    if (raw === 'coed') return inferred || 'Coed';
    if (raw === 'male') return 'Boys';
    if (raw === 'female') return 'Girls';
    return inferred || value;
  }

  function resolvedDivisionGender(division, league) {
    const standings = state.standingsByDivision[division?.id || '']?.standings || [];
    const teamNames = standings.map((team) => team?.teamName).filter(Boolean);
    return displayGender(division?.gender, division?.name, league?.name, ...teamNames);
  }

  function sportShortLabel(sport) {
    const labels = {
      soccer: 'SOC',
      baseball: 'BSB',
      softball: 'SFT',
      basketball: 'BKB',
      football: 'FB',
      hockey: 'HOC',
      lacrosse: 'LAX',
      volleyball: 'VOL',
    };
    return labels[sport] || String(sport || '').slice(0, 3).toUpperCase();
  }

  function rolloutTone(entry) {
    if (entry.suspicious) return 'stale';
    if (entry.overall === 'complete') return 'fresh';
    return 'warn';
  }

  function rolloutBadge(entry) {
    if (entry.suspicious) return 'Review';
    if (entry.overall === 'complete') return 'Complete';
    return 'In Progress';
  }

  function rolloutQualityNote(kind) {
    if (kind.aggregated?.valid) return 'aggregate ready';
    if (kind.suspicious) return 'aggregate looks weak';
    if (kind.readyToAggregate) return 'sports look ready';
    return 'work is still accumulating';
  }

  function rolloutKindMarkup(kind) {
    const width = kind.totalSports ? Math.round((kind.validSports / kind.totalSports) * 100) : 0;
    return `
      <section class="ops-kind">
        <div class="ops-kind-top">
          <div class="ops-kind-title">${escapeHtml(kind.kind)}</div>
          <div class="ops-kind-metric">${kind.validSports}/${kind.totalSports} valid sports</div>
        </div>
        <div class="ops-kind-bar"><span style="width:${width}%"></span></div>
        <div class="ops-kind-dots">
          ${(kind.sports || []).map((sport) => `
            <div class="ops-kind-dot ${sport.valid ? 'valid' : sport.exists ? 'partial' : ''}">
              <span>${escapeHtml(sportShortLabel(sport.sport))}</span>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function trustClass(tone) {
    if (tone === 'green' || tone === 'fresh' || tone === 'current') return 'fresh';
    if (tone === 'amber' || tone === 'warn') return 'warn';
    return 'stale';
  }

  function renderOpsView() {
    const payload = state.ops;
    if (!payload) {
      dom.opsGenerated.textContent = 'Ops payload unavailable';
      dom.opsSummaryGrid.innerHTML = '';
      dom.opsFlagList.innerHTML = '<article class="ops-flag amber"><strong>Ops payload missing</strong><p>The hosted dashboard could not load the research/agents JSON feed.</p></article>';
      dom.opsAgentGrid.innerHTML = '';
      dom.opsStandbyGrid.innerHTML = '';
      dom.opsPausedGrid.innerHTML = '';
      dom.opsRolloutGrid.innerHTML = '';
      dom.opsLogList.innerHTML = '';
      return;
    }

    const freshestAgentMtime = (payload.paperclip || []).reduce((latest, agent) => {
      const current = agent?.latest?.mtimeMs || 0;
      return current > latest ? current : latest;
    }, 0);
    dom.opsGenerated.textContent = `Ops payload generated ${formatStamp(payload.generatedAt)} · ${freshnessLabel(payload.generatedAt)} · freshest agent ${freshestAgentMtime ? shortTime(freshestAgentMtime) : 'unknown'}`;
    const summary = payload.summary || {};
    const stats = [
      ['Tournament States Ready', summary.validTournamentStates || 0, 'Substantive aggregate states ready for rollout.'],
      ['League States Ready', summary.validLeagueStates || 0, 'States with full league aggregates completed.'],
      ['States Still Moving', summary.activeTournamentStates || 0, 'Tournament states still in flight under the stricter per-sport rule.'],
      ['Fresh Agents', summary.freshAgents || 0, 'Agents with recent heartbeats in the current payload.'],
    ];
    dom.opsSummaryGrid.innerHTML = stats.map(([label, value, note]) => `
      <article class="ops-stat">
        <span>${label}</span>
        <strong>${value}</strong>
        <p>${note}</p>
      </article>
    `).join('');

    const flags = Array.isArray(payload.flags) ? payload.flags : [];
    dom.opsFlagList.innerHTML = flags.length
      ? flags.map((flag) => `
        <article class="ops-flag ${flag.level}">
          <div class="ops-flag-pill">${escapeHtml((flag.level || 'info') + ' flag')}</div>
          <strong>${escapeHtml(flag.title || `${flag.level} flag`)}</strong>
          <p>${escapeHtml(flag.detail || '')}</p>
          <div class="ops-flag-meta">
            <div class="ops-flag-meta-item">
              <span>Owner</span>
              <div>${escapeHtml(flag.owner || 'unassigned')}</div>
            </div>
            <div class="ops-flag-meta-item">
              <span>Resolution</span>
              <div>${escapeHtml(flag.mode || 'watch')}</div>
            </div>
            <div class="ops-flag-meta-item">
              <span>Age</span>
              <div>${escapeHtml(flag.age || 'unknown')}</div>
            </div>
          </div>
          <p><strong>Next move:</strong> ${escapeHtml(flag.action || 'watch')}</p>
        </article>
      `).join('')
      : '<article class="ops-flag green"><strong>No active flags</strong><p>No current red or amber ops flags in the payload.</p></article>';

    function agentCard(agent) {
      const freshness = trustClass(agent.freshness);
      const issue = agent.issue ? `issue ${agent.issue}` : 'no linked issue';
      return `
        <article class="ops-agent" style="--accent:${agent.accent || '#316d53'};">
          <div class="ops-agent-head">
            <div>
              <span>${escapeHtml(agent.label || 'Agent')}</span>
              <strong>${escapeHtml(agent.label || 'Agent')}</strong>
            </div>
            <div class="ops-agent-meta">Last run<br>${formatClockFromMs(agent.latest?.mtimeMs)} · ${shortAgeFromMs(agent.latest?.mtimeMs)}</div>
          </div>
          <p><strong>${escapeHtml(agent.persona || agent.label || 'Unknown')}</strong></p>
          <p>${escapeHtml(agent.headline || '')}</p>
          <p><strong>Did:</strong> ${escapeHtml(agent.did || 'No summary')}</p>
          <p><strong>Next:</strong> ${escapeHtml(agent.next || 'No explicit next step')}</p>
          <div class="ops-pill ${freshness}">${escapeHtml(issue)}</div>
        </article>
      `;
    }

    const allAgents = payload.paperclip || [];
    const coreAgents = allAgents.filter((agent) => !agent.availability);
    const standbyAgents = allAgents.filter((agent) => agent.availability === 'standby');
    const pausedAgents = allAgents.filter((agent) => agent.availability === 'paused' || agent.availability === 'disabled');

    dom.opsAgentGrid.innerHTML = coreAgents.map(agentCard).join('');
    dom.opsStandbyGrid.innerHTML = standbyAgents.length
      ? standbyAgents.map(agentCard).join('')
      : '<article class="ops-agent"><p>No standby agents currently listed.</p></article>';
    dom.opsPausedGrid.innerHTML = pausedAgents.length
      ? pausedAgents.map(agentCard).join('')
      : '<article class="ops-agent"><p>No paused or disabled agents currently listed.</p></article>';

    const rolloutStates = (payload.states || [])
      .filter((entry) => entry.tournaments?.aggregated?.exists || entry.leagues?.aggregated?.exists || entry.overall === 'in_progress')
      .sort((a, b) => (a.state || '').localeCompare(b.state || ''));
    dom.opsRolloutGrid.innerHTML = rolloutStates.map((entry) => `
      <article class="ops-rollout">
        <div class="ops-rollout-head">
          <div>
            <span>State</span>
            <strong>${escapeHtml(entry.state)}</strong>
          </div>
          <div class="ops-pill ${rolloutTone(entry)}">${rolloutBadge(entry)}</div>
        </div>
        ${rolloutKindMarkup(entry.tournaments)}
        ${rolloutKindMarkup(entry.leagues)}
        <div class="ops-rollout-footer">
          <div class="ops-rollout-note">
            <strong>${escapeHtml(entry.tournaments.kind)}</strong> ${escapeHtml(rolloutQualityNote(entry.tournaments))}
          </div>
          <div class="ops-rollout-note">
            <strong>${escapeHtml(entry.leagues.kind)}</strong> ${escapeHtml(rolloutQualityNote(entry.leagues))}
          </div>
          <div class="ops-rollout-time">last touch ${entry.latestMtime ? formatStamp(entry.latestMtime) : 'n/a'}</div>
        </div>
      </article>
    `).join('');

    const logs = Array.isArray(payload.recentLogs) ? payload.recentLogs : [];
    dom.opsLogList.innerHTML = logs.map((log) => `
      <article class="ops-log">
        <div class="ops-log-head">
          <div>
            <span>Run Log</span>
            <strong>${escapeHtml(log.name || 'unknown.log')}</strong>
          </div>
          <div class="ops-log-meta">${shortAgeFromMs(log.mtimeMs)}</div>
        </div>
        <p>${Math.round((log.size || 0) / 1024)} KB · updated ${log.mtimeMs ? formatStamp(log.mtimeMs) : 'unknown'}</p>
      </article>
    `).join('');
  }

  function renderAll() {
    renderView();
    renderHero();
    renderSystemView();
    renderLeaguesView();
    renderResearchView();
    renderTournamentView();
    renderOpsView();
  }

  function bindEvents() {
    dom.viewTabs.addEventListener('click', (event) => {
      const button = event.target.closest('.view-tab');
      if (!button || button.hidden) return;
      state.view = button.dataset.view;
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    dom.sportTabs.addEventListener('click', (event) => {
      const button = event.target.closest('.sport-pill');
      if (!button) return;
      state.activeSport = button.dataset.sport;
      state.selectedLeagueId = '';
      state.selectedDivisionId = '';
      state.filters.state = '';
      state.filters.status = '';
      state.filters.league = '';
      state.filters.search = '';
      populateSportTabs();
      populateFilters();
      renderAll();
    });

    dom.filterState.addEventListener('change', () => {
      state.filters.state = dom.filterState.value;
      state.filters.league = '';
      state.selectedLeagueId = '';
      state.selectedDivisionId = '';
      populateFilters();
      renderAll();
    });
    dom.filterStatus.addEventListener('change', () => {
      state.filters.status = dom.filterStatus.value;
      state.filters.league = '';
      state.selectedLeagueId = '';
      state.selectedDivisionId = '';
      populateFilters();
      renderAll();
    });
    dom.filterLeague.addEventListener('change', () => {
      state.filters.league = dom.filterLeague.value;
      state.selectedLeagueId = dom.filterLeague.value;
      state.selectedDivisionId = '';
      renderAll();
      if (state.selectedLeagueId) loadDivisionsForLeague(state.selectedLeagueId);
    });
    dom.filterSearch.addEventListener('input', () => {
      state.filters.search = dom.filterSearch.value.trim().toLowerCase();
      state.filters.league = '';
      state.selectedLeagueId = '';
      state.selectedDivisionId = '';
      populateFilters();
      renderAll();
    });
    dom.leagueRows.addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-league-id]');
      if (!row) return;
      state.selectedLeagueId = row.dataset.leagueId;
      state.selectedDivisionId = '';
      renderAll();
      loadDivisionsForLeague(state.selectedLeagueId);
    });
    dom.divisionRows.addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-division-id]');
      if (!row) return;
      state.selectedDivisionId = row.dataset.divisionId;
      renderLeagueDetail();
      loadStandingsForDivision(state.selectedDivisionId);
    });
    dom.detailBackButton.addEventListener('click', () => {
      state.selectedLeagueId = '';
      state.selectedDivisionId = '';
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.addEventListener('click', (event) => {
      const button = event.target.closest('#selectedLeagueBackButton');
      if (!button) return;
      state.selectedLeagueId = '';
      state.selectedDivisionId = '';
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.addEventListener('click', (event) => {
      const button = event.target.closest('#selectedDivisionBackButton');
      if (!button) return;
      state.selectedDivisionId = '';
      renderLeagueDetail();
    });
    document.addEventListener('click', (event) => {
      const card = event.target.closest('[data-tournament-state]');
      if (!card) return;
      state.selectedTournamentState = card.dataset.tournamentState || '';
      renderTournamentView();
    });
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tournament-sport]');
      if (!button) return;
      state.selectedTournamentSport = button.dataset.tournamentSport || '';
      renderTournamentView();
      if (state.selectedTournamentState && state.selectedTournamentSport) {
        const key = `${state.selectedTournamentState}:${state.selectedTournamentSport}`;
        if (!state.tournamentsBySlice[key]) {
          loadTournamentCards(state.selectedTournamentState, state.selectedTournamentSport);
        }
      }
    });
    document.addEventListener('click', (event) => {
      const button = event.target.closest('#clearTournamentStateButton');
      if (!button) return;
      state.selectedTournamentState = '';
      state.selectedTournamentSport = '';
      renderTournamentView();
    });
  }

  function showLoading(isLoading) {
    dom.loadingState.hidden = !isLoading;
  }

  function showError(message) {
    dom.errorState.hidden = !message;
    if (message) dom.errorText.textContent = message;
  }

  function synthesizeSummaryFromApi(data) {
    return {
      generatedAt: new Date().toISOString(),
      count: Array.isArray(data.leagues) ? data.leagues.length : 0,
      leagues: Array.isArray(data.leagues) ? data.leagues : [],
    };
  }

  async function loadSummary() {
    try {
      return await fetchJSON(SUMMARY_URL);
    } catch {
      const live = await fetchJSON(API_URL);
      return synthesizeSummaryFromApi(live);
    }
  }

  async function init() {
    showLoading(true);
    showError('');
    try {
      const [summary, coverage, ops, tournamentSummary] = await Promise.all([
        loadSummary(),
        fetchJSON(COVERAGE_URL),
        fetchJSON(OPS_URL).catch(() => null),
        fetchJSON(TOURNAMENTS_SUMMARY_URL).catch(() => null),
      ]);
      state.summary = summary;
      state.coverage = sanitizeCoverage(coverage);
      state.ops = ops;
      state.tournamentSummary = tournamentSummary;
      state.leagues = Array.isArray(summary.leagues) ? summary.leagues : [];
      if (!desiredSports().includes(state.activeSport)) {
        state.activeSport = desiredSports()[0] || 'soccer';
      }
      populateSportTabs();
      populateFilters();
      renderAll();
    } catch (error) {
      showError(error.message || 'Unknown load error.');
    } finally {
      showLoading(false);
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  setupChrome();
  bindEvents();
  init();
})();

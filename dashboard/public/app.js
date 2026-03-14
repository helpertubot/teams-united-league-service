/* ========================================
   Teams United — League Dashboard
   App Logic
   ======================================== */

(function () {
  'use strict';

  // --- Constants ---
  const API_BASE = 'https://us-central1-teams-united.cloudfunctions.net';
  const SUMMARY_URL = 'https://storage.googleapis.com/tu-league-dashboard/leagues-summary.json';
  const SPORTS = ['soccer', 'baseball', 'basketball', 'hockey', 'lacrosse'];
  const AUTO_SEASON_LEAGUES = new Set([
    'ecnl-boys', 'ecnl-girls', 'ecnl-rl-boys', 'ecnl-rl-girls',
    'pre-ecnl-boys', 'pre-ecnl-girls'
  ]);

  // --- State ---
  const state = {
    leagues: [],
    divisionCache: {},   // leagueId -> divisions[]
    standingsCache: {},   // divisionId -> standings[]
    activeSport: 'soccer',
    selectedLeague: null, // league object or null
    selectedDivision: null, // division object or null
    view: 'leagues',      // 'leagues' | 'divisions' | 'standings'
    sortCol: null,
    sortDir: 'asc',
    lastRefreshed: null
  };

  // --- DOM References ---
  const dom = {
    sportTabs: document.getElementById('sportTabs'),
    filterLeague: document.getElementById('filterLeague'),
    filterStatus: document.getElementById('filterStatus'),
    filterState: document.getElementById('filterState'),
    filterGender: document.getElementById('filterGender'),
    filterAgeGroup: document.getElementById('filterAgeGroup'),
    filterSearch: document.getElementById('filterSearch'),
    btnClearFilters: document.getElementById('btnClearFilters'),
    btnRefresh: document.getElementById('btnRefresh'),
    btnRetry: document.getElementById('btnRetry'),
    lastRefreshed: document.getElementById('lastRefreshed'),
    kpiActive: document.getElementById('kpiActive'),
    kpiDivisions: document.getElementById('kpiDivisions'),
    kpiWithData: document.getElementById('kpiWithData'),
    kpiPlatforms: document.getElementById('kpiPlatforms'),
    breadcrumb: document.getElementById('breadcrumb'),
    bcSport: document.getElementById('bcSport'),
    bcLeague: document.getElementById('bcLeague'),
    bcLeagueSep: document.getElementById('bcLeagueSep'),
    bcCurrent: document.getElementById('bcCurrent'),
    tableContainer: document.getElementById('tableContainer'),
    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),
    emptyState: document.getElementById('emptyState'),
    dataTable: document.getElementById('dataTable'),
    tableHead: document.getElementById('tableHead'),
    tableBody: document.getElementById('tableBody')
  };

  // --- API Helpers ---
  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function loadLeagues() {
    // Try static GCS summary first (fast CDN), fallback to Cloud Function
    try {
      const data = await fetchJSON(SUMMARY_URL);
      state.leagues = data.leagues || [];
      state.lastRefreshed = new Date();
      return state.leagues;
    } catch {
      const data = await fetchJSON(`${API_BASE}/getLeagues`);
      state.leagues = data.leagues || [];
      state.lastRefreshed = new Date();
      return state.leagues;
    }
  }

  async function loadDivisions(leagueId) {
    if (state.divisionCache[leagueId]) return state.divisionCache[leagueId];
    const data = await fetchJSON(`${API_BASE}/getDivisions?league=${encodeURIComponent(leagueId)}`);
    const divs = data.divisions || [];
    state.divisionCache[leagueId] = divs;
    return divs;
  }

  async function loadStandings(divisionId) {
    if (state.standingsCache[divisionId]) return state.standingsCache[divisionId];
    const data = await fetchJSON(`${API_BASE}/getStandings?division=${encodeURIComponent(divisionId)}`);
    let standings = data.standings || [];

    // Client-side dedup by teamName — belt and suspenders against backend dupes
    const seen = new Map();
    standings = standings.filter(s => {
      const key = s.teamName;
      if (seen.has(key)) return false;
      seen.set(key, true);
      return true;
    });

    state.standingsCache[divisionId] = standings;
    return standings;
  }

  // Division count helper — uses divisionCount from API, falls back to cache
  function getDivisionCount(league) {
    if (league.divisionCount != null) return league.divisionCount;
    return (state.divisionCache[league.id] || []).length;
  }

  // --- Render Helpers ---
  function showView(view) {
    dom.loadingState.style.display = 'none';
    dom.errorState.style.display = 'none';
    dom.emptyState.style.display = 'none';
    dom.dataTable.style.display = 'none';
    if (view === 'loading') dom.loadingState.style.display = '';
    else if (view === 'error') dom.errorState.style.display = '';
    else if (view === 'empty') dom.emptyState.style.display = '';
    else if (view === 'table') dom.dataTable.style.display = '';
  }

  function formatStatus(status) {
    if (!status) return '';
    const label = status.replace(/_/g, ' ');
    let cls = 'status-pending';
    if (status === 'active') cls = 'status-active';
    else if (status === 'inactive') cls = 'status-inactive';
    return `<span class="status-badge ${cls}">${label}</span>`;
  }

  function formatTimestamp(date) {
    if (!date) return '—';
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'Updated just now';
    if (diff < 3600) return `Updated ${Math.floor(diff / 60)}m ago`;
    return `Updated ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // --- KPI Update ---
  function updateKPIs() {
    const sportLeagues = state.leagues.filter(l => l.sport === state.activeSport);
    const active = sportLeagues.filter(l => l.status === 'active');
    const platforms = new Set(sportLeagues.map(l => l.platform).filter(Boolean));

    let totalDivs = 0;
    let withData = 0;
    sportLeagues.forEach(l => {
      const count = getDivisionCount(l);
      totalDivs += count;
      if (count > 0) withData++;
    });

    animateNumber(dom.kpiActive, active.length);
    animateNumber(dom.kpiDivisions, totalDivs);
    animateNumber(dom.kpiWithData, withData);
    animateNumber(dom.kpiPlatforms, platforms.size);
  }

  function animateNumber(el, target) {
    const current = parseInt(el.textContent) || 0;
    if (current === target) { el.textContent = target; return; }
    const diff = target - current;
    const steps = Math.min(Math.abs(diff), 20);
    const stepTime = Math.max(15, 300 / steps);
    let step = 0;
    const increment = diff / steps;

    function tick() {
      step++;
      if (step >= steps) {
        el.textContent = target;
        return;
      }
      el.textContent = Math.round(current + increment * step);
      setTimeout(tick, stepTime);
    }
    tick();
  }

  // --- Sport Badge Counts ---
  function updateBadges() {
    SPORTS.forEach(sport => {
      const count = state.leagues.filter(l => l.sport === sport).length;
      const badge = document.getElementById(`badge-${sport}`);
      if (badge) badge.textContent = count;
    });
  }

  // --- Filter Logic ---
  function getFilteredLeagues() {
    let leagues = state.leagues.filter(l => l.sport === state.activeSport);
    const status = dom.filterStatus.value;
    const stateFilter = dom.filterState.value;
    const search = dom.filterSearch.value.toLowerCase().trim();

    if (status) leagues = leagues.filter(l => l.status === status);
    if (stateFilter) {
      if (stateFilter === 'national') {
        leagues = leagues.filter(l => l.state && l.state.toLowerCase().includes('national'));
      } else {
        leagues = leagues.filter(l => {
          if (!l.state) return false;
          const leagueStates = l.state.split(',').map(s => s.trim().toUpperCase());
          return leagueStates.includes(stateFilter.toUpperCase());
        });
      }
    }
    if (search) leagues = leagues.filter(l =>
      l.name.toLowerCase().includes(search) ||
      (l.platform || '').toLowerCase().includes(search) ||
      (l.state || '').toLowerCase().includes(search) ||
      (l.region || '').toLowerCase().includes(search) ||
      l.id.toLowerCase().includes(search)
    );

    return leagues;
  }

  function getFilteredDivisions() {
    const leagueId = state.selectedLeague ? state.selectedLeague.id : null;
    if (!leagueId) return [];
    let divs = state.divisionCache[leagueId] || [];
    const gender = dom.filterGender.value;
    const ageGroup = dom.filterAgeGroup.value;
    const status = dom.filterStatus.value;
    const search = dom.filterSearch.value.toLowerCase().trim();

    if (gender) divs = divs.filter(d => d.gender && d.gender.toLowerCase() === gender.toLowerCase());
    if (ageGroup) divs = divs.filter(d => d.ageGroup === ageGroup);
    if (status) divs = divs.filter(d => d.status === status);
    if (search) divs = divs.filter(d =>
      d.name.toLowerCase().includes(search) ||
      (d.ageGroup || '').toLowerCase().includes(search) ||
      (d.gender || '').toLowerCase().includes(search) ||
      (d.level || '').toLowerCase().includes(search)
    );

    return divs;
  }

  function getFilteredStandings() {
    const divId = state.selectedDivision ? state.selectedDivision.id : null;
    if (!divId) return [];
    let standings = state.standingsCache[divId] || [];
    const search = dom.filterSearch.value.toLowerCase().trim();

    if (search) standings = standings.filter(s =>
      s.teamName.toLowerCase().includes(search)
    );

    return standings;
  }

  // --- Populate League Dropdown ---
  function populateLeagueDropdown() {
    const leagues = state.leagues.filter(l => l.sport === state.activeSport);
    leagues.sort((a, b) => a.name.localeCompare(b.name));
    dom.filterLeague.innerHTML = '<option value="">All Leagues</option>';
    leagues.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      dom.filterLeague.appendChild(opt);
    });
  }

  // --- Populate State Dropdown ---
  function populateStateDropdown() {
    const leagues = state.leagues.filter(l => l.sport === state.activeSport);
    // Parse comma-separated state fields into individual states
    const stateSet = new Set();
    leagues.forEach(l => {
      if (l.state) {
        l.state.split(',').forEach(s => {
          const trimmed = s.trim().toUpperCase();
          if (trimmed && trimmed !== 'NATIONAL') stateSet.add(trimmed);
        });
      }
    });
    const states = [...stateSet].sort();
    // Add 'national' as a special entry if any league has it
    const hasNational = leagues.some(l => l.state && l.state.toLowerCase().includes('national'));

    dom.filterState.innerHTML = '<option value="">All States</option>';
    if (hasNational) {
      const opt = document.createElement('option');
      opt.value = 'national';
      opt.textContent = 'National';
      dom.filterState.appendChild(opt);
    }
    states.forEach(st => {
      const opt = document.createElement('option');
      opt.value = st;
      opt.textContent = st;
      dom.filterState.appendChild(opt);
    });
  }

  // --- Populate Gender/AgeGroup Dropdowns ---
  function populateDivisionFilters() {
    const divs = state.selectedLeague ? (state.divisionCache[state.selectedLeague.id] || []) : [];

    // Gender
    const genders = [...new Set(divs.map(d => d.gender).filter(Boolean))].sort();
    dom.filterGender.innerHTML = '<option value="">All Genders</option>';
    genders.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = capitalize(g);
      dom.filterGender.appendChild(opt);
    });
    dom.filterGender.disabled = genders.length === 0;

    // Age Group
    const ageGroups = [...new Set(divs.map(d => d.ageGroup).filter(Boolean))].sort();
    dom.filterAgeGroup.innerHTML = '<option value="">All Age Groups</option>';
    ageGroups.forEach(ag => {
      const opt = document.createElement('option');
      opt.value = ag;
      opt.textContent = ag;
      dom.filterAgeGroup.appendChild(opt);
    });
    dom.filterAgeGroup.disabled = ageGroups.length === 0;
  }

  // --- Sorting ---
  function sortData(data, col, dir) {
    if (!col) return data;
    const sorted = [...data];
    sorted.sort((a, b) => {
      let va = a[col];
      let vb = b[col];
      // Handle division count
      if (col === '_divCount') {
        va = getDivisionCount(a);
        vb = getDivisionCount(b);
      }
      if (col === '_autoSeason') {
        va = AUTO_SEASON_LEAGUES.has(a.id) ? 1 : 0;
        vb = AUTO_SEASON_LEAGUES.has(b.id) ? 1 : 0;
      }
      if (typeof va === 'number' && typeof vb === 'number') {
        return dir === 'asc' ? va - vb : vb - va;
      }
      va = (va || '').toString().toLowerCase();
      vb = (vb || '').toString().toLowerCase();
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  function handleSort(col) {
    if (state.sortCol === col) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortCol = col;
      state.sortDir = 'asc';
    }
    renderTable();
  }

  // --- Breadcrumb ---
  function updateBreadcrumb() {
    if (state.view === 'leagues') {
      dom.breadcrumb.style.display = 'none';
      return;
    }
    dom.breadcrumb.style.display = '';
    dom.bcSport.textContent = capitalize(state.activeSport);
    dom.bcSport.onclick = () => navigateToSport();

    if (state.view === 'divisions') {
      dom.bcLeague.style.display = 'none';
      dom.bcLeagueSep.style.display = 'none';
      dom.bcCurrent.textContent = state.selectedLeague ? state.selectedLeague.name : '';
    } else if (state.view === 'standings') {
      dom.bcLeague.style.display = '';
      dom.bcLeagueSep.style.display = '';
      dom.bcLeague.textContent = state.selectedLeague ? state.selectedLeague.name : '';
      dom.bcLeague.onclick = () => navigateToLeague(state.selectedLeague);
      dom.bcCurrent.textContent = state.selectedDivision ? state.selectedDivision.name : '';
    }
  }

  // --- Table Rendering ---
  function renderTableHeader(columns) {
    dom.tableHead.innerHTML = '';
    const tr = document.createElement('tr');
    columns.forEach(c => {
      const th = document.createElement('th');
      th.className = c.numeric ? 'col-num' : '';
      if (state.sortCol === c.key) th.classList.add('sorted');
      th.innerHTML = `${c.label}<span class="sort-arrow">${state.sortCol === c.key ? (state.sortDir === 'asc' ? '▲' : '▼') : '▲'}</span>`;
      th.addEventListener('click', () => handleSort(c.key));
      tr.appendChild(th);
    });
    dom.tableHead.appendChild(tr);
  }

  function renderTable() {
    if (state.view === 'leagues') renderLeagueTable();
    else if (state.view === 'divisions') renderDivisionTable();
    else if (state.view === 'standings') renderStandingsTable();
    updateBreadcrumb();
  }

  function renderLeagueTable() {
    const columns = [
      { key: 'name', label: 'League Name' },
      { key: 'platform', label: 'Platform' },
      { key: 'status', label: 'Status' },
      { key: 'state', label: 'State' },
      { key: 'region', label: 'Region' },
      { key: '_divCount', label: 'Divisions', numeric: true },
      { key: '_autoSeason', label: 'Auto-Update' }
    ];
    renderTableHeader(columns);

    let leagues = getFilteredLeagues();
    leagues = sortData(leagues, state.sortCol, state.sortDir);

    dom.tableBody.innerHTML = '';
    if (leagues.length === 0) {
      showView('empty');
      return;
    }
    showView('table');

    leagues.forEach((l, i) => {
      const tr = document.createElement('tr');
      tr.className = 'clickable fade-in';
      tr.style.animationDelay = `${Math.min(i * 20, 400)}ms`;
      tr.addEventListener('click', () => navigateToLeague(l));

      const divCount = getDivisionCount(l);
      const autoSeason = AUTO_SEASON_LEAGUES.has(l.id);

      tr.innerHTML = `
        <td title="${escapeHtml(l.name)}">${escapeHtml(l.name)}</td>
        <td>${escapeHtml(l.platform || '—')}</td>
        <td>${formatStatus(l.status)}</td>
        <td>${escapeHtml(l.state || '—')}</td>
        <td>${escapeHtml(l.region || '—')}</td>
        <td class="col-num">${divCount}</td>
        <td>${autoSeason ? '<span class="auto-yes">Yes</span>' : '<span class="auto-no">No</span>'}</td>
      `;
      dom.tableBody.appendChild(tr);
    });
  }

  function renderDivisionTable() {
    const columns = [
      { key: 'name', label: 'Division Name' },
      { key: 'ageGroup', label: 'Age Group' },
      { key: 'gender', label: 'Gender' },
      { key: 'level', label: 'Level' },
      { key: 'status', label: 'Status' }
    ];
    renderTableHeader(columns);

    let divs = getFilteredDivisions();
    divs = sortData(divs, state.sortCol, state.sortDir);

    dom.tableBody.innerHTML = '';
    if (divs.length === 0) {
      showView('empty');
      return;
    }
    showView('table');

    divs.forEach((d, i) => {
      const tr = document.createElement('tr');
      tr.className = 'clickable fade-in';
      tr.style.animationDelay = `${Math.min(i * 20, 400)}ms`;
      tr.addEventListener('click', () => navigateToDivision(d));

      tr.innerHTML = `
        <td title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</td>
        <td>${escapeHtml(d.ageGroup || '—')}</td>
        <td>${capitalize(d.gender || '—')}</td>
        <td>${escapeHtml(d.level || '—')}</td>
        <td>${formatStatus(d.status)}</td>
      `;
      dom.tableBody.appendChild(tr);
    });
  }

  // Sport-specific column definitions for standings tables
  const STANDINGS_COLUMNS = {
    soccer: [
      { key: 'position', label: '#', numeric: true },
      { key: 'teamName', label: 'Team' },
      { key: 'gamesPlayed', label: 'GP', numeric: true },
      { key: 'wins', label: 'W', numeric: true },
      { key: 'losses', label: 'L', numeric: true },
      { key: 'ties', label: 'T', numeric: true },
      { key: 'points', label: 'Pts', numeric: true, bold: true },
      { key: 'scored', label: 'GF', numeric: true },
      { key: 'allowed', label: 'GA', numeric: true },
      { key: 'differential', label: 'GD', numeric: true, diff: true },
    ],
    baseball: [
      { key: 'position', label: '#', numeric: true },
      { key: 'teamName', label: 'Team' },
      { key: 'gamesPlayed', label: 'GP', numeric: true },
      { key: 'wins', label: 'W', numeric: true },
      { key: 'losses', label: 'L', numeric: true },
      { key: 'ties', label: 'T', numeric: true },
      { key: 'winPct', label: 'PCT', numeric: true, bold: true, fmt: v => v != null ? v.toFixed(3) : '—' },
      { key: 'scored', label: 'RS', numeric: true },
      { key: 'allowed', label: 'RA', numeric: true },
      { key: 'differential', label: 'DIFF', numeric: true, diff: true },
      { key: 'gamesBack', label: 'GB', numeric: true },
      { key: 'streak', label: 'STRK', numeric: false },
    ],
    basketball: [
      { key: 'position', label: '#', numeric: true },
      { key: 'teamName', label: 'Team' },
      { key: 'gamesPlayed', label: 'GP', numeric: true },
      { key: 'wins', label: 'W', numeric: true },
      { key: 'losses', label: 'L', numeric: true },
      { key: 'winPct', label: 'PCT', numeric: true, bold: true, fmt: v => v != null ? v.toFixed(3) : '—' },
      { key: 'scored', label: 'PF', numeric: true },
      { key: 'allowed', label: 'PA', numeric: true },
      { key: 'differential', label: 'DIFF', numeric: true, diff: true },
      { key: 'streak', label: 'STRK', numeric: false },
      { key: 'gamesBack', label: 'GB', numeric: true },
    ],
  };
  // Hockey and lacrosse use same layout as soccer
  STANDINGS_COLUMNS.hockey = STANDINGS_COLUMNS.soccer;
  STANDINGS_COLUMNS.lacrosse = STANDINGS_COLUMNS.soccer;
  STANDINGS_COLUMNS.softball = STANDINGS_COLUMNS.baseball;

  function renderStandingsTable() {
    const sport = (state.selectedLeague && state.selectedLeague.sport || 'soccer').toLowerCase();
    const columns = STANDINGS_COLUMNS[sport] || STANDINGS_COLUMNS.soccer;
    renderTableHeader(columns);

    let standings = getFilteredStandings();
    standings = sortData(standings, state.sortCol, state.sortDir);

    dom.tableBody.innerHTML = '';
    if (standings.length === 0) {
      showView('empty');
      return;
    }
    showView('table');

    standings.forEach((s, i) => {
      const tr = document.createElement('tr');
      tr.className = 'fade-in';
      tr.style.animationDelay = `${Math.min(i * 20, 400)}ms`;

      tr.innerHTML = columns.map(col => {
        const val = s[col.key];
        if (col.key === 'position') {
          const posClass = val <= 3 ? 'top-3' : '';
          return `<td class="col-num"><span class="pos-badge ${posClass}">${val}</span></td>`;
        }
        if (col.key === 'teamName') {
          return `<td title="${escapeHtml(val)}">${escapeHtml(val)}</td>`;
        }
        const display = col.fmt ? col.fmt(val) : (val ?? '—');
        if (col.diff) {
          const diffClass = val > 0 ? 'diff-positive' : val < 0 ? 'diff-negative' : 'diff-zero';
          const prefix = val > 0 ? '+' : '';
          return `<td class="col-num"><span class="${diffClass}">${prefix}${display}</span></td>`;
        }
        if (col.bold) {
          return `<td class="col-num"><strong>${display}</strong></td>`;
        }
        return `<td class="${col.numeric ? 'col-num' : ''}">${display}</td>`;
      }).join('');

      dom.tableBody.appendChild(tr);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- Navigation ---
  function navigateToSport() {
    state.selectedLeague = null;
    state.selectedDivision = null;
    state.view = 'leagues';
    state.sortCol = null;
    state.sortDir = 'asc';
    dom.filterLeague.value = '';
    dom.filterState.value = '';
    dom.filterGender.value = '';
    dom.filterAgeGroup.value = '';
    dom.filterGender.disabled = true;
    dom.filterAgeGroup.disabled = true;
    populateStateDropdown();
    renderTable();
    updateKPIs();
  }

  async function navigateToLeague(league) {
    state.selectedLeague = league;
    state.selectedDivision = null;
    state.view = 'divisions';
    state.sortCol = null;
    state.sortDir = 'asc';

    dom.filterLeague.value = league.id;
    dom.filterSearch.value = '';

    showView('loading');
    dom.loadingState.querySelector('span').textContent = `Loading divisions for ${league.name}...`;

    try {
      await loadDivisions(league.id);
      populateDivisionFilters();
      renderTable();
    } catch (err) {
      showView('error');
      document.getElementById('errorMsg').textContent = `Failed to load divisions: ${err.message}`;
    }
  }

  async function navigateToDivision(division) {
    state.selectedDivision = division;
    state.view = 'standings';
    state.sortCol = null;
    state.sortDir = 'asc';
    dom.filterSearch.value = '';

    showView('loading');
    dom.loadingState.querySelector('span').textContent = `Loading standings for ${division.name}...`;

    try {
      await loadStandings(division.id);
      renderTable();
    } catch (err) {
      showView('error');
      document.getElementById('errorMsg').textContent = `Failed to load standings: ${err.message}`;
    }
  }

  // --- Event Handlers ---
  function bindEvents() {
    // Sport tabs
    dom.sportTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.sport-tab');
      if (!tab) return;
      const sport = tab.dataset.sport;
      if (sport === state.activeSport && state.view === 'leagues') return;

      document.querySelectorAll('.sport-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      state.activeSport = sport;
      populateLeagueDropdown();
      populateStateDropdown();
      navigateToSport();
    });

    // League dropdown
    dom.filterLeague.addEventListener('change', () => {
      const val = dom.filterLeague.value;
      if (!val) {
        navigateToSport();
      } else {
        const league = state.leagues.find(l => l.id === val);
        if (league) navigateToLeague(league);
      }
    });

    // Other filters — just re-render
    dom.filterStatus.addEventListener('change', () => renderTable());
    dom.filterState.addEventListener('change', () => renderTable());
    dom.filterGender.addEventListener('change', () => renderTable());
    dom.filterAgeGroup.addEventListener('change', () => renderTable());

    // Search with debounce
    let searchTimeout;
    dom.filterSearch.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => renderTable(), 200);
    });

    // Clear filters
    dom.btnClearFilters.addEventListener('click', () => {
      dom.filterStatus.value = '';
      dom.filterState.value = '';
      dom.filterGender.value = '';
      dom.filterAgeGroup.value = '';
      dom.filterSearch.value = '';
      if (state.view === 'leagues') {
        dom.filterLeague.value = '';
      }
      renderTable();
    });

    // Refresh
    dom.btnRefresh.addEventListener('click', () => initApp(true));
    dom.btnRetry.addEventListener('click', () => initApp(false));
  }

  // --- Update Refresh Timestamp ---
  function startRefreshTimer() {
    setInterval(() => {
      dom.lastRefreshed.textContent = formatTimestamp(state.lastRefreshed);
    }, 30000);
  }

  // --- Init ---
  async function initApp(forceRefresh) {
    showView('loading');
    dom.loadingState.querySelector('span').textContent = 'Loading league data...';
    dom.btnRefresh.classList.add('spinning');

    if (forceRefresh) {
      state.divisionCache = {};
      state.standingsCache = {};
    }

    try {
      await loadLeagues();
      updateBadges();
      populateLeagueDropdown();
      populateStateDropdown();
      updateKPIs();
      dom.lastRefreshed.textContent = formatTimestamp(state.lastRefreshed);

      // Restore or default view
      if (state.selectedDivision && state.view === 'standings') {
        renderTable();
      } else if (state.selectedLeague && state.view === 'divisions') {
        renderTable();
      } else {
        state.view = 'leagues';
        renderTable();
      }

    } catch (err) {
      showView('error');
      document.getElementById('errorMsg').textContent = `Failed to load data: ${err.message}`;
    } finally {
      dom.btnRefresh.classList.remove('spinning');
    }
  }

  // --- Start ---
  bindEvents();
  startRefreshTimer();
  initApp(false);

})();

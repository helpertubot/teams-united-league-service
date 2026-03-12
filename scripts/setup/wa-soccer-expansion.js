/**
 * Register WA Soccer Leagues — Expansion to 20-30+ leagues
 *
 * Registers discovered WA youth soccer leagues into Firestore.
 * Covers Tier 1 (state competitive), Tier 2 (local associations), Tier 3 (Eastern WA).
 *
 * Run on deploy VM:
 *   node scripts/register-wa-soccer.js [--dry-run]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

// ═══════════════════════════════════════════════════════════════
// TIER 1 — State-level competitive leagues
// ═══════════════════════════════════════════════════════════════

const TIER1_LEAGUES = [
  // ── RCL (Regional Club League) — Top-tier WA competitive league ──
  {
    id: 'rcl-wa',
    name: 'Regional Club League (RCL) Washington',
    state: 'WA',
    sport: 'Soccer',
    region: 'Statewide',
    sourcePlatform: 'sportsaffinity',
    status: 'active',
    autoUpdate: true,
    sourceConfig: {
      organizationId: '7379E8F5-2B0D-4729-BDF9-967A08999A37',
      seasonGuid: '535db887-ce7e-43db-90bc-55f7d6349bf9',
    },
    seasonStart: '2025-09-01',
    seasonEnd: '2026-06-15',
    notes: 'Top 18 WA clubs, U8-U19. OrgId shared with WYS — seasonGuid is RCL-specific. 25+ divisions.',
  },

  // ── SSUL (South Sound United League) — 7 associations ──
  {
    id: 'ssul-wa',
    name: 'South Sound United League (SSUL)',
    state: 'WA',
    sport: 'Soccer',
    region: 'South Sound',
    sourcePlatform: 'sportsaffinity',
    status: 'active',
    autoUpdate: true,
    sourceConfig: {
      organizationId: '7379E8F5-2B0D-4729-BDF9-967A08999A37',
      seasonGuid: 'D6AB7B1D-22CD-426D-9562-C444FF4E35E3',
    },
    seasonStart: '2026-04-18',
    seasonEnd: '2026-06-30',
    notes: 'Spring 2026 season. 7 associations: Auburn, Federal Way, Kent Covington, Highline, Maple Valley, Renton Tukwila, Pierce County. ~22 divisions, ~193 teams. Season empty until April 18.',
  },

  // ── EWSL (Eastern WA Select League) — on GotSport via WPL ──
  {
    id: 'ewsl-wa',
    name: 'Eastern WA Select League (EWSL)',
    state: 'WA',
    sport: 'Soccer',
    region: 'Eastern WA',
    sourcePlatform: 'gotsport',
    status: 'active',
    autoUpdate: true,
    sourceConfig: {
      leagueEventId: '45512',
      groups: [
        { groupId: '398397', name: 'EWSL B8U Div 1', ageGroup: 'U8', gender: 'boys' },
        { groupId: '398394', name: 'EWSL B9U Div 1', ageGroup: 'U9', gender: 'boys' },
        { groupId: '398388', name: 'EWSL B10U Div 1', ageGroup: 'U10', gender: 'boys' },
        { groupId: '398386', name: 'EWSL B10U Div 2', ageGroup: 'U10', gender: 'boys', level: 'D2' },
        { groupId: '413445', name: 'EWSL B10U Div 3', ageGroup: 'U10', gender: 'boys', level: 'D3' },
        { groupId: '398387', name: 'EWSL B11U Div 1', ageGroup: 'U11', gender: 'boys' },
        { groupId: '398384', name: 'EWSL B11U Div 2', ageGroup: 'U11', gender: 'boys', level: 'D2' },
        { groupId: '398385', name: 'EWSL B11U Div 3', ageGroup: 'U11', gender: 'boys', level: 'D3' },
        { groupId: '398391', name: 'EWSL B12U Div 1', ageGroup: 'U12', gender: 'boys' },
        { groupId: '398392', name: 'EWSL B12U Div 2', ageGroup: 'U12', gender: 'boys', level: 'D2' },
        { groupId: '398399', name: 'EWSL B13U Div 1', ageGroup: 'U13', gender: 'boys' },
        { groupId: '398401', name: 'EWSL B14U Div 1', ageGroup: 'U14', gender: 'boys' },
        { groupId: '398402', name: 'EWSL B16U Div 1', ageGroup: 'U16', gender: 'boys' },
        { groupId: '411141', name: 'EWSL B19U Div 1', ageGroup: 'U19', gender: 'boys' },
        { groupId: '411138', name: 'EWSL G8U Div 1', ageGroup: 'U8', gender: 'girls' },
        { groupId: '411136', name: 'EWSL G9U Div 1', ageGroup: 'U9', gender: 'girls' },
        { groupId: '411137', name: 'EWSL G9U Div 2', ageGroup: 'U9', gender: 'girls', level: 'D2' },
        { groupId: '411134', name: 'EWSL G10U Div 1', ageGroup: 'U10', gender: 'girls' },
        { groupId: '411135', name: 'EWSL G10U Div 2', ageGroup: 'U10', gender: 'girls', level: 'D2' },
        { groupId: '398383', name: 'EWSL G11U Div 1', ageGroup: 'U11', gender: 'girls' },
        { groupId: '398382', name: 'EWSL G11U Div 2', ageGroup: 'U11', gender: 'girls', level: 'D2' },
        { groupId: '398389', name: 'EWSL G12U Div 1', ageGroup: 'U12', gender: 'girls' },
        { groupId: '398390', name: 'EWSL G12U Div 2', ageGroup: 'U12', gender: 'girls', level: 'D2' },
        { groupId: '398396', name: 'EWSL G13U Div 1', ageGroup: 'U13', gender: 'girls' },
        { groupId: '398406', name: 'EWSL G14U Div 1', ageGroup: 'U14', gender: 'girls' },
        { groupId: '398404', name: 'EWSL G15U Div 1', ageGroup: 'U15', gender: 'girls' },
      ],
    },
    seasonStart: '2025-09-01',
    seasonEnd: '2025-11-10',
    notes: 'Fall 2025 event. Spring 2026 event not yet published — will need new leagueEventId when available (April 18 start). 26 divisions.',
  },

  // ── WPL Girls HS NPL/Classic/Copa — NOT in system ──
  {
    id: 'wpl-girls-hs-spring',
    name: 'WPL Girls HS NPL, Classic & Copa',
    state: 'WA',
    sport: 'Soccer',
    region: 'Statewide',
    sourcePlatform: 'gotsport',
    status: 'active',
    autoUpdate: true,
    sourceConfig: {
      leagueEventId: '48496',
      groups: [
        { groupId: '426913', name: 'G15U NPL League 1', ageGroup: 'U15', gender: 'girls', level: 'NPL' },
        { groupId: '426915', name: 'G15U Classic', ageGroup: 'U15', gender: 'girls', level: 'Classic' },
        { groupId: '426916', name: 'G15U Copa 1', ageGroup: 'U15', gender: 'girls', level: 'Copa' },
        { groupId: '426912', name: 'G15U Copa 2', ageGroup: 'U15', gender: 'girls', level: 'Copa' },
        { groupId: '426917', name: 'G16U NPL League 1', ageGroup: 'U16', gender: 'girls', level: 'NPL' },
        { groupId: '426919', name: 'G16U Classic', ageGroup: 'U16', gender: 'girls', level: 'Classic' },
        { groupId: '426918', name: 'G16U Copa', ageGroup: 'U16', gender: 'girls', level: 'Copa' },
        { groupId: '426920', name: 'G17U NPL League 1', ageGroup: 'U17', gender: 'girls', level: 'NPL' },
        { groupId: '426921', name: 'G17U Classic', ageGroup: 'U17', gender: 'girls', level: 'Classic' },
        { groupId: '450971', name: 'G17U Copa', ageGroup: 'U17', gender: 'girls', level: 'Copa' },
        { groupId: '426923', name: 'G19U NPL League 1', ageGroup: 'U19', gender: 'girls', level: 'NPL' },
        { groupId: '426924', name: 'G19U Classic', ageGroup: 'U19', gender: 'girls', level: 'Classic' },
        { groupId: '426922', name: 'G19U Copa', ageGroup: 'U19', gender: 'girls', level: 'Copa' },
      ],
    },
    seasonStart: '2026-01-01',
    seasonEnd: '2026-06-01',
    notes: 'Girls HS winter/spring 2026. 13 divisions across NPL, Classic, Copa tiers.',
  },

  // ── WPL Spring 11U-14U All Leagues (NPL + Classic + Copa) ──
  {
    id: 'wpl-spring-1114u',
    name: 'WPL Spring 11U-14U NPL, Classic & Copa',
    state: 'WA',
    sport: 'Soccer',
    region: 'Western WA',
    sourcePlatform: 'gotsport',
    status: 'active',
    autoUpdate: true,
    sourceConfig: {
      leagueEventId: '50025',
      groups: [
        // Boys U11
        { groupId: '444613', name: 'B11U NPL 1', ageGroup: 'U11', gender: 'boys', level: 'NPL' },
        { groupId: '444609', name: 'B11U Classic 1 West', ageGroup: 'U11', gender: 'boys', level: 'Classic' },
        { groupId: '444618', name: 'B11U Classic 2 Red West', ageGroup: 'U11', gender: 'boys', level: 'Classic' },
        { groupId: '444611', name: 'B11U Classic 2 Blue West', ageGroup: 'U11', gender: 'boys', level: 'Classic' },
        { groupId: '444610', name: 'B11U Classic 3 West', ageGroup: 'U11', gender: 'boys', level: 'Classic' },
        { groupId: '460578', name: 'B11U Copa 1 West', ageGroup: 'U11', gender: 'boys', level: 'Copa' },
        { groupId: '444612', name: 'B11U Copa 2 Red West', ageGroup: 'U11', gender: 'boys', level: 'Copa' },
        { groupId: '444616', name: 'B11U Copa 2 Blue West', ageGroup: 'U11', gender: 'boys', level: 'Copa' },
        { groupId: '444617', name: 'B11U Copa 3 Red West', ageGroup: 'U11', gender: 'boys', level: 'Copa' },
        { groupId: '444614', name: 'B11U Copa 3 Blue West', ageGroup: 'U11', gender: 'boys', level: 'Copa' },
        // Boys U12
        { groupId: '444634', name: 'B12U NPL 1', ageGroup: 'U12', gender: 'boys', level: 'NPL' },
        { groupId: '444632', name: 'B12U Classic 1 Red West', ageGroup: 'U12', gender: 'boys', level: 'Classic' },
        { groupId: '444630', name: 'B12U Classic 1 Blue West', ageGroup: 'U12', gender: 'boys', level: 'Classic' },
        { groupId: '444631', name: 'B12U Classic 2 Red West', ageGroup: 'U12', gender: 'boys', level: 'Classic' },
        { groupId: '444633', name: 'B12U Classic 2 Blue West', ageGroup: 'U12', gender: 'boys', level: 'Classic' },
        { groupId: '444629', name: 'B12U Copa 1 Red West', ageGroup: 'U12', gender: 'boys', level: 'Copa' },
        { groupId: '444626', name: 'B12U Copa 1 Blue West', ageGroup: 'U12', gender: 'boys', level: 'Copa' },
        { groupId: '444625', name: 'B12U Copa 2 Red West', ageGroup: 'U12', gender: 'boys', level: 'Copa' },
        { groupId: '460811', name: 'B12U Copa 2 Blue West', ageGroup: 'U12', gender: 'boys', level: 'Copa' },
        { groupId: '444627', name: 'B12U Copa 3 Red West', ageGroup: 'U12', gender: 'boys', level: 'Copa' },
        { groupId: '444628', name: 'B12U Copa 3 Blue West', ageGroup: 'U12', gender: 'boys', level: 'Copa' },
        // Boys U13
        { groupId: '444643', name: 'B13U NPL 1', ageGroup: 'U13', gender: 'boys', level: 'NPL' },
        { groupId: '444641', name: 'B13U Classic 1 West', ageGroup: 'U13', gender: 'boys', level: 'Classic' },
        { groupId: '444646', name: 'B13U Classic 2 Red West', ageGroup: 'U13', gender: 'boys', level: 'Classic' },
        { groupId: '444642', name: 'B13U Classic 2 Blue West', ageGroup: 'U13', gender: 'boys', level: 'Classic' },
        { groupId: '444645', name: 'B13U Copa 1 West', ageGroup: 'U13', gender: 'boys', level: 'Copa' },
        { groupId: '444644', name: 'B13U Copa 2 West', ageGroup: 'U13', gender: 'boys', level: 'Copa' },
        { groupId: '444647', name: 'B13U Copa 3 Red West', ageGroup: 'U13', gender: 'boys', level: 'Copa' },
        { groupId: '460809', name: 'B13U Copa 3 Blue West', ageGroup: 'U13', gender: 'boys', level: 'Copa' },
        // Boys U14
        { groupId: '444658', name: 'B14U NPL 1', ageGroup: 'U14', gender: 'boys', level: 'NPL' },
        { groupId: '444653', name: 'B14U Classic 1 West', ageGroup: 'U14', gender: 'boys', level: 'Classic' },
        { groupId: '444655', name: 'B14U Classic 2 Red West', ageGroup: 'U14', gender: 'boys', level: 'Classic' },
        { groupId: '460804', name: 'B14U Classic 2 Blue West', ageGroup: 'U14', gender: 'boys', level: 'Classic' },
        { groupId: '444657', name: 'B14U Copa 1 West', ageGroup: 'U14', gender: 'boys', level: 'Copa' },
        { groupId: '444654', name: 'B14U Copa 2 West', ageGroup: 'U14', gender: 'boys', level: 'Copa' },
        { groupId: '444656', name: 'B14U Copa 3 West', ageGroup: 'U14', gender: 'boys', level: 'Copa' },
        // Girls U11
        { groupId: '444607', name: 'G11U NPL 1', ageGroup: 'U11', gender: 'girls', level: 'NPL' },
        { groupId: '444608', name: 'G11U Classic 1 West', ageGroup: 'U11', gender: 'girls', level: 'Classic' },
        { groupId: '444605', name: 'G11U Classic 2 West', ageGroup: 'U11', gender: 'girls', level: 'Classic' },
        { groupId: '444606', name: 'G11U Copa 1 West', ageGroup: 'U11', gender: 'girls', level: 'Copa' },
        { groupId: '460586', name: 'G11U Copa 2 West', ageGroup: 'U11', gender: 'girls', level: 'Copa' },
        // Girls U12
        { groupId: '444622', name: 'G12U NPL 1', ageGroup: 'U12', gender: 'girls', level: 'NPL' },
        { groupId: '444619', name: 'G12U Classic 1 West', ageGroup: 'U12', gender: 'girls', level: 'Classic' },
        { groupId: '444620', name: 'G12U Classic 2 West', ageGroup: 'U12', gender: 'girls', level: 'Classic' },
        { groupId: '444621', name: 'G12U Copa 1 West', ageGroup: 'U12', gender: 'girls', level: 'Copa' },
        { groupId: '444624', name: 'G12U Copa 2 West', ageGroup: 'U12', gender: 'girls', level: 'Copa' },
        // Girls U13
        { groupId: '444639', name: 'G13U NPL 1', ageGroup: 'U13', gender: 'girls', level: 'NPL' },
        { groupId: '444636', name: 'G13U Classic 1 West', ageGroup: 'U13', gender: 'girls', level: 'Classic' },
        { groupId: '444635', name: 'G13U Copa 1 West', ageGroup: 'U13', gender: 'girls', level: 'Copa' },
        { groupId: '444637', name: 'G13U Copa 2 West', ageGroup: 'U13', gender: 'girls', level: 'Copa' },
        { groupId: '461049', name: 'G13U Copa 3 West', ageGroup: 'U13', gender: 'girls', level: 'Copa' },
        // Girls U14
        { groupId: '444648', name: 'G14U NPL 1', ageGroup: 'U14', gender: 'girls', level: 'NPL' },
        { groupId: '444651', name: 'G14U Classic 1 West', ageGroup: 'U14', gender: 'girls', level: 'Classic' },
        { groupId: '460582', name: 'G14U Classic 2 West', ageGroup: 'U14', gender: 'girls', level: 'Classic' },
        { groupId: '444650', name: 'G14U Copa 1 West', ageGroup: 'U14', gender: 'girls', level: 'Copa' },
        { groupId: '444649', name: 'G14U Copa 2 West', ageGroup: 'U14', gender: 'girls', level: 'Copa' },
      ],
    },
    seasonStart: '2026-03-01',
    seasonEnd: '2026-06-30',
    notes: 'Spring 2026, 57 groups. Full NPL + Classic + Copa coverage for 11U-14U boys and girls.',
  },

  // ── WPL W.WA Dev League (U8-U10) ──
  {
    id: 'wpl-wwa-dev-spring',
    name: 'WPL Western WA Development League',
    state: 'WA',
    sport: 'Soccer',
    region: 'Western WA',
    sourcePlatform: 'gotsport',
    status: 'active',
    autoUpdate: true,
    sourceConfig: {
      leagueEventId: '50027',
      groups: [
        // Boys U8
        { groupId: '444691', name: 'WPL Dev B8U Div 1', ageGroup: 'U8', gender: 'boys' },
        { groupId: '444690', name: 'WPL Dev B8U Div 2', ageGroup: 'U8', gender: 'boys' },
        { groupId: '444692', name: 'WPL Dev B8U Div 3', ageGroup: 'U8', gender: 'boys' },
        { groupId: '463881', name: 'WPL Dev B8U Div 4', ageGroup: 'U8', gender: 'boys' },
        // Boys U9
        { groupId: '444698', name: 'WPL Dev B9U Div 1', ageGroup: 'U9', gender: 'boys' },
        { groupId: '444700', name: 'WPL Dev B9U Div 2', ageGroup: 'U9', gender: 'boys' },
        { groupId: '444697', name: 'WPL Dev B9U Div 3', ageGroup: 'U9', gender: 'boys' },
        { groupId: '444699', name: 'WPL Dev B9U Div 4', ageGroup: 'U9', gender: 'boys' },
        { groupId: '444704', name: 'WPL Dev B9U Div 5', ageGroup: 'U9', gender: 'boys' },
        { groupId: '444702', name: 'WPL Dev B9U Div 6', ageGroup: 'U9', gender: 'boys' },
        { groupId: '444701', name: 'WPL Dev B9U Div 7', ageGroup: 'U9', gender: 'boys' },
        // Boys U10
        { groupId: '444712', name: 'WPL Dev B10U Div 1 Red', ageGroup: 'U10', gender: 'boys' },
        { groupId: '444711', name: 'WPL Dev B10U Div 1 Blue', ageGroup: 'U10', gender: 'boys' },
        { groupId: '444713', name: 'WPL Dev B10U Div 2', ageGroup: 'U10', gender: 'boys' },
        { groupId: '444717', name: 'WPL Dev B10U Div 3', ageGroup: 'U10', gender: 'boys' },
        { groupId: '444718', name: 'WPL Dev B10U Div 4 Red', ageGroup: 'U10', gender: 'boys' },
        { groupId: '464812', name: 'WPL Dev B10U Div 4 Blue', ageGroup: 'U10', gender: 'boys' },
        { groupId: '444716', name: 'WPL Dev B10U Div 5', ageGroup: 'U10', gender: 'boys' },
        { groupId: '444710', name: 'WPL Dev B10U Div 6 Red', ageGroup: 'U10', gender: 'boys' },
        { groupId: '444715', name: 'WPL Dev B10U Div 7', ageGroup: 'U10', gender: 'boys' },
        // Girls U9
        { groupId: '444696', name: 'WPL Dev G9U Div 1', ageGroup: 'U9', gender: 'girls' },
        { groupId: '444693', name: 'WPL Dev G9U Div 2', ageGroup: 'U9', gender: 'girls' },
        { groupId: '466561', name: 'WPL Dev G9U/8U Div 3', ageGroup: 'U9', gender: 'girls' },
        // Girls U10
        { groupId: '444707', name: 'WPL Dev G10U Div 1', ageGroup: 'U10', gender: 'girls' },
        { groupId: '444706', name: 'WPL Dev G10U Div 2', ageGroup: 'U10', gender: 'girls' },
        { groupId: '444705', name: 'WPL Dev G10U Div 3', ageGroup: 'U10', gender: 'girls' },
        { groupId: '444708', name: 'WPL Dev G10U Div 4', ageGroup: 'U10', gender: 'girls' },
      ],
    },
    seasonStart: '2025-11-01',
    seasonEnd: '2026-04-30',
    notes: 'Western WA Development League for U8-U10. 27 groups. Separate from Eastern WA Dev League.',
  },

  // ── NPSL (North Puget Sound League) — Demosphere/OttoSport ──
  {
    id: 'npsl-wa',
    name: 'North Puget Sound League (NPSL)',
    state: 'WA',
    sport: 'Soccer',
    region: 'North Puget Sound',
    sourcePlatform: 'demosphere',
    status: 'active',
    autoUpdate: true,
    sourceConfig: {
      baseUrl: 'https://northpugetsoundleague.ottosport.ai',
      standingsSlug: 'fall-2024-standings',
      orgId: '74274',
    },
    seasonStart: '2024-09-01',
    seasonEnd: '2025-06-30',
    notes: 'Competitive league for 11 WYS associations. U9-U19. Fall 2024 standings available; fall 2025 standings not yet posted. standingsSlug will need updating each season. Covers Whatcom, Skagit, Snohomish, King North associations.',
  },
];

// ═══════════════════════════════════════════════════════════════
// TIER 2 — Local association rec/competitive leagues
// ═══════════════════════════════════════════════════════════════

const TIER2_LEAGUES = [
  // ── LWYSA (Lake Washington YSA) — SportsConnect ──
  {
    id: 'sc-lwysa-wa',
    name: 'Lake Washington Youth Soccer (LWYSA)',
    state: 'WA',
    sport: 'Soccer',
    region: 'Eastside / Lake Washington',
    sourcePlatform: 'sportsconnect',
    status: 'active',
    autoUpdate: true,
    sourceConfig: {
      baseUrl: 'https://www.lwysa.org',
      standingsTabId: '730932',
    },
    notes: 'SportsConnect with Puppeteer. Programs include: Fall Rec, Spring Rec, Crossfire Premier/Select, RCL. Multiple seasons in dropdown.',
  },

  // ── SYSA (Seattle YSA) — Demosphere (standings not public) ──
  {
    id: 'demosphere-sysa-wa',
    name: 'Seattle Youth Soccer Association (SYSA)',
    state: 'WA',
    sport: 'Soccer',
    region: 'Seattle',
    sourcePlatform: 'demosphere',
    status: 'pending_config',
    sourceConfig: {
      baseUrl: 'https://sysa.ottosport.ai',
      orgId: '75049',
    },
    notes: 'SYSA policy: standings are kept internally for competitive balance but NOT published publicly. May not be collectible. ~13 clubs, ~5000 players. Demosphere/OttoSport platform.',
  },

  // ── SWYSA (SW WA YSA) — SportsConnect/Affinity hybrid ──
  {
    id: 'sc-swysa-wa',
    name: 'Southwest Washington Youth Soccer (SWYSA)',
    state: 'WA',
    sport: 'Soccer',
    region: 'SW WA / Clark County',
    sourcePlatform: 'sportsconnect',
    status: 'pending_config',
    sourceConfig: {
      baseUrl: 'https://www.swysa.net',
    },
    notes: 'Vancouver/Clark County, 4 clubs. DNN portal with Affinity login for scores. Need to find standingsTabId — schedules at tabid=843193. Spring 2026 schedules expected April 12.',
  },

  // ── EYSA (Eastside YSA) — Platform TBD ──
  {
    id: 'eysa-wa',
    name: 'Eastside Youth Soccer Association (EYSA)',
    state: 'WA',
    sport: 'Soccer',
    region: 'Eastside / Bellevue',
    sourcePlatform: 'sportsaffinity',
    status: 'pending_config',
    sourceConfig: {},
    notes: 'Bellevue area, 6 clubs (Bellevue United, Eastside FC, Issaquah, Lake Hills, Mercer Island, Newport). ~7700 players. WYS District 2. Likely SportsAffinity via WYS for U11-U12 standings. Wix website at eysa.org. Need to find standings URL.',
  },

  // ── Northshore YSA — SportsConnect ──
  {
    id: 'sc-northshore-wa',
    name: 'Northshore Youth Soccer Association',
    state: 'WA',
    sport: 'Soccer',
    region: 'Bothell / Woodinville',
    sourcePlatform: 'sportsconnect',
    status: 'pending_tabid',
    sourceConfig: {
      baseUrl: 'https://www.northshoresoccer.org',
    },
    notes: 'Bothell/Woodinville, 4 clubs. SportsConnect confirmed. Need standingsTabId. U13-U19 play in League Washington.',
  },

  // ── PCSA (Pierce County SA) — WordPress, no adapter ──
  {
    id: 'pcsa-wa',
    name: 'Pierce County Soccer Association (PCSA)',
    state: 'WA',
    sport: 'Soccer',
    region: 'Tacoma / Pierce County',
    sourcePlatform: 'sportsaffinity',
    status: 'pending_config',
    sourceConfig: {},
    notes: 'Tacoma area, 11 clubs. Home league (U7-U12) on WordPress site piercecountysoccer.com — no adapter. U13+ play in SSUL (already registered). May have SportsAffinity standings for home league. Need investigation.',
  },

  // ── Thurston County YSA — TeamSideline (no adapter) ──
  {
    id: 'thurston-wa',
    name: 'Thurston County Youth Soccer Association',
    state: 'WA',
    sport: 'Soccer',
    region: 'Olympia / Thurston County',
    sourcePlatform: 'demosphere',
    status: 'pending_config',
    sourceConfig: {},
    notes: 'Olympia, 7 clubs. Uses TeamSideline platform — no adapter exists. thurstoncountysoccer.com. Would need new TeamSideline adapter to collect.',
  },

  // ── Whatcom County YSA — Demosphere (rec) + NPSL (competitive) ──
  {
    id: 'demosphere-whatcom-wa',
    name: 'Whatcom County Youth Soccer (Rec)',
    state: 'WA',
    sport: 'Soccer',
    region: 'Bellingham / Whatcom',
    sourcePlatform: 'demosphere',
    status: 'pending_config',
    sourceConfig: {
      baseUrl: 'https://whatcomsoccer.demosphere.com',
    },
    notes: 'Bellingham, 11 clubs. Rec league on Demosphere (may be deprecated — got 403). Select teams play in NPSL (already registered). Competitive play under Whatcom FC Rangers. Re-check in mid-April when spring starts.',
  },
];

// ═══════════════════════════════════════════════════════════════
// TIER 3 — Eastern WA + smaller associations
// ═══════════════════════════════════════════════════════════════

const TIER3_LEAGUES = [
  // ── Spokane SYSA — SportsConnect ──
  {
    id: 'sc-spokane-sysa',
    name: 'Spokane Youth Soccer Association',
    state: 'WA',
    sport: 'Soccer',
    region: 'Spokane',
    sourcePlatform: 'sportsconnect',
    status: 'pending_tabid',
    sourceConfig: {
      baseUrl: 'https://www.sysa.com',
    },
    notes: 'Spokane rec soccer. SportsConnect/Blue Sombrero platform. Need standingsTabId. Spring 2026 games start April 18. May not have public standings — investigate during active season.',
  },

  // ── Tri-Cities T-CYSA — SportsConnect ──
  {
    id: 'sc-tcysa-wa',
    name: 'Tri-Cities Youth Soccer Association (T-CYSA)',
    state: 'WA',
    sport: 'Soccer',
    region: 'Tri-Cities',
    sourcePlatform: 'sportsconnect',
    status: 'pending_config',
    sourceConfig: {
      baseUrl: 'https://www.t-cysa.org',
    },
    notes: 'Pasco/Tri-Cities. SportsConnect, portalId 50521. Rec program is non-competitive. Competitive under Tri-Cities FC. Low priority for collection.',
  },

  // ── Skagit Valley YSA — SportsConnect ──
  {
    id: 'sc-skagit-wa',
    name: 'Skagit Valley Youth Soccer Association',
    state: 'WA',
    sport: 'Soccer',
    region: 'Burlington / Mount Vernon',
    sourcePlatform: 'sportsconnect',
    status: 'pending_tabid',
    sourceConfig: {
      baseUrl: 'https://clubs.bluesombrero.com/default.aspx?portalid=50807',
    },
    notes: 'Burlington/Mt Vernon, 9 clubs. Blue Sombrero/SportsConnect. Game Schedules tab at tabid=1455207, but no standings tab found. Select teams play in NPSL.',
  },

  // ── League Washington (WYS) — SportsConnect ──
  {
    id: 'league-wa',
    name: 'League Washington (WYS)',
    state: 'WA',
    sport: 'Soccer',
    region: 'Statewide',
    sourcePlatform: 'sportsconnect',
    status: 'pending_config',
    sourceConfig: {},
    notes: 'WYS collaborative rec league for U17-U19 (HS age). 6 associations. Standings on SportsConnect per operating procedures. Need to find the SportsConnect portal URL and standingsTabId. Lower priority — rec league.',
  },

  // ── Snoqualmie Valley YSA — SportsEngine (no adapter) ──
  {
    id: 'snoqualmie-wa',
    name: 'Snoqualmie Valley Youth Soccer Association',
    state: 'WA',
    sport: 'Soccer',
    region: 'Snoqualmie Valley',
    sourcePlatform: 'leagueapps',
    status: 'pending_config',
    sourceConfig: {},
    notes: 'Uses SportsEngine — no adapter exists. snvysa.org. 6 clubs. U11-U12 play within SnVYSA + EYSA; U13-U19 play in League WA. Would need SportsEngine adapter.',
  },

  // ── Lewis County YSA — TeamSideline (no adapter) ──
  {
    id: 'lewis-county-wa',
    name: 'Lewis County Youth Soccer Association',
    state: 'WA',
    sport: 'Soccer',
    region: 'Centralia / Chehalis',
    sourcePlatform: 'demosphere',
    status: 'pending_config',
    sourceConfig: {},
    notes: 'Centralia/Chehalis, 8 clubs. Uses TeamSideline at lcysa.net — no adapter exists. Same platform as Thurston County.',
  },
];

const ALL_LEAGUES = [...TIER1_LEAGUES, ...TIER2_LEAGUES, ...TIER3_LEAGUES];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const tierFilter = process.argv.find(a => a.startsWith('--tier='));

  let leagues = ALL_LEAGUES;
  if (tierFilter) {
    const tier = tierFilter.split('=')[1];
    if (tier === '1') leagues = TIER1_LEAGUES;
    else if (tier === '2') leagues = TIER2_LEAGUES;
    else if (tier === '3') leagues = TIER3_LEAGUES;
  }

  console.log(`\n=== WA Soccer Expansion: Registering ${leagues.length} leagues ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  const results = { created: [], skipped: [], errors: [] };

  for (const league of leagues) {
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
        discoveredBy: 'register-wa-soccer',
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

  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(e => console.log(`  - ${e.id}: ${e.error}`));
  }

  // Breakdown by status
  const active = leagues.filter(l => l.status === 'active');
  const pendingConfig = leagues.filter(l => l.status === 'pending_config');
  const pendingTabid = leagues.filter(l => l.status === 'pending_tabid');

  console.log(`\n--- Status Breakdown ---`);
  console.log(`Active (ready to collect): ${active.length}`);
  active.forEach(l => console.log(`  - ${l.id}: ${l.name} [${l.sourcePlatform}]`));
  console.log(`Pending config: ${pendingConfig.length}`);
  pendingConfig.forEach(l => console.log(`  - ${l.id}: ${l.name} — ${l.notes ? l.notes.substring(0, 80) : ''}`));
  console.log(`Pending tabId: ${pendingTabid.length}`);
  pendingTabid.forEach(l => console.log(`  - ${l.id}: ${l.name}`));

  // Log the run
  if (!dryRun) {
    await db.collection('discoveryLogs').add({
      function: 'register-wa-soccer',
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

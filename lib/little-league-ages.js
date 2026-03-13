/**
 * Standard Little League International age divisions.
 *
 * Applies to ALL Little League orgs regardless of platform (GameChanger,
 * SportsConnect, Pointstreak, etc.). These are the official LL division
 * structures used across 6,500+ programs in the US.
 *
 * Used by:
 *   - index.js post-processing (catch-all for any adapter)
 *   - adapters/sportsconnect.js (fallback when dropdown lacks ages)
 *   - scripts/maintenance/backfill-ll-age-groups.js (one-time fix)
 */

// Keys are UPPERCASE for case-insensitive lookup.
// Includes both letter-grades (A, AA, AAA) and named levels (Tee Ball, Minors, etc.)
const LL_AGE_MAP = {
  // ── Baseball ──
  'TEE BALL':       '4U-6U',
  'T-BALL':         '4U-6U',
  'TBALL':          '4U-6U',
  'A':              '4U-7U',
  'COACH PITCH':    '7U-8U',
  'MACHINE PITCH':  '7U-8U',
  'AA':             '7U-8U',
  'MINORS':         '8U-10U',
  'MINOR':          '8U-10U',
  'AAA':            '9U-10U',
  'MAJORS':         '10U-12U',
  'MAJOR':          '10U-12U',
  'COAST':          '10U-12U',
  'COAST/MAJORS':   '10U-12U',
  '50/70':          '11U-13U',
  'INTERMEDIATE':   '11U-13U',
  'JUNIORS':        '13U-14U',
  'JUNIOR':         '13U-14U',
  'SENIORS':        '14U-16U',
  'SENIOR':         '14U-16U',
  'BIG LEAGUE':     '16U-18U',

  // ── Softball (same structure, slightly different ranges) ──
  'MINOR SOFTBALL':  '8U-10U',
  'MAJOR SOFTBALL':  '10U-12U',
  'JUNIOR SOFTBALL': '13U-14U',
  'SENIOR SOFTBALL': '14U-16U',
};

/**
 * Look up the standard LL age group for a division level or name.
 *
 * Tries multiple strategies:
 *   1. Exact match on the level field (e.g. "A", "AA", "Majors")
 *   2. Exact match on the division name's first segment (before " - ")
 *   3. Keyword search within the name (e.g. "Coast/Majors Baseball" → "COAST/MAJORS")
 *
 * @param {string} [level] - Division level field (e.g. "A", "Coast", "Majors")
 * @param {string} [divName] - Full division name (e.g. "AAA - 2026 Baseball")
 * @returns {string|null} Age group like "9U-10U", or null if no match
 */
function resolveLLAgeGroup(level, divName) {
  // 1. Direct lookup on the level field
  if (level) {
    const key = level.trim().toUpperCase();
    if (LL_AGE_MAP[key]) return LL_AGE_MAP[key];
  }

  if (!divName) return null;

  // 2. First segment of the name (before " - ")
  const firstSegment = divName.split(/\s*-\s*/)[0].trim().toUpperCase();
  if (LL_AGE_MAP[firstSegment]) return LL_AGE_MAP[firstSegment];

  // 3. Keyword search — check each key against the full name
  const upper = divName.toUpperCase();
  for (const [key, age] of Object.entries(LL_AGE_MAP)) {
    // Only match multi-word keys or word-bounded single keys
    if (key.length <= 3) {
      // Short keys like "A", "AA" — require word boundary to avoid false matches
      const regex = new RegExp(`\\b${key}\\b`);
      if (regex.test(upper)) return age;
    } else {
      if (upper.includes(key)) return age;
    }
  }

  return null;
}

/**
 * Check if a league name indicates it's a Little League org.
 * @param {string} leagueName
 * @returns {boolean}
 */
function isLittleLeague(leagueName) {
  if (!leagueName) return false;
  const lower = leagueName.toLowerCase();
  return lower.includes('little league') || lower.includes(' ll ') ||
    lower.endsWith(' ll') || /\bll-/.test(lower);
}

module.exports = { LL_AGE_MAP, resolveLLAgeGroup, isLittleLeague };

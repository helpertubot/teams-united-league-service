/**
 * Shared age group + gender inference from division/league names.
 *
 * Extracts structured { ageGroup, gender } from free-text names like:
 *   "Majors - Little League Baseball Ages 10 to 12"
 *   "12U Gold Division"
 *   "Mustang 7-8"
 *   "AA - Player Pitch - Little League Softball Ages 6 to 8"
 *
 * Used by: gamechanger, sportsconnect, pointstreak, leagueapps adapters
 */

// ── Little League division levels → standard age ranges ──
// Official Little League International age divisions (2024+)
const LL_LEVELS = [
  { pattern: /t-?ball|tee\s*ball/i, ageGroup: '4U-6U' },
  { pattern: /coach\s*pitch|machine\s*pitch/i, ageGroup: '7U-8U' },
  { pattern: /\bminors?\b/i, ageGroup: '8U-10U' },
  { pattern: /\bmajors?\b/i, ageGroup: '10U-12U' },
  { pattern: /\bintermediate\b|50\/70/i, ageGroup: '11U-13U' },
  { pattern: /\bjuniors?\b/i, ageGroup: '13U-14U' },
  { pattern: /\bseniors?\b/i, ageGroup: '14U-16U' },
  { pattern: /\bbig\s*league\b/i, ageGroup: '16U-18U' },
];

// ── PONY Baseball division levels → standard age ranges ──
const PONY_LEVELS = [
  { pattern: /\bshetland\b/i, ageGroup: '5U-6U' },
  { pattern: /\bpinto\b/i, ageGroup: '7U-8U' },
  { pattern: /\bmustang\b/i, ageGroup: '7U-10U' },
  { pattern: /\bbronco\b/i, ageGroup: '11U-12U' },
  { pattern: /\bpony\b(?!\s*baseball)/i, ageGroup: '13U-14U' },
  { pattern: /\bcolt\b/i, ageGroup: '15U-16U' },
  { pattern: /\bpalomino\b/i, ageGroup: '17U-18U' },
];

/**
 * Infer age group and gender from a division or league name.
 *
 * @param {string} name - Division name, league name, or org name
 * @param {Object} [defaults] - Fallback values
 * @param {string} [defaults.ageGroup='unknown'] - Default age group if none detected
 * @param {string} [defaults.gender='unknown'] - Default gender if none detected
 * @returns {{ ageGroup: string, gender: string }}
 */
function inferAgeGroup(name, defaults) {
  const fallbackAge = (defaults && defaults.ageGroup) || 'unknown';
  const fallbackGender = (defaults && defaults.gender) || 'unknown';

  if (!name) return { ageGroup: fallbackAge, gender: fallbackGender };

  const lower = name.toLowerCase();
  let ageGroup = null;
  let gender = null;

  // ── Gender detection ──
  if (lower.includes('softball') || /\bgirls?\b/.test(lower)) {
    gender = 'girls';
  } else if (lower.includes('baseball') || /\bboys?\b/.test(lower)) {
    gender = 'boys';
  }

  // ── Explicit age range: "Ages 10 to 12", "Ages 6-8" ──
  const ageRangeMatch = name.match(/ages?\s+(\d+)\s*(?:to|-)\s*(\d+)/i);
  if (ageRangeMatch) {
    ageGroup = `${ageRangeMatch[1]}U-${ageRangeMatch[2]}U`;
  }

  // ── Explicit U-notation: "12U", "U12", "14u", "u-14" ──
  if (!ageGroup) {
    const uMatch = name.match(/\b(\d{1,2})\s*U\b/i) || name.match(/\bU-?(\d{1,2})\b/i);
    if (uMatch) {
      ageGroup = `U${uMatch[1]}`;
    }
  }

  // ── Age range without "U": "7-8", "9-10" (common in PONY/rec) ──
  if (!ageGroup) {
    const dashRange = name.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\b/);
    if (dashRange) {
      const lo = parseInt(dashRange[1]);
      const hi = parseInt(dashRange[2]);
      // Only treat as age range if values look like ages (4-18)
      if (lo >= 4 && lo <= 18 && hi >= 4 && hi <= 18 && hi > lo) {
        ageGroup = `${lo}U-${hi}U`;
      }
    }
  }

  // ── Little League level names ──
  if (!ageGroup) {
    for (const level of LL_LEVELS) {
      if (level.pattern.test(name)) {
        ageGroup = level.ageGroup;
        break;
      }
    }
  }

  // ── PONY level names ──
  if (!ageGroup) {
    for (const level of PONY_LEVELS) {
      if (level.pattern.test(name)) {
        ageGroup = level.ageGroup;
        break;
      }
    }
  }

  return {
    ageGroup: ageGroup || fallbackAge,
    gender: gender || fallbackGender,
  };
}

module.exports = { inferAgeGroup };

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

// ── Grade-based naming → age group (NJB, rec basketball, etc.) ──
// Typical mapping: kindergarten=5-6yo (U6), 1st grade=6-7yo (U7), etc.
const GRADE_MAP = {
  'kindergarten': 'U6', 'k': 'U6',
  '1st': 'U7', '2nd': 'U8', '3rd': 'U9', '4th': 'U10',
  '5th': 'U11', '6th': 'U12', '7th': 'U13', '8th': 'U14',
  '9th': 'U15', '10th': 'U16', '11th': 'U17', '12th': 'U18',
};

/** Map a numeric grade string to its ordinal suffix key for GRADE_MAP lookup */
function ordSuffix(n) {
  const num = parseInt(n);
  if (num === 1) return 'st';
  if (num === 2) return 'nd';
  if (num === 3) return 'rd';
  return 'th';
}

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

  // ── BU/GU prefix pattern: "BU11", "GU14" (common in OYSA/SA-ASP) ──
  const buguMatch = name.match(/\b([BG])U-?(\d{1,2})\b/i);
  if (buguMatch) {
    gender = buguMatch[1].toUpperCase() === 'B' ? 'boys' : 'girls';
    ageGroup = `U${buguMatch[2]}`;
  }

  // ── Gender detection ──
  if (!gender) {
    if (lower.includes('softball') || /\bgirls?\b/.test(lower)) {
      gender = 'girls';
    } else if (lower.includes('baseball') || /\bboys?\b/.test(lower)) {
      gender = 'boys';
    }
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

  // ── Grade-based naming: "2nd Grade", "4th and 5th Grades", "6th through 8th Grades" ──
  if (!ageGroup) {
    // Range: "4th and 5th Grades", "6th through 8th Grades"
    const gradeRange = name.match(/(\d+)(?:st|nd|rd|th)\s+(?:and|through|thru|to|-)\s+(\d+)(?:st|nd|rd|th)\s*grade/i);
    if (gradeRange) {
      const loAge = GRADE_MAP[gradeRange[1] + ordSuffix(gradeRange[1])];
      const hiAge = GRADE_MAP[gradeRange[2] + ordSuffix(gradeRange[2])];
      if (loAge && hiAge) ageGroup = `${loAge}-${hiAge}`;
    }
    // Single: "2nd Grade", "1st Grade"
    if (!ageGroup) {
      const singleGrade = name.match(/(\d+)(?:st|nd|rd|th)\s*grade/i);
      if (singleGrade) {
        const mapped = GRADE_MAP[singleGrade[1] + ordSuffix(singleGrade[1])];
        if (mapped) ageGroup = mapped;
      }
    }
    // Kindergarten (standalone)
    if (!ageGroup && /\bkindergarten\b/i.test(name)) {
      ageGroup = GRADE_MAP['kindergarten'];
    }
    // "Rookies" without a grade qualifier (NJB K-1st grade level)
    if (!ageGroup && /\brookies?\b/i.test(name)) {
      ageGroup = 'U6-U7';
    }
  }

  return {
    ageGroup: ageGroup || fallbackAge,
    gender: gender || fallbackGender,
  };
}

module.exports = { inferAgeGroup };

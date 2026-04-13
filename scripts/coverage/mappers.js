const L = require('./lib');

function dropEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

function researchLeagueToConfigV2(row) {
  const name = L.normalizeCell(row.name);
  if (!name) return null;
  return dropEmpty({
    id: L.slug(name),
    name,
    level: L.normalizeCell(row.level),
    ageGroups: L.normalizeCell(row.ageGroups),
    gender: L.normalizeGender(row.gender),
    season: L.normalizeCell(row.season),
    region: L.normalizeCell(row.geography),
    governingBody: L.normalizeCell(row.governingBody),
    sanctioning: L.normalizeCell(row.sanctioning),
    website: L.stripUrlWrapper(row.website),
    sourceUrl: L.stripUrlWrapper(row.sourceUrl),
    notes: L.normalizeCell(row.notes)
  });
}

function researchTournamentToConfigV2(row) {
  const name = L.normalizeCell(row.name);
  if (!name) return null;

  const startDateRaw = L.normalizeCell(row.startDate);
  const endDateRaw = L.normalizeCell(row.endDate);
  const startDate = L.validateDate(startDateRaw) ? startDateRaw : undefined;
  const endDate = L.validateDate(endDateRaw) ? endDateRaw : undefined;

  if (startDateRaw && !startDate) {
    console.warn(`warn: malformed startDate "${startDateRaw}" on row "${name}" — dropping field`);
  }
  if (endDateRaw && !endDate) {
    console.warn(`warn: malformed endDate "${endDateRaw}" on row "${name}" — dropping field`);
  }

  const entry = dropEmpty({
    id: L.slug(name),
    seriesId: L.slugWithoutYear(name),
    name,
    startDate,
    endDate,
    venue: L.normalizeCell(row.venue),
    city: L.normalizeCell(row.city),
    entryFee: L.normalizeCell(row.entryFee),
    teamCount: L.normalizeCell(row.teamCount),
    sourcePlatform: L.normalizePlatform(L.normalizeCell(row.platform) || ''),
    registrationUrl: L.stripUrlWrapper(row.registrationUrl),
    ageGroups: L.normalizeCell(row.ageGroups),
    gender: L.normalizeGender(row.gender),
    format: L.normalizeCell(row.format),
    organizer: L.normalizeCell(row.organizer),
    sanctioning: L.normalizeCell(row.sanctioning),
    confidence: L.normalizeCell(row.confidence),
    sourceUrl: L.stripUrlWrapper(row.sourceUrl),
    notes: L.normalizeCell(row.notes)
  });

  // Always include derived fields even when dates are missing:
  entry.year = L.parseYear(startDate);
  entry.lifecycle = 'upcoming';

  return entry;
}

module.exports = { researchLeagueToConfigV2, researchTournamentToConfigV2 };

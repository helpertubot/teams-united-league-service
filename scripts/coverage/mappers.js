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

module.exports = { researchLeagueToConfigV2 };

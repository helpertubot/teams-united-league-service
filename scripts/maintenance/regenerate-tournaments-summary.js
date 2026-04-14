/**
 * Regenerate tournaments-summary.json from repo config and upload to GCS.
 *
 * Usage:
 *   node scripts/maintenance/regenerate-tournaments-summary.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { Storage } = require('@google-cloud/storage');

const storage = new Storage();
const ROOT = path.join(__dirname, '..', '..');
const STATES_ROOT = path.join(ROOT, 'config', 'states');

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeTournament(row, state, sport) {
  return {
    id: row.id || '',
    seriesId: row.seriesId || '',
    name: row.name || '',
    sport: (row.sport || sport || '').toLowerCase(),
    state: (row.state || state || '').toUpperCase(),
    startDate: row.startDate || row.start_date || '',
    endDate: row.endDate || row.end_date || '',
    venue: row.venue || row.venueName || '',
    city: row.city || '',
    entryFee: row.entryFee || row.entry_fee || '',
    ageGroups: row.ageGroups || row.age_groups || '',
    gender: row.gender || '',
    format: row.format || '',
    organizer: row.organizer || row.contactName || '',
    sanctioning: row.sanctioning || '',
    confidence: row.confidence || '',
    sourcePlatform: row.sourcePlatform || row.source_platform || '',
    sourceUrl: row.sourceUrl || row.source_url || '',
    registrationUrl: row.registrationUrl || row.registration_url || '',
    notes: row.notes || '',
    lifecycle: row.lifecycle || '',
    importedBy: row.importedBy || '',
    year: row.year || '',
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const outputFlagIndex = process.argv.indexOf('--output');
  const outputPath = outputFlagIndex !== -1 ? process.argv[outputFlagIndex + 1] : '';
  const tournaments = [];

  for (const state of fs.readdirSync(STATES_ROOT)) {
    if (!/^[A-Z]{2}$/.test(state)) continue;
    const stateDir = path.join(STATES_ROOT, state);
    if (!fs.statSync(stateDir).isDirectory()) continue;
    for (const sport of fs.readdirSync(stateDir)) {
      const filePath = path.join(stateDir, sport, 'tournaments.json');
      if (!fs.existsSync(filePath)) continue;
      const parsed = safeReadJson(filePath);
      const rows = Array.isArray(parsed?.tournaments) ? parsed.tournaments : [];
      for (const row of rows) {
        tournaments.push(normalizeTournament(row, state, sport));
      }
    }
  }

  tournaments.sort((a, b) => {
    const ad = a.startDate || '9999-99-99';
    const bd = b.startDate || '9999-99-99';
    if (ad !== bd) return ad.localeCompare(bd);
    return (a.name || '').localeCompare(b.name || '');
  });

  const byStateSport = {};
  for (const row of tournaments) {
    const key = `${row.state}:${row.sport}`;
    byStateSport[key] = (byStateSport[key] || 0) + 1;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    count: tournaments.length,
    byStateSport,
    tournaments,
  };

  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    console.log(`Wrote ${outputPath} (${payload.count} tournaments)`);
    return;
  }

  if (dryRun) {
    console.log(JSON.stringify({
      generatedAt: payload.generatedAt,
      count: payload.count,
      sample: tournaments.slice(0, 3),
    }, null, 2));
    return;
  }

  const bucket = storage.bucket('tu-league-dashboard');
  const file = bucket.file('tournaments-summary.json');
  await file.save(JSON.stringify(payload), {
    contentType: 'application/json',
    metadata: { cacheControl: 'public, max-age=300' },
  });

  console.log(`Uploaded tournaments-summary.json (${payload.count} tournaments)`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

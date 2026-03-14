/**
 * Cleanup Duplicate Standings — Remove legacy auto-generated Firestore docs
 *
 * Before composite keys were introduced, standings were written with
 * Firestore auto-generated IDs (e.g., "3tuuQxHFlTaVTID0b4B5").
 * After the switch, new docs use composite keys like
 * "{divisionId}-{slugified-teamName}".
 *
 * This script finds all standings where the same (divisionId, teamName)
 * pair has multiple documents, and deletes the ones with auto-generated IDs.
 *
 * Usage:
 *   node scripts/maintenance/cleanup-duplicate-standings.js [--dry-run] [--division=ID]
 */

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const divFilter = args.find(a => a.startsWith('--division='))?.split('=')[1];

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Cleanup Duplicate Standings                      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Options: dryRun=${dryRun}, division=${divFilter || 'all'}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  // Fetch all standings (or filtered by division)
  let query = db.collection('standings');
  if (divFilter) {
    query = query.where('divisionId', '==', divFilter);
  }

  console.log('Fetching standings...');
  const snap = await query.get();
  console.log(`Total standings documents: ${snap.size}\n`);

  // Group by (divisionId, teamName) — track document IDs
  const groups = {};
  for (const doc of snap.docs) {
    const data = doc.data();
    const divId = data.divisionId || 'unknown';
    const team = data.teamName || 'unknown';
    const key = `${divId}|||${team}`;

    if (!groups[key]) groups[key] = [];
    groups[key].push({ id: doc.id, data });
  }

  // Find duplicates
  const duplicateGroups = Object.entries(groups).filter(([, docs]) => docs.length > 1);
  console.log(`Groups with duplicates: ${duplicateGroups.length}`);

  if (duplicateGroups.length === 0) {
    console.log('\nNo duplicates found. All clean!');
    return;
  }

  // For each duplicate group, identify which doc to keep (composite key)
  // and which to delete (auto-generated ID)
  const toDelete = [];
  let examinedDivisions = new Set();

  for (const [key, docs] of duplicateGroups) {
    const [divId, teamName] = key.split('|||');
    examinedDivisions.add(divId);

    // A composite key doc starts with the divisionId prefix
    const compositeKeyDocs = docs.filter(d => d.id.startsWith(divId));
    const autoIdDocs = docs.filter(d => !d.id.startsWith(divId));

    if (compositeKeyDocs.length >= 1 && autoIdDocs.length >= 1) {
      // Keep the composite key doc, delete the auto-ID docs
      for (const d of autoIdDocs) {
        toDelete.push({ id: d.id, divisionId: divId, teamName });
      }
    } else if (compositeKeyDocs.length > 1) {
      // Multiple composite key docs (shouldn't happen, but keep first)
      for (let i = 1; i < compositeKeyDocs.length; i++) {
        toDelete.push({ id: compositeKeyDocs[i].id, divisionId: divId, teamName });
      }
    } else {
      // All auto-ID docs, no composite key — keep the first, delete rest
      for (let i = 1; i < docs.length; i++) {
        toDelete.push({ id: docs[i].id, divisionId: divId, teamName });
      }
    }
  }

  console.log(`Documents to delete: ${toDelete.length}`);
  console.log(`Across ${examinedDivisions.size} divisions\n`);

  // Show sample
  const sample = toDelete.slice(0, 10);
  console.log('--- Sample (first 10) ---');
  for (const d of sample) {
    console.log(`  DELETE ${d.id} — ${d.teamName} (${d.divisionId.substring(0, 30)}...)`);
  }
  if (toDelete.length > 10) {
    console.log(`  ... and ${toDelete.length - 10} more`);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No documents deleted.');
    return;
  }

  // Delete in batches of 400
  console.log('\nDeleting...');
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 400) {
    const batch = db.batch();
    const chunk = toDelete.slice(i, i + 400);
    for (const d of chunk) {
      batch.delete(db.collection('standings').doc(d.id));
    }
    await batch.commit();
    deleted += chunk.length;
    console.log(`  Deleted ${deleted}/${toDelete.length}`);
  }

  console.log(`\nDone. Deleted ${deleted} duplicate standings documents.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

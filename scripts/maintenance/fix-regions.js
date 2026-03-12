/**
 * fix-regions.js — Standardize region field across all leagues
 * 
 * Uses 8 standard US regions (based on BEA/common usage):
 *   1. Pacific Northwest (WA, OR, AK)
 *   2. West (CA, HI, NV)
 *   3. Mountain (ID, MT, WY, CO, UT, AZ, NM)
 *   4. Midwest (ND, SD, NE, KS, MN, IA, MO, WI, IL, IN, MI, OH)
 *   5. South Central (TX, OK, AR, LA)
 *   6. Southeast (FL, GA, SC, NC, VA, WV, KY, TN, AL, MS, MD, DE, DC)
 *   7. Northeast (PA, NJ, NY, CT, RI, MA, VT, NH, ME)
 *   8. National (multi-state / national leagues)
 * 
 * Also fixes:
 *   - state "national" → "National" (uppercase)
 *   - state "template" → "Template"
 *   - Keeps existing local sub-region in a new "subRegion" field for WA leagues
 */

const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'teams-united'
  });
}
const db = admin.firestore();

// ── Standard US Region Mapping (state abbreviation → region) ──
const STATE_TO_REGION = {
  // Pacific Northwest
  WA: 'Pacific Northwest',
  OR: 'Pacific Northwest',
  AK: 'Pacific Northwest',

  // West
  CA: 'West',
  HI: 'West',
  NV: 'West',

  // Mountain
  ID: 'Mountain',
  MT: 'Mountain',
  WY: 'Mountain',
  CO: 'Mountain',
  UT: 'Mountain',
  AZ: 'Mountain',
  NM: 'Mountain',

  // Midwest
  ND: 'Midwest',
  SD: 'Midwest',
  NE: 'Midwest',
  KS: 'Midwest',
  MN: 'Midwest',
  IA: 'Midwest',
  MO: 'Midwest',
  WI: 'Midwest',
  IL: 'Midwest',
  IN: 'Midwest',
  MI: 'Midwest',
  OH: 'Midwest',

  // South Central
  TX: 'South Central',
  OK: 'South Central',
  AR: 'South Central',
  LA: 'South Central',

  // Southeast
  FL: 'Southeast',
  GA: 'Southeast',
  SC: 'Southeast',
  NC: 'Southeast',
  VA: 'Southeast',
  WV: 'Southeast',
  KY: 'Southeast',
  TN: 'Southeast',
  AL: 'Southeast',
  MS: 'Southeast',
  MD: 'Southeast',
  DE: 'Southeast',
  DC: 'Southeast',

  // Northeast
  PA: 'Northeast',
  NJ: 'Northeast',
  NY: 'Northeast',
  CT: 'Northeast',
  RI: 'Northeast',
  MA: 'Northeast',
  VT: 'Northeast',
  NH: 'Northeast',
  ME: 'Northeast',
};

function getRegionForState(stateField) {
  if (!stateField) return null;
  
  const s = stateField.trim();
  
  // National / multi-state
  if (s.toLowerCase() === 'national') return 'National';
  if (s.toLowerCase() === 'template') return null; // skip templates
  
  // Multi-state (e.g., "OR,WA,ID,MT" or "WA,OR,BC")
  if (s.includes(',')) {
    // Check if all states map to same region
    const parts = s.split(',').map(p => p.trim());
    const regions = new Set();
    for (const p of parts) {
      const r = STATE_TO_REGION[p];
      if (r) regions.add(r);
    }
    if (regions.size === 1) return [...regions][0];
    // Mixed regions → pick the first US state's region, or "National" if truly mixed
    for (const p of parts) {
      if (STATE_TO_REGION[p]) return STATE_TO_REGION[p];
    }
    return 'National';
  }
  
  // Single state lookup
  if (STATE_TO_REGION[s]) return STATE_TO_REGION[s];
  
  // Unknown
  console.warn(`  ⚠ Unknown state: "${s}"`);
  return null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\n🏟 Region Standardization ${dryRun ? '(DRY RUN)' : '(LIVE)'}\n`);
  
  const snap = await db.collection('leagues').get();
  console.log(`Found ${snap.size} total leagues\n`);
  
  let updated = 0;
  let skipped = 0;
  let casingFixed = 0;
  const changes = [];
  
  for (const doc of snap.docs) {
    const data = doc.data();
    const updates = {};
    let changeDesc = [];
    
    // 1. Fix state casing: "national" → "National"
    if (data.state === 'national') {
      updates.state = 'National';
      changeDesc.push('state: national → National');
      casingFixed++;
    }
    
    // 2. Fix state casing: "template" → "Template"  
    if (data.state === 'template') {
      updates.state = 'Template';
      changeDesc.push('state: template → Template');
    }
    
    // 3. Determine correct region
    const effectiveState = updates.state || data.state;
    const newRegion = getRegionForState(effectiveState);
    
    if (!newRegion) {
      if (data.status !== 'template') {
        console.log(`  SKIP: ${data.name} (state=${data.state}, status=${data.status})`);
      }
      skipped++;
      continue;
    }
    
    // 4. If current region is a local/sub-region (city-level), preserve it
    const currentRegion = data.region || '';
    const isLocalRegion = currentRegion && 
      currentRegion !== 'National' && 
      currentRegion !== 'Pacific Northwest' &&
      currentRegion !== 'West' &&
      currentRegion !== 'Mountain' &&
      currentRegion !== 'Midwest' &&
      currentRegion !== 'South Central' &&
      currentRegion !== 'Southeast' &&
      currentRegion !== 'Northeast' &&
      currentRegion !== 'Template' &&
      currentRegion !== 'Statewide';
    
    if (isLocalRegion && !data.subRegion) {
      updates.subRegion = currentRegion;
      changeDesc.push(`subRegion: "${currentRegion}" (preserved)`);
    }
    
    // 5. Set the new standard region
    if (currentRegion !== newRegion) {
      updates.region = newRegion;
      changeDesc.push(`region: "${currentRegion}" → "${newRegion}"`);
    }
    
    // Apply updates
    if (Object.keys(updates).length > 0) {
      changes.push({ id: doc.id, name: data.name, state: effectiveState, changes: changeDesc });
      
      if (!dryRun) {
        await db.collection('leagues').doc(doc.id).update(updates);
      }
      updated++;
    }
  }
  
  // Summary
  console.log('\n── Changes ──\n');
  for (const c of changes) {
    console.log(`  ${c.name} (${c.state}):`);
    for (const d of c.changes) {
      console.log(`    • ${d}`);
    }
  }
  
  console.log(`\n── Summary ──`);
  console.log(`  Total leagues: ${snap.size}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  State casing fixes: ${casingFixed}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);
  
  // Print final region distribution
  if (!dryRun) {
    const snap2 = await db.collection('leagues').get();
    const regionCounts = {};
    snap2.forEach(d => {
      const r = d.data().region || 'NONE';
      regionCounts[r] = (regionCounts[r] || 0) + 1;
    });
    console.log('── New Region Distribution ──');
    for (const [r, c] of Object.entries(regionCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${r}: ${c}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });

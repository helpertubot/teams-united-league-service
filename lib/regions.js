/**
 * US Region Mapping — Standard regions for Teams United
 * 
 * 8 regions based on BEA/common usage:
 *   Pacific Northwest, West, Mountain, Midwest,
 *   South Central, Southeast, Northeast, National
 */

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

const ALL_REGIONS = [
  'Pacific Northwest', 'West', 'Mountain', 'Midwest',
  'South Central', 'Southeast', 'Northeast', 'National'
];

/**
 * Get the standard region for a state abbreviation.
 * Returns 'National' for multi-state or national leagues.
 * Returns null for unknown states.
 */
function getRegion(stateField) {
  if (!stateField) return null;
  const s = stateField.trim();
  
  if (s === 'National') return 'National';
  if (s === 'Template') return null;
  
  // Multi-state
  if (s.includes(',')) {
    const parts = s.split(',').map(p => p.trim());
    const regions = new Set();
    for (const p of parts) {
      const r = STATE_TO_REGION[p];
      if (r) regions.add(r);
    }
    if (regions.size === 1) return [...regions][0];
    for (const p of parts) {
      if (STATE_TO_REGION[p]) return STATE_TO_REGION[p];
    }
    return 'National';
  }
  
  return STATE_TO_REGION[s] || null;
}

module.exports = { STATE_TO_REGION, ALL_REGIONS, getRegion };

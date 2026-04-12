#!/usr/bin/env node
/**
 * sweep-tournaments — URL liveness + lifecycle maintenance.
 *
 * Runs weekly. For every tournament row:
 *   - HEAD (with GET fallback) the website and registrationUrl.
 *   - Record lastChecked (ISO date) + lastHttpStatus (number|'network-error').
 *   - Increment consecutiveFailures on non-2xx/3xx. Reset to 0 on success.
 *   - 2+ consecutive failures -> lifecycle='stale'.
 *   - Final-URL host differs from recorded host -> lifecycle='moved'.
 * Never deletes rows. Never demotes a sticky state back to 'upcoming'.
 * Research remains the source of truth for card creation — the sweeper only
 * flags; human/Tier-2 confirms any deactivation.
 *
 * Usage:
 *   node scripts/coverage/sweep-tournaments.js --state CA
 *   node scripts/coverage/sweep-tournaments.js --all
 *   node scripts/coverage/sweep-tournaments.js --state ID --sport soccer --dry-run
 *   node scripts/coverage/sweep-tournaments.js --all --concurrency 8 --timeout 10000
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const L = require('./lib');

function parseArgs(argv) {
  const args = { flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args.flags[key] = next; i++; }
      else args.flags[key] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const state = args.flags.state;
const sportFilter = args.flags.sport || null;
const dryRun = !!args.flags['dry-run'];
const all = !!args.flags.all;
const concurrency = parseInt(args.flags.concurrency, 10) || 6;
const timeoutMs = parseInt(args.flags.timeout, 10) || 8000;

if (!state && !all) {
  console.error('Usage: sweep-tournaments.js (--state XX | --all) [--sport YY] [--dry-run]');
  process.exit(1);
}

const STICKY = new Set(['missing-from-research']); // never recomputed by sweep

/**
 * HEAD a URL with redirect follow (max 5 hops). Falls back to GET when a
 * server returns 405/403 on HEAD. Returns { status, finalUrl, error }.
 */
function check(url, opts = {}) {
  const maxHops = 5;
  const followed = [];
  return new Promise((resolve) => {
    const go = (u, hops, method) => {
      let parsed;
      try { parsed = new URL(u); } catch { return resolve({ status: 'network-error', finalUrl: u, error: 'invalid-url' }); }
      const lib = parsed.protocol === 'http:' ? http : https;
      const req = lib.request(parsed, {
        method,
        timeout: timeoutMs,
        headers: { 'User-Agent': 'TeamsUnited-Sweeper/1.0 (+https://teamsunited.com)' }
      }, (res) => {
        const code = res.statusCode;
        res.resume(); // drain
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && hops < maxHops) {
          const nextUrl = new URL(res.headers.location, parsed).toString();
          followed.push(nextUrl);
          return go(nextUrl, hops + 1, method);
        }
        if ((code === 405 || code === 403 || code === 501) && method === 'HEAD') {
          return go(u, hops, 'GET');
        }
        resolve({ status: code, finalUrl: u, error: null });
      });
      req.on('timeout', () => { req.destroy(); resolve({ status: 'network-error', finalUrl: u, error: 'timeout' }); });
      req.on('error', (e) => resolve({ status: 'network-error', finalUrl: u, error: e.code || e.message }));
      req.end();
    };
    go(url, 0, 'HEAD');
  });
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
}

async function sweepRow(row) {
  const urls = [row.website, row.registrationUrl].filter(Boolean);
  if (urls.length === 0) {
    return { row, changed: false, note: 'no-urls' };
  }
  const results = await Promise.all(urls.map((u) => check(u)));
  const anyOk = results.some((r) => typeof r.status === 'number' && r.status >= 200 && r.status < 400);
  const primary = results[0];
  const originalHost = hostOf(urls[0]);
  const finalHost = hostOf(primary.finalUrl);
  const hostChanged = originalHost && finalHost && originalHost !== finalHost;

  const before = JSON.stringify(row);
  row.lastChecked = L.todayISO();
  row.lastHttpStatus = primary.status;

  const prevFails = Number.isFinite(row.consecutiveFailures) ? row.consecutiveFailures : 0;
  row.consecutiveFailures = anyOk ? 0 : prevFails + 1;

  if (!STICKY.has(row.lifecycle)) {
    if (hostChanged && anyOk) {
      row.lifecycle = 'moved';
      row.movedTo = finalHost;
    } else if (row.consecutiveFailures >= 2) {
      row.lifecycle = 'stale';
    } else if (anyOk && (row.lifecycle === 'stale' || row.lifecycle === 'moved')) {
      // Recovered — re-derive from dates.
      delete row.movedTo;
      row.lifecycle = L.deriveLifecycle(row);
    }
  }

  const after = JSON.stringify(row);
  return { row, changed: before !== after };
}

async function pMap(items, worker, n) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

async function sweepState(stateCode) {
  const sports = sportFilter ? [sportFilter] : L.SPORTS;
  const stateReport = { state: stateCode, sports: {} };
  for (const sport of sports) {
    const p = L.configTournamentsPath(stateCode, sport);
    if (!fs.existsSync(p)) continue;
    const data = L.readJson(p);
    if (!data || !Array.isArray(data.tournaments)) continue;

    const results = await pMap(data.tournaments, sweepRow, concurrency);
    const changed = results.filter((r) => r.changed).length;
    const flagged = results.filter((r) => ['stale', 'moved'].includes(r.row.lifecycle)).length;

    if (!dryRun && changed > 0) {
      data._lastUpdated = L.todayISO();
      L.writeJson(p, data);
    }

    stateReport.sports[sport] = {
      total: data.tournaments.length,
      changed,
      flagged,
      rows: results.map((r) => ({
        id: r.row.id,
        lifecycle: r.row.lifecycle,
        lastHttpStatus: r.row.lastHttpStatus,
        consecutiveFailures: r.row.consecutiveFailures
      }))
    };
    console.log(`[${stateCode}/${sport}] checked=${data.tournaments.length} changed=${changed} flagged=${flagged}${dryRun ? ' (dry-run)' : ''}`);
  }
  return stateReport;
}

(async () => {
  const targets = all
    ? fs.readdirSync(path.join(L.REPO_ROOT, 'config', 'states')).sort()
    : [state];

  const reports = [];
  for (const s of targets) {
    reports.push(await sweepState(s));
  }

  const reportDir = path.join(L.REPO_ROOT, 'scripts', 'coverage', '_reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `sweep-${L.todayISO()}.json`);
  if (!dryRun) {
    fs.writeFileSync(reportPath, JSON.stringify({ ranAt: L.todayISO(), reports }, null, 2));
  }
  console.log(`\nReport: ${dryRun ? '(dry-run, not written)' : reportPath}`);
})();

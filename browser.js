/**
 * Shared Browser Launcher (v2 — frame-detached fix)
 * 
 * Provides launchBrowser() and resilientGoto() used by all adapters that need
 * browser automation. Uses @sparticuz/chromium in Cloud Functions (serverless)
 * and falls back to regular puppeteer locally.
 * 
 * Key fixes in v2:
 * - Removed --single-process flag (primary cause of frame-detached errors)
 * - Added resilientGoto() with retry logic and proper lifecycle events
 * - Added page stabilization helpers
 * 
 * Usage:
 *   const { launchBrowser, resilientGoto } = require('./browser');
 *   const browser = await launchBrowser();
 *   const page = await browser.newPage();
 *   await resilientGoto(page, url, { waitUntil: 'domcontentloaded' });
 *   // ... use page ..
 *   await browser.close();
 */

// Priority order:
// 1. Full puppeteer (has its own Chrome) — best for VMs/local dev
// 2. @sparticuz/chromium + puppeteer-core — for Cloud Functions (serverless)
// 3. Manual Chrome path detection — fallback

let puppeteerFull;
try {
  puppeteerFull = require('puppeteer');
} catch (e) {
  puppeteerFull = null;
}

let chromium;
try {
  chromium = require('@sparticuz/chromium');
} catch (e) {
  chromium = null;
}

const puppeteerCore = require('puppeteer-core');

/**
 * Launch a headless Chromium browser suitable for the current environment.
 * In Cloud Functions: uses @sparticuz/chromium's bundled binary.
 * Locally: falls back to system Chrome or puppeteer's bundled Chrome.
 * 
 * @param {Object} [opts] - Additional Puppeteer launch options to merge in
 * @returns {Promise<Browser>} Puppeteer Browser instance
 */
async function launchBrowser(opts = {}) {
  // NOTE: --single-process removed — it causes frame-detached errors
  // when pages navigate or iframes load
  const defaultArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--no-first-run',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-blink-features=AutomationControlled',
  ];

  // ── Path 1: Full puppeteer (VM / local dev) ──
  // Prefer this over @sparticuz/chromium because it has a real Chrome binary
  // with all shared libraries, which works reliably for heavy SPAs.
  if (puppeteerFull) {
    // Check if puppeteer's default path exists; if not, find it in cache
    const defaultPath = puppeteerFull.executablePath();
    const fs2 = require('fs');
    const path2 = require('path');
    let chromePath = defaultPath;
    
    if (!fs2.existsSync(defaultPath)) {
      // Search puppeteer cache for Chrome binary
      const homeDir = process.env.HOME || '/root';
      const cacheDir = path2.join(homeDir, '.cache', 'puppeteer', 'chrome');
      try {
        if (fs2.existsSync(cacheDir)) {
          const versions = fs2.readdirSync(cacheDir).sort().reverse(); // newest first
          for (const v of versions) {
            const candidate = path2.join(cacheDir, v, 'chrome-linux64', 'chrome');
            if (fs2.existsSync(candidate)) {
              chromePath = candidate;
              break;
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    if (fs2.existsSync(chromePath)) {
      console.log(`Browser: using full puppeteer Chrome at ${chromePath}`);
      return puppeteerFull.launch({
        headless: 'new',
        executablePath: chromePath,
        args: defaultArgs,
        protocolTimeout: 120000,
        ...opts,
      });
    } else {
      console.warn(`Browser: puppeteer installed but Chrome not found at ${defaultPath}, falling through...`);
    }
  }

  // ── Path 2: @sparticuz/chromium (Cloud Functions / serverless) ──
  if (chromium) {
    const executablePath = await chromium.executablePath();
    console.log(`Browser: using @sparticuz/chromium at ${executablePath}`);

    // CRITICAL: Filter out --single-process from chromium.args
    // @sparticuz/chromium includes it by default, but it causes frame-detached
    // errors when pages navigate or iframes load in Cloud Functions
    const chromiumArgs = (chromium.args || []).filter(arg => arg !== '--single-process');
    console.log(`Browser: chromium args (filtered): ${chromiumArgs.length} args, --single-process removed`);

    return puppeteerCore.launch({
      args: [...chromiumArgs, ...defaultArgs],
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: 'new',  // Use new headless mode — less detectable than old headless
      protocolTimeout: 120000,
      ...opts,
    });
  }

  // Second try: check common Chrome/Chromium locations
  const fs = require('fs');
  const path = require('path');
  const possiblePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];

  // Also check puppeteer cache directory
  const homeDir = process.env.HOME || '/home/deploy';
  const puppeteerCacheDir = path.join(homeDir, '.cache', 'puppeteer', 'chrome');
  try {
    if (fs.existsSync(puppeteerCacheDir)) {
      const versions = fs.readdirSync(puppeteerCacheDir);
      for (const v of versions) {
        const chromePath = path.join(puppeteerCacheDir, v, 'chrome-linux64', 'chrome');
        if (fs.existsSync(chromePath)) {
          possiblePaths.unshift(chromePath); // Prioritize
        }
      }
    }
  } catch (e) { /* ignore */ }

  let executablePath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      executablePath = p;
      break;
    }
  }

  if (!executablePath) {
    throw new Error(
      'No Chrome/Chromium found. Install @sparticuz/chromium for serverless ' +
      'or puppeteer for local development.'
    );
  }

  console.log(`Browser: using local Chrome at ${executablePath}`);
  return puppeteerCore.launch({
    executablePath,
    headless: 'new',
    args: defaultArgs,
    protocolTimeout: 120000,
    ...opts,
  });
}

/**
 * Navigate to a URL with retry logic and frame-detached resilience.
 * 
 * Instead of relying on `networkidle2` (which times out on long-polling pages),
 * we use `domcontentloaded` and then wait for the page to stabilize.
 * 
 * @param {Page} page - Puppeteer Page instance
 * @param {string} url - URL to navigate to
 * @param {Object} [options]
 * @param {string} [options.waitUntil='domcontentloaded'] - Navigation event to wait for
 * @param {number} [options.timeout=45000] - Navigation timeout in ms
 * @param {number} [options.retries=2] - Number of retries on failure
 * @param {number} [options.stabilizeMs=3000] - Wait after navigation for JS to render
 * @returns {Promise<void>}
 */
async function resilientGoto(page, url, options = {}) {
  const {
    waitUntil = 'domcontentloaded',
    timeout = 45000,
    retries = 2,
    stabilizeMs = 3000,
  } = options;

  let lastError;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Browser: Retry ${attempt}/${retries} for ${url}`);
        await sleep(2000 * attempt); // Exponential backoff
      }

      // Listen for frame-detached errors and suppress them during navigation
      const frameDetachedHandler = () => {};
      page.on('framedetached', frameDetachedHandler);

      await page.goto(url, { waitUntil, timeout });

      page.off('framedetached', frameDetachedHandler);

      // Wait for the page to stabilize (SPA hydration, dynamic content)
      await sleep(stabilizeMs);

      return; // Success
    } catch (err) {
      lastError = err;
      
      // If it's a frame-detached or target-closed error, the page might be in a bad state
      if (err.message.includes('frame was detached') || 
          err.message.includes('Target closed') ||
          err.message.includes('Session closed') ||
          err.message.includes('Protocol error')) {
        console.warn(`Browser: Frame/session error on attempt ${attempt + 1}: ${err.message}`);
        
        // Try to recover by creating a fresh page
        if (attempt < retries) {
          try {
            const browser = page.browser();
            const newPage = await browser.newPage();
            await newPage.setViewport({ width: 1280, height: 800 });
            await newPage.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 TeamsUnited-Standings/1.0');
            // Copy properties from old page to new page
            // Note: caller should use the returned page reference
            Object.assign(page, newPage);
          } catch (recoveryErr) {
            console.warn(`Browser: Recovery failed: ${recoveryErr.message}`);
          }
        }
        continue;
      }
      
      // For timeout errors, just retry
      if (err.message.includes('timeout') || err.message.includes('Timeout')) {
        console.warn(`Browser: Timeout on attempt ${attempt + 1}, retrying...`);
        continue;
      }
      
      // For other errors, throw immediately
      throw err;
    }
  }

  throw lastError;
}

/**
 * Apply anti-detection overrides to a page before navigation.
 * Hides common headless Chrome indicators that some sites check.
 */
async function applyStealthOverrides(page) {
  await page.evaluateOnNewDocument(() => {
    // Hide webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Fake plugins array (headless has 0 plugins)
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ],
    });

    // Fake languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

    // Remove chrome.runtime that automation adds
    if (window.chrome) {
      window.chrome.runtime = undefined;
    }
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { launchBrowser, resilientGoto, applyStealthOverrides };

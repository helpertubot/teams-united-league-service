/**
 * Debug: inspect the Falls Little League standings table structure
 * Run on deploy VM: node scripts/debug-falls-ll.js
 */
const { launchBrowser } = require('../browser');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  console.log('Navigating...');
  await page.goto('https://tshq.bluesombrero.com/Default.aspx?tabid=2462466', {
    waitUntil: 'networkidle2', timeout: 60000,
  });
  await sleep(2000);

  // Select 2026 Baseball
  const progSel = await page.evaluate(() => {
    for (const el of document.querySelectorAll('select'))
      if (el.id.includes('dropDownSeasons')) return '#' + el.id;
    return null;
  });
  console.log('Program dropdown:', progSel);

  await page.evaluate((sel) => {
    const d = document.querySelector(sel);
    d.value = '130176273'; // 2026 Baseball
    d.dispatchEvent(new Event('change', { bubbles: true }));
    if (d.onchange) d.onchange();
  }, progSel);
  try { await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }); }
  catch (e) { await sleep(3000); }
  await sleep(1000);

  // Select first division (A Baseball)
  const divSel = await page.evaluate(() => {
    for (const el of document.querySelectorAll('select'))
      if (el.id.includes('dropDownDivisions')) return '#' + el.id;
    return null;
  });
  const divOpts = await page.evaluate((sel) => {
    const d = document.querySelector(sel);
    return Array.from(d.options).map(o => ({ v: o.value, t: o.text }));
  }, divSel);
  console.log('Divisions:', JSON.stringify(divOpts));

  const firstDiv = divOpts.find(o => o.v && o.v !== '0' && o.t !== 'Division');
  console.log('Selecting division:', firstDiv);

  await page.evaluate((sel, val) => {
    const d = document.querySelector(sel);
    d.value = val;
    d.dispatchEvent(new Event('change', { bubbles: true }));
    if (d.onchange) d.onchange();
  }, divSel, firstDiv.v);
  try { await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }); }
  catch (e) { await sleep(3000); }
  await sleep(2000);

  // Select first schedule if available
  const schedSel = await page.evaluate(() => {
    for (const el of document.querySelectorAll('select'))
      if (el.id.includes('dropDownEvents')) return '#' + el.id;
    return null;
  });
  if (schedSel) {
    const schedOpts = await page.evaluate((sel) => {
      const d = document.querySelector(sel);
      return Array.from(d.options).map(o => ({ v: o.value, t: o.text }));
    }, schedSel);
    console.log('Schedules:', JSON.stringify(schedOpts));
    const firstSched = schedOpts.find(s => s.v && s.v !== '0' && s.t !== 'Schedule');
    if (firstSched) {
      console.log('Selecting schedule:', firstSched);
      await page.evaluate((sel, val) => {
        const d = document.querySelector(sel);
        d.value = val;
        d.dispatchEvent(new Event('change', { bubbles: true }));
        if (d.onchange) d.onchange();
      }, schedSel, firstSched.v);
      try { await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }); }
      catch (e) { await sleep(3000); }
      await sleep(2000);
    }
  }

  // Dump all tables on the page
  const tableInfo = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    return Array.from(tables).map((t, i) => {
      const allRows = t.querySelectorAll('tr');
      const firstRow = allRows[0];
      const cells = firstRow
        ? Array.from(firstRow.querySelectorAll('th, td')).map(c => ({
            tag: c.tagName,
            text: c.textContent.trim().substring(0, 30),
            hasInput: !!c.querySelector('input'),
          }))
        : [];

      // Check second row too
      const secondRow = allRows[1];
      const secondCells = secondRow
        ? Array.from(secondRow.querySelectorAll('th, td')).map(c => ({
            tag: c.tagName,
            text: c.textContent.trim().substring(0, 30),
            hasInput: !!c.querySelector('input'),
          }))
        : [];

      return {
        index: i,
        className: t.className.substring(0, 80),
        id: t.id ? t.id.substring(0, 80) : '',
        rowCount: allRows.length,
        hasThead: !!t.querySelector('thead'),
        hasTbody: !!t.querySelector('tbody'),
        hasStandingInput: !!t.querySelector('.standingTextbox, input[class*="standing"]'),
        firstRowCells: cells,
        secondRowCells: secondCells,
      };
    });
  });

  console.log('\n=== TABLES ON PAGE ===');
  for (const t of tableInfo) {
    console.log(`\nTable ${t.index}: class="${t.className}" id="${t.id}"`);
    console.log(`  rows=${t.rowCount} thead=${t.hasThead} tbody=${t.hasTbody} standingInput=${t.hasStandingInput}`);
    console.log('  Row 0:', JSON.stringify(t.firstRowCells));
    if (t.secondRowCells.length > 0) {
      console.log('  Row 1:', JSON.stringify(t.secondRowCells));
    }
  }

  // Also check: does the page have "Standings" text visible?
  const standingsVisible = await page.evaluate(() => {
    const h4s = document.querySelectorAll('h4, h3, h2');
    return Array.from(h4s).map(h => h.textContent.trim()).filter(t => t.toLowerCase().includes('standing'));
  });
  console.log('\nStandings headers:', standingsVisible);

  await browser.close();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

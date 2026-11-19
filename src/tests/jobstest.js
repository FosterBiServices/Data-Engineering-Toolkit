// Saved work on every tool page (review, Nov 2026): save, a second job, switch, unsaved warning, delete, download/open a file, kept on Clear entries.
const { open } = require('./lib');
const fs = require('fs'), os = require('os'), path = require('path');
let fails = 0; const ok = (l, c, x) => { console.log((c ? 'ok   ' : 'FAIL ') + l + (x ? ' ' + x : '')); if (!c) fails++; };
const PAGES = [['adf-pipeline-generator.html', 'dea.', '[data-k=domain]'], ['python-notebook-generator.html', 'dep.', '[data-k=entity]'], ['python-script-generator.html', 'des.', '[data-k=name]']];
(async () => {
  for (const [file, P, box] of PAGES) {
    console.log('== ' + file);
    const { browser, page, errors } = await open(file, { essentials: true });
    const val = () => page.inputValue(box);
    await page.click('#startOwn'); await page.fill(box, 'alpha'); await page.waitForTimeout(100);
    await page.fill('#jobName', 'Job A'); await page.click('#jobSave');
    ok('saved A', /Saved as Job A/.test(await page.textContent('#jobMsg')));
    await page.click('#jobNew'); await page.waitForLoadState('load'); await page.waitForTimeout(150);
    ok('New: empty page, no current job', (await page.inputValue('#jobName')) === '' && (await val()) === '');
    await page.fill(box, 'beta'); await page.waitForTimeout(100);
    await page.fill('#jobName', 'Job B'); await page.click('#jobSave');
    ok('list holds both', (await page.$$eval('#jobList option', o => o.map(x => x.value).filter(Boolean))).join() === 'Job A,Job B');
    await page.selectOption('#jobList', 'Job A'); await page.waitForLoadState('load'); await page.waitForTimeout(150);
    ok('opens A', (await val()) === 'alpha' && (await page.inputValue('#jobName')) === 'Job A', await val());
    await page.fill(box, 'alpha changed'); await page.waitForTimeout(100);
    await page.selectOption('#jobList', 'Job B');
    ok('unsaved change asks first', /isn’t saved/.test(await page.textContent('#jobMsg')));
    await page.click('#jobMsg [data-jn]'); ok('cancel keeps the page', (await val()) === 'alpha changed');
    await page.click('#jobSave'); ok('save overwrites A without asking', /Saved as Job A/.test(await page.textContent('#jobMsg')));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#jobDown')]);
    const f = path.join(os.tmpdir(), 'job_' + P + 'json'); await dl.saveAs(f);
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    ok('download holds the setup', d.name === 'Job A' && d.tool === file.replace('.html', '') && !!d.cfg);
    await page.click('#jobDel'); await page.click('#jobMsg [data-jy]');
    ok('delete removes it, page stays', (await page.$$eval('#jobList option', o => o.map(x => x.value).filter(Boolean))).join() === 'Job B' && (await val()) === 'alpha changed');
    await page.setInputFiles('#jobFile', f); await page.waitForTimeout(150);
    ok('open a file asks first (the page isn’t saved)', /isn’t saved/.test(await page.textContent('#jobMsg')));
    await page.click('#jobMsg [data-jy]'); await page.waitForLoadState('load'); await page.waitForTimeout(200);
    ok('open a file brings it back', (await page.$$eval('#jobList option', o => o.map(x => x.value).filter(Boolean))).join() === 'Job A,Job B' && (await val()) === 'alpha changed');
    const other = path.join(os.tmpdir(), 'wrong.json'); fs.writeFileSync(other, JSON.stringify({ tool: 'something-else', cfg: {} }));
    await page.setInputFiles('#jobFile', other); await page.waitForTimeout(150); ok('a file from another page is refused', /wasn’t saved from this page/.test(await page.textContent('#jobMsg')));
    await page.click('#clearEntries'); await page.click('#clearYes'); await page.reload();
    ok('Clear entries keeps saved work', (await page.$$eval('#jobList option', o => o.map(x => x.value).filter(Boolean))).length === 2 && (await val()) === '');
    await page.setViewportSize({ width: 390, height: 800 });
    ok('390px overflow', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) === 0);
    ok('no page errors', !errors.length, JSON.stringify(errors));
    await browser.close();
  }
  console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();

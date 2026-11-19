// Essentials / All settings on the ADF Build tab (review, Nov 2026): optional sections hidden, named when in use, values kept.
const { open } = require('./lib');
let fails = 0; const ok = (l, c, x) => { console.log((c ? 'ok   ' : 'FAIL ') + l + (x ? ' ' + x : '')); if (!c) fails++; };
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html', { essentials: true });
  const vis = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; }, sel);
  ok('opens in Essentials', await page.evaluate(() => document.body.classList.contains('essentials')));
  ok('datasets, variables, logging hidden', !(await vis('#dsSub')) && !(await vis('#varSub')) && !(await vis('#logSub')));
  ok('bronze and layers shown', await vis('[data-k="med.bronzeFolder"]') && await vis('#stageList'));
  const sum = await page.textContent('#advSummary');
  ok('summary names hidden settings in use', /object list on/.test(sum) && /archive on/.test(sum), sum);
  const pipe1 = await page.evaluate(() => document.getElementById('plView').textContent);
  await page.click('#advSummary [data-advshow]');
  ok('Show all settings shows them', await vis('#dsSub') && await vis('#logSub'));
  ok('same pipeline either way', pipe1 === await page.evaluate(() => document.getElementById('plView').textContent));
  await page.reload();
  ok('choice kept after reload', await page.evaluate(() => !document.body.classList.contains('essentials') && document.querySelector('[data-view][value=all]').checked));
  await page.click('label:has(input[data-view][value=essentials])');
  await page.click('#startOwn');
  ok('blank: says datasets are created', /created for you/.test(await page.textContent('#advSummary')));
  await page.setViewportSize({ width: 390, height: 800 });
  ok('390px overflow', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) === 0);
  ok('no page errors', !errors.length, JSON.stringify(errors));
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();

// Script generator: several filters joined with AND / OR, and keeping what the filters remove.
const { open } = require('./lib');
(async () => {
  const { browser, page, errors } = await open('python-script-generator.html');
  const T = async (label, fn) => console.log(label, JSON.stringify(await page.evaluate(fn)));
  await T('example filter came over as a list', () => [...document.querySelectorAll('#filterList input[data-f=when]')].map(i => i.value));
  await page.click('#addFilter'); await page.fill('#filterList [data-i="1"] input[data-f=when]', 'order_date >= "2026-06-01"'); await page.fill('#filterList [data-i="1"] input[data-f=label]', 'on or after 1 June');
  await page.click('#addFilter'); await page.fill('#filterList [data-i="2"] input[data-f=when]', 'amount > 1000'); await page.selectOption('#filterList [data-i="2"] select[data-f=join]', 'or');
  await T('logic shown (expect (A AND B) OR C)', () => document.getElementById('filterLogic').textContent);
  await page.check('[data-k=keepRemoved]');
  await T('script: combine lines and sheets', () => { const c = document.getElementById('pyView') ? document.getElementById('pyView').textContent : document.querySelector('[data-pane] pre').textContent; return [/keep = keep & PASSES\["on or after 1 June"\]/.test(c), /keep = keep \| PASSES\["amount > 1000"\]/.test(c), /sheet_name="Filtered out"/.test(c), /sheet_name="Original"/.test(c)]; });
  // renaming a column carries into the filters
  const idx = await page.evaluate(() => [...document.querySelectorAll('#mapBody tr')].findIndex(r => (r.querySelector('[data-f=name]') || {}).value === 'amount'));
  await page.fill('#mapBody tr[data-i="' + idx + '"] input[data-f=name]', 'order_amount');
  await T('rename reaches the filter', () => document.querySelector('#filterList [data-i="2"] input[data-f=when]').value);
  await page.click('#addFilter'); await page.click('#filterList [data-i="0"] [data-del]');
  await T('after removing the first (and an empty new one), the old second leads', () => [...document.querySelectorAll('#filterList [data-i]')].map(r => (r.querySelector('select') ? r.querySelector('select').value + ' ' : '') + r.querySelector('input').value));
  await page.reload();
  await T('kept after reload', () => [document.querySelectorAll('#filterList [data-i]').length, document.querySelector('[data-k=keepRemoved]').checked]);
  await page.setViewportSize({ width: 390, height: 800 });
  await T('390px overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  await (await page.$('#filterList')).screenshot({ path: '/tmp/filters390.png' });
  await page.setViewportSize({ width: 1100, height: 900 });
  await (await (await page.$('#filterList')).evaluateHandle(e => e.closest('.sub'))).asElement().screenshot({ path: '/tmp/filters.png' });
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

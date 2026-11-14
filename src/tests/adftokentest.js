// Token bar: shows under a folder or file name box while it has focus, lists what the box accepts with the example's
// values (your variables included), inserts at the cursor, and shows what the pattern becomes.
const { open } = require('./lib');
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  const T = async (label, fn) => console.log(label, JSON.stringify(await page.evaluate(fn)));
  await page.click('#addVar'); await page.fill('[data-vi="0"] [data-vf=name]', 'your_bronze_path'); await page.fill('[data-vi="0"] [data-vf=value]', 'yourproject/bronze/');
  await page.fill('[data-k="med.example"]', 'Customer-Orders.csv');
  await page.click('[data-k="med.bronzeFolder"]');
  await T('bar shown under the bronze folder', () => { const b = document.getElementById('tokBar'); return [!b.hidden, b.previousElementSibling && b.previousElementSibling.textContent.trim().slice(0, 20)]; });
  await T('chips', () => [...document.querySelectorAll('#tokBar .tokchip')].map(c => c.textContent));
  await page.fill('[data-k="med.bronzeFolder"]', ''); await page.click('[data-tok="{var:your_bronze_path}"]'); await page.click('[data-tok="{name}"]');
  await T('after two clicks: value, result, focus kept', () => [document.querySelector('[data-k="med.bronzeFolder"]').value, document.getElementById('tokRes').textContent, document.activeElement.dataset.k]);
  await page.click('[data-k="med.container"]');
  await T('container: run scope has no object/file/name', () => [document.querySelector('#tokBar .tokhead').textContent.slice(0, 30), [...document.querySelectorAll('#tokBar [data-tok]')].map(c => c.dataset.tok).filter(t => /object|file\}|name\}/.test(t))]);
  await page.fill('[data-k="med.container"]', '{object}');
  await T('a token that does not belong shows in the result', () => document.getElementById('tokRes').textContent);
  await page.fill('[data-k="med.container"]', '');
  const sp = '[data-pkey="s0"][data-pi="0"] ';
  await page.selectOption(sp + 'select[data-pf=use]', 'text'); await page.click(sp + 'input[data-pf=value]');
  await T('folder-loop parameter: meanings', () => [document.querySelector('#tokBar .tokhead').textContent.slice(0, 40), [...document.querySelectorAll('#tokBar .tokchip')].slice(0, 3).map(c => c.textContent)]);
  await page.click('[data-tok="{object}"]');
  await T('parameter result', () => document.getElementById('tokRes').textContent);
  await page.click('h3:text-is("Datasets")'); await page.waitForTimeout(50);
  await T('hidden after leaving', () => [document.getElementById('tokBar').hidden, document.activeElement.tagName + ' ' + (document.activeElement.dataset.pf || document.activeElement.id)]);
  await page.setViewportSize({ width: 390, height: 800 }); await page.click('[data-k="med.bronzeFile"]');
  await T('390px overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  const el = await page.$('[data-k="med.bronzeFile"]'); const lab = await el.evaluateHandle(e => e.closest('.qgrid'));
  await lab.asElement().screenshot({ path: '/tmp/tokbar390.png' });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.click('[data-k="med.bronzeFolder"]');
  await (await (await page.$('[data-k="med.bronzeFolder"]')).evaluateHandle(e => e.closest('#medCopy'))).asElement().screenshot({ path: '/tmp/tokbar.png' });
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

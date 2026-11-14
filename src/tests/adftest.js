const { open } = require('./lib');
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  const pick = (n, v) => page.click('label:has(input[name=' + n + '][value=' + v + '])');
  const T = async (label, fn) => console.log(label, JSON.stringify(await page.evaluate(fn)));
  await T('example banner shown (expect true)', () => !document.getElementById('exampleBanner').hidden);
  await T('pipeline name (expect pl_sales_orders_incremental)', () => JSON.parse(document.getElementById('plView').textContent).name);
  await T('activities (expect 9)', () => document.querySelectorAll('#flowBody tr').length);
  await T('ai review rows (expect 1 Replaces)', () => [...document.querySelectorAll('#aiBody tr')].map(r => r.children[1].textContent));
  await T('stats', () => document.getElementById('outStats').textContent);
  await page.screenshot({ path: __dirname + '/adf_example.png', fullPage: true });
  // check tab
  await page.click('#modeBar [data-tab=check]');
  await T('check findings (expect high ones)', () => [...document.querySelectorAll('#findBody tr')].map(r => r.children[0].textContent + ' ' + r.children[1].textContent + ': ' + r.children[3].textContent.slice(0, 70)));
  await page.screenshot({ path: __dirname + '/adf_check.png', fullPage: true });
  await page.click('#modeBar [data-tab=build]');
  // typing in a main box replaces the example
  await page.click('[data-k="src.table"]'); await page.keyboard.type('Customer');
  await T('after typing: table, goal, schema, filter (expect Customer and blanks)', () => [document.querySelector('[data-k="src.table"]').value, document.querySelector('[data-k="goal"]').value, document.querySelector('[data-k="schemaText"]').value, document.querySelector('[data-k="filter"]').value]);
  await T('banner hidden (expect true)', () => document.getElementById('exampleBanner').hidden);
  await T('brief messages', () => [...document.querySelectorAll('#briefMsg .msg')].map(m => m.className + ': ' + m.textContent.slice(0, 80)));
  // full load to parquet
  await pick('loadType', 'full'); await pick('tgtKind', 'adls');
  await T('full to raw: activities', () => [...document.querySelectorAll('#flowBody tr')].map(r => r.children[1].textContent));
  await T('placeholders', () => document.getElementById('phMsg').textContent);
  // files
  await pick('srcKind', 'files'); await page.fill('[data-k="src.folder"]', 'sales/orders');
  await page.evaluate(() => { document.getElementById('nbWrap').open = true; });
  await page.fill('[data-k="notebooks"]', '/Shared/medallion/nb_bronze_orders\n/Shared/medallion/nb_silver_orders');
  await T('files: activities', () => [...document.querySelectorAll('#flowBody tr')].map(r => r.children[1].textContent.trim()));
  await T('own check message (expect empty)', () => document.getElementById('outMsg').textContent);
  await page.reload();
  await T('after reload: folder kept (expect sales/orders)', () => document.querySelector('[data-k="src.folder"]').value);
  await page.click('#clearEntries'); await page.click('#clearYes'); await page.reload();
  await T('after clear + reload: blank, no banner (expect ["",true])', () => [document.querySelector('[data-k="src.table"]').value, document.getElementById('exampleBanner').hidden]);
  // mobile width
  await page.setViewportSize({ width: 390, height: 800 }); await page.evaluate(() => localStorage.clear()); await page.reload();
  await T('390px: horizontal overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();

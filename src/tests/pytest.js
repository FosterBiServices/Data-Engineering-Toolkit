const { open } = require('./lib');
(async () => {
  const { browser, page, errors } = await open('python-notebook-generator.html');
  const T = async (label, fn) => console.log(label, JSON.stringify(await page.evaluate(fn)));
  await T('example: banner, layer, notebook (expect true silver nb_silver_orders)', () => [!document.getElementById('exampleBanner').hidden, document.querySelector('#layerBar [aria-selected=true]').dataset.layer, document.getElementById('codeTitle').textContent]);
  await T('stats', () => document.getElementById('outStats').textContent);
  await T('ai rows', () => [...document.querySelectorAll('#aiBody tr')].map(r => r.children[0].textContent + ' ' + r.children[2].textContent));
  await page.screenshot({ path: __dirname + '/py_silver.png', fullPage: true });
  await page.click('#layerBar [data-layer=gold]');
  await T('gold: notebook, grain chips on', () => [document.getElementById('codeTitle').textContent, [...document.querySelectorAll('#grainChips [aria-pressed=true]')].map(b => b.dataset.grain)]);
  await page.screenshot({ path: __dirname + '/py_gold.png', fullPage: true });
  // remove a grain column the rebuild needs: error, then add back
  await page.click('#grainChips [data-grain=order_date]');
  await T('without order_date: messages', () => [...document.querySelectorAll('#setupMsg .msg.err')].map(m => m.textContent));
  await page.click('#grainChips [data-grain=order_date]');
  await page.selectOption('#rebuildCol', 'order_date');
  await T('restored: output shown', () => !document.getElementById('outWrap').hidden);
  await page.click('#layerBar [data-layer=bronze]');
  await T('bronze notebook first line', () => document.getElementById('codeView').textContent.split('\n')[3]);
  await page.click('#layerBar [data-layer=silver]');
  // edit a mapping name, check it flows to the code
  await page.fill('#mapBody tr[data-i="5"] input[data-f=name]', 'region');
  await T('renamed in code (expect true)', () => document.getElementById('codeView').textContent.includes('.alias("region")'));
  await page.click('#addRule'); await T('empty rule blocks output (expect true)', () => document.getElementById('outWrap').hidden);
  await page.click('#ruleList .rrow:last-child [data-del]');
  await page.reload(); await T('after reload: rename kept (expect region)', () => document.querySelector('#mapBody tr[data-i="5"] input[data-f=name]').value);
  // own entry replaces the example
  await page.click('[data-k=entity]'); await page.keyboard.type('customers');
  await T('own entry: entity, mapping rows, banner hidden', () => [document.querySelector('[data-k=entity]').value, document.querySelectorAll('#mapBody tr[data-i]').length, document.getElementById('exampleBanner').hidden]);
  await page.fill('#schemaIn', 'customer_id bigint\nname string\nemail string\nmodified_at timestamp\nis_active boolean');
  await T('after schema: key guessed, order col', () => [[...document.querySelectorAll('#mapBody input[data-f=key]')].map(x => x.checked), document.getElementById('orderCol').value, !document.getElementById('outWrap').hidden]);
  await page.click('#layerBar [data-layer=gold]'); await page.click('#useSilver');
  await T('gold from silver columns', () => [...document.querySelectorAll('#grainChips [data-grain]')].map(b => b.dataset.grain));
  await page.setViewportSize({ width: 390, height: 800 });
  await T('390px overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  await page.click('#layerBar [data-layer=silver]');
  await T('390px silver overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  await page.click('#clearEntries'); await page.click('#clearYes'); await page.reload();
  await T('after clear: blank (expect "",true)', () => [document.querySelector('[data-k=entity]').value, document.getElementById('exampleBanner').hidden]);
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

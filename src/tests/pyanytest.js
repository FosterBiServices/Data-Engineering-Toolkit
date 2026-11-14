// Notebook generator, "Any object": one silver and one gold notebook for every object the pipeline sends.
const { open } = require('./lib');
(async () => {
  const { browser, page, errors } = await open('python-notebook-generator.html');
  const T = async (label, fn) => console.log(label, JSON.stringify(await page.evaluate(fn)));
  await page.click('#startOwn').catch(() => {});
  await page.selectOption('[data-k=scope]', 'any'); await page.fill('[data-k=subject]', 'sales');
  await T('step 2 hidden, entity hidden, any options shown', () => [document.querySelector('section[aria-labelledby="s2"]').hidden, document.getElementById('entityBox').hidden, document.getElementById('setAny').hidden]);
  await page.click('#layerBar [data-layer=silver]');
  await T('silver notebook', () => [document.getElementById('codeTitle').textContent, /def clean_name/.test(document.getElementById('codeView').textContent), document.getElementById('outMsg').textContent]);
  await page.uncheck('[data-k="any.dropDupRows"]');
  await T('option off reaches the notebook', () => /dropDuplicates\(\)/.test(document.getElementById('codeView').textContent));
  await T('ADF parameters', () => document.getElementById('adfView').textContent.split('\n').slice(4, 12));
  await page.click('#layerBar [data-layer=gold]');
  await T('gold notebook', () => [document.getElementById('codeTitle').textContent, /_ingest_ts.*> F.lit\(last\)/.test(document.getElementById('codeView').textContent)]);
  await page.click('#layerBar [data-layer=bronze]');
  await T('bronze refused for any object', () => document.getElementById('briefMsg') ? document.getElementById('briefMsg').textContent : [...document.querySelectorAll('.msg.err')].map(m => m.textContent).join(' | '));
  await page.click('#layerBar [data-layer=silver]'); await page.reload();
  await T('kept after reload', () => [document.querySelector('[data-k=scope]').value, document.querySelector('[data-k="any.dropDupRows"]').checked, document.getElementById('codeTitle').textContent]);
  await page.setViewportSize({ width: 390, height: 800 });
  await T('390px overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

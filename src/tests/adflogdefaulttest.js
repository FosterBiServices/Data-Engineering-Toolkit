// Choosing "My own Databricks notebook" fills in the usual logging rows for the bronze, silver and gold pattern,
// keeps rows the user already changed, and leaves the plain set for the other patterns.
const { open } = require('./lib');
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  const T = async (label, fn) => console.log(label, JSON.stringify(await page.evaluate(fn)));
  const rows = () => [...document.querySelectorAll('#logRows [data-logrow]')].map(r => r.querySelector('[data-lf=name]').value + '=' + r.querySelector('select[data-lf=use]').value + (r.querySelector('input[data-lf=value]') ? ':' + r.querySelector('input[data-lf=value]').value : ''));
  await page.selectOption('#logMethod', 'notebook');
  await T('medallion defaults (expect 8 rows)', rows);
  await T('no red items', () => [...document.querySelectorAll('#logSub .msg.err')].map(m => m.textContent));
  await page.selectOption('#logMethod', 'none'); await page.selectOption('#logMethod', 'notebook');
  await T('switching away and back keeps them', rows);
  await page.fill('#logRows [data-logrow="0"] input[data-lf=name]', 'my_id'); await page.selectOption('#logMethod', 'sp_own'); await page.selectOption('#logMethod', 'notebook');
  await T('an edited row is kept (expect my_id first)', rows);
  await page.click('#clearSetup').catch(() => {}); 
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

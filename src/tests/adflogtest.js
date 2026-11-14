// Logging values: the short list, "Output of an earlier step" pickers, and real values in the JSON.
const fs = require('fs'), { open } = require('./lib');
const DIR = process.env.SAMPLES || '/home/claude/samples';
if (!fs.existsSync(DIR)) { console.log('adflogtest skipped: no samples folder (set SAMPLES)'); process.exit(0); }
const CSV = fs.readFileSync(DIR + '/ds_sample1.json', 'utf8');
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  const T = async (label, fn) => console.log(label, JSON.stringify(await page.evaluate(fn)));
  const pick = (n, v) => page.click('label:has(input[name=' + n + '][value=' + v + '])');
  await pick('srcKind', 'files');
  await page.fill('[data-k="src.folder"]', 'yourproject/incoming/yourfolder'); await page.fill('[data-k="src.ends"]', '.csv'); await page.fill('[data-k="src.dest"]', 'yourproject/yourfolder');
  for (const k of ['src', 'tgt']) { await pick('dsMode' + k, 'own'); await page.fill('[data-dsjson=' + k + ']', CSV); }
  await page.selectOption('#logMethod', 'notebook'); await page.fill('[data-l=nbPath]', '/Shared/yourproject/log_run');
  await T('the list in Copy or move files', () => [...document.querySelectorAll('#logRows [data-logrow="0"] select[data-lf=use] option')].map(o => o.textContent));
  await page.click('#addLogParam'); const r = '#logRows [data-logrow="4"] ';
  await page.fill(r + 'input[data-lf=name]', 'rows_written'); await page.selectOption(r + 'select[data-lf=use]', 'step');
  await T('steps offered', () => [...document.querySelectorAll('#logRows [data-logrow="4"] select[data-lf=stepAct] option')].map(o => o.textContent));
  await page.selectOption(r + 'select[data-lf=stepAct]', { index: 1 });
  await T('outputs offered for a Copy', () => [...document.querySelectorAll('#logRows [data-logrow="4"] select[data-lf=stepField] option')].map(o => o.textContent));
  await page.selectOption(r + 'select[data-lf=stepField]', 'filesWritten');
  await page.click('#addLogParam'); const r2 = '#logRows [data-logrow="5"] ';
  await page.fill(r2 + 'input[data-lf=name]', 'detail'); await page.selectOption(r2 + 'select[data-lf=use]', 'step'); await page.selectOption(r2 + 'select[data-lf=stepAct]', { index: 1 }); await page.selectOption(r2 + 'select[data-lf=stepField]', '=');
  await page.fill(r2 + 'input[data-lf=stepPath]', 'dataWritten');
  await page.click('#addLogParam'); const r3 = '#logRows [data-logrow="6"] ';
  await page.fill(r3 + 'input[data-lf=name]', 'x'); await page.selectOption(r3 + 'select[data-lf=use]', 'expr'); await page.fill(r3 + 'input[data-lf=value]', "@string('abc')");
  await T('success log parameters', () => { const p = JSON.parse(document.getElementById('plView').textContent); return p.properties.activities.find(a => a.name === 'nb_log_success').typeProperties.baseParameters; });
  await T('own checks (expect empty)', () => document.getElementById('outMsg').textContent);
  await page.reload();
  await T('after reload: step choice kept', () => [document.querySelector('#logRows [data-logrow="4"] select[data-lf=stepAct]').value, document.querySelector('#logRows [data-logrow="4"] select[data-lf=stepField]').value, document.querySelector('#logRows [data-logrow="5"] input[data-lf=stepPath]').value]);
  await pick('srcKind', 'medallion');
  await T('medallion list adds the loop values', () => [...document.querySelectorAll('#logRows [data-logrow="0"] select[data-lf=use] option')].map(o => o.textContent).slice(7, 11));
  await page.setViewportSize({ width: 390, height: 800 }); await pick('srcKind', 'files');
  await T('390px overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

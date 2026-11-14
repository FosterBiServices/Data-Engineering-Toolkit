// The user's own setup: their datasets, their logging notebook, a plain copy, and the checker's context and fixes.
const { open } = require('./lib');
const DS = (name, type) => JSON.stringify({ name, properties: { linkedServiceName: { referenceName: 'ls_adls_dev', type: 'LinkedServiceReference' }, parameters: { p_container: { type: 'string' }, p_directory: { type: 'string' }, p_name: { type: 'string' }, p_env: { type: 'string' } }, type, typeProperties: { location: { type: 'AzureBlobFSLocation', fileName: { value: '@dataset().p_name', type: 'Expression' }, folderPath: { value: '@dataset().p_directory', type: 'Expression' }, fileSystem: { value: '@dataset().p_container', type: 'Expression' } } } } }, null, 2);
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  const T = async (label, fn, arg) => console.log(label, JSON.stringify(await page.evaluate(fn, arg)));
  const pick = (n, v) => page.click('label:has(input[name=' + n + '][value=' + v + '])');
  await page.click('#startOwn');
  await pick('srcKind', 'files');
  await T('blank defaults: after, alert (expect leave none)', () => [document.querySelector('[data-k="src.after"]').value, document.querySelector('[data-k=alert]').value]);
  await page.fill('[data-k="src.container"]', 'landing'); await page.fill('[data-k="src.folder"]', 'sales/orders'); await page.fill('[data-k="src.dest"]', 'bronze/orders');
  await page.fill('[data-k="tgt.container"]', 'datalake');
  await pick('dsModesrc', 'own'); await page.fill('[data-dsjson=src]', DS('ds_adls_landing', 'Binary'));
  await T('source dataset read', () => [document.getElementById('dsInfosrc').textContent, [...document.querySelectorAll('#dsMapsrc select')].map(s => s.dataset.p + '=' + s.value)]);
  await pick('dsModetgt', 'own'); await page.fill('[data-dsjson=tgt]', DS('ds_adls_lake', 'Binary'));
  await page.selectOption('#dsMaptgt select[data-p=p_env]', 'fixed'); await page.fill('#dsMaptgt input[data-dsfixed]', 'dev');
  await T('fixed value kept while typing (expect dev)', () => document.querySelector('#dsMaptgt input[data-dsfixed]').value);
  // logging with my own notebook
  await page.selectOption('#logMethod', 'notebook'); await page.fill('[data-l=nbPath]', '/Shared/util/nb_log_run'); await page.fill('[data-l=nbLs]', 'ls_databricks_dev');
  await page.fill('#logRows [data-logrow="0"] input[data-lf=name]', 'pipeline');
  await page.click('#logRows [data-logrow="7"] [data-logdel]');
  await page.click('#addLogParam'); await page.fill('#logRows [data-logrow="7"] input[data-lf=name]', 'environment'); await page.fill('#logRows [data-logrow="7"] input[data-lf=value]', 'dev');
  await T('flow', () => [...document.querySelectorAll('#flowBody tr')].map(r => r.children[1].textContent.trim() + ' [' + r.children[2].textContent + ']'));
  await T('placeholders and own-check message (expect both empty)', () => [document.getElementById('phMsg').textContent, document.getElementById('outMsg').textContent]);
  await T('copy activity uses my datasets and parameters', () => { const p = JSON.parse(document.getElementById('plView').textContent), cp = p.properties.activities[2].typeProperties.activities[0]; return [cp.inputs[0].referenceName, cp.inputs[0].parameters.p_directory, cp.outputs[0].referenceName, cp.outputs[0].parameters, p.properties.activities[3].typeProperties]; });
  await T('datasets tab says reuse; SQL tab; objects', () => [document.getElementById('dsList').textContent.slice(0, 80), document.getElementById('sqlView').textContent.trim(), [...document.querySelectorAll('#objBody tr')].map(r => r.children[0].textContent + ':' + r.children[1].textContent + ':' + r.children[2].textContent)]);
  await page.screenshot({ path: __dirname + '/adf_own.png', fullPage: true });
  await page.reload();
  await T('after reload: datasets, mapping and logging kept', () => [document.getElementById('dsInfosrc').textContent.slice(0, 30), document.querySelector('#dsMaptgt input[data-dsfixed]').value, document.getElementById('logMethod').value, document.querySelectorAll('#logRows [data-logrow]').length, document.querySelector('#logRows [data-logrow="7"] input[data-lf=value]').value]);
  // checker: paste the pipeline the page just made minus its failure path end
  const json = await page.evaluate(() => { const p = JSON.parse(document.getElementById('plView').textContent); p.properties.activities = p.properties.activities.filter(a => a.type !== 'Fail'); return JSON.stringify(p); });
  await page.click('#modeBar [data-tab=check]'); await page.fill('#checkInput', json);
  const rows = () => [...document.querySelectorAll('#findBody tr')].map(r => r.children[0].textContent + ' | ' + r.children[2].textContent + ' | ' + r.children[3].textContent.slice(0, 60) + ' ... ' + (r.querySelector('.fix') ? 'FIX: ' + r.querySelector('.fix').textContent.slice(12, 90) : 'no fix'));
  await T('findings, run by trigger', rows);
  await page.selectOption('#runBy', 'manual'); await T('findings, run by hand', rows);
  await page.click('#offChips [data-off="Failure path"]'); await T('Failure path off (expect 1 low: environment = dev typed in)', () => [document.querySelectorAll('#findBody tr').length, document.getElementById('checkStats').textContent]);
  await page.click('#offChips [data-off="Failure path"]');
  await T('fix prompt: ends properly, has JSON', () => { const t = document.getElementById('fixView').textContent; return [t.length, /=== END OF PROMPT ===\s*$/.test(t), t.includes('"nb_log_failure"')]; });
  await page.setViewportSize({ width: 390, height: 800 }); await T('390px check tab overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  await page.click('#modeBar [data-tab=build]'); await T('390px build tab overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

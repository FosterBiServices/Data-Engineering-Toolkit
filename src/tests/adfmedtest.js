// The owner's process set up through the page, with his own datasets and logging notebook (generic names elsewhere).
const fs = require('fs'), { open } = require('./lib');
// The owner's datasets and pipelines are not in the repo (client names). Point SAMPLES at a folder holding them.
const DIR = process.env.SAMPLES || '/home/claude/samples';
if (!fs.existsSync(DIR)) { console.log('adfmedtest skipped: no samples folder (set SAMPLES)'); process.exit(0); }
const S = f => fs.readFileSync(DIR + '/' + f + '.json', 'utf8');
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  const T = async (label, fn, a) => console.log(label, JSON.stringify(await page.evaluate(fn, a)));
  const pick = (n, v) => page.click('label:has(input[name=' + n + '][value=' + v + '])');
  await T('example: kind, preview', () => [document.querySelector('input[name=srcKind]:checked').value, document.getElementById('medPreview').innerText.split('\n').slice(0, 4)]);
  await page.screenshot({ path: __dirname + '/adf_med_example.png', fullPage: true });
  await page.click('#startOwn');
  await T('blank: medallion is the default, nothing assumed', () => [document.querySelector('input[name=srcKind]:checked').value, document.querySelector('[data-k="med.lookup.on"]').checked, document.querySelectorAll('#stageList [data-si]').length]);
  await page.fill('[data-k="src.container"]', 'yourcontainer'); await page.fill('[data-k="src.folder"]', 'yourproject/landing'); await page.fill('[data-k="src.ends"]', '.csv');
  await page.fill('#medSub [data-k="med.ls"]', 'ls_yourstorage'); await page.fill('#medSub [data-k=nbLs]', 'ls_databricks');
  // datasets: his own
  for (const [k, f] of [['list', 'ds_sample1'], ['sink', 'ds_sample3'], ['meta', 'ds_sample2']]) { await pick('dsMode' + k, 'own'); await page.fill('[data-dsjson=' + k + ']', S(f)); }
  await T('datasets read', () => ['list', 'sink', 'meta'].map(k => document.getElementById('dsInfo' + k).innerText.replace(/\n/g, ' ')));
  // objects and bronze
  await page.check('[data-k="med.lookup.on"]'); await page.fill('[data-k="med.lookup.nbPath"]', '/Shared/platform/object_list');
  await page.fill('[data-k="med.bronzeFolder"]', 'yourproject/bronze/{object}'); await page.fill('[data-k="med.bronzeFile"]', '{object}.parquet');
  await page.check('[data-k="med.archive"]'); await page.fill('[data-k="med.archiveFolder"]', 'yourproject/archive/{object}'); await page.fill('[data-k="med.archiveFile"]', '{object}.parquet');
  await page.fill('[data-k="med.example"]', 'Customer-Orders.csv');
  await T('preview for Customer-Orders.csv', () => document.getElementById('medPreview').innerText.split('\n'));
  // layers
  await page.click('#addStage'); await page.click('#addStage');
  await T('layers added with suggested folders', () => [...document.querySelectorAll('#stageList [data-si]')].map(s => s.querySelector('[data-sf=label]').value + ' @ ' + (s.querySelector('[data-sf=path]') || {}).value));
  await page.fill('[data-si="0"] [data-sf=nbPath]', '/Shared/yourproject/to_silver');
  await page.fill('[data-si="1"] [data-sf=nbPath]', '/Shared/yourproject/to_gold'); await page.fill('[data-si="1"] [data-sf=path]', 'yourproject/silver');
  await page.click('[data-addp=s0]'); await page.fill('[data-pkey=s0][data-pi="2"] [data-pf=name]', 'obj_id'); await page.selectOption('[data-pkey=s0][data-pi="2"] [data-pf=use]', 'obj_id');
  await page.click('[data-addp=s0]'); await page.fill('[data-pkey=s0][data-pi="3"] [data-pf=name]', 'region_name'); await page.fill('[data-pkey=s0][data-pi="3"] [data-pf=value]', 'Region A');
  await page.click('[data-addp=s0]'); await page.fill('[data-pkey=s0][data-pi="4"] [data-pf=name]', 'storage_name'); await page.selectOption('[data-pkey=s0][data-pi="4"] [data-pf=use]', 'global'); await page.fill('[data-pkey=s0][data-pi="4"] [data-pf=value]', 'StorageAccountName');
  // logging: his log_run notebook
  await page.selectOption('#logMethod', 'notebook'); await page.fill('[data-l=nbPath]', '/Shared/platform/log_run'); await page.fill('[data-l=nbLs]', 'ls_databricks');
  const row = i => '#logRows [data-logrow="' + i + '"] ';
  const setRow = async (i, name, use, value) => { if (!(await page.$(row(i)))) await page.click('#addLogParam'); await page.fill(row(i) + 'input[data-lf=name]', name); await page.selectOption(row(i) + 'select[data-lf=use]', use); if (value != null) await page.fill(row(i) + 'input[data-lf=value]', value); };
  const setStep = async (i, name, act, field) => { await setRow(i, name, 'step'); await page.selectOption(row(i) + 'select[data-lf=stepAct]', act); await page.selectOption(row(i) + 'select[data-lf=stepField]', field); };
  await setRow(0, 'obj_id', 'obj_id'); await setRow(1, 'obj_name', 'obj_name'); await setRow(2, 'status', 'status'); await setRow(3, 'error_details', 'error');
  await setStep(4, 'number_rows', 'cp_file_to_bronze', 'rowsCopied'); await setStep(5, 'duration', 'cp_file_to_bronze', 'copyDuration');
  await setRow(6, 'layer', 'layer'); await setRow(7, 'storage_name', 'global', 'StorageAccountName');
  await T('problems shown (expect none)', () => [...document.querySelectorAll('#briefMsg .msg.err')].map(m => m.textContent));
  await T('flow', () => [...document.querySelectorAll('#flowBody tr')].map(r => r.children[1].textContent.trim()));
  await T('own checks and placeholders (expect empty)', () => [document.getElementById('outMsg').textContent, document.getElementById('phMsg').textContent]);
  await T('JSON: bronze copy and silver parameters', () => { const p = JSON.parse(document.getElementById('plView').textContent), fe = p.properties.activities.find(a => a.name === 'fe_files').typeProperties.activities, cp = fe.find(a => a.name === 'cp_file_to_bronze'), log = fe.find(a => a.name === 'nb_log_file_success'), sv = p.properties.activities.find(a => a.name === 'fe_silver').typeProperties.activities.find(a => a.name === 'nb_silver');
    return { name: p.name, vars: Object.keys(p.properties.variables), out: cp.outputs[0].parameters, log: Object.keys(log.typeProperties.baseParameters), silver: sv.typeProperties.baseParameters }; });
  await T('datasets tab: all reused, one new (the file reader)', () => document.getElementById('dsList').innerText.slice(0, 200));
  await page.screenshot({ path: __dirname + '/adf_med_own.png', fullPage: true });
  await page.reload();
  await T('after reload: layers, params, datasets kept', () => [document.querySelectorAll('#stageList [data-si]').length, document.querySelector('[data-pkey=s0][data-pi="3"] [data-pf=value]').value, document.getElementById('dsInfosink').innerText.slice(0, 20), document.querySelector('[data-k="med.bronzeFolder"]').value]);
  // checker on the generated pipeline, then on his sample
  const json = await page.evaluate(() => document.getElementById('plView').textContent);
  await page.click('#modeBar [data-tab=check]'); await page.fill('#checkInput', json);
  await T('checker on generated (expect no findings)', () => document.getElementById('checkStats').innerText);
  await page.fill('#checkInput', S('pl_sample_1'));
  await T('checker on his yourproject pipeline', () => [...document.querySelectorAll('#findBody tr')].map(r => r.children[0].textContent + ' ' + r.children[1].textContent + ': ' + r.children[3].textContent.slice(0, 80)));
  await page.selectOption('#runBy', 'child'); await page.fill('#checkInput', S('pl_Sample3'));
  await T('pagination child pipeline, run by another pipeline', () => [...document.querySelectorAll('#findBody tr')].map(r => r.children[0].textContent + ': ' + r.children[3].textContent.slice(0, 60)));
  await page.setViewportSize({ width: 390, height: 800 }); await page.click('#modeBar [data-tab=build]');
  await T('390px overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

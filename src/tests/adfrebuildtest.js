// Rebuild the owner's yourproject pipeline through the page as a user would, then compare its values with his
// original for one example file (adfcompare.py). Needs his samples (not in the repo): SAMPLES, default /home/claude/samples.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process'), { open } = require('./lib');
const DIR = process.env.SAMPLES || '/home/claude/samples';
if (!fs.existsSync(DIR + '/pl_sample_1.json')) { console.log('adfrebuildtest skipped: no samples folder (set SAMPLES)'); process.exit(0); }
const SM = f => fs.readFileSync(DIR + '/' + f + '.json', 'utf8');
/* stand-ins for his two landing datasets (not among the samples): a folder on Blob storage, and one file in it */
const landing = p => JSON.stringify({ name: 'ds_landing' + (p ? '_file' : ''), properties: Object.assign({ linkedServiceName: { referenceName: 'ls_blob_landing', type: 'LinkedServiceReference' } }, p ? { parameters: { file_name: { type: 'string' } } } : {}, { annotations: [], type: 'DelimitedText',
  typeProperties: { location: Object.assign({ type: 'AzureBlobStorageLocation', folderPath: 'region', container: 'yourproject' }, p ? { fileName: { value: '@dataset().file_name', type: 'Expression' } } : {}), columnDelimiter: ',', firstRowAsHeader: true }, schema: [] }) });
const CC = f => landing(f === 'ds_file');
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  await page.setViewportSize({ width: 1280, height: 900 });
  const T = async (label, fn, a) => console.log('## ' + label, JSON.stringify(await page.evaluate(fn, a)));
  const step = async (label, fn) => { try { await fn(); } catch (e) { console.log('!! FAILED ' + label + ': ' + e.message.split('\n')[0]); } };
  const pick = (n, v) => page.click('label:has(input[name=' + n + '][value=' + v + '])');
  const errs = () => T('red items', () => [...document.querySelectorAll('.msg.err')].filter(m => m.offsetParent).map(m => m.textContent.slice(0, 160)));
  await page.click('#startOwn');
  // 1. source
  await page.fill('[data-k="src.container"]', 'yourproject'); await page.fill('[data-k="src.folder"]', 'region'); await page.fill('[data-k="src.ends"]', '.csv');
  // 2. names
  await step('names', async () => { await page.fill('[data-k="domain"]', 'yourproject'); });
  await step('pipeline name', async () => { await page.fill('[data-k="name"]', 'pl_yourproject_region'); });
  await page.fill('#medSub [data-k=nbLs]', 'ls_databricks'); await page.fill('#medSub [data-k="med.ls"]', 'ls_yourstorage');
  // my variables, with my names
  const vars = [['lake_container', 'yourcontainer/'], ['bronze_root', 'yourproject/bronze/'], ['archive_root', 'yourproject/archive/'], ['silver_root', 'yourproject/silver/'], ['silver_layer', 'silver'], ['gold_layer', 'gold']];
  for (let i = 0; i < vars.length; i++) { await page.click('#addVar'); await page.fill('[data-vi="' + i + '"] [data-vf=name]', vars[i][0]); await page.fill('[data-vi="' + i + '"] [data-vf=value]', vars[i][1]); }
  // objects
  await page.check('[data-k="med.lookup.on"]'); await page.fill('[data-k="med.lookup.nbPath"]', '/Shared/object_list');
  // bronze
  await page.fill('[data-k="med.container"]', '{var:lake_container}');
  await page.fill('[data-k="med.bronzeFolder"]', '{var:bronze_root}{name}'); await page.fill('[data-k="med.bronzeFile"]', '{object}.parquet');
  await page.check('[data-k="med.archive"]'); await page.fill('[data-k="med.archiveFolder"]', '{var:archive_root}{name}'); await page.fill('[data-k="med.archiveFile"]', '{object}.parquet');
  await page.fill('[data-k="med.example"]', 'Customer-Orders.csv');
  await T('preview', () => document.getElementById('medPreview').innerText.split('\n'));
  // datasets
  const ds = [['list', CC('ds_list')], ['read', CC('ds_file')], ['sink', SM('ds_sample3')], ['meta', SM('ds_sample2')]];
  for (const [k, j] of ds) await step('dataset ' + k, async () => { await pick('dsMode' + k, 'own'); await page.fill('[data-dsjson=' + k + ']', j); });
  await T('datasets read', () => ['list', 'read', 'sink', 'meta'].map(k => (document.getElementById('dsInfo' + k) || {}).innerText + ' | ' + (document.getElementById('dsMsg' + k) || {}).innerText + ' | ' + [...document.querySelectorAll('#dsMap' + k + ' .rrow')].map(r => r.innerText.replace(/\n/g, ' ') + '=' + (r.querySelector('select') || {}).value).join('; ')));
  await errs();
  // layers
  await page.click('#addStage'); await page.click('#addStage');
  await page.fill('[data-si="0"] [data-sf=label]', 'silver'); await page.fill('[data-si="0"] [data-sf=path]', '{var:bronze_root}'); await page.fill('[data-si="0"] [data-sf=nbPath]', '/Shared/yourproject/yourproject_to_silver');
  await page.fill('[data-si="1"] [data-sf=label]', 'gold'); await page.fill('[data-si="1"] [data-sf=path]', '{var:silver_root}'); await page.fill('[data-si="1"] [data-sf=nbPath]', '/Shared/yourproject/yourproject_to_gold');
  await T('stage params by default', () => [...document.querySelectorAll('[data-pkey=s0]')].map(r => r.querySelector('[data-pf=name]').value + '=' + r.querySelector('[data-pf=use]').value));
  // silver params: file_name, obj_name, storage_name, region_name, obj_id, layer
  const setP = async (key, i, name, use, value) => { const sel = '[data-pkey=' + key + '][data-pi="' + i + '"] '; if (!(await page.$(sel))) await page.click('[data-addp=' + key + ']'); await page.fill(sel + '[data-pf=name]', name); await page.selectOption(sel + '[data-pf=use]', use); if (value != null) await page.fill(sel + '[data-pf=value]', value); };
  for (const key of ['s0', 's1']) {
    await setP(key, 0, 'file_name', 'text', key === 's0' ? '{object}.parquet' : '{name}.parquet');
    await setP(key, 1, 'obj_name', 'text', '{name}');
    await setP(key, 2, 'storage_name', 'global', 'StorageAccountName');
    await setP(key, 3, 'region_name', 'text', 'Region A');
    await setP(key, 4, 'obj_id', 'obj_id');
    await setP(key, 5, 'layer', key === 's0' ? 'variable' : 'text', key === 's0' ? 'silver_layer' : 'gold');
  }
  await setP('s1', 6, 'table_name', 'object');
  // logging
  await page.selectOption('#logMethod', 'notebook'); await page.fill('[data-l=nbPath]', '/Shared/platform/log_run'); await page.fill('[data-l=nbLs]', 'ls_databricks');
  const row = i => '#logRows [data-logrow="' + i + '"] ';
  const setRow = async (i, name, use, value) => { if (!(await page.$(row(i)))) await page.click('#addLogParam'); await page.fill(row(i) + 'input[data-lf=name]', name); await page.selectOption(row(i) + 'select[data-lf=use]', use); if (value != null) await page.fill(row(i) + 'input[data-lf=value]', value); };
  await step('log rows', async () => {
    await setRow(0, 'obj_id', 'obj_id'); await setRow(1, 'obj_name', 'obj_name'); await setRow(2, 'error_details', 'error', 'no error'); await setRow(3, 'status', 'status');
    await setRow(4, 'number_rows', 'step'); await page.selectOption(row(4) + 'select[data-lf=stepAct]', 'cp_file_to_bronze'); await page.selectOption(row(4) + 'select[data-lf=stepField]', 'rowsCopied');
    await setRow(5, 'duration', 'step'); await page.selectOption(row(5) + 'select[data-lf=stepAct]', 'cp_file_to_bronze'); await page.selectOption(row(5) + 'select[data-lf=stepField]', 'copyDuration');
    await setRow(6, 'layer', 'layer'); await setRow(7, 'storage_name', 'global', 'StorageAccountName'); });
  await page.uncheck('[data-k="med.failOnError"]');
  await page.uncheck('[data-k="med.vars"]');
  await errs();
  await T('preview at the end', () => document.getElementById('medPreview').innerText.split('\n'));
  await T('bronze dataset says', () => [...document.querySelectorAll('#dsMapsink .rrow')].map(r => r.innerText.replace(/\n/g, ' ')));
  await T('own checks / placeholders', () => [document.getElementById('outMsg').innerText, document.getElementById('phMsg').innerText, document.getElementById('outStats').innerText]);
  await T('flow', () => [...document.querySelectorAll('#flowBody tr')].map(r => r.children[1].textContent.trim() + ' [' + r.children[2].textContent + ']'));
  const out = path.join(os.tmpdir(), 'yourproject_rebuilt.json'); fs.writeFileSync(out, await page.evaluate(() => document.getElementById('plView').textContent));
  console.log(execFileSync('python3', [path.join(__dirname, 'adfcompare.py'), DIR + '/pl_sample_1.json', out], { encoding: 'utf8' }));
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

// Rebuild a real pipeline through the page as a user would, then compare the values it passes with the original's for
// one example file (adfcompare.py). Everything specific to that pipeline lives in a private recipe beside the samples
// (rebuild.json, never in the repo): SAMPLES, default /home/claude/samples. Without it the test is skipped.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process'), { open } = require('./lib');
const DIR = process.env.SAMPLES || '/home/claude/samples', RECIPE = path.join(DIR, 'rebuild.json');
if (!fs.existsSync(RECIPE)) { console.log('adfrebuildtest skipped: no private recipe (set SAMPLES)'); process.exit(0); }
const R = JSON.parse(fs.readFileSync(RECIPE, 'utf8')), SM = f => fs.readFileSync(path.join(DIR, f + '.json'), 'utf8');
/* stand-ins for the landing datasets when the samples don't hold them: a folder on Blob storage, and one file in it */
const landing = p => JSON.stringify({ name: 'ds_landing' + (p ? '_file' : ''), properties: Object.assign({ linkedServiceName: { referenceName: 'ls_blob_landing', type: 'LinkedServiceReference' } }, p ? { parameters: { file_name: { type: 'string' } } } : {}, { annotations: [], type: 'DelimitedText',
  typeProperties: { location: Object.assign({ type: 'AzureBlobStorageLocation', folderPath: R.landing.folder, container: R.landing.container }, p ? { fileName: { value: '@dataset().file_name', type: 'Expression' } } : {}), columnDelimiter: ',', firstRowAsHeader: true }, schema: [] }) });
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  await page.setViewportSize({ width: 1280, height: 900 });
  const T = async (label, fn, a) => console.log('## ' + label, JSON.stringify(await page.evaluate(fn, a)));
  const step = async (label, fn) => { try { await fn(); } catch (e) { console.log('!! FAILED ' + label + ': ' + e.message.split('\n')[0]); } };
  const pick = (n, v) => page.click('label:has(input[name=' + n + '][value=' + v + '])');
  const errs = () => T('red items', () => [...document.querySelectorAll('.msg.err')].filter(m => m.offsetParent).map(m => m.textContent.slice(0, 160)));
  await page.click('#startOwn');
  await page.fill('[data-k="src.container"]', R.landing.container); await page.fill('[data-k="src.folder"]', R.landing.folder); await page.fill('[data-k="src.ends"]', R.landing.ends);
  await step('names', async () => { await page.fill('[data-k="domain"]', R.domain); await page.fill('[data-k="name"]', R.name); });
  await page.fill('#medSub [data-k=nbLs]', R.nbLs); await page.fill('#medSub [data-k="med.ls"]', R.ls);
  for (let i = 0; i < R.vars.length; i++) { await page.click('#addVar'); await page.fill('[data-vi="' + i + '"] [data-vf=name]', R.vars[i][0]); await page.fill('[data-vi="' + i + '"] [data-vf=value]', R.vars[i][1]); }
  if (R.lookup) { await page.check('[data-k="med.lookup.on"]'); await page.fill('[data-k="med.lookup.nbPath"]', R.lookup); }
  await page.fill('[data-k="med.container"]', R.container || '');
  await page.fill('[data-k="med.bronzeFolder"]', R.bronzeFolder); await page.fill('[data-k="med.bronzeFile"]', R.bronzeFile);
  if (R.archiveFolder) { await page.check('[data-k="med.archive"]'); await page.fill('[data-k="med.archiveFolder"]', R.archiveFolder); await page.fill('[data-k="med.archiveFile"]', R.archiveFile); }
  await page.fill('[data-k="med.example"]', R.example);
  const ds = [['list', R.datasets.list ? SM(R.datasets.list) : landing(false)], ['read', R.datasets.read ? SM(R.datasets.read) : landing(true)], ['sink', SM(R.datasets.sink)], ['meta', SM(R.datasets.meta)]];
  for (const [k, j] of ds) await step('dataset ' + k, async () => { await pick('dsMode' + k, 'own'); await page.fill('[data-dsjson=' + k + ']', j); });
  await errs();
  const setP = async (key, i, name, use, value) => { const sel = '[data-pkey=' + key + '][data-pi="' + i + '"] '; if (!(await page.$(sel))) await page.click('[data-addp=' + key + ']'); await page.fill(sel + '[data-pf=name]', name); await page.selectOption(sel + '[data-pf=use]', use); if (value != null) await page.fill(sel + '[data-pf=value]', value); };
  for (let i = 0; i < R.stages.length; i++) {
    const s = R.stages[i], q = '[data-si="' + i + '"] ';
    await page.click('#addStage'); await page.fill(q + '[data-sf=label]', s.label); if (s.loop) await page.selectOption(q + '[data-sf=loop]', s.loop);
    if (s.path) await page.fill(q + '[data-sf=path]', s.path); await page.fill(q + '[data-sf=nbPath]', s.nb);
    for (let j = 0; j < s.params.length; j++) await setP('s' + i, j, s.params[j][0], s.params[j][1], s.params[j][2]);
  }
  await page.selectOption('#logMethod', 'notebook'); await page.fill('[data-l=nbPath]', R.log.nb); await page.fill('[data-l=nbLs]', R.log.nbLs || '');
  const row = i => '#logRows [data-logrow="' + i + '"] ';
  await step('log rows', async () => {
    for (let i = 0; i < R.log.rows.length; i++) {
      const [name, use, value] = R.log.rows[i];
      if (!(await page.$(row(i)))) await page.click('#addLogParam');
      await page.fill(row(i) + 'input[data-lf=name]', name); await page.selectOption(row(i) + 'select[data-lf=use]', use);
      if (use === 'step') { const [a, f] = value.split('|'); await page.selectOption(row(i) + 'select[data-lf=stepAct]', a); await page.selectOption(row(i) + 'select[data-lf=stepField]', f); }
      else if (value != null) await page.fill(row(i) + 'input[data-lf=value]', value);
    }
  });
  if (!R.failOnError) await page.uncheck('[data-k="med.failOnError"]');
  if (!R.keepVars) await page.uncheck('[data-k="med.vars"]');
  await errs();
  await T('own checks / placeholders', () => [document.getElementById('outMsg').innerText, document.getElementById('phMsg').innerText, document.getElementById('outStats').innerText]);
  const out = path.join(os.tmpdir(), 'rebuilt_pipeline.json'); fs.writeFileSync(out, await page.evaluate(() => document.getElementById('plView').textContent));
  console.log(execFileSync('python3', [path.join(__dirname, 'adfcompare.py'), path.join(DIR, R.original), out, RECIPE], { encoding: 'utf8' }));
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

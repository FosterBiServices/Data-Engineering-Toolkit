// Pipeline variables: defined by the user, passed to a dataset parameter, used in a folder pattern and a notebook parameter.
const { open } = require('./lib');
const DS = JSON.stringify({ name: 'ds_your_parquet', properties: { linkedServiceName: { referenceName: 'ls_adls' }, parameters: { file_name: { type: 'string' }, file_path: { type: 'string' }, container: { type: 'string' } }, type: 'Parquet',
  typeProperties: { location: { type: 'AzureBlobFSLocation', fileName: { value: '@dataset().file_name', type: 'Expression' }, folderPath: { value: '@dataset().file_path', type: 'Expression' }, fileSystem: { value: '@dataset().container', type: 'Expression' } } } } }, null, 2);
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  const T = async (label, fn) => console.log(label, JSON.stringify(await page.evaluate(fn)));
  const pick = (n, v) => page.click('label:has(input[name=' + n + '][value=' + v + '])');
  await page.click('#startOwn');
  await page.fill('[data-k="src.container"]', 'yourcontainer'); await page.fill('[data-k="src.folder"]', 'sales/landing'); await page.fill('[data-k="src.ends"]', '.csv');
  // my variables
  await page.click('#addVar'); await page.fill('[data-vi="0"] [data-vf=name]', 'your_container'); await page.fill('[data-vi="0"] [data-vf=value]', 'yourcontainer/');
  await page.click('#addVar'); await page.fill('[data-vi="1"] [data-vf=name]', 'your_bronze_path'); await page.fill('[data-vi="1"] [data-vf=value]', 'sales/bronze/');
  await page.click('#addVar'); await page.fill('[data-vi="2"] [data-vf=name]', 'obj_id'); await page.selectOption('[data-vi="2"] [data-vf=type]', 'Integer'); await page.fill('[data-vi="2"] [data-vf=value]', '20');
  // the bronze dataset's container parameter gets a variable
  await pick('dsModesink', 'own'); await page.fill('[data-dsjson=sink]', DS);
  await page.selectOption('#dsMapsink select[data-p=container]', 'variable');
  await page.fill('#dsMapsink input[data-dsfixed][data-p=container]', 'your_container');
  await T('variable name kept in the box (expect your_container)', () => document.querySelector('#dsMapsink input[data-dsfixed][data-p=container]').value);
  // the folder uses another one
  await page.fill('[data-k="med.bronzeFolder"]', '{var:your_bronze_path}{object}');
  await T('preview uses the variable value', () => document.getElementById('medPreview').innerText.split('\n').find(l => /Copied/.test(l)));
  // a layer whose notebook gets obj_id from a variable
  await page.click('#addStage'); await page.fill('[data-si="0"] [data-sf=nbPath]', '/Shared/x/to_silver');
  await page.click('[data-addp=s0]'); await page.fill('[data-pkey=s0][data-pi="2"] [data-pf=name]', 'obj_id'); await page.selectOption('[data-pkey=s0][data-pi="2"] [data-pf=use]', 'variable'); await page.fill('[data-pkey=s0][data-pi="2"] [data-pf=value]', 'obj_id');
  await T('problems (expect none)', () => [...document.querySelectorAll('#briefMsg .msg.err')].map(m => m.textContent));
  await T('JSON: variables, bronze copy, silver obj_id', () => { const p = JSON.parse(document.getElementById('plView').textContent), cp = p.properties.activities.find(a => a.name === 'fe_files').typeProperties.activities.find(a => a.name === 'cp_file_to_bronze'), nb = p.properties.activities.find(a => a.name === 'fe_silver').typeProperties.activities.find(a => a.name === 'nb_silver');
    return [p.properties.variables.your_container, p.properties.variables.obj_id, cp.outputs[0].parameters.container, cp.outputs[0].parameters.file_path.value, nb.typeProperties.baseParameters.obj_id]; });
  await T('made-by-page list and datalist', () => [document.getElementById('autoVars').innerText.slice(0, 120), [...document.querySelectorAll('#varNames option')].map(o => o.value)]);
  // a mistake: a variable that doesn't exist, and a default with @
  await page.fill('#dsMapsink input[data-dsfixed][data-p=container]', 'no_such_var'); await page.fill('[data-vi="1"] [data-vf=value]', "@concat('a','b')");
  await T('mistakes caught', () => [...document.querySelectorAll('#briefMsg .msg.err')].map(m => m.textContent.slice(0, 90)));
  await page.fill('#dsMapsink input[data-dsfixed][data-p=container]', 'your_container'); await page.fill('[data-vi="1"] [data-vf=value]', 'sales/bronze/');
  await page.reload();
  await T('after reload: variables and mapping kept', () => [document.querySelectorAll('#varRows [data-vi]').length, document.querySelector('[data-vi="2"] [data-vf=type]').value, document.querySelector('#dsMapsink select[data-p=container]').value, document.querySelector('#dsMapsink input[data-dsfixed][data-p=container]').value]);
  // the same section on a database load
  await pick('srcKind', 'sql');
  await T('database load keeps the variables in its JSON', () => { const v = document.getElementById('plView').textContent; return v ? Object.keys(JSON.parse(v).properties.variables || {}) : 'no pipeline (needs setup)'; });
  await page.setViewportSize({ width: 390, height: 800 }); await pick('srcKind', 'medallion');
  await T('390px overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

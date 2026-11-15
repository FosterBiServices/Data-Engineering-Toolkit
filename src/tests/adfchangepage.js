// ADF page, "Change a pipeline": paste, add changes, Copilot, review.
const { open } = require('./lib');
const X = v => ({ value: v, type: 'Expression' }), DS = (n, p) => ({ referenceName: n, type: 'DatasetReference', parameters: p });
const pl = { name: 'pl_sales_files', properties: { activities: [
  { name: 'gm_list', type: 'GetMetadata', dependsOn: [], policy: { timeout: '0.01:00:00', retry: 0 }, typeProperties: { dataset: DS('ds_landing', {}), fieldList: ['childItems'] } },
  { name: 'nb_gold', type: 'DatabricksNotebook', dependsOn: [{ activity: 'gm_list', dependencyConditions: ['Succeeded'] }], policy: { timeout: '0.02:00:00', retry: 0 }, linkedServiceName: { referenceName: 'ls_databricks', type: 'LinkedServiceReference' }, typeProperties: { notebookPath: '/Shared/yourproject/nb_gold', baseParameters: { folder: X("@concat(variables('gold_path'), 'sales')") } } }],
  variables: { gold_path: { type: 'String', defaultValue: 'yourproject/gold/' } } } };
const landing = { name: 'ds_landing', properties: { linkedServiceName: { referenceName: 'ls_blob', type: 'LinkedServiceReference' }, type: 'DelimitedText', typeProperties: { location: { type: 'AzureBlobStorageLocation', folderPath: 'southern-region', container: 'landing' } } } };
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  await page.setViewportSize({ width: 1280, height: 900 });
  const T = async (label, fn) => console.log(label, JSON.stringify(await page.evaluate(fn)));
  await page.click('#modeBar [data-tab=change]');
  await T('tab shown', () => [!document.getElementById('paneChange').hidden, document.getElementById('paneBuild').hidden, document.getElementById('chgEmpty').hidden]);
  await page.fill('#chgPl', '{ not json');
  await T('bad JSON message', () => document.getElementById('chgMsg').innerText.slice(0, 80));
  await page.fill('#chgPl', JSON.stringify(pl, null, 2));
  await T('one box per dataset the pipeline uses', () => [...document.querySelectorAll('.chgdsrow summary')].map(s => s.innerText.replace(/\n/g, ' ')));
  await page.fill('[data-dsi="0"]', JSON.stringify({ name: 'ds_other', properties: { type: 'Parquet', typeProperties: {} } }));
  await T('wrong dataset in a box is named', () => document.querySelector('[data-dsmsg="0"]').innerText);
  await page.fill('[data-dsi="0"]', JSON.stringify(landing, null, 2));
  await page.click('#chgDsAdd');
  await page.fill('[data-dsi="1"]', JSON.stringify({ name: 'ds_parquet_v2', properties: { type: 'Parquet', typeProperties: {} } }));
  await T('another dataset added', () => [[...document.querySelectorAll('[data-dspill]')].map(p => p.innerText), document.getElementById('chgStats').innerText.replace(/\n/g, ' ')]);
  await T('focus kept in a dataset box', () => document.activeElement && document.activeElement.dataset.dsi);
  await T('outline', () => document.getElementById('chgStats').innerText.replace(/\n/g, ' '));
  await page.selectOption('#chgKind', 'toParam'); await page.click('#chgAddBtn');
  await page.fill('[data-ci="0"][data-cf=find]', 'southern-region'); await page.fill('[data-ci="0"][data-cf=name]', 'region');
  await T('found list for the value', () => document.querySelector('[data-cfound="0"]').innerText.slice(0, 160));
  await page.selectOption('#chgKind', 'replace'); await page.click('#chgAddBtn');
  await page.fill('[data-ci="1"][data-cf=find]', 'yourproject/'); await page.fill('[data-ci="1"][data-cf=repl]', 'yourproject/{param:region}/');
  await T('found list: notebook path unticked', () => [...document.querySelectorAll('[data-cfound="1"] input')].map(i => i.checked));
  await T('card messages', () => [...document.querySelectorAll('[data-cmsg]')].map(m => m.innerText.replace(/\n/g, ' | ').slice(0, 220)));
  await T('review stats', () => document.getElementById('chgOutStats').innerText.replace(/\n/g, ' '));
  await T('change these too', () => [...document.querySelectorAll('#chgAlso li')].map(l => l.textContent.slice(0, 70)));
  await T('what changed rows', () => [...document.querySelectorAll('#chgDiffBody tr')].map(r => r.innerText.replace(/\s+/g, ' ').slice(0, 110)));
  await page.click('#chgTabs [data-tab=diff]');
  await T('line diff', () => [document.querySelectorAll('#chgLines .dl.add').length, document.querySelectorAll('#chgLines .dl.del').length, document.querySelectorAll('#chgLines .fold').length]);
  await page.click('#chgTabs [data-tab=json]');
  await T('dataset JSON out', () => [document.querySelectorAll('#chgDsOut .codebox').length, /dataset\(\)\.region/.test(document.getElementById('chgDsOut').textContent)]);
  await page.click('#chgTabs [data-tab=how]');
  await T('steps', () => document.getElementById('chgSteps').textContent.split('\n').slice(0, 4));
  // a rename via selects
  await page.selectOption('#chgKind', 'rename'); await page.click('#chgAddBtn');
  await page.selectOption('[data-ci="2"][data-cf=activity]', 'nb_gold'); await page.fill('[data-ci="2"][data-cf=newName]', 'nb_gold_sales');
  await T('rename applied', () => document.querySelector('[data-cmsg="2"]').innerText);
  // notebook parameter rows
  await page.selectOption('#chgKind', 'notebook'); await page.click('#chgAddBtn');
  await page.selectOption('[data-ci="3"][data-cf=activity]', 'nb_gold_sales'); await page.click('[data-ci="3"][data-padd]');
  await page.fill('[data-ci="3"][data-pj="0"][data-pf2=name]', 'region'); await page.fill('[data-ci="3"][data-pj="0"][data-pf2=value]', '{param:region}');
  await T('notebook parameter set', () => [document.querySelector('[data-cmsg="3"]').innerText, /"region": \{\s*"value": "@pipeline\(\)\.parameters\.region"/.test(document.getElementById('chgJson').textContent)]);
  await T('focus kept while typing', () => document.activeElement && document.activeElement.dataset.pf2);
  // Copilot
  await page.fill('#chgAsk', 'Add lastModified to the Get Metadata field list.');
  await T('prompt', () => [!document.getElementById('chgAiBox').hidden, /TASK/.test(document.getElementById('chgPromptView').textContent), /nb_gold_sales/.test(document.getElementById('chgPromptView').textContent)]);
  const got = await page.evaluate(() => { const o = JSON.parse(document.getElementById('chgJson').textContent); o.properties.activities[1].typeProperties.fieldList.push('lastModified'); o.properties.activities.splice(2, 1); return o; });
  await page.fill('#chgReply', '@@@ PIPELINE @@@\n' + JSON.stringify(got) + '\n@@@ ALSO_CHANGE @@@\n- none\n@@@ NOTES @@@\n- added lastModified');
  await T('Copilot reply used and its removal flagged', () => [document.getElementById('chgAiMsg').innerText.slice(0, 60), document.getElementById('chgReview').innerText.slice(0, 200)]);
  await page.selectOption('#chgKind', 'param'); await page.click('#chgAddBtn');
  await page.selectOption('[data-ci="4"][data-cf=action]', 'rename');
  await T('rename a parameter: the list has the one an earlier change added', () => [...document.querySelectorAll('[data-ci="4"][data-cf=name] option')].map(o => o.value));
  await page.selectOption('#chgKind', 'var'); await page.click('#chgAddBtn');
  await page.selectOption('[data-ci="5"][data-cf=action]', 'remove');
  await T('remove a variable: the list has the pipeline\'s variables', () => [...document.querySelectorAll('[data-ci="5"][data-cf=name] option')].map(o => o.value));
  await page.click('[data-cdel="5"]'); await page.click('[data-cdel="4"]');
  await page.reload();
  await T('kept after reload', () => [document.getElementById('paneChange').hidden, document.querySelectorAll('.chgcard').length, document.getElementById('chgReply').value.length > 10]);
  await T('datasets kept after reload', () => [...document.querySelectorAll('[data-dspill]')].map(p => p.innerText));
  await page.click('[data-dsdel="1"]');
  await T('another dataset removed', () => document.querySelectorAll('.chgdsrow').length);
  await page.click('[data-cdel="3"]');
  await T('remove a change', () => document.querySelectorAll('.chgcard').length);
  await page.setViewportSize({ width: 390, height: 800 });
  await T('390px overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  await page.click('#clearEntries'); await page.click('#clearYes');
  await T('Clear entries empties the tab', () => [document.getElementById('chgPl').value, document.querySelectorAll('.chgcard').length]);
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

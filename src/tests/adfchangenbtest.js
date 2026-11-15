// Change a pipeline: notebooks the pipeline runs (generic). Pasted or opened, checked against what each step sends,
// changed by the page (widget lines, find and replace) or by Copilot (NOTEBOOK blocks), with a diff and download.
const fs = require('fs'), os = require('os'), path = require('path'), { open } = require('./lib');
const X = v => ({ value: v, type: 'Expression' });
const pl = { name: 'pl_sales', properties: { activities: [
  { name: 'nb_silver', type: 'DatabricksNotebook', dependsOn: [], linkedServiceName: { referenceName: 'ls_databricks', type: 'LinkedServiceReference' }, typeProperties: { notebookPath: '/Shared/yourproject/nb_silver', baseParameters: { obj_name: 'orders', region_name: X("@string('Region A')") } } },
  { name: 'nb_gold', type: 'DatabricksNotebook', dependsOn: [{ activity: 'nb_silver', dependencyConditions: ['Succeeded'] }], linkedServiceName: { referenceName: 'ls_databricks', type: 'LinkedServiceReference' }, typeProperties: { notebookPath: '/Shared/yourproject/nb_gold', baseParameters: { obj_name: 'orders' } } }],
  variables: { silver_path: { type: 'String', defaultValue: 'yourproject/silver/' } } } };
const silverNb = ['# Databricks notebook source', 'dbutils.widgets.text("obj_name", "")', 'dbutils.widgets.text("region_name", "")', '', 'obj_name = dbutils.widgets.get("obj_name").strip()', 'region_name = dbutils.widgets.get("region_name").strip()', '', '# COMMAND ----------', '', 'base = f"abfss://lake@acct.dfs.core.windows.net/yourproject"', 'silver_path = f"{base}/silver/{obj_name}"', 'print(silver_path)'].join('\n');
const goldIpynb = path.join(os.tmpdir(), 'nb_gold.ipynb');
fs.writeFileSync(goldIpynb, JSON.stringify({ cells: [{ cell_type: 'code', source: ['dbutils.widgets.text("obj_name", "")\n', 'obj_name = dbutils.widgets.get("obj_name")\n'] }, { cell_type: 'code', source: ['df = spark.read.load(f"abfss://lake@acct.dfs.core.windows.net/yourproject/silver/{obj_name}")\n'] }], nbformat: 4, nbformat_minor: 4, metadata: {} }));
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  await page.setViewportSize({ width: 1280, height: 900 });
  const T = async (l, fn, a) => console.log(l, JSON.stringify(await page.evaluate(fn, a)));
  await page.click('#modeBar [data-tab=change]');
  await page.fill('#chgPl', JSON.stringify(pl, null, 2));
  await T('a box per notebook', () => [...document.querySelectorAll('#chgNbBox summary b')].map(b => b.textContent));
  await page.fill('#chgNbBox [data-nbi="0"]', silverNb);
  await page.setInputFiles('#chgNbBox [data-nbfile="1"]', goldIpynb); await page.waitForTimeout(400);
  await T('pasted and opened (.ipynb read as Python)', () => [...document.querySelectorAll('[data-nbpill]')].map(p => p.innerText));
  // the region example on a generic pipeline: a variable, folders, the notebook gets it
  const add = async kind => { await page.selectOption('#chgKind', kind); await page.click('#chgAddBtn'); return page.evaluate(() => document.querySelectorAll('.chgcard').length - 1); };
  let i = await add('var'); await page.fill(`[data-ci="${i}"][data-cf=name]`, 'location'); await page.fill(`[data-ci="${i}"][data-cf=value]`, 'region-a');
  i = await add('replace'); await page.fill(`[data-ci="${i}"][data-cf=find]`, 'yourproject/'); await page.fill(`[data-ci="${i}"][data-cf=repl]`, 'yourproject/{var:location}/');
  i = await add('notebook'); await page.selectOption(`[data-ci="${i}"][data-cf=activity]`, 'nb_silver'); await page.click(`[data-ci="${i}"][data-padd]`);
  await page.fill(`[data-ci="${i}"][data-pj="0"][data-pf2=name]`, 'location'); await page.fill(`[data-ci="${i}"][data-pj="0"][data-pf2=value]`, '{var:location}');
  await page.click('#chgTabs [data-tab=nb]');
  await T('Notebooks tab: what is sent, what it does not read, which lines build the folder', () => [...document.querySelectorAll('#chgNbOut .chgnb')].map(c => c.innerText.replace(/\s+/g, ' ').slice(0, 400)));
  await T('Change these too points to the tab', () => [...document.querySelectorAll('#chgAlso li')].map(l => l.textContent).filter(t => /^Notebook/.test(t)));
  await page.click('[data-nbaddw="/Shared/yourproject/nb_silver"]');
  i = await add('nbReplace'); await page.selectOption(`[data-ci="${i}"][data-cf=path]`, '/Shared/yourproject/nb_silver');
  await page.fill(`[data-ci="${i}"][data-cf=find]`, '.dfs.core.windows.net/yourproject"'); await page.fill(`[data-ci="${i}"][data-cf=repl]`, '.dfs.core.windows.net/yourproject/{location}"');
  await T('card messages for the notebook changes', () => [...document.querySelectorAll('[data-cmsg]')].slice(-2).map(m => m.innerText));
  await page.click('#chgTabs [data-tab=nb]');
  await T('silver now reads location; new version with a diff', () => { const c = document.querySelectorAll('#chgNbOut .chgnb')[0]; return [/doesn.t read/.test(c.innerText), c.querySelectorAll('.dl.add').length, !!c.querySelector('[data-nbcopy]')]; });
  await T('steps say to replace the notebook in Databricks', () => document.getElementById('chgSteps').textContent.split('\n').filter(l => /Databricks: open/.test(l)));
  // Copilot changes the gold notebook
  await page.fill('#chgAsk', 'The gold notebook must read silver from every location folder and union them.');
  await T('prompt holds the notebooks and asks for NOTEBOOK blocks', () => { const p = document.getElementById('chgPromptView').textContent; return [/Notebook \/Shared\/yourproject\/nb_gold:/.test(p), /@@@ NOTEBOOK @@@/.test(p), /PATH:/.test(p)]; });
  const plNow = await page.evaluate(() => document.getElementById('chgJson').textContent);
  await page.fill('#chgReply', '@@@ PIPELINE @@@\n' + plNow + '\n@@@ NOTEBOOK @@@\nPATH: /Shared/yourproject/nb_gold\ndbutils.widgets.text("obj_name", "")\nobj_name = dbutils.widgets.get("obj_name")\nparts = [p.path for p in dbutils.fs.ls("abfss://lake@acct.dfs.core.windows.net/yourproject/")]\n@@@ ALSO_CHANGE @@@\n- none\n@@@ NOTES @@@\n- gold reads every location');
  await page.click('#chgTabs [data-tab=nb]');
  await T('Copilot\'s notebook shown as the new version', () => [document.getElementById('chgAiMsg').innerText.slice(0, 80), [...document.querySelectorAll('#chgNbOut .chgnb')].map(c => c.innerText.match(/from (Copilot|the changes in Step 2)/)?.[0])]);
  await page.reload();
  await T('kept after reload', () => [...document.querySelectorAll('[data-nbpill]')].map(p => p.innerText.slice(0, 20)));
  await page.setViewportSize({ width: 390, height: 800 });
  await T('390px overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

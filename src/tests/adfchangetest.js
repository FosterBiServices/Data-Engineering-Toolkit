// Change a pipeline that works: the page's own changes on a generic pipeline, checked by evaluating every value
// before and after (adfeval.py). The region example: a fixed landing folder becomes a parameter, and the parameter is
// added as a folder between the project and the layer in every lake path.
const S = require('../parts/suite.js'), A = require('../parts/adf_core.js'); require('../parts/adf_med.js'); require('../parts/adf_change.js');
const { execFileSync } = require('child_process'), path = require('path');
let fails = 0; const ok = (label, cond, extra) => { console.log((cond ? 'ok   ' : 'FAIL ') + label + (extra !== undefined && !cond ? ' ' + JSON.stringify(extra) : '')); if (!cond) fails++; };
const X = v => ({ value: v, type: 'Expression' }), DS = (n, p) => ({ referenceName: n, type: 'DatasetReference', parameters: p });
const pl = { name: 'pl_sales_files', properties: {
  activities: [
    { name: 'gm_list', type: 'GetMetadata', dependsOn: [], policy: { timeout: '0.01:00:00', retry: 0 }, typeProperties: { dataset: DS('ds_landing', { file_name: '' }), fieldList: ['childItems'] } },
    { name: 'fe_files', type: 'ForEach', dependsOn: [{ activity: 'gm_list', dependencyConditions: ['Succeeded'] }], typeProperties: { isSequential: true, items: X("@activity('gm_list').output.childItems"), activities: [
      { name: 'cp_file', type: 'Copy', dependsOn: [], policy: { timeout: '0.01:00:00', retry: 2, retryIntervalInSeconds: 60 }, typeProperties: { source: { type: 'DelimitedTextSource' }, sink: { type: 'ParquetSink' } },
        inputs: [DS('ds_landing', { file_name: X('@item().name') })], outputs: [DS('ds_parquet', { container: X("@variables('lake_container')"), file_path: X("@concat(variables('sink_file_path'), replace(item().name, '.csv', ''))"), file_name: X("@replace(item().name, '.csv', '.parquet')") })] },
      { name: 'nb_silver', type: 'DatabricksNotebook', dependsOn: [{ activity: 'cp_file', dependencyConditions: ['Succeeded'] }], policy: { timeout: '0.02:00:00', retry: 0 }, linkedServiceName: { referenceName: 'ls_databricks', type: 'LinkedServiceReference' },
        typeProperties: { notebookPath: '/Shared/yourproject/nb_silver', baseParameters: { source_folder: X("@concat(variables('silver_file_path'), replace(item().name, '.csv', ''))"), archive: X("@concat('yourproject/archive/', item().name)"), log_path: X('yourproject/logs/@{pipeline().RunId}'), table: 'sales' } } }] } },
    { name: 'nb_gold', type: 'DatabricksNotebook', dependsOn: [{ activity: 'fe_files', dependencyConditions: ['Succeeded'] }], policy: { timeout: '0.02:00:00', retry: 0 }, linkedServiceName: { referenceName: 'ls_databricks', type: 'LinkedServiceReference' },
      typeProperties: { notebookPath: '/Shared/yourproject/nb_gold', baseParameters: { target: 'yourproject/gold/sales', note: "it's @home" } } }],
  variables: { lake_container: { type: 'String', defaultValue: 'lake' }, sink_file_path: { type: 'String', defaultValue: 'yourproject/bronze/' }, silver_file_path: { type: 'String', defaultValue: 'yourproject/silver/' } },
  annotations: [] } };
const landing = { name: 'ds_landing', properties: { linkedServiceName: { referenceName: 'ls_blob', type: 'LinkedServiceReference' }, parameters: { file_name: { type: 'string' } }, type: 'DelimitedText',
  typeProperties: { location: { type: 'AzureBlobStorageLocation', fileName: X('@dataset().file_name'), folderPath: 'region-a', container: 'landing' }, columnDelimiter: ',' } } };

/* evaluate the values that decide where data goes, for one file, with adfeval.py */
const evalAll = (p, ds, params) => JSON.parse(execFileSync('python3', ['-c', `
import sys, json; sys.path.insert(0, ${JSON.stringify(__dirname)}); import adfeval as e
pl, ds, params = json.loads(sys.argv[1]), json.loads(sys.argv[2]), json.loads(sys.argv[3])
P = pl['properties']; acts = {}
def walk(l):
    for a in l:
        acts[a['name']] = a; tp = a.get('typeProperties', {})
        for k in ('activities', 'ifTrueActivities', 'ifFalseActivities'): walk(tp.get(k, []))
walk(P['activities'])
defs = {k: v.get('defaultValue') for k, v in P.get('parameters', {}).items()}; defs.update(params)
c = e.Ctx(item={'name': 'orders.csv'}, params=defs)
c.vars = {k: v.get('defaultValue', '') for k, v in P.get('variables', {}).items()}
for a in P['activities']:
    if a['type'] == 'SetVariable': c.vars[a['typeProperties']['variableName']] = e.value(a['typeProperties']['value'], c)
out = {}
def dsfolder(ref):
    d = ds.get(ref['referenceName']);
    if not d: return None
    dp = {k: e.value(v, c) for k, v in ref.get('parameters', {}).items()}
    for k, v in d['properties'].get('parameters', {}).items(): dp.setdefault(k, v.get('defaultValue'))
    cc = e.Ctx(ds=dp); return e.value(d['properties']['typeProperties']['location']['folderPath'], cc)
out['landing folder (gm_list)'] = dsfolder(acts['gm_list']['typeProperties']['dataset'])
out['landing folder (cp_file)'] = dsfolder(acts['cp_file']['inputs'][0])
for k, v in acts['cp_file']['outputs'][0]['parameters'].items(): out['cp_file out ' + k] = e.value(v, c)
for n in ('nb_silver', 'nb_gold'):
    for k, v in acts[n]['typeProperties']['baseParameters'].items(): out[n + ' ' + k] = e.value(v, c)
    out[n + ' path'] = e.value(acts[n]['typeProperties']['notebookPath'], c)
print(json.dumps(out))`, JSON.stringify(p), JSON.stringify(Object.fromEntries(ds.map(d => [d.name, d]))), JSON.stringify(params || {})], { encoding: 'utf8' }));

const before = evalAll(pl, [landing]);
ok('before: landing folder', before['landing folder (gm_list)'] === 'region-a');
const find = A.findValue(pl, [landing], 'yourproject/', true);
ok('found every use of yourproject/ (7), notebook paths marked unsure', find.length === 7 && find.filter(h => h.unsure).length === 2, find.map(h => h.label + (h.unsure ? ' (unsure)' : '')));
const changes = [{ kind: 'toParam', find: 'region-a', name: 'region', as: 'param', cs: true, skip: [], keep: [] }, { kind: 'replace', find: 'yourproject/', repl: 'yourproject/{param:region}/', cs: true, skip: [], keep: [] }];
const res = A.applyChanges(pl, [landing], changes, '2026-11-15');
res.results.forEach(r => r.msgs.forEach(m => console.log('     ' + m.sev + ': ' + m.msg)));
ok('no errors', !res.results.some(r => r.msgs.some(m => m.sev === 'err')));
ok('the original is untouched', pl.properties.variables.sink_file_path.defaultValue === 'yourproject/bronze/' && landing.properties.typeProperties.location.folderPath === 'region-a');
ok('parameter added with the old value', JSON.stringify(res.pipeline.properties.parameters) === JSON.stringify({ region: { type: 'String', defaultValue: 'region-a' } }));
ok('landing dataset changed and returned', res.datasets.length === 1 && res.datasets[0].properties.parameters.region.defaultValue === 'region-a');
const after = evalAll(res.pipeline, res.allDatasets), west = evalAll(res.pipeline, res.allDatasets, { region: 'west' });
const expect = { 'landing folder (gm_list)': 'west', 'landing folder (cp_file)': 'west', 'cp_file out container': 'lake', 'cp_file out file_path': 'yourproject/west/bronze/orders', 'cp_file out file_name': 'orders.parquet',
  'nb_silver source_folder': 'yourproject/west/silver/orders', 'nb_silver archive': 'yourproject/west/archive/orders.csv', 'nb_silver log_path': 'yourproject/west/logs/RUN', 'nb_silver table': 'sales', 'nb_silver path': '/Shared/yourproject/nb_silver',
  'nb_gold target': 'yourproject/west/gold/sales', 'nb_gold note': "it's @home", 'nb_gold path': '/Shared/yourproject/nb_gold' };
Object.keys(expect).forEach(k => ok('with region=west: ' + k + ' = ' + expect[k], west[k] === expect[k], west[k]));
ok('with the default, the landing folder is unchanged', after['landing folder (gm_list)'] === 'region-a' && after['cp_file out file_path'] === 'yourproject/region-a/bronze/orders');
ok('variable defaults moved to Set Variable steps at the start', res.pipeline.properties.activities.slice(0, 2).map(a => a.name).join() === 'set_sink_file_path,set_silver_file_path' && res.pipeline.properties.variables.sink_file_path.defaultValue === '');
ok('the run starts with them, then gm_list', res.pipeline.properties.activities.find(a => a.name === 'gm_list').dependsOn[0].activity === 'set_silver_file_path' && res.pipeline.properties.activities[1].dependsOn[0].activity === 'set_sink_file_path');
ok('no broken references', !A.refProblems(res.pipeline).length, A.refProblems(res.pipeline));
const rv = A.reviewChange(pl, res.pipeline, A.defaultStandards());
ok('no new findings from the checker', !rv.fresh.length, rv.fresh.map(f => f.msg));
ok('diff lists the added steps and changed values', rv.diff.some(d => d.what === 'added' && d.activity === 'set_sink_file_path') && rv.diff.some(d => d.activity === 'nb_gold' && /target/.test(d.path)), rv.diff.length);
ok('line diff has + and - lines', rv.lines.some(l => l.t === '+') && rv.lines.some(l => l.t === '-'));
const notes = A.changeNotes(pl, res, changes, ['ds_landing']);
ok('notes: dataset to paste, unpasted dataset, notebooks, new parameter', notes.length === 4 && /ds_landing changed/.test(notes[0]) && /ds_parquet/.test(notes[1]) && /nb_silver/.test(notes[2]) && /region/.test(notes[3]), notes);
const res2 = A.applyChanges(pl, [landing], [{ kind: 'replace', find: 'yourproject/', repl: 'yourproject/{param:region}/', cs: true, skip: [], keep: [find.find(h => h.unsure).id] }]);
ok('a ticked notebook path changes too (and the missing parameter is reported)', /region/.test(JSON.stringify(res2.pipeline.properties.activities.find(a => a.name === 'fe_files').typeProperties.activities[1].typeProperties.notebookPath)) && A.refProblems(res2.pipeline).some(p => /parameter region/.test(p)));

// the other changes
const run = (c, more) => A.applyChanges(pl, [landing], [c].concat(more || []));
const msgs = r => r.results.map(x => x.msgs.map(m => m.sev + ': ' + m.msg).join(' | ')).join(' || ');
let r = run({ kind: 'rename', activity: 'gm_list', newName: 'gm_list_landing' });
ok('rename an activity: dependsOn and activity() updated', !A.refProblems(r.pipeline).length && /gm_list_landing/.test(JSON.stringify(r.pipeline.properties.activities[1])) && !/'gm_list'/.test(JSON.stringify(r.pipeline)), msgs(r));
r = run({ kind: 'rename', activity: 'gm_list', newName: 'fe_files' }); ok('rename to a name in use refused', /already an activity/.test(msgs(r)) && r.pipeline.properties.activities[0].name === 'gm_list');
r = run({ kind: 'var', action: 'rename', name: 'sink_file_path', newName: 'bronze_path' }); ok('rename a variable', !A.refProblems(r.pipeline).length && /bronze_path/.test(JSON.stringify(r.pipeline)) && !/sink_file_path/.test(JSON.stringify(r.pipeline)), msgs(r));
r = run({ kind: 'var', action: 'remove', name: 'lake_container' }); ok('remove a variable in use refused', /still used/.test(msgs(r)));
r = run({ kind: 'param', action: 'add', name: 'run_date', type: 'String', value: '' }, [{ kind: 'notebook', activity: 'nb_gold', path: '', params: [{ name: 'run_date', value: '{param:run_date}' }, { name: 'note', remove: true }] }]);
ok('add a parameter and pass it to a notebook', r.pipeline.properties.parameters.run_date && r.pipeline.properties.activities[2].typeProperties.baseParameters.run_date.value === '@pipeline().parameters.run_date' && !('note' in r.pipeline.properties.activities[2].typeProperties.baseParameters), msgs(r));
r = run({ kind: 'addNotebook', after: 'nb_gold', name: 'nb_quality', path: '/Shared/yourproject/nb_quality', ls: '', params: [{ name: 'layer', value: 'gold' }], insert: false });
ok('add a notebook step after another (linked service copied)', r.pipeline.properties.activities[3].name === 'nb_quality' && r.pipeline.properties.activities[3].linkedServiceName.referenceName === 'ls_databricks' && !A.check(r.pipeline, A.defaultStandards()).some(f => f.sev === 'high'), msgs(r));
r = run({ kind: 'addNotebook', after: 'cp_file', name: 'nb_validate', path: '/Shared/yourproject/nb_validate', params: [], insert: true });
ok('insert a step between two (inside a ForEach)', JSON.stringify(r.pipeline.properties.activities[1].typeProperties.activities.map(a => a.name + '<' + a.dependsOn.map(d => d.activity).join())) === JSON.stringify(['cp_file<', 'nb_validate<cp_file', 'nb_silver<nb_validate']), msgs(r));
r = run({ kind: 'dataset', activity: '*', from: 'ds_parquet', to: 'ds_parquet_v2' }); ok('use another dataset', /ds_parquet_v2/.test(JSON.stringify(r.pipeline)) && !/"ds_parquet"/.test(JSON.stringify(r.pipeline)), msgs(r));
r = run({ kind: 'dsParam', dataset: 'ds_landing', activity: '*', name: 'region', value: '{param:region}', remove: false }, []);
ok('send a value to a dataset parameter (missing on the pasted dataset: warned)', /parameters\.region/.test(JSON.stringify(r.pipeline.properties.activities[0].typeProperties.dataset)) && /has no parameter called region/.test(msgs(r)), msgs(r));
r = run({ kind: 'dsParam', dataset: 'ds_landing', activity: '*', name: 'file_name', remove: true }); ok('stop sending a dataset parameter', !/"file_name"/.test(JSON.stringify(r.pipeline.properties.activities[0].typeProperties.dataset)) && /no longer send/.test(msgs(r)), msgs(r));
r = run({ kind: 'policy', activity: '*', timeout: '4', retry: '3', interval: '120' }); ok('timeout and retries for all', r.pipeline.properties.activities[0].policy.timeout === '0.04:00:00' && r.pipeline.properties.activities[0].policy.retry === 3 && !r.pipeline.properties.activities[1].policy, msgs(r));
r = run({ kind: 'state', activity: 'nb_gold', active: false, markAs: 'Succeeded' }); ok('turn an activity off', r.pipeline.properties.activities[2].state === 'Inactive');
r = run({ kind: 'remove', activity: 'fe_files' }); ok('remove: the step after inherits the dependency', r.pipeline.properties.activities.find(a => a.name === 'nb_gold').dependsOn[0].activity === 'gm_list', msgs(r));
r = run({ kind: 'remove', activity: 'gm_list' }); ok('remove a step whose output is read: refused', /still read/.test(msgs(r)) && r.pipeline.properties.activities.length === 3);
r = run({ kind: 'schedule', freq: 'daily', time: '05:30', tz: 'Eastern Standard Time', name: '' }); ok('schedule', r.trigger && r.trigger.name === 'tr_sales_files_daily' && r.trigger.properties.typeProperties.recurrence.schedule.hours[0] === 5);
r = run({ kind: 'toParam', find: 'lake', name: 'lake_container_name', as: 'global', cs: true, skip: [], keep: [] }); ok('value to a global parameter', /globalParameters\.lake_container_name/.test(JSON.stringify(r.pipeline)) && r.globals.lake_container_name === 'lake', msgs(r));
r = run({ kind: 'replace', find: 'nothing-like-this', repl: 'x' }); ok('find with no match warns', /isn.t used anywhere/.test(msgs(r)));

// Copilot
const prompt = A.changePrompt(pl, 'Only copy files changed today', [landing]);
ok('prompt sections', ['TASK', 'CONTEXT', 'STARTING POINT', 'RULES', 'REPLY FORMAT'].every(h => prompt.indexOf('\n' + h) >= 0) && /Dataset ds_landing:/.test(prompt));
const changed = JSON.parse(JSON.stringify(pl)); changed.properties.activities.pop(); changed.properties.activities[0].typeProperties.fieldList.push('lastModified');
const reply = '```\n@@@ PIPELINE @@@\n' + JSON.stringify(changed) + '\n@@@ ALSO_CHANGE @@@\n- none\n@@@ NOTES @@@\n- added lastModified\n```';
const pr = A.changeParse(reply, S.parseBlocks);
ok('reply parsed', pr.pipeline && !pr.errors.length && pr.notes.length === 1 && !pr.also.length, pr.errors);
const rv2 = A.reviewChange(pl, pr.pipeline, A.defaultStandards(), { fromCopilot: true });
ok('Copilot removing an activity is flagged', rv2.flags.some(f => /removed the activity nb_gold/.test(f)), rv2.flags);
ok('template-only reply is not a pipeline', !A.changeParse('@@@ PIPELINE @@@\n{ the complete changed pipeline JSON }\n@@@ NOTES @@@\n- what you changed, one line per change', S.parseBlocks).pipeline);
const two = A.readDatasets(JSON.stringify(landing, null, 2) + '\n\n' + JSON.stringify({ name: 'ds_b', properties: { type: 'Parquet', typeProperties: {} } }));
ok('several datasets pasted one after another', two.datasets.length === 2 && !two.errors.length);
const rr = A.applyChanges(pl, [], [{ kind: 'rename', activity: 'nb_gold', newName: 'nb_gold_sales' }]), dd = A.pipelineDiff(pl, rr.pipeline);
ok('a rename shows as a rename, not removed + added', dd.length === 1 && dd[0].path === 'name' && dd[0].to === 'nb_gold_sales', dd);
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);

// Builds every pattern and runs the page's own checker on each: no high or medium findings expected.
const S = require('../parts/suite.js'), A = require('../parts/adf_core.js'); require('../parts/adf_med.js'); const EX = require('../parts/adf_ex.js');
let bad = 0;
const run = (label, edit, want) => {
  const c = EX(A.blank); c.src.kind = 'sql'; c.ai.reply = ''; c.ai.request = ''; edit(c);
  const errs = A.problems(c, c._std || A.defaultStandards()).filter(p => p.sev === 'err' && !/Overwrite with an incremental/.test(p.msg));
  if (want === 'blocked') { console.log(label, errs.length ? 'blocked as expected: ' + errs[0].msg.slice(0, 60) : 'NOT BLOCKED'); if (!errs.length) bad++; return; }
  if (errs.length) { bad++; console.log(label, 'setup errors', errs.map(e => e.msg)); return; }
  const std0 = c._std || null; delete c._std;
  const o = A.build(c, std0, null, '2026-11-15'); JSON.parse(o.json); o.datasets.forEach(d => JSON.parse(JSON.stringify(d)));
  const ck = A.check(o.pipeline, std0, { off: o.names.noHandler ? ['Failure path'] : [] }), f = ck.filter(x => x.sev !== 'low'), low = ck.filter(x => x.sev === 'low');
  if (f.length || low.length > (want === 'selectstar' ? 1 : 0)) bad++;
  const go = (o.sql.match(/^GO$/gm) || []).length, opens = (o.sql.match(/\bBEGIN\b/g) || []).length, ends = (o.sql.match(/\bEND\b/g) || []).length;
  console.log(label, '|', A.flow(o.pipeline).length, 'activities |', f.length + low.length, 'findings', f.concat(low).map(x => x.activity + ': ' + x.msg.slice(0, 70)), '| placeholders', o.placeholders.join(' ') || 'none', '| sql batches', go, opens === ends + (o.sql.match(/BEGIN TRANSACTION/g) || []).length ? '' : 'BEGIN/END MISMATCH');
  return o;
};
run('example merge', c => {});
const scd = run('scd2', c => { c.tgt.write = 'scd2'; });
run('full overwrite', c => { c.load.type = 'full'; c.tgt.write = 'overwrite'; });
run('full merge, two keys', c => { c.load.type = 'full'; c.load.keys = ['OrderID', 'CustomerID']; });
run('incremental append', c => { c.tgt.write = 'append'; });
run('incremental + overwrite (falls back to append)', c => { c.tgt.write = 'overwrite'; });
run('integer watermark', c => { c.load.wmCol = 'OrderID'; c.load.wmType = 'integer'; c.load.keys = ['OrderID']; });
run('synapse target', c => { c.tgt.system = 'synapse'; });
run('to parquet, incremental, notebooks', c => { c.tgt.kind = 'adls'; c.tgt.ls = 'ls_adls_datalake_prod'; c.ctlLs = 'ls_azuresql_control_prod'; c.tgt.storage = 'stdatalake'; c.notebooks = '/Shared/medallion/nb_bronze_orders\n/Shared/medallion/nb_silver_orders'; c.nbLs = 'ls_databricks_prod'; });
run('to parquet, full, no alert, no schedule', c => { c.tgt.kind = 'adls'; c.load.type = 'full'; c.alert = 'none'; c.sched.freq = 'none'; c.tgt.ls = ''; c.ctlLs = ''; });
run('files', c => { c.src.kind = 'files'; c.src.ls = 'ls_adls_datalake_prod'; c.src.starts = 'orders_'; c.notebooks = '/Shared/medallion/nb_bronze_orders'; });
const DS = (name, type, params, loc) => JSON.stringify({ name, properties: { linkedServiceName: { referenceName: 'ls_adls_dev', type: 'LinkedServiceReference' }, parameters: Object.fromEntries(params.map(p => [p, { type: 'string' }])), type, typeProperties: { location: Object.assign({ type: 'AzureBlobFSLocation' }, loc) } } });
const E = v => ({ value: '@dataset().' + v, type: 'Expression' });
const own = (c, src, tgt) => { c.src.kind = 'files'; c.src.ls = ''; if (src) c.ds.src = { mode: 'own', json: src, map: {} }; if (tgt) c.ds.tgt = { mode: 'own', json: tgt, map: {} }; };
const withLog = (log, f) => c => { f(c); c._std = Object.assign(A.defaultStandards(), { log: Object.assign(A.defaultStandards().log, log) }); };
run('files, plain copy (leave)', c => { c.src.kind = 'files'; c.src.ls = 'ls_adls'; c.src.after = 'leave'; c.src.dest = 'bronze/orders/{yyyy}/{MM}'; });
run('files, move (delete)', c => { c.src.kind = 'files'; c.src.ls = 'ls_adls'; c.src.after = 'delete'; });
const o1 = run('files, own Binary datasets, odd parameter names', c => { own(c, DS('ds_in', 'Binary', ['fs', 'dir', 'fname'], { fileSystem: E('fs'), folderPath: E('dir'), fileName: E('fname') }), DS('ds_out', 'Binary', ['p1', 'p2'], { fileSystem: 'lake', folderPath: E('p1'), fileName: E('p2') })); c.src.after = 'archive'; });
console.log('   own refs:', JSON.stringify(o1.pipeline.properties.activities[0].typeProperties.dataset.parameters), '| new datasets (expect none):', o1.datasets.length, '| reused:', o1.reused.map(d => d.name).join(','));
run('files, own source without file parameter', c => { own(c, DS('ds_in', 'Binary', ['dir'], { fileSystem: 'x', folderPath: E('dir') }), null); }, 'blocked');
run('files, own csv source + page binary destination', c => { own(c, DS('ds_in', 'DelimitedText', ['dir', 'file'], { fileSystem: 'x', folderPath: E('dir'), fileName: E('file') }), null); }, 'blocked');
run('files, own destination with no folder + archive', c => { own(c, null, DS('ds_out', 'Binary', ['file'], { fileSystem: 'x', folderPath: 'bronze', fileName: E('file') })); c.src.after = 'archive'; }, 'blocked');
run('files, own destination with no folder, plain copy', c => { own(c, null, DS('ds_out', 'Binary', ['file'], { fileSystem: 'x', folderPath: 'bronze', fileName: E('file') })); c.src.after = 'leave'; });
run('sql with own table datasets', c => { c.ds.src = { mode: 'own', map: {}, json: JSON.stringify({ name: 'ds_src_any', properties: { linkedServiceName: { referenceName: 'ls_sql_src' }, type: 'SqlServerTable', parameters: { SchemaName: { type: 'string' }, TableName: { type: 'string' } }, typeProperties: { schema: E('SchemaName'), table: E('TableName') } } }) }; c.ds.tgt = { mode: 'own', map: {}, json: JSON.stringify({ name: 'ds_dw_any', properties: { linkedServiceName: { referenceName: 'ls_azuresql_dw_prod' }, type: 'AzureSqlTable', parameters: { s: { type: 'string' }, t: { type: 'string' } }, typeProperties: { schema: E('s'), table: E('t') } } }) }; });
run('own target without table parameters + merge', c => { c.ds.tgt = { mode: 'own', map: {}, json: JSON.stringify({ name: 'ds_fixed', properties: { type: 'AzureSqlTable', typeProperties: { schema: 'dw', table: 'fact_orders' } } }) }; }, 'blocked');
run('own dataset: pipeline JSON pasted by mistake', c => { c.ds.src = { mode: 'own', map: {}, json: '{"name":"pl","properties":{"activities":[]}}' }; }, 'blocked');
const o2 = run('log with own notebook', withLog({ method: 'notebook', nbPath: '/Shared/util/nb_log', nbLs: 'ls_dbx', params: [{ name: 'pipeline', use: 'pipeline' }, { name: 'rows', use: 'rows_written' }, { name: 'status', use: 'status' }, { name: 'err', use: 'error' }, { name: 'source_system', use: 'fixed', value: 'sales' }] }, c => {}));
console.log('   notebook log params:', JSON.stringify(o2.pipeline.properties.activities.find(a => a.name === 'nb_log_failure').typeProperties.baseParameters).slice(0, 150));
const o3 = run('log with own procedure', withLog({ method: 'sp_own', proc: '[audit].[usp_log]', params: [{ name: '@PipelineName', use: 'pipeline' }, { name: 'RowsCopied', use: 'rows_written' }] }, c => {}));
console.log('   own proc:', JSON.stringify(o3.pipeline.properties.activities.find(a => a.name === 'sp_log_success').typeProperties), '| log table in SQL (expect false):', /pipeline_run_log/.test(o3.sql));
const o4 = run('no logging, no alert', withLog({ method: 'none' }, c => { c.alert = 'none'; }));
console.log('   handlers (expect none):', o4.pipeline.properties.activities.filter(a => /log|fail|alert/.test(a.name)).map(a => a.name));
run('no logging, alert only', withLog({ method: 'none' }, c => { c.alert = 'web'; }));
run('files, plain copy, no logging: no SQL, no control placeholder', withLog({ method: 'none' }, c => { c.src.kind = 'files'; c.src.ls = 'ls_adls'; c.src.after = 'leave'; c.alert = 'none'; }));
// checker: context and switches
{ const p = { name: 'pl_x', properties: { activities: [{ name: 'cp_a', type: 'Copy', dependsOn: [], policy: { retry: 2, timeout: '0.02:00:00' }, typeProperties: { source: {}, sink: { type: 'ParquetSink' } } }, { name: 'nb_log', type: 'DatabricksNotebook', dependsOn: [{ activity: 'cp_a', dependencyConditions: ['Failed'] }], typeProperties: {} }] } };
  const sev = o => A.check(JSON.parse(JSON.stringify(p)), null, o).map(f => f.sev + ':' + f.rule);
  console.log('handler without Fail | auto:', sev({}), '| by hand:', sev({ manual: true }), '| group off:', sev({ off: ['Failure path'] }));
  const f = A.check(JSON.parse(JSON.stringify(p)))[0]; console.log('   fix names the activity (expect true):', /On nb_log, select the \+/.test(f.fix));
  console.log('   fix prompt has JSON and findings:', /STARTING POINT\n\{/.test(A.fixPrompt(p, [f])) && /1\. \[medium\] nb_log/.test(A.fixPrompt(p, [f]))); }
run('no schema pasted', c => { c.schemaText = ''; c.load.keys = ['OrderID']; }, 'selectstar');
run('excluded column + filter with @', c => { c.exclude = ['SalesRegion']; c.filter = "[Status] <> 'a@b'"; });
run('merge without key', c => { c.load.keys = []; }, 'blocked');
run('incremental without change column', c => { c.load.wmCol = ''; }, 'blocked');
run('wrong watermark type', c => { c.load.wmCol = 'Status'; }, 'blocked');
// Copilot reply parsing
const c = EX(A.blank); c.src.kind = 'sql';
c.ai.reply = "@@@ COLUMN @@@\nNAME: OrderYear\nTYPE: int\nEXPR: YEAR([OrderDate])\n@@@ COLUMN @@@\nNAME: Bad\nTYPE: int\nEXPR: (SELECT 1); DROP TABLE x\n@@@ COLUMN @@@\nNAME: Ghost\nTYPE: int\nEXPR: [Nope] + 1\n@@@ COLUMN @@@\nNAME: OrderID\nTYPE: int\nEXPR: [OrderID] * 2\n@@@ FILTER @@@\nWHERE [Amount] >= 0\n@@@ COLUMN @@@\nNAME: column name\nTYPE: sql type\nEXPR: t-sql expression";
const ai = A.aiParse(c.ai.reply, c, S.parseBlocks, S.fields);
console.log('ai ok (expect OrderYear):', ai.ok.map(x => x.name), '| rejected (expect Bad, Ghost, OrderID):', ai.items ? '' : ai.columns.filter(x => x.problems.length).map(x => x.name), '| filter:', ai.filterOk);
const o = A.build(c, null, ai, '2026-11-15'); console.log('query has new column and filter:', /YEAR\(\[OrderDate\]\) AS \[OrderYear\]/.test(o.json) && /\(\[Amount\] >= 0\)/.test(o.json), '| staging has it:', /\[OrderYear\]\s+int NULL/.test(o.sql));
// checker on broken input
console.log('not json:', A.readPipeline('hello').error.slice(0, 30), '| dataset json:', A.readPipeline('{"name":"x","properties":{"type":"Parquet"}}').error.slice(0, 40));
const loop = { name: 'pl_x', properties: { activities: [{ name: 'a', type: 'Wait', dependsOn: [{ activity: 'b', dependencyConditions: ['Succeeded'] }] }, { name: 'b', type: 'Wait', dependsOn: [{ activity: 'a', dependencyConditions: ['Done'] }] }, { name: 'fe_1', type: 'ForEach', typeProperties: { activities: [{ name: 'fe_2', type: 'ForEach', typeProperties: { isSequential: true, activities: [] } }, { name: 'sv_x', type: 'SetVariable', typeProperties: { variableName: 'v' } }] } }] } };
console.log('loop + nesting:', A.check(loop).filter(f => f.sev === 'high').map(f => f.msg.slice(0, 48)));
if (process.argv[2] === 'scd') console.log(scd.sql.slice(scd.sql.indexOf('-- SCD')));
console.log(bad ? 'FAILED ' + bad : 'all patterns clean');

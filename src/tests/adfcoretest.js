// Builds every pattern and runs the page's own checker on each: no high or medium findings expected.
const S = require('../parts/suite.js'), A = require('../parts/adf_core.js'), EX = require('../parts/adf_ex.js');
let bad = 0;
const run = (label, edit, want) => {
  const c = EX(A.blank); c.ai.reply = ''; c.ai.request = ''; edit(c);
  const errs = A.problems(c).filter(p => p.sev === 'err' && !/Overwrite with an incremental/.test(p.msg));
  if (want === 'blocked') { console.log(label, errs.length ? 'blocked as expected: ' + errs[0].msg.slice(0, 60) : 'NOT BLOCKED'); if (!errs.length) bad++; return; }
  if (errs.length) { bad++; console.log(label, 'setup errors', errs.map(e => e.msg)); return; }
  const o = A.build(c, null, null, '2026-11-15'); JSON.parse(o.json); o.datasets.forEach(d => JSON.parse(JSON.stringify(d)));
  const f = A.check(o.pipeline).filter(x => x.sev !== 'low'), low = A.check(o.pipeline).filter(x => x.sev === 'low');
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
run('no schema pasted', c => { c.schemaText = ''; c.load.keys = ['OrderID']; }, 'selectstar');
run('excluded column + filter with @', c => { c.exclude = ['SalesRegion']; c.filter = "[Status] <> 'a@b'"; });
run('merge without key', c => { c.load.keys = []; }, 'blocked');
run('incremental without change column', c => { c.load.wmCol = ''; }, 'blocked');
run('wrong watermark type', c => { c.load.wmCol = 'Status'; }, 'blocked');
// Copilot reply parsing
const c = EX(A.blank);
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

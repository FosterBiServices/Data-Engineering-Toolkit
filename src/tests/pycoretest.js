// Generates notebooks for many setups and checks each one is valid Python (python3 -c ast.parse).
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const S = require('../parts/suite.js'), P = require('../parts/py_core.js'), EX = require('../parts/py_ex.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-')); let n = 0, bad = 0;
const check = (label, cfg) => {
  const ai = (cfg.layer === 'gold' ? cfg.gold.aiReply : cfg.silver.aiReply) ? P.aiParse(cfg.layer === 'gold' ? cfg.gold.aiReply : cfg.silver.aiReply, cfg, S.parseBlocks, S.fields) : null;
  const errs = P.problems(cfg).filter(p => p.sev === 'err'); if (errs.length) { console.log(label, 'setup errors:', errs.map(e => e.msg)); bad++; return; }
  const o = P.build(cfg, ai), f = path.join(dir, 'n' + (n++) + '.py'); fs.writeFileSync(f, o.code);
  const r = cp.spawnSync('python3', ['-I', '-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.log(label, 'NOT VALID PYTHON\n', r.stderr.split('\n').slice(-4).join('\n')); } else console.log(label, 'ok,', o.code.split('\n').length, 'lines', ai ? '(ai used: ' + ai.ok.map(i => i.name) + ')' : '');
  return o;
};
const base = () => EX(P);
['bronze', 'silver', 'gold'].forEach(L => { const c = base(); c.layer = L; check('example ' + L, c); });
let c = base(); c.bronze.format = 'csv'; c.layer = 'bronze'; check('bronze csv', c);
c = base(); c.silver.orderCol = ''; c.silver.softDelete = ''; c.silver.cluster = ''; c.silver.aiReply = ''; c.silver.rules = [{ kind: 'regex', col: 'sales_region', val: '^[A-Z"\\\\]+$' }, { kind: 'notfuture', col: 'order_date' }, { kind: 'max', col: 'amount', val: '1e6' }, { kind: 'expr', name: 'Weird Rule', val: "status = 'OPEN' AND amount > 5" }]; check('silver, no order col, all rule kinds', c);
c = base(); c.silver.cols[0].src = 'Order ID'; c.silver.cols[3].clean = 'trim_null'; c.silver.cols[5].on = false; check('silver, spaced source name', c);
c = base(); c.layer = 'gold'; c.gold.mode = 'full'; c.gold.softDelete = ''; c.gold.derived = []; c.gold.metrics = [{ name: 'rows', agg: 'count', col: '', filter: '' }, { name: 'open_orders', agg: 'count', col: '', filter: "status = 'OPEN'" }, { name: 'avg_amount', agg: 'avg', col: 'amount', filter: '' }]; check('gold full rebuild, counts', c);
c = base(); c.layer = 'gold'; c.gold.aiReq = 'x'; c.gold.aiReply = '@@@ METRIC @@@\nNAME: large_orders\nEXPR: F.sum(F.when(F.col("order_size") == "Large", 1).otherwise(0))\n@@@ DERIVED @@@\nNAME: large_share\nEXPR: F.col("large_orders") / F.col("order_count")\n@@@ METRIC @@@\nNAME: bad\nEXPR: spark.sql("x").collect()\n@@@ DERIVED @@@\nNAME: bad2\nEXPR: F.col("nope") * 2';
const o = check('gold with Copilot metrics', c); const ai = P.aiParse(c.gold.aiReply, c, S.parseBlocks, S.fields);
console.log('rejected (expect bad, bad2):', ai.items.filter(i => i.problems.length).map(i => i.name + ': ' + i.problems[0]));
c = base(); c.silver.aiReply = '@@@ COLUMN @@@\nNAME: order_id\nTYPE: bigint\nEXPR: F.col("order_id") + 1\n@@@ RULE @@@\nNAME: ship\nFAILS_WHEN: F.col("ship_date") < F.col("order_date")\n@@@ COLUMN @@@\nNAME: x\nTYPE: string\nEXPR: __import__("os").system("x")\n@@@ RULE @@@\nNAME: big\nFAILS_WHEN: F.col("amount") > 1000000';
const a2 = P.aiParse(c.silver.aiReply, c, S.parseBlocks, S.fields); console.log('silver ai: ok', a2.ok.map(i => i.name), 'rejected', a2.items.filter(i => i.problems.length).map(i => i.name + ': ' + i.problems.join(' | ')));
console.log('parse sql grid:', P.parseSchema('TABLE_SCHEMA\tTABLE_NAME\tCOLUMN_NAME\tDATA_TYPE\tMAX_LEN\tPREC\tSCALE\tIS_NULLABLE\tKEY_FLAG\ndbo\tOrders\tOrderID\tint\tNULL\t10\t0\tNO\tPK\ndbo\tOrders\tAmount\tdecimal\tNULL\t18\t2\tNO\t\ndbo\tOrders\tModifiedDate\tdatetime2\tNULL\t7\tNULL\tNO\t').cols.map(c => c.name + ':' + c.type + (c.pk ? ':pk' : '')));
console.log('parse list:', P.parseSchema('order_id bigint\namount decimal(10,2)\nnote').cols.map(c => c.name + ':' + c.type));
console.log(bad ? 'FAILED ' + bad : 'all notebooks valid');
if (process.argv[2] === 'show') console.log(P.build(base(), P.aiParse(base().silver.aiReply, base(), S.parseBlocks, S.fields)).code, '\n=====\n', (() => { const g = base(); g.layer = 'gold'; return P.build(g, null).code; })());

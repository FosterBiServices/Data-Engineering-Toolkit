// Generates scripts for many setups, checks each parses as Python, and RUNS them with pandas on real files.
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const S = require('../parts/suite.js'), K = require('../parts/ps_core.js'), EX = require('../parts/ps_ex.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-')); let n = 0, bad = 0;
const hasPandas = cp.spawnSync('python3', ['-c', 'import pandas, openpyxl']).status === 0;
const ORDERS = ['Order ID,Customer Name,Order Date,Status,Amount,Sales Region,Postal Code,Is Gift', '1001, Avery Stone ,2026-01-05,Shipped,"1,250.00",East,02134,no', '1002,Jordan Lee,2026-01-05,open,89.50,West,94105,yes',
  '1003,Riley Chen,2026-01-06,Cancelled,430.00,East,10001,no', '1003,Riley Chen,2026-01-08,Shipped,430.00,East,10001,no', '1004,Morgan Diaz,2026-01-07,Shipped,-15.75,South,73301,no', '1005,Sam Roe,not a date,Shipped,12.00,North,00501,maybe',
  ',,,,,,,', '1006,Test User,2026-01-09,TEST,1.00,East,10001,no', '1007,Kai Park,2026-01-09,Returned,($20.00),West,94105,YES', ',No Id,2026-01-09,Open,5,West,94105,no'].join('\n') + '\n';
fs.writeFileSync(path.join(dir, 'orders.csv'), ORDERS);
fs.writeFileSync(path.join(dir, 'regions.csv'), 'Region,Manager,Target\nEast,Dana,1000\nWest,Lee,2000\nSouth,Ola,500\n');
fs.writeFileSync(path.join(dir, 'regions_dupe.csv'), 'Region,Manager\nEast,Dana\nEast,Other\n');
const base = () => { const c = EX(K); c.input.path = path.join(dir, 'orders.csv'); c.output.path = path.join(dir, 'out' + (n) + '.xlsx'); return c; };
const run = (label, edit, expect) => {
  const c = base(); edit(c); n++;
  const ai = c.aiReply.trim() ? K.aiParse(c.aiReply, c, S.parseBlocks, S.fields) : null;
  const errs = K.problems(c, ai).filter(p => p.sev === 'err');
  if (expect === 'blocked') { if (!errs.length) { bad++; console.log(label, 'NOT BLOCKED'); } else console.log(label, 'blocked as expected:', errs[0].msg.slice(0, 70)); return; }
  if (errs.length) { bad++; console.log(label, 'setup errors', errs.map(e => e.msg)); return; }
  const o = K.build(c, ai), f = path.join(dir, 's' + n + '.py'); fs.writeFileSync(f, o.py);
  const nb = JSON.parse(o.ipynb), code = nb.cells.filter(x => x.cell_type === 'code').map(x => x.source.join('')).join('\n\n');
  fs.writeFileSync(f + '.nb.py', code);
  for (const file of [f, f + '.nb.py']) { const r = cp.spawnSync('python3', ['-I', '-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', file], { encoding: 'utf8' }); if (r.status !== 0) { bad++; console.log(label, 'NOT VALID PYTHON', r.stderr.split('\n').slice(-4).join(' ')); return; } }
  if (!hasPandas) { console.log(label, 'parses (pandas not installed, not run)'); return; }
  const r = cp.spawnSync('python3', [f + '.nb.py'], { encoding: 'utf8', cwd: dir });
  const tail = (r.stdout || '').trim().split('\n').filter(l => /^Rows|^Problems/.test(l)).map(l => l.replace(/\s+/g, ' ')).join(' | ');
  if (expect === 'fails') { const m = (r.stderr || '').trim().split('\n').pop(); if (r.status === 0) { bad++; console.log(label, 'SHOULD HAVE STOPPED'); } else console.log(label, 'stopped as expected:', m.slice(0, 110)); return; }
  if (r.status !== 0) { bad++; console.log(label, 'FAILED TO RUN\n', (r.stderr || '').split('\n').slice(-6).join('\n')); return; }
  const ok = !expect || expect.every(e => (r.stdout || '').includes(e));
  if (!ok) { bad++; console.log(label, 'UNEXPECTED OUTPUT, wanted', expect, '\n', r.stdout); return; }
  console.log(label, 'ran |', tail, r.stderr && /Warning/.test(r.stderr) ? '| WARNINGS: ' + r.stderr.trim().split('\n').slice(0, 2).join(' ') : '');
  return { c, o, out: r.stdout };
};
const ex = run('example (excel out, split, dedupe, summary, Copilot)', c => {}, ['Rows read: 10'.replace(': ', ':     '), 'Removed 1 duplicate']);
run('csv out, report mode, no dedupe (key uniqueness check)', c => { c.output = { kind: 'csv', path: path.join(dir, 'o.csv') }; c.bad = 'report'; c.dedupe.on = false; c.aiReply = ''; c.aiReq = ''; c.rules.pop(); }, ['duplicate_key']);
run('parquet out, stop mode', c => { c.output = { kind: 'parquet', path: path.join(dir, 'o.parquet') }; c.bad = 'stop'; }, 'fails');
run('no rules, no keys, nothing optional', c => { c.cols.forEach(x => { x.key = false; x.req = false; }); c.rules = []; c.dedupe.on = false; c.summary.on = false; c.filters = []; c.aiReply = ''; c.opts = { trim: false, emptyNa: false, dropBlank: false, dayFirst: true }; c.output = { kind: 'csv', path: path.join(dir, 'p.csv') }; });
run('all text, dedupe keep first', c => { c.cols.forEach(x => { x.type = 'text'; }); c.rules = []; c.summary.on = false; c.aiReply = ''; c.dedupe = { on: true, order: '', keep: 'first' }; });
run('lookup join left', c => { c.join = { on: true, kind: 'csv', path: path.join(dir, 'regions.csv'), sheet: '', leftKey: 'sales_region', rightKey: 'Region', cols: 'Manager', how: 'left' }; }, ['no match in the lookup file']);
run('lookup join inner, all columns', c => { c.join = { on: true, kind: 'csv', path: path.join(dir, 'regions.csv'), sheet: '', leftKey: 'sales_region', rightKey: 'Region', cols: '', how: 'inner' }; c.summary.group = ['Manager']; });
run('lookup with repeated keys stops', c => { c.join = { on: true, kind: 'csv', path: path.join(dir, 'regions_dupe.csv'), sheet: '', leftKey: 'sales_region', rightKey: 'Region', cols: '', how: 'left' }; }, 'fails');
run('missing column in file stops', c => { c.cols[1].src = 'Customer'; }, 'fails');
run('Copilot filter + regex + notfuture rules', c => { c.aiReply += '\n@@@ FILTER @@@\nKEEP_WHEN: df["amount"].notna() & (df["order_size"] != "Small")'; c.rules.push({ kind: 'regex', col: 'postal_code', val: '^\\d{5}$' }, { kind: 'notfuture', col: 'order_date', val: '' }, { kind: 'max', col: 'amount', val: '1000' }); });
// read back what the example wrote
if (hasPandas && ex) { const r = cp.spawnSync('python3', ['-c', 'import pandas as pd,sys\nx=pd.read_excel(sys.argv[1],sheet_name=None,dtype=str)\nprint({k:len(v) for k,v in x.items()})\nd=x["Data"]\nprint(d[["order_id","postal_code","amount","status","order_size","order_date","is_gift"]].to_string(index=False))\nprint(x["Rejected rows"][["order_id","failed_checks"]].to_string(index=False))\nprint(x["Summary"].to_string(index=False))', ex.c.output.path], { encoding: 'utf8' }); console.log(r.stdout || r.stderr); }
// round trip: excel in, parquet in
if (hasPandas) { cp.spawnSync('python3', ['-c', 'import pandas as pd,sys\nd=pd.read_csv(sys.argv[1]+"/orders.csv")\nd.to_excel(sys.argv[1]+"/orders.xlsx",index=False,sheet_name="Orders")\nd.to_parquet(sys.argv[1]+"/orders.parquet",index=False)', dir]); 
  run('excel in (named sheet)', c => { c.input = { kind: 'excel', path: path.join(dir, 'orders.xlsx'), sheet: 'Orders', sep: ',', encoding: 'utf-8', skip: 0 }; });
  run('parquet in', c => { c.input.kind = 'parquet'; c.input.path = path.join(dir, 'orders.parquet'); }); }
// setup checks and Copilot vetting
run('paths without extensions (csv in, excel out)', c => { c.input.path = path.join(dir, 'orders'); c.output.path = path.join(dir, 'noext_out'); }, ['noext_out.xlsx']);
if (hasPandas) run('excel in without extension', c => { c.input = { kind: 'excel', path: path.join(dir, 'orders'), sheet: 'Orders', sep: ',', encoding: 'utf-8', skip: 0 }; c.output.path = path.join(dir, 'noext2'); }, ['Rows read:']);
run('dedupe without key', c => { c.cols.forEach(x => { x.key = false; }); }, 'blocked');
run('filter with single =', c => { c.filters = [{ when: 'status = "A"', join: 'and' }]; }, 'blocked');
run('two filters with AND, keep what they remove (excel)', c => { c.output.path = path.join(dir, 'and.xlsx'); c.filters = [{ when: 'order_date >= "2026-01-06"', label: 'on or after 6 Jan', join: 'and' }, { when: 'status != "TEST"', label: '', join: 'and' }]; c.keepRemoved = true; }, ['Filters removed', 'Filtered out:']);
run('three filters with OR (csv), keep what they remove', c => { c.output = { kind: 'csv', path: path.join(dir, 'or.csv') }; c.filters = [{ when: 'order_date >= "2026-01-08"', join: 'and' }, { when: 'sales_region == "South"', join: 'or' }, { when: 'amount > 1000', join: 'or' }]; c.keepRemoved = true; c.aiReply = ''; }, ['Filtered out:']);
run('sum of a text column', c => { c.summary.metrics[1].col = 'status'; }, 'blocked');
run('output same as input', c => { c.output.path = c.input.path; c.output.kind = 'csv'; }, 'blocked');
const c2 = base(); c2.aiReply = '@@@ COLUMN @@@\nNAME: a\nEXPR: df["nope"] * 2\n@@@ COLUMN @@@\nNAME: b\nEXPR: __import__("os").system("x")\n@@@ COLUMN @@@\nNAME: c\nEXPR: df["amount"].apply(lambda v: v * 2)\n@@@ COLUMN @@@\nNAME: d\nEXPR: pd.read_csv("x")\n@@@ COLUMN @@@\nNAME: order_id\nEXPR: df["order_id"] + 1\n@@@ COLUMN @@@\nNAME: e\nEXPR: amount * 2\n@@@ COLUMN @@@\nNAME: good\nEXPR: np.where(df["amount"] > 100, "big", "small")\n@@@ COLUMN @@@\nNAME: column_name\nEXPR: pandas expression';
const a2 = K.aiParse(c2.aiReply, c2, S.parseBlocks, S.fields); console.log('Copilot vetting: ok', a2.ok.map(i => i.name), '(expect good) | rejected', a2.items.filter(i => i.problems.length).map(i => i.name + ': ' + i.problems[0].slice(0, 46)));
console.log('infer:', K.parseSample('zip\tn\td\tdt\tb\tm\tt\n02134\t1,200\t1/5/2026\t2026-01-05 13:30\tYes\t$1,200.50\tx\n10001\t7\t12/31/2025\t2026-01-06 08:00\tno\t(3.00)\t').cols.map(x => x.type).join(' '), '(expect text decimal date datetime bool decimal text)');
console.log('semicolon:', JSON.stringify(K.parseSample('a;b\n1;2').delim), '| dup header:', K.parseSample('a,a\n1,2').errors.length);
// read back the sheets of the AND case: Original = Data + Filtered out (before dedupe and checks move rows)
if (hasPandas) { const f = path.join(dir, 'and.xlsx'); const r = cp.spawnSync('python3', ['-c', 'import pandas as pd,sys\nx=pd.read_excel(sys.argv[1],sheet_name=None,dtype=str)\nprint("sheets", list(x))\nfo=x["Filtered out"]\nprint("filtered out", len(fo), "| reasons", sorted(set(fo["failed_filters"])))\nprint("original", len(x["Original"]))', f], { encoding: 'utf8' }); console.log('keep what the filters remove:', (r.stdout || r.stderr).trim().replace(/\n/g, ' | ')); }
if (hasPandas) { const r = cp.spawnSync('python3', ['-c', 'import pandas as pd,sys,glob\nfor f in sorted(glob.glob(sys.argv[1]+"/or*.csv")): print(f.split("/")[-1], len(pd.read_csv(f)))', dir], { encoding: 'utf8' }); console.log('OR case files:', (r.stdout || r.stderr).trim().replace(/\n/g, ' | ')); }
// to_number must drop spaces (\s), not the letter s (a lost backslash once did that)
{ const py = K.build(EX(K), null).py; const okRx = py.includes('\\s]", "", regex=True)'); if (!okRx) bad++; console.log('to_number strips whitespace, not "s":', okRx); }
console.log(bad ? 'FAILED ' + bad : 'all scripts ' + (hasPandas ? 'ran' : 'parse'));
if (process.argv[2] === 'show') console.log(K.build(EX(K), K.aiParse(EX(K).aiReply, EX(K), S.parseBlocks, S.fields)).py);

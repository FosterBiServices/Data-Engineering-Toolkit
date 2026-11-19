/* Review fixes (Nov 2026): same text in different capitals, exact copies, "#" columns. Needs Node, Python with pandas, openpyxl. */
const K = require('../parts/ps_core.js');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psrev-'));
let fails = 0; const ok = (l, c, x) => { console.log((c ? 'ok   ' : 'FAIL ') + l + (x ? ' ' + x : '')); if (!c) fails++; };
const csv = 'Order #,Region,Amount\n1001,North,10\n1002,north,5\n1003, North ,1\n1004,South,7\n1004,South,7\n';
fs.writeFileSync(path.join(dir, 'orders.csv'), csv);
ok('Order # is text, named order_no', K.inferType(['1001', '1002'], 'Order #') === 'text' && K.snake('Order #') === 'order_no');
const run = (opts, out) => {
  const c = K.blank(); c.input.path = path.join(dir, 'orders.csv'); c.output.kind = 'excel'; c.output.path = path.join(dir, out);
  const s = K.parseSample(csv); c.cols = s.cols.map(x => ({ src: x.src, name: K.snake(x.src), type: x.type, on: true, key: false, req: false }));
  Object.assign(c.opts, opts); c.summary = { on: true, group: ['region'], metrics: [{ name: 'total', agg: 'sum', col: 'amount' }] };
  const f = path.join(dir, out + '.py'); fs.writeFileSync(f, K.build(c, null).py);
  const log = execFileSync('python3', [f], { cwd: dir, encoding: 'utf8' });
  const sum = JSON.parse(execFileSync('python3', ['-c', 'import pandas as pd,sys;print(pd.read_excel(sys.argv[1],sheet_name="Summary").to_json(orient="records"))', path.join(dir, out)], { encoding: 'utf8' }));
  return { log, sum };
};
const a = run({}, 'a.xlsx');
ok('defaults: one North, copy removed', a.sum.length === 2 && a.sum.find(r => r.region === 'North').total === 16 && a.sum.find(r => r.region === 'South').total === 7, JSON.stringify(a.sum));
ok('defaults: says what it changed', /Removed 1 row/.test(a.log) && /region: 1 value\(s\) now use the most common spelling/.test(a.log));
const b = run({ sameCase: false, dropDupRows: false }, 'b.xlsx');
ok('off: listed as problems, data left alone', b.sum.length === 3 && /same text in different capitals/.test(b.log) && /exact copies/.test(b.log), JSON.stringify(b.sum));
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);

/* Common tasks in the Python Script Generator (owner, Nov 2026: "common scenarios... the user can choose one and the
   form expands"). Builds a script for each task, RUNS it with pandas, reads the output back; checks the order rules,
   moving old settings into tasks, and the page (picker, fold, move, remove, reload, rename, 390px).
   Needs Node, Python with pandas and openpyxl, and Playwright for the page part. */
const K = require('../parts/ps_core.js');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pstask-'));
let fails = 0; const ok = (l, c, x) => { console.log((c ? 'ok   ' : 'FAIL ') + l + (c || x === undefined ? '' : ' ' + x)); if (!c) fails++; };

// generic sales rows; Region is written once per customer block (a report export), names are "Last, First"
const csv = ['Order ID,Customer,Region,Order Date,Ship Date,Amount,Status,Contact,Jan,Feb,Mar',
  '1,Acme,East,2026-01-05,2026-01-07,50,Shipped,"Lee, Avery",1,2,',
  '2,Acme,,2026-01-06,2026-01-09,500,n/a,"Lee, Avery",3,,4',
  '3,Acme,,2026-01-07,,1500,SHIPPED Inc.,"Stone, Jo",5,6,7',
  '4,Birch,,2026-01-05,2026-01-06,500,Open,Kai,,,',
  '5,Birch,West,2026-01-08,2026-01-10,20,open,"Park, Kai",8,9,10',
  '6,Birch,,2026-01-08,2026-01-12,20,Open,"park , kai",1,1,1'].join('\n') + '\n';
fs.writeFileSync(path.join(dir, 'orders.csv'), csv);
fs.writeFileSync(path.join(dir, 'regions.csv'), 'Region,Manager\nEast,Dana\nWest,Lee\n');
fs.writeFileSync(path.join(dir, 'customers.csv'), 'Customer,Tier\nAcme,Gold\nBirch,Silver\n');

const base = () => {
  const c = K.blank(); c.input.path = path.join(dir, 'orders.csv'); c.output.kind = 'excel';
  c.cols = K.mapCols(K.parseSample(csv), []);
  c.opts.sameCase = false;   // keep "open" and "Open" apart so the replacements show
  c.cols.find(x => x.name === 'jan').type = 'decimal'; ['feb', 'mar'].forEach(n => { c.cols.find(x => x.name === n).type = 'decimal'; });
  return c;
};
const task = (kind, f) => Object.assign(K.taskBlank(kind), f || {});
let n = 0;
const run = (c, label) => {
  const out = 't' + (++n) + '.xlsx'; c.output.path = path.join(dir, out);
  const errs = K.problems(c, null).filter(p => p.sev === 'err');
  if (errs.length) { ok(label + ': no setup problems', false, JSON.stringify(errs)); return { rows: [], log: '' }; }
  const f = path.join(dir, 't' + n + '.py'); fs.writeFileSync(f, K.build(c, null).py);
  let log = '';
  try { log = execFileSync('python3', [f], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { ok(label + ': script ran', false, String(e.stderr || e).split('\n').slice(-6).join('\n')); return { rows: [], log: '' }; }
  const rows = JSON.parse(execFileSync('python3', ['-c', 'import pandas as pd,sys;print(pd.read_excel(sys.argv[1],sheet_name="Data",dtype=str,keep_default_na=False).fillna("").to_json(orient="records"))', path.join(dir, out)], { encoding: 'utf8' }));
  return { rows, log };
};
const col = (rows, k) => rows.map(r => r[k]).join('|');

// fix values
let r = run(Object.assign(base(), { tasks: [task('filldown', { cols: ['region'], within: 'customer' })] }), 'fill down');
ok('fill down within each customer (Birch row 4 has nothing above it in Birch)', col(r.rows, 'region') === 'East|East|East||West|West', col(r.rows, 'region'));
ok('fill down says how many', /region: 3 blank\(s\) filled/.test(r.log), r.log);
r = run(Object.assign(base(), { tasks: [task('filldown', { cols: ['region'] })] }), 'fill down, whole file');
ok('fill down across the file', col(r.rows, 'region') === 'East|East|East|East|West|West');
r = run(Object.assign(base(), { tasks: [task('replace', { cols: ['status'], pairs: 'N/A =>\nopen => Open' })] }), 'replace whole values');
ok('replace whole values, ignoring capitals; empty = missing', col(r.rows, 'status') === 'Shipped||SHIPPED Inc.|Open|Open|Open', col(r.rows, 'status'));
r = run(Object.assign(base(), { tasks: [task('replace', { cols: ['status'], pairs: ' inc.=>\nship\tSHIP', part: true })] }), 'replace part');
ok('replace part of the text (tab-separated pair too)', col(r.rows, 'status') === 'SHIPped|n/a|SHIPPED|Open|open|Open', col(r.rows, 'status'));
r = run(Object.assign(base(), { tasks: [task('replace', { cols: ['status'], pairs: 'open => OPEN', caseSens: true })] }), 'replace, capitals matter');
ok('capitals must match', col(r.rows, 'status') === 'Shipped|n/a|SHIPPED Inc.|Open|OPEN|Open', col(r.rows, 'status'));

// reshape
r = run(Object.assign(base(), { tasks: [task('split', { col: 'contact', sep: ',', into: 'last_name, first_name' })] }), 'split');
ok('split into two, trimmed, original removed', col(r.rows, 'last_name') === 'Lee|Lee|Stone|Kai|Park|park' && col(r.rows, 'first_name') === 'Avery|Avery|Jo||Kai|kai' && !('contact' in r.rows[0]), JSON.stringify(r.rows[3]));
ok('split: new columns sit where the old one was', Object.keys(r.rows[0]).slice(7, 9).join() === 'last_name,first_name', Object.keys(r.rows[0]).join());
ok('split: a row with fewer pieces is listed', /fewer pieces than columns: 1 row/.test(r.log), r.log);
r = run(Object.assign(base(), { tasks: [task('split', { col: 'contact', sep: ',', into: 'last_name, first_name', keep: true }), task('combine', { cols: ['first_name', 'last_name', 'customer'], sep: ' ', name: 'label' })] }), 'combine');
ok('combine skips a missing piece', col(r.rows, 'label') === 'Avery Lee Acme|Avery Lee Acme|Jo Stone Acme|Kai Birch|Kai Park Birch|kai park Birch', col(r.rows, 'label'));
r = run(Object.assign(base(), { tasks: [task('combine', { cols: ['order_id', 'order_date', 'amount'], sep: '-', name: 'ref' })] }), 'combine dates and numbers');
ok('combine writes dates as yyyy-mm-dd and 50.0 as 50', r.rows[0].ref === '1-2026-01-05-50', r.rows[0].ref);
const up = Object.assign(base(), { tasks: [task('rownum'), task('unpivot', { vals: ['jan', 'feb', 'mar'], ids: ['order_id'], nameCol: 'month', valueCol: 'qty', dropEmpty: true })] });
r = run(up, 'unpivot');
ok('unpivot: one row per value, rows together in column order, empties left out', r.rows.map(x => x.order_id + x.month + x.qty).slice(0, 5).join() === '1jan1,1feb2,2jan3,2mar4,3jan5' && r.rows.length === 13, r.rows.map(x => x.order_id + x.month + x.qty).join());
ok('unpivot keeps the row numbers', Object.keys(r.rows[0]).join() === 'row_number,order_id,month,qty' && r.rows[2].row_number === '3', Object.keys(r.rows[0]).join());
up.tasks.push(task('rownum')); ok('a second Number the rows is refused', K.problems(up, null).some(p => p.sev === 'err' && /only one of these/.test(p.msg)));
up.tasks = [up.tasks[1], task('rownum')];
ok('row numbers from the file after unpivot are refused', K.problems(up, null).some(p => p.sev === 'err' && /no longer match the file/.test(p.msg)));
up.tasks[1].from = 'clean'; ok('… but 1, 2, 3 after it is fine', !K.problems(up, null).some(p => p.sev === 'err'));
ok('after unpivot only its columns exist for later tasks', K.known(up, null).all.join() === 'order_id,month,qty,row_number' || K.known(up, null).all.join() === 'row_number,order_id,month,qty', K.known(up, null).all.join());

// add columns
r = run(Object.assign(base(), { tasks: [task('bands', { col: 'amount', edges: '100, 1000' }), task('bands', { col: 'amount', edges: '100', labels: 'Small, Big', name: 'size' })] }), 'bands');
ok('bands: default names, lower edge included', col(r.rows, 'amount_band') === 'under 100|100 to under 1,000|1,000 and over|100 to under 1,000|under 100|under 100', col(r.rows, 'amount_band'));
ok('bands: own names', col(r.rows, 'size') === 'Small|Big|Big|Big|Small|Small');
const bb = Object.assign(base(), { tasks: [task('bands', { col: 'amount', edges: '1000, 100' }), task('bands', { col: 'status', edges: '1', labels: 'a' })] });
const bm = K.problems(bb, null).filter(p => p.sev === 'err').map(p => p.msg).join(' | ');
ok('bands: edges must go up, names must fit, numbers only', /have to go up/.test(bm) && /give 2 names/.test(bm) && /status isn’t a number column/.test(bm), bm);
r = run(Object.assign(base(), { tasks: [task('dates', { col: 'order_date', parts: ['year', 'quarter', 'month_name', 'weekday', 'week'], until: 'ship_date' }), task('dates', { col: 'order_date', parts: [], until: 'today', name: 'age_days' })] }), 'dates');
ok('date parts', r.rows[0].order_date_year === '2026' && r.rows[0].order_date_quarter === '1' && r.rows[0].order_date_month_name === 'January' && r.rows[0].order_date_weekday === 'Monday' && r.rows[0].order_date_week === '2', JSON.stringify(r.rows[0]));
ok('days between, missing date gives missing', col(r.rows, 'days_order_date_to_ship_date') === '2|3||1|2|4', col(r.rows, 'days_order_date_to_ship_date'));
ok('days to today', Number(r.rows[0].age_days) > 300, r.rows[0].age_days);
r = run(Object.assign(base(), { tasks: [task('rank', { by: 'amount', group: ['customer'] }), task('rank', { by: 'amount', order: 'asc', ties: 'first', name: 'small_first' })] }), 'rank');
ok('rank within customer, ties share (1, 1, 3)', col(r.rows, 'rank') === '3|2|1|1|2|2', col(r.rows, 'rank'));
ok('rank the whole file, lowest first, no ties', col(r.rows, 'small_first') === '3|4|6|5|1|2', col(r.rows, 'small_first'));
r = run(Object.assign(base(), { tasks: [task('running', { col: 'amount', group: ['customer'], order: 'order_date' }), task('running', { col: 'amount', calc: 'pct', group: ['customer'], order: 'order_date' }), task('running', { col: 'status', calc: 'prev' })] }), 'running');
ok('running total per customer, file order kept', col(r.rows, 'amount_running_total') === '50|550|2050|500|520|540', col(r.rows, 'amount_running_total'));
ok('% change from previous', col(r.rows, 'amount_pct_change') === '|9|2||-0.96|0', col(r.rows, 'amount_pct_change'));
ok('previous value of a text column', col(r.rows, 'status_previous') === '|Shipped|n/a|SHIPPED Inc.|Open|open', col(r.rows, 'status_previous'));
ok('running total of text is refused', K.problems(Object.assign(base(), { tasks: [task('running', { col: 'status' })] }), null).some(p => p.sev === 'err' && /isn’t a number column/.test(p.msg)));

// dates written in different ways in one column (owner, Nov 2026: "you cannot go by just the first row")
{ const mcsv = 'Order ID,Order Date,Shipped At\n1,2026-01-05,2026-01-06 09:30\n2,1/7/2026,1/8/2026 3:15 PM\n3,"Jan 9, 2026",10-Jan-2026\n4,46032,2026-01-12\n5,not a date,\n';
  fs.writeFileSync(path.join(dir, 'mixed.csv'), mcsv);
  const c = K.blank(); c.input.path = path.join(dir, 'mixed.csv'); c.output.kind = 'excel'; c.cols = K.mapCols(K.parseSample(mcsv.split('\n').slice(0, 4).join('\n')), []);
  ok('a column with mixed date formats is a date (time of day kept apart)', c.cols[1].type === 'date' && c.cols[2].type === 'datetime', c.cols.map(x => x.type).join());
  c.tasks = [task('dates', { col: 'order_date', parts: ['day'], until: 'shipped_at' })];
  const r2 = run(c, 'mixed dates');
  ok('every format read, Excel day number too; unreadable is missing', col(r2.rows, 'order_date_day') === '5|7|9|10|' && col(r2.rows, 'days_order_date_to_shipped_at') === '1|1|1|2|', col(r2.rows, 'order_date') + ' / ' + col(r2.rows, 'days_order_date_to_shipped_at')); }

// find problems
r = run(Object.assign(base(), { tasks: [task('split', { col: 'contact', sep: ',', into: 'last_name, first_name', keep: true }), task('dupflag', { cols: ['last_name', 'first_name'] })] }), 'possible duplicates');
ok('possible duplicates: capitals and spaces ignored, rows listed', col(r.rows, 'possible_duplicate_group') === '1|1|||2|2' && col(r.rows, 'possible_duplicate_rows') === '2; 3|2; 3|||6; 7|6; 7', col(r.rows, 'possible_duplicate_group') + ' / ' + col(r.rows, 'possible_duplicate_rows'));
ok('possible duplicates: row numbers were added for it', 'row_number' in r.rows[0] && /possible duplicates on last_name \+ first_name: 4 row/.test(r.log), r.log);
const late = Object.assign(base(), { tasks: [task('dupflag', { cols: ['customer'] }), task('rownum')] });
ok('a task that needs row numbers below Number the rows is refused', K.problems(late, null).some(p => p.sev === 'err' && /put Number the rows above it/.test(p.msg)));

// two lookups, in order; a later task uses a looked-up column
const lk = Object.assign(base(), { tasks: [task('filldown', { cols: ['region'] }), task('lookup', { path: path.join(dir, 'regions.csv'), leftKey: 'region', rightKey: 'Region', cols: 'Manager' }), task('lookup', { path: path.join(dir, 'customers'), leftKey: 'customer', rightKey: 'Customer', cols: 'Tier' }), task('rank', { by: 'amount', group: ['Tier'], name: 'tier_rank' })] });
const lkPy = K.build(lk, null).py;
ok('two lookups get two paths', /LOOKUP_PATH = +with_extension/.test(lkPy) && /LOOKUP_PATH_2 = with_extension/.test(lkPy));
r = run(lk, 'two lookups');
ok('lookups ran after the fill, in order', col(r.rows, 'Manager') === 'Dana|Dana|Dana|Dana|Lee|Lee' && col(r.rows, 'Tier') === 'Gold|Gold|Gold|Silver|Silver|Silver' && col(r.rows, 'tier_rank') === '3|2|1|1|2|2', col(r.rows, 'Manager') + ' ' + col(r.rows, 'tier_rank'));
const lk2 = Object.assign(base(), { tasks: [task('rank', { by: 'amount', group: ['Manager'] }), task('lookup', { path: 'x.csv', leftKey: 'region', rightKey: 'Region', cols: 'Manager' })] });
ok('a column used before the lookup that makes it is refused', K.problems(lk2, null).some(p => p.sev === 'err' && /Manager isn’t a column at this point/.test(p.msg)));
const rnLk = Object.assign(base(), { tasks: [task('lookup', { path: path.join(dir, 'regions.csv'), leftKey: 'region', rightKey: 'Region', cols: 'Manager', how: 'inner' }), task('rownum')] });
r = run(rnLk, 'row numbers after a lookup');
ok('row numbers after a lookup still point at the file', col(r.rows, 'row_number') === '2|6', col(r.rows, 'row_number'));

// settings saved before Common tasks
const old = base(); delete old.tasks;
Object.assign(old, { filters: [{ when: 'amount > 10', label: '', join: 'and' }], dedupe: { on: true, order: '', keep: 'first' }, join: { on: true, kind: 'csv', path: 'r.csv', sheet: '', leftKey: 'region', rightKey: 'Region', cols: 'Manager', how: 'left' },
  rowNo: { on: false, name: 'line_no', from: 'file' }, fills: [{ col: 'region', passes: 'customer', swapA: '', swapB: '' }], conflicts: { on: true, group: 'customer', cols: ['status'], missing: false } });
old.cols.find(x => x.name === 'order_id').key = true;
const m = K.norm(old);
ok('old settings become tasks in the order they ran', m.tasks.map(t => t.kind).join() === 'rownum,lookup,filter,dedupe,fillmatch,conflicts' && m.tasks[0].name === 'line_no' && m.tasks[3].keep === 'first' && !('dedupe' in m) && !('fills' in m), m.tasks.map(t => t.kind).join());
ok('the original is left alone', old.dedupe.on === true && !old.tasks);
ok('norm is a no-op on new settings', K.norm(m) === m);

// the prompt lists what the tasks do and what they make
const pr = K.aiPrompt(Object.assign(base(), { aiReq: 'x', tasks: [task('bands', { col: 'amount', edges: '100' })] }));
ok('Copilot prompt: tasks listed, their columns are for STEP blocks', /ALREADY DONE BY THE PAGE/.test(pr) && /Group numbers into bands: amount/.test(pr) && /- amount_band \| text/.test(pr), pr.split('\n').filter(l => /band/.test(l)).join(' / '));

// every task kind has fields, a summary and code
Object.keys(K.TASK_DEFS).forEach(k => { const d = K.TASK_DEFS[k]; ok('defined: ' + k, d.label && d.group && d.hint && Array.isArray(d.fields) && typeof d.summary === 'function' && typeof K.TASK_CODE[k] === 'function' && typeof K.taskSummary(K.taskBlank(k), { cfg: base(), keys: [] }) === 'string'); });

// ---------- the page ----------
(async () => {
  let lib; try { lib = require('./lib.js'); } catch (e) { console.log('skip page: ' + e.message); return done(); }
  const { browser, page, errors } = await lib.open('python-script-generator.html');
  const cards = () => page.$$eval('.task', a => a.map(x => x.querySelector('.tlab').textContent));
  ok('page: the example comes as tasks, folded', (await cards()).join() === 'Filter rows,Remove duplicates' && (await page.$$('.task.open')).length === 0);
  ok('page: a folded task says what it does', /Keep if status != "TEST"/.test(await page.textContent('.task[data-i="0"] .tsum')));
  await page.selectOption('#taskAdd', 'bands');
  ok('page: a new task opens and the others fold', (await page.$$eval('.task.open', a => a.map(x => x.dataset.i))).join() === '2');
  ok('page: the picker offers number columns only', (await page.$$eval('.task[data-i="2"] select[data-f=col] option', a => a.map(o => o.value))).join() === ',amount,order_size');   // order_size comes from Copilot: its type isn't known
  await page.selectOption('.task[data-i="2"] select[data-f=col]', 'amount'); await page.fill('.task[data-i="2"] input[data-f=edges]', '100, 1000');
  ok('page: the script has the band', /amount_band/.test(await page.textContent('#codeView')));
  await page.click('.task[data-i="2"] [data-tmove="-1"]'); await page.click('.task[data-i="1"] [data-tmove="-1"]');
  ok('page: moved to the top, and it runs first', (await cards())[0] === 'Group numbers into bands' && (await page.textContent('#codeView')).indexOf('Bands of amount') < (await page.textContent('#codeView')).indexOf('Keep only the rows'));
  ok('page: Filter rows can be added only once', await page.$eval('#taskAdd option[value=filter]', o => o.disabled));
  await page.selectOption('#taskAdd', 'combine');
  await page.click('.task[data-i="3"] [data-tchip=cols][data-v=sales_region]'); await page.click('.task[data-i="3"] [data-tchip=cols][data-v=customer_name]');
  ok('page: combine shows the click order', (await page.$$eval('.task[data-i="3"] [aria-pressed=true]', a => a.map(b => b.textContent))).join() === 'customer_name2,sales_region1');
  await page.fill('.task[data-i="3"] input[data-f=name]', 'label');
  ok('page: no problems, script shown', !(await page.$eval('#outWrap', e => e.hidden)), await page.textContent('#setupMsg'));
  // rename a column in Step 2: tasks follow
  await page.fill('#mapBody tr[data-i="1"] input[data-f=name]', 'client'); await page.press('#mapBody tr[data-i="1"] input[data-f=name]', 'Tab');
  ok('page: a renamed column is renamed in the tasks', (await page.$$eval('.task[data-i="3"] [aria-pressed=true]', a => a.map(b => b.dataset.v))).join() === 'client,sales_region', await page.textContent('#setupMsg'));
  // remove the filter task: its filters go too
  await page.click('.task[data-i="1"] [data-del]');
  ok('page: removing Filter rows removes its filters', (await cards()).indexOf('Filter rows') < 0 && !/Keep only the rows/.test(await page.textContent('#codeView')));
  // a task with a problem is marked
  await page.selectOption('#taskAdd', 'split');
  ok('page: a task with a problem is marked red', (await page.$$('.task.bad')).length === 1 && (await page.$eval('#outWrap', e => e.hidden)));
  await page.click('.task[data-i="3"] [data-del]');
  await page.reload();
  ok('page: kept after reload', (await cards()).join() === 'Group numbers into bands,Remove duplicates,Combine columns', (await cards()).join());
  // settings saved before Common tasks
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('des.cfg')); delete c.tasks; c.dedupe = { on: true, order: '', keep: 'last' }; c.rowNo = { on: true, name: 'line', from: 'clean' }; c.fills = []; c.conflicts = { on: false }; c.join = { on: false }; localStorage.setItem('des.cfg', JSON.stringify(c)); });
  await page.reload();
  ok('page: an old saved setup opens as tasks', (await cards()).join() === 'Number the rows,Remove duplicates', (await cards()).join());
  // saved work: folding a card isn't an unsaved change, and an old saved job (moved into tasks on opening) isn't either
  await page.fill('#jobName', 'tasks job'); await page.click('#jobSave');
  await page.click('.task[data-i="1"] [data-tfold]'); await page.click('#jobNew'); await page.waitForTimeout(100);
  ok('page: folding a card doesn\'t count as unsaved', !/isn.t saved/.test(await page.textContent('#jobMsg')), await page.textContent('#jobMsg'));
  await page.waitForLoadState('load'); await page.waitForTimeout(150);
  await page.evaluate(() => { const j = JSON.parse(localStorage.getItem('des.jobs')); const c = j[0].cfg; delete c.tasks; c.dedupe = { on: true, order: '', keep: 'last' }; localStorage.setItem('des.jobs', JSON.stringify(j)); });
  await page.reload(); await page.selectOption('#jobList', 'tasks job'); await page.waitForTimeout(100);
  if (await page.$('#jobMsg [data-jy]')) await page.click('#jobMsg [data-jy]');   // the empty page after New
  await page.waitForLoadState('load'); await page.waitForTimeout(200);
  ok('page: an old saved job opens as tasks', (await cards()).join() === 'Remove duplicates', (await cards()).join());
  await page.click('#jobNew'); await page.waitForTimeout(100);
  ok('page: … and isn\'t called unsaved', !/isn.t saved/.test(await page.textContent('#jobMsg')), await page.textContent('#jobMsg'));
  await page.waitForLoadState('load'); await page.waitForTimeout(150);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.selectOption('#taskAdd', 'fillmatch');
  ok('page: 390px, no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= 391), await page.evaluate(() => document.documentElement.scrollWidth));
  await (await page.$('#taskList')).screenshot({ path: '/tmp/tasks390.png' });
  ok('page: no errors', !errors.length, JSON.stringify(errors));
  await browser.close();
  done();
})();
function done() { console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); }

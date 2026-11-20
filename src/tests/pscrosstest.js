/* Across rows in the Python Script Generator (owner, Nov 2026: fill a missing id from matching rows, then list values that
   differ within an id; and Copilot STEP blocks for logic across rows). Builds the script, RUNS it with pandas, reads the
   workbook back, then checks the page. Needs Node, Python with pandas and openpyxl, and Playwright for the page part. */
const K = require('../parts/ps_core.js');
const S = require('../parts/suite.js');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pscross-'));
let fails = 0; const ok = (l, c, x) => { console.log((c ? 'ok   ' : 'FAIL ') + l + (x ? ' ' + x : '')); if (!c) fails++; };

// Made-up people: the id is missing on 5 rows
const head = 'Person ID,First Name,Last Name,Birth Date,Gender,Team,Hours';
const rows = [
  ['P-1', 'Ana', 'Lopez', '1985-02-03', 'Female', 'North', '5'],     // file row 2
  ['P-1', 'Ana', 'Lopez', '1985-02-03', 'F', 'North', '3'],          // 3: gender differs within P-1
  ['', 'ana ', 'LOPEZ', '1985-02-03', 'Female', 'North', '1'],         // 4: name + date, capitals and spaces differ
  ['P-2', 'Ben', 'Carter', '1970-07-07', 'Male', 'South', '2'],      // 5
  ['', 'Carter', 'Ben', '1970-07-07', 'Male', 'South', '2'],         // 6: names swapped
  ['P-3', 'Cy', 'Dunn', '1990-01-01', 'Male', 'East', '4'],          // 7
  ['', 'Cy', 'Dunn', '', 'Male', 'East', '4'],                       // 8: no date, names only
  ['P-4', 'Dee', 'Evans', '1960-05-05', 'Female', 'West', '1'],      // 9
  ['P-5', 'Dee', 'Evans', '1960-05-05', 'Female', 'West', '1'],      // 10: two ids, one person
  ['', 'Dee', 'Evans', '1960-05-05', 'Female', 'West', '1'],         // 11: more than one match, left empty
  ['', 'Zed', 'Nobody', '2000-01-01', 'Male', 'North', '1'],         // 12: no match
  ['P-2', 'Ben', 'Carter', '1970-07-07', 'Male', 'North', '6'],      // 13: team differs within P-2
];
const csv = [head].concat(rows.map(r => r.join(','))).join('\n') + '\n';
fs.writeFileSync(path.join(dir, 'people.csv'), csv);

const cfgFor = (extra) => {
  const c = K.blank(); c.input.path = path.join(dir, 'people.csv'); c.output.kind = 'excel';
  const s = K.parseSample(csv); c.cols = s.cols.map(x => ({ src: x.src, name: K.snake(x.src), type: x.type, on: true, key: false, req: false }));
  c.cols.find(x => x.name === 'birth_date').type = 'date';
  Object.assign(c, extra); return c;
};
const run = (cfg, ai, out) => {
  cfg.output.path = path.join(dir, out);
  const f = path.join(dir, out + '.py'); fs.writeFileSync(f, K.build(cfg, ai).py);
  return execFileSync('python3', [f], { cwd: dir, encoding: 'utf8' });
};
const sheet = (out, name) => JSON.parse(execFileSync('python3', ['-c', 'import pandas as pd,sys;print(pd.read_excel(sys.argv[1],sheet_name=sys.argv[2],dtype=str).fillna("").to_json(orient="records"))', path.join(dir, out), name], { encoding: 'utf8' }));

// 1. fill + conflicts
const cfg = cfgFor({
  fills: [{ col: 'person_id', passes: 'first_name, last_name, birth_date\nfirst_name, last_name', swapA: 'first_name', swapB: 'last_name' }],
  conflicts: { on: true, group: 'person_id', cols: ['birth_date', 'gender', 'team'], missing: false },
});
ok('no setup problems', !K.problems(cfg, null).filter(p => p.sev === 'err').length, JSON.stringify(K.problems(cfg, null)));
ok('row numbers forced on by the fill', K.rowCol(cfg) === 'row_number');
const log = run(cfg, null, 'a.xlsx');
const d = sheet('a.xlsx', 'Data'), by = n => d.find(r => r.row_number === String(n));
ok('row numbers are file rows (header = 1)', d.map(r => r.row_number).join() === '2,3,4,5,6,7,8,9,10,11,12,13');
ok('row 4: name + date, other capitals', by(4).person_id === 'P-1' && by(4).person_id_filled_from_row === '2' && /birth_date$/.test(by(4).person_id_fill_note), JSON.stringify(by(4)));
ok('row 6: names swapped', by(6).person_id === 'P-2' && by(6).person_id_filled_from_row === '5' && /swapped/.test(by(6).person_id_fill_note));
ok('row 8: names only', by(8).person_id === 'P-3' && by(8).person_id_filled_from_row === '7' && by(8).person_id_fill_note === 'matched on first_name + last_name');
ok('row 11: two ids, left empty with both listed', by(11).person_id === '' && /P-4; P-5/.test(by(11).person_id_fill_note), by(11).person_id_fill_note);
ok('row 12: no match', by(12).person_id === '' && by(12).person_id_fill_note === 'not filled: no match');
ok('rows that had an id are untouched', by(2).person_id_filled_from_row === '' && by(2).person_id_fill_note === '');
ok('gender differs within P-1, on every row of it', [2, 3, 4].every(n => by(n).gender_conflict_rows === '2; 3; 4' && by(n).gender_conflict_values === 'Female; F' && by(n).conflict_columns === 'gender'));
ok('team differs within P-2 (the filled row counts)', by(13).team_conflict_rows === '5; 6; 13' && by(13).team_conflict_values === 'South; North');
ok('no conflict where values agree', by(9).conflict_columns === '' && by(9).birth_date_conflict_rows === '');
const cs = sheet('a.xlsx', 'Conflicts');
ok('Conflicts sheet: one row per group and column', cs.length === 2 && cs.some(r => r.person_id === 'P-1' && r.column === 'gender'), JSON.stringify(cs));
ok('the script says what it did', /3 of 5 missing value\(s\) filled/.test(log) && /person_id still missing after matching: 2 row/.test(log));

// 2. row numbers after cleaning, and missing counted as different
const c2 = cfgFor({ rowNo: { on: true, name: 'line', from: 'clean' }, conflicts: { on: true, group: 'person_id', cols: ['birth_date'], missing: true } });
run(c2, null, 'b.xlsx'); const d2 = sheet('b.xlsx', 'Data');
ok('row numbers 1, 2, 3 after cleaning, named as asked', d2[0].line === '1' && d2[11].line === '12');

// 3. Copilot STEP blocks
const reply = '```\n@@@ STEP @@@\nNAME: hours_per_person\nWHAT: total hours per person on every row\nCODE:\ndef step(df):\n    df["person_hours"] = df.groupby("person_id")["hours"].transform("sum")\n    return df\n@@@ NOTES @@@\nRows with no person_id get no total.\n```';
const c3 = cfgFor({ fills: cfg.fills, aiReq: 'total hours per person', aiReply: reply });
c3.cols.find(x => x.name === 'hours').type = 'whole';
const ai = K.aiParse(c3.aiReply, c3, S.parseBlocks, S.fields);
ok('STEP parsed and accepted', ai.ok.length === 1 && ai.ok[0].kind === 'STEP' && ai.ok[0].made.join() === 'person_hours', JSON.stringify(ai.items));
run(c3, ai, 'c.xlsx'); const d3 = sheet('c.xlsx', 'Data');
ok('the step ran after the fill (row 4 counts toward P-1)', d3.find(r => r.row_number === '4').person_hours === '9', JSON.stringify(d3[0]));
ok('later filters may use the step\'s columns', K.known(c3, ai).open === true);
const bad = (code) => K.aiParse('@@@ STEP @@@\nNAME: x\nCODE:\n' + code, c3, S.parseBlocks, S.fields).items[0].problems;
ok('refused: import', bad('def step(df):\n    import os\n    return df').length > 0);
ok('refused: reading a file', bad('def step(df):\n    other = pd.read_csv("x.csv")\n    return df').length > 0);
ok('refused: writing a file', bad('def step(df):\n    df.to_csv("x.csv")\n    return df').length > 0);
ok('refused: dunder access', bad('def step(df):\n    x = df.__class__\n    return df').length > 0);
ok('refused: no return', bad('def step(df):\n    df["a"] = 1').length > 0);
ok('refused: not a step function', bad('def other(df):\n    return df').length > 0);
ok('a column it doesn\'t know is pointed out', K.aiParse('@@@ STEP @@@\nNAME: y\nCODE:\ndef step(df):\n    df["z"] = df["no_such"]\n    return df', c3, S.parseBlocks, S.fields).items[0].unknown.join() === 'no_such');
ok('the prompt explains STEP and what the page already does', /@@@ STEP @@@/.test(K.aiPrompt(c3)) && /ALREADY DONE BY THE PAGE/.test(K.aiPrompt(c3)) && /row_number \| whole number/.test(K.aiPrompt(c3)));

// 4. setup problems
const p4 = cfgFor({ fills: [{ col: 'person_id', passes: 'person_id, nope', swapA: 'first_name', swapB: '' }], conflicts: { on: true, group: '', cols: [], missing: false } });
const msgs = K.problems(p4, null).filter(p => p.sev === 'err').map(p => p.msg).join(' | ');
ok('setup problems named', /uses the column it fills/.test(msgs) && /nope isn’t a kept column/.test(msgs) && /two different columns to swap/.test(msgs) && /choose the column that identifies/.test(msgs), msgs);

// 5. the page
(async () => {
  const { open } = require('./lib');
  const { browser, page, errors } = await open('python-script-generator.html');
  await page.click('#startOwn'); await page.click('#sampleIn'); await page.keyboard.insertText(csv);
  await page.click('#addFill');
  await page.selectOption('#fillList [data-i="0"] [data-f=col]', 'person_id');
  await page.fill('#fillList [data-i="0"] [data-f=passes]', 'first_name, last_name');
  await page.check('[data-k="conflicts.on"]'); await page.selectOption('#cfGroup', 'person_id'); await page.click('[data-cfcol="gender"]');
  await page.waitForTimeout(200);
  ok('page: row numbers added for the fill', /Added because/.test(await page.textContent('#rowNoNote')));
  const code = await page.evaluate(() => window.PSG.build(JSON.parse(localStorage.getItem('des.cfg')), null).py);
  ok('page: script has both sections', /FILLS = \[/.test(code) && /CONFLICT_COLUMNS = \["gender"\]/.test(code));
  await page.reload();
  ok('page: kept after reload', (await page.inputValue('#fillList [data-i="0"] [data-f=passes]')) === 'first_name, last_name' && (await page.$$eval('#cfChips [aria-pressed=true]', r => r.length)) === 1);
  await page.fill('[data-k=aiReq]', 'total hours per person'); await page.fill('[data-k=aiReply]', reply); await page.waitForTimeout(200);
  ok('page: the step and its code are shown', /def step\(df\)/.test(await page.textContent('#aiBody')));
  await page.setViewportSize({ width: 390, height: 800 });
  ok('390px overflow', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) === 0);
  ok('no page errors', !errors.length, JSON.stringify(errors));
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();

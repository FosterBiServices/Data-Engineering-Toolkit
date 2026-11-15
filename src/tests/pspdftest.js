/* PDF input in the Python Script Generator: set it up on the page, run the script on made-up PDFs (pdf_make.py), paste its
   sample back, run again. Needs Playwright, Chrome, Python with pandas, openpyxl, pdfplumber and reportlab. */
const { open } = require('./lib');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pspdf-'));
execFileSync('python3', [path.join(__dirname, 'pdf_make.py'), dir]);
let fails = 0; const ok = (label, cond, extra) => { console.log((cond ? 'ok   ' : 'FAIL ') + label + (extra ? ' ' + extra : '')); if (!cond) fails++; };
const run = (code, name) => { const f = path.join(dir, name + '.py'); fs.writeFileSync(f, code); return execFileSync('python3', [f], { cwd: dir, encoding: 'utf8' }); };
const readXl = (f, sheet) => JSON.parse(execFileSync('python3', ['-c', 'import pandas as pd,sys;d=pd.read_excel(sys.argv[1],sheet_name=sys.argv[2],dtype=str);print(d.fillna("").to_json(orient="records"))', f, sheet], { encoding: 'utf8' }));
(async () => {
  const { browser, page, errors } = await open('python-script-generator.html');
  await page.click('#clearEntries'); await page.click('#clearYes'); await page.reload();
  await page.selectOption('[data-k="input.kind"]', 'pdf');
  ok('pdf box shown', await page.isVisible('.pdfbox'));
  await page.fill('[data-k="input.path"]', path.join(dir, 'monthly'));
  await page.selectOption('[data-k="output.kind"]', 'excel');
  await page.fill('[data-k="output.path"]', path.join(dir, 'out', 'sales.xlsx'));
  await page.fill('[data-k="input.pdf.skip"]', 'Page , Total');
  await page.fill('#pdfSections', 'region = Region:');
  await page.fill('[data-k="input.pdf.month"]', 'report month');
  const code1 = await page.evaluate(() => document.getElementById('outWrap').hidden ? '' : window.PSG.build(JSON.parse(localStorage.getItem('des.cfg')), null).py);
  ok('script shown with no columns yet', !!code1);
  ok('settings in the script', code1.includes('SECTIONS = {"region": "Region:"}') && code1.includes('MONTH_FROM_FILE_NAME = "report_month"') && code1.includes('COLUMNS = None'));
  const o1 = run(code1, 'first');
  ok('first run reads 2 files, 10 rows', /Read 2 PDF file\(s\), 4 page\(s\): 10 row\(s\)/.test(o1), o1.split('\n')[0]);
  const rows = readXl(path.join(dir, 'out', 'sales.xlsx'), 'Data');
  ok('Data sheet: region and month filled', rows.length === 10 && rows.every(r => r.region && r.report_month), JSON.stringify(rows[0]));
  ok('PDF pages sheet', readXl(path.join(dir, 'out', 'sales.xlsx'), 'PDF pages').length === 4);
  // paste the sample it wrote, as from Excel (tab separated)
  const sample = execFileSync('python3', ['-c', 'import pandas as pd,sys;print(pd.read_csv(sys.argv[1],dtype=str).head(8).to_csv(sep="\\t",index=False))', path.join(dir, 'out', 'sales_sample.csv')], { encoding: 'utf8' });
  await page.click('#sampleIn'); await page.keyboard.insertText(sample);
  const cols = await page.evaluate(() => [...document.querySelectorAll('#mapBody tr[data-i]')].map(r => r.children[1].textContent + ':' + r.querySelector('[data-f=type]').value));
  ok('columns from the sample', cols.length === 8, cols.join(' '));
  await page.selectOption('#mapBody tr[data-i="1"] [data-f=type]', 'decimal');
  await page.selectOption('#mapBody tr[data-i="2"] [data-f=type]', 'decimal');
  const code2 = await page.evaluate(() => window.PSG.build(JSON.parse(localStorage.getItem('des.cfg')), null).py);
  const o2 = run(code2, 'second');
  ok('second run converts numbers', /Rows written:\s+10/.test(o2));
  const rows2 = readXl(path.join(dir, 'out', 'sales.xlsx'), 'Data');
  ok('Revenue is a number', rows2.some(r => r.revenue === '7407.0' || r.revenue === '7407'), rows2[0].revenue);
  // the other two layouts
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('des.cfg')); return c; });
  const other = await page.evaluate(d => { const K = window.PSG, mk = (p, set) => { const c = K.blank(); c.input.kind = 'pdf'; c.input.path = p; c.output.kind = 'excel'; c.output.path = d + '/out/' + set.out; Object.assign(c.input.pdf, set); return K.build(c, null).py; };
    return [mk(d + '/aligned_report.pdf', { out: 'a.xlsx', method: 'text', headerStarts: 'Site', skip: 'Page , Subtotal', sections: [{ name: 'region', label: 'Region' }] }),
      mk(d + '/label_report.pdf', { out: 'b.xlsx', method: 'label', names: 'measure, jan, feb, mar', values: 3, skip: 'Notes:', sections: [{ name: 'site', label: 'Site:' }, { name: 'manager', label: 'Manager:' }] })]; }, dir);
  run(other[0], 'aligned'); const a = readXl(path.join(dir, 'out', 'a.xlsx'), 'Data');
  ok('lined-up columns: 4 sites with regions', a.length === 4 && a.map(r => r.Site + '/' + r.region).join(',') === 'Harbor/East,Lakeside/East,Mesa/West,Pine Ridge/West', a.map(r => r.Site + '/' + r.region).join(','));
  run(other[1], 'label'); const b = readXl(path.join(dir, 'out', 'b.xlsx'), 'Data');
  ok('name then numbers: 6 rows, site and manager', b.length === 6 && b[0].measure === 'New orders' && b[0].site === 'Harbor' && b[0].manager === 'Pat Lee' && b[5].mar === '36', JSON.stringify(b[0]));
  await page.setViewportSize({ width: 390, height: 800 });
  ok('390px overflow', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) === 0);
  await page.reload();
  ok('after reload: pdf settings kept', await page.evaluate(() => document.getElementById('pdfSections').value === 'region = Region:' && document.querySelector('[data-k="input.pdf.month"]').value === 'report month'));
  ok('no page errors', !errors.length, JSON.stringify(errors));
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();

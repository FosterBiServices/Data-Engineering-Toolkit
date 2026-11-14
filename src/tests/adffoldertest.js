// The owner's screen: Copy or move files, a CSV dataset with only a folder parameter as source and destination, fixed folders.
const fs = require('fs'), { open } = require('./lib');
const DIR = process.env.SAMPLES || '/home/claude/samples';
if (!fs.existsSync(DIR)) { console.log('adffoldertest skipped: no samples folder (set SAMPLES)'); process.exit(0); }
const CSV = fs.readFileSync(DIR + '/ds_sample1.json', 'utf8');
(async () => {
  const { browser, page, errors } = await open('adf-pipeline-generator.html');
  const T = async (label, fn) => console.log(label, JSON.stringify(await page.evaluate(fn)));
  const pick = (n, v) => page.click('label:has(input[name=' + n + '][value=' + v + '])');
  await pick('srcKind', 'files');           // from the example, as he did
  await page.fill('[data-k="src.folder"]', 'yourproject/incoming/yourfolder'); await page.fill('[data-k="src.container"]', 'yourcontainer'); await page.fill('[data-k="src.ends"]', '.csv');
  await page.selectOption('[data-k="src.after"]', 'archive');
  for (const k of ['src', 'tgt']) { await pick('dsMode' + k, 'own'); await page.fill('[data-dsjson=' + k + ']', CSV); await page.selectOption('#dsMap' + k + ' select[data-p=file_path]', 'fixed'); }
  await page.fill('#dsMapsrc input[data-dsfixed]', 'yourproject/incoming/yourfolder'); await page.fill('#dsMaptgt input[data-dsfixed]', 'yourproject/yourfolder');
  await page.fill('[data-k="src.dest"]', 'yourproject/yourfolder');
  const msgs = () => [...document.querySelectorAll('#briefMsg .msg')].map(m => m.className.replace('msg ', '') + ': ' + m.textContent.slice(0, 120));
  await T('archive mode: what it says', msgs);
  await page.selectOption('[data-k="src.after"]', 'leave');
  await T('leave the originals: messages (expect no errors)', msgs);
  await T('flow', () => [...document.querySelectorAll('#flowBody tr')].map(r => r.children[1].textContent.trim()));
  await T('copy activity', () => { const p = JSON.parse(document.getElementById('plView').textContent).properties.activities[0]; return [p.typeProperties.source.storeSettings.wildcardFileName, p.inputs[0].parameters, p.outputs[0].parameters]; });
  await page.screenshot({ path: __dirname + '/adf_folder.png', fullPage: true });
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

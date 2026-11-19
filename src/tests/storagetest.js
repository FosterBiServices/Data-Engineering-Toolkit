// Junk in every saved key, then junk typed into every field and every button pressed: the pages must still open with no script errors.
const { open } = require('./lib');
const JUNK = ['null', '"x"', '[]', '{"layer":5,"silver":{"cols":[1,null,{"src":7}],"rules":"x"},"gold":{"metrics":[{}],"grain":[3]},"src":"x","load":{"keys":"no"},"tgt":null}', '{bad json', '12', '{"example":"yes","done":[1,{}],"check":{"a":1},"mode":3}'];
const TYPED = ['', '<img src=x onerror="window.__xss=1">', '"\'`;--', '\t\t\n\n', '{"properties":{"activities":[{"name":1,"dependsOn":"x","typeProperties":7},null,"a"]}}', '@@@ COLUMN @@@\nNAME:\nEXPR:', ' |-- <b>x</b>: string', '<b>a</b>,"b\n1,2,3', 'TABLE_SCHEMA\tCOLUMN_NAME\tDATA_TYPE\nx\t<i>y</i>\tint'];
(async () => {
  for (const [file, prefix] of [['adf-pipeline-generator.html', 'dea.'], ['python-notebook-generator.html', 'dep.'], ['python-script-generator.html', 'des.'], ['index.html', '']]) {
    const { browser, page, errors } = await open(file);
    if (prefix) for (const j of JUNK) { await page.evaluate(([p, v]) => { ['cfg', 'st', 'std', 'blank'].forEach(k => localStorage.setItem(p + k, v)); }, [prefix, j]); await page.reload(); }
    await page.evaluate(() => localStorage.clear()); await page.reload();
    let n = 0;
    for (const v of TYPED) {
      await page.evaluate(val => { document.querySelectorAll('details').forEach(d => { d.open = true; }); document.querySelectorAll('textarea, input[type=text], input[type=number]').forEach(el => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }); }, v);
      const count = await page.evaluate(() => document.querySelectorAll('button:not(#clearYes):not(#clearAllPages):not(#jobNew), [role=tab], select:not(#suiteSwitch):not(#jobList)').length);
      for (let i = 0; i < count; i++) { await page.evaluate(k => { const el = document.querySelectorAll('button:not(#clearYes):not(#clearAllPages):not(#jobNew), [role=tab], select:not(#suiteSwitch):not(#jobList)')[k]; if (!el) return; if (el.tagName === 'SELECT') { el.selectedIndex = el.options.length - 1; el.dispatchEvent(new Event('change', { bubbles: true })); } else if (!/Download/.test(el.textContent) && !el.dataset.save) el.click(); }, i); n++; }
    }
    const xss = await page.evaluate(() => window.__xss || document.querySelector('img[src=x]') ? 'MARKUP RAN' : 'none');
    console.log(file, '|', n, 'presses | typed markup ran:', xss, '| errors', JSON.stringify(errors.slice(0, 5)));
    await browser.close();
  }
})();

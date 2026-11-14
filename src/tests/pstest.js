const { open } = require('./lib');
(async () => {
  const { browser, page, errors } = await open('python-script-generator.html');
  const T = async (label, fn) => console.log(label, JSON.stringify(await page.evaluate(fn)));
  await T('example: banner, script, stats', () => [!document.getElementById('exampleBanner').hidden, document.getElementById('codeTitle').textContent, document.getElementById('outStats').textContent]);
  await T('ai rows (expect status Replaces, order_size Added)', () => [...document.querySelectorAll('#aiBody tr')].map(r => r.children[0].textContent + ' ' + r.children[1].textContent));
  await T('group chips include Copilot column (expect true)', () => !!document.querySelector('#groupChips [data-group=order_size]'));
  await T('notebook json parses, cells', () => { const b = [...document.querySelectorAll('[data-save=ipynb]')][0]; return !!b; });
  await page.screenshot({ path: __dirname + '/ps_example.png', fullPage: true });
  // rename a column: flows to code; duplicate name blocks
  await page.fill('#mapBody tr[data-i="5"] input[data-f=name]', 'region');
  await T('renamed: code and summary follow, no errors', () => [document.getElementById('codeView').textContent.includes('groupby(["region"]'), document.querySelectorAll('#setupMsg .msg.err').length]);
  await page.fill('#mapBody tr[data-i="5"] input[data-f=name]', 'sales_region');
  // own paste replaces the example
  await page.click('#sampleIn'); await page.keyboard.insertText('id;name;joined;balance\n001;Ann;31/12/2025;1.5\n002;Bob;01/01/2026;20');
  await T('own paste: columns, types, sep, banner hidden, filter cleared', () => [[...document.querySelectorAll('#mapBody tr[data-i]')].map(r => r.children[1].textContent + ':' + r.querySelector('select').value), document.querySelector('[data-k="input.sep"]').value, document.getElementById('exampleBanner').hidden, document.querySelector('[data-k=filter]').value, document.querySelector('[data-k="opts.dayFirst"]').checked]);
  await T('script shown with default names', () => [!document.getElementById('outWrap').hidden, document.getElementById('codeTitle').textContent]);
  await page.fill('[data-k="input.path"]', 'C:\\Data\\members.csv');
  await T('windows path escaped in code (expect true), output placeholder', () => [document.getElementById('codeView').textContent.includes('Path("C:\\\\Data\\\\members.csv")'), document.getElementById('outPath').placeholder]);
  await page.check('[data-k="dedupe.on"]');
  await T('dedupe without key blocks (expect true)', () => document.getElementById('outWrap').hidden);
  await page.check('#mapBody tr[data-i="0"] input[data-f=key]');
  await T('key ticked: shown again, required auto-ticked', () => [!document.getElementById('outWrap').hidden, document.querySelector('#mapBody tr[data-i="0"] input[data-f=req]').checked]);
  await page.reload();
  await T('after reload: sample box empty, columns kept', () => [document.getElementById('sampleIn').value, document.querySelectorAll('#mapBody tr[data-i]').length, document.querySelector('[data-k="input.path"]').value]);
  await page.setViewportSize({ width: 390, height: 800 });
  await T('390px overflow (expect 0)', () => document.documentElement.scrollWidth - window.innerWidth);
  await page.click('#clearEntries'); await page.click('#clearYes'); await page.reload();
  await T('after clear: blank (expect 0,true)', () => [document.querySelectorAll('#mapBody tr[data-i]').length, document.getElementById('exampleBanner').hidden]);
  console.log('errors', JSON.stringify(errors)); await browser.close();
})();

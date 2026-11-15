// Dark mode: text whose colour is too close to the background behind it, on every tab of every page.
const { open } = require('./lib');
(async () => {
  for (const pg of ['adf-pipeline-generator.html', 'python-notebook-generator.html', 'python-script-generator.html', 'index.html']) {
    const { browser, page } = await open(pg);
    await page.emulateMedia({ colorScheme: 'dark' });
    const tabs = await page.$$eval('#modeBar [data-tab]', b => b.map(x => x.dataset.tab)).catch(() => []);
    for (const t of tabs.length ? tabs : ['']) {
      if (t) await page.click('#modeBar [data-tab=' + t + ']');
      if (t === 'change') { await page.fill('#chgPl', JSON.stringify({ name: 'pl_x', properties: { activities: [{ name: 'nb', type: 'DatabricksNotebook', typeProperties: { notebookPath: '/Shared/a', baseParameters: { p: 'yourproject/x' } } }], variables: { v: { type: 'String', defaultValue: 'yourproject/' } } } })); await page.selectOption('#chgKind', 'replace'); await page.click('#chgAddBtn'); await page.fill('[data-ci="0"][data-cf=find]', 'yourproject/'); await page.fill('[data-ci="0"][data-cf=repl]', 'p/'); await page.click('#chgTabs [data-tab=diff]'); }
      await page.waitForTimeout(300);
      const bad = await page.evaluate(() => {
        const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
        const lum = c => { const a = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
        const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c; } return [255, 255, 255]; };
        const out = [];
        document.querySelectorAll('body *').forEach(el => { if (!el.offsetParent || el.closest('[hidden]')) return; const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName); if (!own) return;
          const f = rgb(getComputedStyle(el).color), b = bgOf(el), L1 = lum(f), L2 = lum(b), r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          if (r < 3) out.push(el.tagName + (el.id ? '#' + el.id : '') + '.' + el.className + ' "' + (el.value || el.textContent).trim().slice(0, 30) + '" ' + r.toFixed(1)); });
        return Array.from(new Set(out)).slice(0, 15);
      });
      console.log(pg, t || '-', bad.length ? bad : 'ok');
    }
    await browser.close();
  }
})();

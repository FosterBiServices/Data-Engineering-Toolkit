// Shared by the browser checks: opens a page of the built site from disk and collects script errors.
const path = require('path');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); }
const ROOT = path.resolve(__dirname, '..', '..');
exports.ROOT = ROOT;
exports.open = async function (file, opts) {
  const o = opts || {};
  const browser = await pw.chromium.launch(Object.assign({ args: ['--no-sandbox'] }, process.env.CHROME ? { executablePath: process.env.CHROME } : (require('fs').existsSync('/usr/bin/google-chrome') ? { executablePath: '/usr/bin/google-chrome' } : {})));
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 1200, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto('file://' + path.join(ROOT, file));
  return { browser, page, errors };
};

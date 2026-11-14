/* Shared by every page of the Foster BI Data Engineering Toolkit. */
(function (root) {
  'use strict';
  const S = {};
  S.SITE = 'Foster BI Data Engineering Toolkit';
  S.TOOLS = [
    { file: 'adf-pipeline-generator.html', name: 'ADF Pipeline Generator', prefix: 'dea.' },
    { file: 'python-notebook-generator.html', name: 'Python Notebook Generator', prefix: 'dep.' }
  ];
  S.PREFIXES = S.TOOLS.map(t => t.prefix);
  S.NEXT = {
    'adf-pipeline-generator.html': [['python-notebook-generator.html', 'Write the Databricks notebooks this pipeline runs']],
    'python-notebook-generator.html': [['adf-pipeline-generator.html', 'Build the ADF pipeline that runs this notebook']]
  };
  S.END = '=== END OF PROMPT ===';
  S.READ_RULE = '\n\nHOW TO READ THIS PROMPT\n'
    + '- The task is only what the TASK section asks for. Everything else is CONTEXT (facts to use), the STARTING POINT (code or text to change), RULES (how to do the task) or the REPLY FORMAT.\n'
    + '- Sample and example content is never a requirement. That includes the reply-format template, placeholders, and any example values, fields, records, tables, names, dates, filters or business rules. Don’t carry any of it into the task.\n'
    + '- If something here looks unrelated to the request or conflicts with it, don’t act on it. Mention it where the reply format allows questions or notes.';
  S.ONE_REPLY = '\n\nReply in one single response. If the complete reply is too long to show in full in the chat, put the whole reply, in the format asked for above, in one downloadable .txt file instead of splitting it across messages or shortening it.';
  S.PROMPT_WARN = 12000;
  S.fullPrompt = t => t.trim() + S.READ_RULE + S.ONE_REPLY + '\n\n' + S.END;

  S.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---- replies: labelled @@@ NAME @@@ blocks, as in the Power BI toolkit ---- */
  S.cleanReply = function (text) {
    let t = String(text || '').replace(/\r\n?/g, '\n');
    t = t.replace(/^[ \t]*```[a-zA-Z0-9_-]*[ \t]*$/gm, '');            // code fences
    t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"); // smart quotes
    t = t.replace(/\\([\[\]_*<>#])/g, '$1');                            // chat escapes
    t = t.replace(/ /g, ' ');
    return t;
  };
  S.parseBlocks = function (text) {
    const t = S.cleanReply(text), out = [];
    const re = /^[ \t]*@@@[ \t]*([A-Za-z][A-Za-z _]*?)[ \t]*@@@[ \t]*$/gm;
    let m, last = null;
    while ((m = re.exec(t))) {
      if (last) last.body = t.slice(last.from, m.index);
      last = { tag: m[1].trim().toUpperCase().replace(/\s+/g, ' '), from: re.lastIndex, body: '' };
      out.push(last);
    }
    if (last) last.body = t.slice(last.from);
    out.forEach(b => { b.body = b.body.replace(/^\n+|\s+$/g, ''); delete b.from; });
    return out;
  };
  /* "KEY: value" lines inside a block; a value runs on until the next KEY: line */
  S.fields = function (body, keys) {
    const out = {}; let cur = null;
    const re = new RegExp('^\\s*(' + keys.join('|') + ')\\s*:\\s?(.*)$', 'i');
    body.split('\n').forEach(line => {
      const m = re.exec(line);
      if (m) { cur = m[1].toUpperCase(); out[cur] = m[2]; }
      else if (cur) out[cur] += '\n' + line;
    });
    Object.keys(out).forEach(k => { out[k] = out[k].trim(); });
    return out;
  };

  if (typeof document === 'undefined') { if (typeof module !== 'undefined') module.exports = S; root.DE_SUITE = S; return; }

  S.$ = id => document.getElementById(id);

  /* ---- storage: one prefix per page ---- */
  S.store = function (prefix) {
    const ok = (() => { try { localStorage.setItem(prefix + 't', '1'); localStorage.removeItem(prefix + 't'); return true; } catch (e) { return false; } })();
    return {
      get(k, def) { if (!ok) return def; try { const v = localStorage.getItem(prefix + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
      set(k, v) { if (!ok) return; try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch (e) { } },
      del(k) { if (!ok) return; try { localStorage.removeItem(prefix + k); } catch (e) { } },
      clear() { if (!ok) return; try { Object.keys(localStorage).filter(k => k.indexOf(prefix) === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { } }
    };
  };
  S.clearAll = function () {
    S.PREFIXES.forEach(p => { const st = S.store(p); st.clear(); st.set('blank', true); });
  };

  /* ---- copy and download ---- */
  S.copyText = function (text, btn) {
    const done = () => { if (!btn) return; const old = btn.textContent; btn.textContent = 'Copied'; btn.classList.add('done'); setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1400); };
    const fallback = () => {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } ta.remove(); done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  };
  S.saveText = function (name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  /* buttons: data-copy="key" / data-save="key" read the text from getters[key]() */
  S.wireCopy = function (getters) {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-copy],[data-save]'); if (!b) return;
      const key = b.dataset.copy || b.dataset.save, g = getters[key]; if (!g) return;
      const v = g(); if (v == null || v === '') return;
      if (b.dataset.copy) S.copyText(typeof v === 'string' ? v : v.text, b);
      else S.saveText(v.name, v.text);
    });
  };
  S.readFile = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = rej; r.readAsText(file); });

  /* ---- small render helpers ---- */
  S.msg = (kind, html) => '<div class="msg ' + kind + '">' + html + '</div>';
  S.pill = (kind, text) => '<span class="pill ' + kind + '">' + S.esc(text) + '</span>';
  S.count = function (el, text) {
    if (!el) return;
    const n = text.length; el.textContent = n.toLocaleString('en-US') + ' characters';
    el.classList.toggle('high', n > S.PROMPT_WARN);
    el.title = n > S.PROMPT_WARN ? 'Long prompt: download it and send it to Copilot as a file' : '';
  };
  /* tabs: buttons [data-tab=x] inside bar, panes [data-pane=x] */
  S.tabs = function (bar, onChange) {
    const btns = Array.from(bar.querySelectorAll('[data-tab]'));
    const scope = bar.parentElement;
    const show = name => {
      btns.forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'));
      scope.querySelectorAll(':scope > [data-pane]').forEach(p => { p.hidden = p.dataset.pane !== name; });
      if (onChange) onChange(name);
    };
    btns.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    return show;
  };

  /* ---- nav, what next, footer ---- */
  S.page = () => (location.pathname.split('/').pop() || 'index.html');
  S.nav = function () {
    const top = document.querySelector('header.top'); if (!top || S.$('suiteNav')) return;
    const here = S.page();
    const nav = document.createElement('nav'); nav.id = 'suiteNav'; nav.className = 'suite-nav'; nav.setAttribute('aria-label', 'Toolkit');
    nav.innerHTML = '<a class="home" href="index.html">&larr; All tools</a>'
      + '<label class="switch"><span>Switch tool</span><select id="suiteSwitch">'
      + S.TOOLS.map(t => '<option value="' + t.file + '"' + (t.file === here ? ' selected' : '') + '>' + S.esc(t.name) + '</option>').join('')
      + '</select></label>';
    top.insertBefore(nav, top.firstChild);
    S.$('suiteSwitch').addEventListener('change', e => { location.href = e.target.value; });
    const next = S.NEXT[here], foot = document.querySelector('footer');
    if (next && foot) {
      const d = document.createElement('section'); d.className = 'whatnext';
      d.innerHTML = '<h2>What next</h2><ul>' + next.map(n => '<li><a href="' + n[0] + '">' + S.esc(n[1]) + '</a></li>').join('') + '</ul>';
      foot.parentElement.insertBefore(d, foot);
    }
  };

  /* ---- Clear entries: confirm inline, then empty the page and what it saved ---- */
  S.clearSetup = function (cfg) {
    const btn = S.$('clearEntries'), box = S.$('clearConfirm'), done = S.$('clearDone');
    if (!btn || !box) return;
    const open = v => { box.hidden = !v; btn.setAttribute('aria-expanded', v ? 'true' : 'false'); if (v && done) done.hidden = true; };
    btn.addEventListener('click', () => open(box.hidden));
    S.$('clearNo').addEventListener('click', () => open(false));
    S.$('clearYes').addEventListener('click', () => { open(false); cfg.onClear(); if (done) done.hidden = false; });
    const all = S.$('clearAllPages');
    if (all) all.addEventListener('click', () => { open(false); S.clearAll(); cfg.onClear(); if (done) { done.hidden = false; done.textContent = 'Every page of the toolkit was cleared.'; } });
  };

  /* ---- example handling: the first entry of your own replaces the whole example ----
     Fields marked data-own trigger it. cfg.isExample() says whether the example is showing;
     cfg.toBlank(keepEl) must empty every field except the one being edited. */
  S.ownEntry = function (cfg) {
    const hit = el => el && el.closest && el.closest('[data-own]');
    document.addEventListener('beforeinput', e => {
      if (!cfg.isExample() || !hit(e.target)) return;
      const el = e.target;
      if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|number|time|)$/.test(el.type))) { el.value = ''; cfg.toBlank(el); }
    }, true);
    document.addEventListener('change', e => {
      if (!cfg.isExample() || !hit(e.target)) return;
      cfg.toBlank(e.target);
    }, true);
  };

  root.DE_SUITE = S;
})(typeof window !== 'undefined' ? window : globalThis);

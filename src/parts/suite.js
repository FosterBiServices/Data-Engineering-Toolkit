/* Shared by every page of the Foster BI Data Engineering Toolkit. */
(function (root) {
  'use strict';
  const S = {};
  S.SITE = 'Foster BI Data Engineering Toolkit';
  S.TOOLS = [
    { file: 'adf-pipeline-generator.html', name: 'ADF Pipeline Generator', prefix: 'dea.' },
    { file: 'python-notebook-generator.html', name: 'Python Notebook Generator (Databricks)', prefix: 'dep.' },
    { file: 'python-script-generator.html', name: 'Python Script Generator (pandas)', prefix: 'des.' }
  ];
  S.PREFIXES = S.TOOLS.map(t => t.prefix);
  S.NEXT = {
    'adf-pipeline-generator.html': [['python-notebook-generator.html', 'Write the Databricks notebooks this pipeline runs']],
    'python-notebook-generator.html': [['adf-pipeline-generator.html', 'Build the ADF pipeline that runs this notebook'], ['python-script-generator.html', 'Prepare a file with pandas, outside Databricks']],
    'python-script-generator.html': [['python-notebook-generator.html', 'Do this at scale in Databricks: bronze, silver and gold notebooks'], ['adf-pipeline-generator.html', 'Load the cleaned data on a schedule with Azure Data Factory']]
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
      clear() { if (!ok) return; try { Object.keys(localStorage).filter(k => k.indexOf(prefix) === 0 && k !== prefix + 'jobs').forEach(k => localStorage.removeItem(k)); } catch (e) { } }   // saved work is kept
    };
  };
  S.clearAll = function () {
    S.PREFIXES.forEach(p => { const st = S.store(p); st.clear(); st.set('blank', true); });
  };

  /* ---- saved work (review, Nov 2026: one piece of work per page meant a second pipeline overwrote the first) ----
     A named copy of the page's saved setup (<prefix>cfg) in <prefix>jobs, kept when entries are cleared. Opening one
     writes it back as the page's setup and reloads, so each page's own loader checks it. Download / Open a file share a
     job with a colleague or keep a backup. o: { prefix, what: 'pipeline', tool: file name, place: element to sit before } */
  S.JOB_MAX = 200;
  S.jobs = function (o) {
    const P = o.prefix, get = (k, d) => { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
    const put = (k, v) => { try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    const list = () => { const a = get('jobs', []); return Array.isArray(a) ? a.filter(j => j && typeof j.name === 'string' && j.cfg && typeof j.cfg === 'object') : []; };
    const bar = document.createElement('div'); bar.className = 'jobs'; bar.id = 'jobBar';
    bar.innerHTML = '<span class="jobs-t">Saved ' + o.what + 's</span>'
      + '<input type="text" id="jobName" class="plain" spellcheck="false" autocomplete="off" aria-label="Name for this ' + o.what + '" placeholder="Name this ' + o.what + '">'
      + '<button type="button" class="btn" id="jobSave">Save</button><button type="button" class="btn" id="jobNew">New</button>'
      + '<select id="jobList" aria-label="Open a saved ' + o.what + '"></select>'
      + '<span class="jobs-more"><button type="button" class="linkbtn" id="jobDown">Download</button><label class="linkbtn filebtn">Open a file<input type="file" id="jobFile" accept=".json,application/json"></label><button type="button" class="linkbtn" id="jobDel">Delete</button></span>'
      + '<div class="jobs-msg" id="jobMsg" role="status" aria-live="polite"></div>';
    o.place.parentNode.insertBefore(bar, o.place);
    const $n = S.$('jobName'), $l = S.$('jobList'), $m = S.$('jobMsg');
    const cur = () => get('job', '');
    const say = (cls, html) => { $m.innerHTML = html ? '<span class="' + cls + '">' + html + '</span>' : ''; };
    const ask = (html, yes, label) => {
      $m.innerHTML = '<span class="warn">' + html + '</span> <button type="button" class="btn" data-jy>' + (label || 'Yes') + '</button><button type="button" class="linkbtn" data-jn>Cancel</button>';
      $m.querySelector('[data-jy]').onclick = () => { say(); yes(); }; $m.querySelector('[data-jn]').onclick = () => say();
    };
    const when = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
    const draw = () => {
      const a = list().sort((x, y) => x.name.localeCompare(y.name)), c = cur();
      $l.innerHTML = '<option value="">' + (a.length ? 'Open a saved ' + o.what + ' (' + a.length + ')' : 'Nothing saved yet') + '</option>'
        + a.map(j => '<option value="' + S.esc(j.name) + '"' + (j.name === c ? ' selected' : '') + '>' + S.esc(j.name) + (j.saved ? ' · ' + when(j.saved) : '') + '</option>').join('');
      $l.disabled = !a.length; if (document.activeElement !== $n) $n.value = c;
      S.$('jobDel').hidden = !a.some(j => j.name === c);
    };
    const changed = () => { const c = cur(), j = list().find(x => x.name === c), now = localStorage.getItem(P + 'cfg'); return j ? JSON.stringify(j.cfg) !== now : !!now && !get('st', {}).example; };
    const store = (name, cfg) => {
      const a = list().filter(j => j.name !== name); a.push({ name, saved: new Date().toISOString(), cfg });
      if (a.length > S.JOB_MAX) { say('err', 'You have ' + S.JOB_MAX + ' saved. Delete one first.'); return false; }
      if (!put('jobs', a)) { say('err', 'The browser refused to save (storage full?). Download it instead.'); return false; }
      put('job', name); return true;
    };
    const openCfg = (name, cfg) => {
      put('cfg', cfg); const st = get('st', {}) || {}; st.example = false; put('st', st);
      try { localStorage.removeItem(P + 'blank'); } catch (e) { } put('job', name); location.reload();
    };
    S.$('jobSave').addEventListener('click', () => {
      const name = $n.value.trim().slice(0, 80); if (!name) { say('err', 'Type a name first.'); $n.focus(); return; }
      let cfg; try { cfg = JSON.parse(localStorage.getItem(P + 'cfg')); } catch (e) { cfg = null; }
      if (!cfg) { say('err', 'Nothing to save yet.'); return; }
      const go = () => { if (store(name, cfg)) { draw(); say('ok', 'Saved as ' + S.esc(name) + '.'); } };
      if (name !== cur() && list().some(j => j.name === name)) ask('Replace the saved ' + o.what + ' ' + S.esc(name) + '?', go, 'Replace'); else go();
    });
    $l.addEventListener('change', () => {
      const name = $l.value, j = list().find(x => x.name === name); if (!j) return;
      if (name === cur() && !changed()) { draw(); return; }
      const go = () => openCfg(j.name, j.cfg);
      if (changed()) { draw(); ask('What is on the page now isn&rsquo;t saved. Open ' + S.esc(name) + ' anyway?', go, 'Open it'); } else go();
    });
    S.$('jobNew').addEventListener('click', () => {   // an empty setup; team standards, logging and saved work stay
      const go = () => { try { localStorage.removeItem(P + 'cfg'); localStorage.removeItem(P + 'job'); } catch (e) { } put('blank', true); const st = get('st', {}) || {}; st.example = false; put('st', st); location.reload(); };
      if (changed()) ask('What is on the page now isn&rsquo;t saved. Start a new ' + o.what + ' anyway?', go, 'Start new'); else go();
    });
    S.$('jobDel').addEventListener('click', () => {
      const c = cur(); if (!c) return;
      ask('Delete the saved ' + o.what + ' ' + S.esc(c) + '? What is on the page stays.', () => { put('jobs', list().filter(j => j.name !== c)); try { localStorage.removeItem(P + 'job'); } catch (e) { } draw(); say('ok', 'Deleted.'); }, 'Delete');
    });
    S.$('jobDown').addEventListener('click', () => {
      let cfg; try { cfg = JSON.parse(localStorage.getItem(P + 'cfg')); } catch (e) { cfg = null; }
      if (!cfg) { say('err', 'Nothing to download yet.'); return; }
      const name = $n.value.trim() || cur() || o.what;
      S.saveText(name.replace(/[^\w.-]+/g, '_') + '.' + o.tool + '.json', JSON.stringify({ tool: o.tool, name, saved: new Date().toISOString(), cfg }, null, 2));
      say('ok', 'Downloaded. Open it here on another computer with Open a file.');
    });
    S.$('jobFile').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        let d; try { d = JSON.parse(r.result); } catch (err) { say('err', 'That file isn&rsquo;t JSON.'); return; }
        if (!d || d.tool !== o.tool || !d.cfg || typeof d.cfg !== 'object') { say('err', 'That file wasn&rsquo;t saved from this page' + (d && d.tool ? ' (it is from ' + S.esc(String(d.tool)) + ')' : '') + '.'); return; }
        const name = String(d.name || f.name.replace(/\..*$/, '')).trim().slice(0, 80) || 'opened';
        const go = () => { if (store(name, d.cfg)) openCfg(name, d.cfg); };
        if (changed()) ask('What is on the page now isn&rsquo;t saved. Open ' + S.esc(name) + ' anyway?', go, 'Open it');
        else if (list().some(j => j.name === name)) ask('Replace the saved ' + o.what + ' ' + S.esc(name) + ' with the file?', go, 'Replace'); else go();
      };
      r.readAsText(f);
    });
    // Starting over or clearing means the page no longer shows the saved one
    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#startOwn, #clearYes, #clearAllPages')) setTimeout(() => { try { localStorage.removeItem(P + 'job'); } catch (err) { } draw(); }, 0); });
    draw();
    return { draw };
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
      const v = g(); if (v == null || v === '' || v === false || (typeof v === 'object' && !v.text)) { const old = b.textContent; b.textContent = 'Nothing to copy yet'; setTimeout(() => { b.textContent = old; }, 1600); return; }
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

/* Python Script Generator: page wiring. */
(function () {
  'use strict';
  const S = window.DE_SUITE, K = window.PSG, $ = S.$, esc = S.esc;
  const store = S.store('des.');
  let cfg, st, out = null, ai = null;
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const set = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const str = v => (typeof v === 'string' ? v : '');
  const oneOf = (list, v, def) => (list.indexOf(v) >= 0 ? v : def);

  /* saved data can be anything: rebuild it field by field */
  function restore(s) {
    const c = K.blank(); if (!s || typeof s !== 'object' || Array.isArray(s)) return c;
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), arr = a => (Array.isArray(a) ? a.filter(x => x && typeof x === 'object') : []);
    const copy = (to, from, keys) => keys.forEach(k => { if (typeof obj(from)[k] === typeof to[k]) to[k] = from[k]; });
    const kinds = K.KINDS.map(k => k[0]);
    copy(c, s, ['name', 'aiReq', 'aiReply']); c.keepRemoved = s.keepRemoved === true;
    c.filters = arr(s.filters).map(x => ({ when: str(x.when), label: str(x.label), join: x.join === 'or' ? 'or' : 'and' }));
    if (!c.filters.length && str(s.filter).trim()) c.filters = [{ when: str(s.filter), label: '', join: 'and' }];   // saved before filters became a list c.bad = oneOf(K.BAD.map(b => b[0]), s.bad, 'report');
    copy(c.input, s.input, ['path', 'sheet', 'encoding']); c.input.kind = oneOf(kinds, obj(s.input).kind, 'csv'); c.input.sep = oneOf([',', ';', 'tab', '|'], obj(s.input).sep, ','); c.input.skip = Math.max(0, parseInt(obj(s.input).skip, 10) || 0);
    const sp = obj(obj(s.input).pdf), pd0 = c.input.pdf;
    copy(pd0, sp, ['pattern', 'pages', 'headerStarts', 'names', 'skip', 'month', 'header', 'source']); pd0.method = oneOf(K.PDF_METHODS.map(m => m[0]), sp.method, 'table'); pd0.values = Math.max(0, parseInt(sp.values, 10) || 0);
    pd0.sections = arr(sp.sections).map(x => ({ name: str(x.name), label: str(x.label) })).filter(x => x.name || x.label);
    copy(c.opts, s.opts, ['trim', 'emptyNa', 'dropBlank', 'dropDupRows', 'sameCase', 'dayFirst']);
    c.cols = arr(s.cols).filter(x => str(x.src)).map(x => ({ src: str(x.src), name: str(x.name), type: oneOf(K.TYPES.map(t => t[0]), x.type, 'text'), on: x.on !== false, key: !!x.key, req: !!x.req }));
    copy(c.dedupe, s.dedupe, ['on', 'order']); c.dedupe.keep = oneOf(['first', 'last'], obj(s.dedupe).keep, 'last');
    copy(c.join, s.join, ['on', 'path', 'sheet', 'leftKey', 'rightKey', 'cols']); c.join.kind = oneOf(kinds, obj(s.join).kind, 'csv'); c.join.how = oneOf(['left', 'inner'], obj(s.join).how, 'left');
    c.summary.on = obj(s.summary).on === true; c.summary.group = (Array.isArray(obj(s.summary).group) ? s.summary.group : []).filter(x => typeof x === 'string');
    c.summary.metrics = arr(obj(s.summary).metrics).map(x => ({ name: str(x.name), agg: oneOf(K.AGGS.map(a => a[0]), x.agg, 'sum'), col: str(x.col) }));
    c.rules = arr(s.rules).map(x => ({ kind: oneOf(K.RULES.map(r => r[0]), x.kind, 'min'), col: str(x.col), val: str(x.val) }));
    copy(c.output, s.output, ['path']); c.output.kind = oneOf(kinds, obj(s.output).kind, 'csv');
    return c;
  }
  function load() {
    const s = store.get('st', null), o = s && typeof s === 'object' ? s : {};
    st = { example: o.example === true, done: (Array.isArray(o.done) ? o.done : []).filter(x => typeof x === 'string') };
    const saved = store.get('cfg', null);
    if (saved) cfg = restore(saved); else if (store.get('blank', false)) { cfg = K.blank(); st.example = false; } else { cfg = window.PSG_EX(K); st.example = true; }
  }
  const save = () => { store.set('cfg', cfg); store.set('st', st); };
  const opts = (list, cur, empty) => (empty != null ? '<option value="">' + esc(empty) + '</option>' : '') + list.map(o => { const v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
  const names = () => cfg.cols.filter(c => c.on).map(c => c.name).filter(Boolean);

  function fill(skip) {
    document.querySelectorAll('[data-k]').forEach(el => { if (el === skip || (el.tagName === 'SELECT' && el.id)) return; const v = get(cfg, el.dataset.k); if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v; });
    if ($('sampleIn') !== skip) $('sampleIn').value = st.example ? window.PSG_EX_SAMPLE : '';
    if ($('pdfSections') !== skip) $('pdfSections').value = cfg.input.pdf.sections.map(x => x.name + ' = ' + x.label).join('\n');
  }
  /* drop choices that point at columns that are gone */
  function prune() {
    const n = names(), all = K.known(cfg, null);
    if (n.indexOf(cfg.dedupe.order) < 0) cfg.dedupe.order = '';
    if (n.indexOf(cfg.join.leftKey) < 0) cfg.join.leftKey = '';
    if (!all.open) cfg.summary.group = cfg.summary.group.filter(g => all.all.indexOf(g) >= 0 || (ai && ai.ok.some(i => i.name === g)));
  }

  let drawing = false;
  function renderForm() {
    if (drawing) return;   /* replacing a focused box fires blur and change; a second redraw inside the first one throws */
    drawing = true;
    try { drawForm(); } finally { drawing = false; }
  }
  function drawForm() {
    ai = cfg.aiReq.trim() && cfg.aiReply.trim() ? K.aiParse(cfg.aiReply, cfg, S.parseBlocks, S.fields) : null;
    $('exampleBanner').hidden = !st.example;
    document.querySelectorAll('[data-kind]').forEach(el => { el.hidden = el.dataset.kind.split(' ').indexOf(cfg.input.kind) < 0; });
    document.querySelectorAll('[data-pdf]').forEach(el => { el.hidden = el.dataset.pdf.split(' ').indexOf(cfg.input.pdf.method) < 0; });
    $('mapBody').innerHTML = cfg.cols.map((c, i) => '<tr data-i="' + i + '"><td class="ck"><input type="checkbox" data-f="on"' + (c.on ? ' checked' : '') + ' aria-label="Keep ' + esc(c.src) + '"></td><td class="nm">' + esc(c.src) + '</td>'
      + '<td><input type="text" data-f="name" value="' + esc(c.name) + '" spellcheck="false" aria-label="New name for ' + esc(c.src) + '"></td><td><select data-f="type" aria-label="Type">' + opts(K.TYPES, c.type) + '</select></td>'
      + '<td class="ck"><input type="checkbox" data-f="key"' + (c.key ? ' checked' : '') + ' aria-label="Key"></td><td class="ck"><input type="checkbox" data-f="req"' + (c.req || c.key ? ' checked' : '') + (c.key ? ' disabled' : '') + ' aria-label="Required"></td></tr>').join('')
      || '<tr><td colspan="6" class="muted">Paste the header row and a few rows in Step 1 and the columns appear here.</td></tr>';
    const n = names(), on = cfg.cols.filter(c => c.on);
    $('dedupeBox').hidden = !cfg.dedupe.on; $('joinBox').hidden = !cfg.join.on; $('joinNote').hidden = !cfg.join.on; $('sumBox').hidden = !cfg.summary.on;
    $('dedupeOrder').innerHTML = opts(on.filter(c => /^(date|datetime|whole|decimal)$/.test(c.type)).map(c => [c.name, 'The one with the latest ' + c.name]), cfg.dedupe.order, 'By position in the file');
    $('keepBox').hidden = !!cfg.dedupe.order; $('joinSheet').hidden = cfg.join.kind !== 'excel';
    $('joinLeft').innerHTML = opts(n, cfg.join.leftKey, 'Choose a column');
    $('badSel').innerHTML = opts(K.BAD, cfg.bad);
    const all = K.known(cfg, ai).all;
    $('filterList').innerHTML = cfg.filters.map((f, i) => '<div class="rrow filt" data-list="filters" data-i="' + i + '">'
      + (i ? '<select data-f="join" aria-label="Combine with the filters before"><option value="and"' + (f.join !== 'or' ? ' selected' : '') + '>AND</option><option value="or"' + (f.join === 'or' ? ' selected' : '') + '>OR</option></select>' : '<span class="muted small" style="align-self:center">Keep if</span>')
      + '<input type="text" data-f="when" value="' + esc(f.when) + '" placeholder=\'order_date >= "2026-06-01"\' spellcheck="false" aria-label="Condition">'
      + '<input type="text" data-f="label" value="' + esc(f.label) + '" placeholder="name (optional)" spellcheck="false" aria-label="Name shown in Filtered out">'
      + '<button type="button" class="x" data-del aria-label="Remove filter">&times;</button></div>').join('');
    filterPreview();
    $('ruleList').innerHTML = cfg.rules.map((r, i) => '<div class="rrow" data-list="rules" data-i="' + i + '"><select data-f="col" aria-label="Column">' + opts(all, r.col, 'Column') + '</select><select data-f="kind" aria-label="Check">' + opts(K.RULES.map(x => [x[0], x[1]]), r.kind) + '</select>'
      + (r.kind === 'notfuture' ? '<span></span><span></span>' : '<input type="text" data-f="val" value="' + esc(r.val) + '" placeholder="' + esc((K.RULES.find(x => x[0] === r.kind) || [])[2] || '') + '" spellcheck="false" aria-label="Value" style="grid-column:span 2">') + '<button type="button" class="x" data-del aria-label="Remove check">&times;</button></div>').join('');
    $('groupChips').innerHTML = all.length ? all.map(c => '<button type="button" class="chip" data-group="' + esc(c) + '" aria-pressed="' + (cfg.summary.group.indexOf(c) >= 0 ? 'true' : 'false') + '">' + esc(c) + '</button>').join('') : '<span class="note small">Paste the sample in Step 1 first.</span>';
    $('metricList').innerHTML = cfg.summary.metrics.map((m, i) => '<div class="rrow" data-list="metrics" data-i="' + i + '"><input type="text" data-f="name" value="' + esc(m.name) + '" placeholder="total_amount" spellcheck="false" aria-label="Measure name"><select data-f="agg" aria-label="How">' + opts(K.AGGS, m.agg) + '</select>'
      + (m.agg === 'size' ? '<span style="grid-column:span 2"></span>' : '<select data-f="col" aria-label="Column" style="grid-column:span 2">' + opts(all, m.col, 'Column') + '</select>') + '<button type="button" class="x" data-del aria-label="Remove measure">&times;</button></div>').join('');
    $('checklist').innerHTML = K.CHECKLIST.map((t, i) => '<li><label><input type="checkbox" data-done="' + i + '"' + (st.done.indexOf(String(i)) >= 0 ? ' checked' : '') + '> <span>' + esc(t) + '</span></label></li>').join('');
    renderOut();
  }

  function filterPreview() {
    const act = K.activeFilters(cfg); $('filterLogic').textContent = act.length > 1 ? 'Rows are kept when: ' + K.filterLogic(act) + (act.some((f, i) => i && f.join === 'or') && act.some((f, i) => i && f.join !== 'or') && act.length > 2 ? '. Read left to right: each AND or OR applies to everything before it.' : '.') : '';
  }
  function renderOut() {
    filterPreview();
    const nm = K.names(cfg); $('outPath').placeholder = nm.outPath; $('scriptName').placeholder = nm.script;
    $('sampleStats').innerHTML = cfg.cols.length ? '<span class="stat"><b>' + cfg.cols.length + '</b> columns</span><span class="stat"><b>' + cfg.cols.filter(c => c.on && c.type !== 'text').length + '</b> converted from text</span>' : '';
    ai = null; const want = cfg.aiReq.trim().length > 0, msgs = [];
    $('aiBox').hidden = !want;
    if (want) {
      const prompt = S.fullPrompt(K.aiPrompt(cfg)); $('aiPromptView').textContent = prompt; S.count($('aiCount'), prompt);
      if (cfg.aiReply.trim()) {
        ai = K.aiParse(cfg.aiReply, cfg, S.parseBlocks, S.fields);
        if (!ai.any) msgs.push(S.msg('err', 'No labelled blocks were found in the reply. Ask Copilot to answer in the reply format, inside one code block, and paste the whole reply.'));
        ai.skipped.forEach(s => msgs.push(S.msg('warn', '<b>Not written:</b> ' + esc(s))));
        if (ai.notes.length) msgs.push(S.msg('info', '<b>Confirm these assumptions:</b><ul>' + ai.notes.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>'));
        $('aiBody').innerHTML = ai.items.map(c => '<tr><td class="nm">' + esc(c.name) + '</td><td>' + (c.problems.length ? S.pill('err', 'Not used') : S.pill(c.replaces ? 'replace' : 'ok', c.kind === 'FILTER' ? 'Used' : c.replaces ? 'Replaces' : 'Added')) + '</td><td><span class="mono" style="overflow-wrap:anywhere">' + esc(c.expr) + '</span>' + (c.problems.length ? '<ul>' + c.problems.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '') + '</td></tr>').join('');
        $('aiReview').hidden = !ai.items.length;
      } else $('aiReview').hidden = true;
    }
    $('aiMsg').innerHTML = msgs.join('');
    const probs = K.problems(cfg, ai), errs = probs.filter(p => p.sev === 'err');
    $('setupMsg').innerHTML = cfg.cols.length ? probs.map(p => S.msg(p.sev, esc(p.msg))).join('') : '';
    if (errs.length) { out = null; $('outWrap').hidden = true; $('outMsg').innerHTML = S.msg('warn', cfg.cols.length ? 'Fix the ' + (errs.length === 1 ? 'item' : errs.length + ' items') + ' marked in red in Step 3 and the script appears here.' : 'Paste the header row and a few rows in Step 1 and the script appears here.'); }
    else {
      out = K.build(cfg, ai); $('outWrap').hidden = false; $('outMsg').innerHTML = '';
      $('outStats').innerHTML = '<span class="stat"><b>' + esc(out.names.script) + '</b></span><span class="stat"><b>' + out.sections.length + '</b> steps</span><span class="stat"><b>' + out.stats.kept + '</b> columns</span><span class="stat"><b>' + out.stats.rules + '</b> checks</span><span class="stat">Needs <b>' + esc(out.needs.join(', ')) + '</b></span>' + (out.stats.ai ? '<span class="stat" style="background:var(--info-soft);color:var(--info)"><b>' + out.stats.ai + '</b> from Copilot</span>' : '');
      $('codeTitle').textContent = out.names.script + '.py'; $('codeView').textContent = out.py; $('howView').textContent = out.howto;
    }
    save();
  }

  function onSample(text) {
    const p = K.parseSample(text);
    $('sampleMsg').innerHTML = p.errors.map(e => S.msg('warn', esc(e))).join('');
    if (!p.cols.length) return;
    cfg.cols = K.mapCols(p, cfg.cols);
    if (cfg.input.kind === 'csv' && (p.delim === ';' || p.delim === '|')) cfg.input.sep = p.delim;
    if (p.dayFirst) cfg.opts.dayFirst = true;
    prune(); fill($('sampleIn'));
  }
  function toBlank(keep) { cfg = K.blank(); st.example = false; ai = null; $('sampleMsg').innerHTML = ''; fill(keep); renderForm(); }
  const listOf = row => (row.dataset.list === 'rules' ? cfg.rules : row.dataset.list === 'metrics' ? cfg.summary.metrics : row.dataset.list === 'filters' ? cfg.filters : cfg.cols);

  function init() {
    load(); S.nav(); fill(); S.tabs($('outTabs')); renderForm();
    document.addEventListener('input', e => {
      if (e.target.id === 'pdfSections') { cfg.input.pdf.sections = e.target.value.split('\n').map(l => { const k = l.indexOf('='); return k < 0 ? { name: l.trim(), label: '' } : { name: l.slice(0, k).trim(), label: l.slice(k + 1).trim() }; }).filter(x => x.name || x.label); renderOut(); return; }
      const el = e.target;
      if (el.id === 'sampleIn') { onSample(el.value); renderForm(); return; }
      const row = el.closest('[data-i]');
      if (row && el.dataset.f && el.tagName === 'INPUT' && el.type === 'text') {
        const it = listOf(row)[Number(row.dataset.i)]; if (!it) return;
        const was = it[el.dataset.f]; it[el.dataset.f] = el.value;
        if (!row.dataset.list && el.dataset.f === 'name' && was && el.value) {     // a renamed column takes its uses with it
          const sw = v => (v === was ? el.value : v);
          cfg.dedupe.order = sw(cfg.dedupe.order); cfg.join.leftKey = sw(cfg.join.leftKey); cfg.summary.group = cfg.summary.group.map(sw);
          cfg.summary.metrics.forEach(m => { m.col = sw(m.col); }); cfg.rules.forEach(r => { r.col = sw(r.col); });
          const word = new RegExp('(^|[^\\w"\'])' + was.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w"\'])', 'g');
          cfg.filters.forEach(f => { f.when = f.when.replace(word, (m0, p) => p + el.value); });
          document.querySelectorAll('#filterList [data-i]').forEach(r => { const f = cfg.filters[Number(r.dataset.i)], b = r.querySelector('[data-f="when"]'); if (f && b && b.value !== f.when) b.value = f.when; });
        }
        renderOut(); return;
      }
      if (el.dataset && el.dataset.k && el.tagName !== 'SELECT' && el.type !== 'checkbox') { set(cfg, el.dataset.k, el.type === 'number' ? Math.max(0, parseInt(el.value, 10) || 0) : el.value); renderOut(); }
    });
    document.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset && el.dataset.done != null) { st.done = st.done.filter(x => x !== el.dataset.done).concat(el.checked ? [el.dataset.done] : []); save(); return; }
      const row = el.closest('[data-i]');
      if (row && el.dataset.f) {
        const it = listOf(row)[Number(row.dataset.i)]; if (!it) return;
        if (el.type === 'checkbox') it[el.dataset.f] = el.checked; else if (el.tagName === 'SELECT') it[el.dataset.f] = el.value; else if (row.dataset.list) { renderOut(); return; } else { prune(); renderForm(); return; }   /* a redraw here would take the cursor out of the next box */
        if (!row.dataset.list && el.dataset.f === 'key' && it.key) it.req = true;
        prune(); renderForm(); return;
      }
      if (el.dataset && el.dataset.k && (el.tagName === 'SELECT' || el.type === 'checkbox')) { set(cfg, el.dataset.k, el.type === 'checkbox' ? el.checked : el.value); renderForm(); }
    });
    document.addEventListener('click', e => {
      const del = e.target.closest('[data-del]'), g = e.target.closest('[data-group]');
      if (del) { const row = del.closest('[data-i]'); listOf(row).splice(Number(row.dataset.i), 1); renderForm(); }
      else if (g) { const a = cfg.summary.group, i = a.indexOf(g.dataset.group); if (i >= 0) a.splice(i, 1); else a.push(g.dataset.group); renderForm(); }
    });
    $('addRule').addEventListener('click', () => { cfg.rules.push({ kind: 'min', col: '', val: '' }); renderForm(); });
    $('addFilter').addEventListener('click', () => { cfg.filters.push({ when: '', label: '', join: 'and' }); renderForm(); const all = document.querySelectorAll('#filterList input[data-f="when"]'); if (all.length) all[all.length - 1].focus(); });
    $('addMetric').addEventListener('click', () => { cfg.summary.metrics.push({ name: '', agg: 'sum', col: '' }); renderForm(); });
    $('startOwn').addEventListener('click', () => toBlank(null));
    S.ownEntry({ isExample: () => st.example, toBlank });
    S.clearSetup({ onClear: () => { store.clear(); store.set('blank', true); st = { example: false, done: [] }; cfg = K.blank(); $('sampleMsg').innerHTML = ''; fill(); renderForm(); } });
    S.wireCopy({
      aiPrompt: () => ({ name: 'python-script-prompt.txt', text: $('aiPromptView').textContent }),
      py: () => out && ({ name: out.names.script + '.py', text: out.py }), ipynb: () => out && ({ name: out.names.script + '.ipynb', text: out.ipynb }), howto: () => out && out.howto
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

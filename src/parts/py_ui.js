/* Python Notebook Generator: page wiring. */
(function () {
  'use strict';
  const S = window.DE_SUITE, P = window.PYG, $ = S.$, esc = S.esc;
  const store = S.store('dep.');
  let cfg, st, log, out = null, ai = null;

  const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const str = v => (typeof v === 'string' ? v : '');
  /* saved data can be anything: rebuild it field by field */
  function restore(saved) {
    const c = P.blank(); if (!saved || typeof saved !== 'object') return c;
    const copy = (to, from, keys) => keys.forEach(k => { if (from && typeof from[k] === typeof to[k] && !Array.isArray(to[k])) to[k] = from[k]; });
    copy(c, saved, ['entity', 'subject', 'folder']); if (/^(bronze|silver|gold)$/.test(saved.layer)) c.layer = saved.layer;
    if (saved.scope === 'any') c.scope = 'any'; if (saved.any && typeof saved.any === 'object') { copy(c.any, saved.any, ['keys', 'storage', 'trim', 'emptyNull', 'dropDupRows']); }
    copy(c.cat, saved.cat, ['bronze', 'silver', 'gold']); copy(c.bronze, saved.bronze, ['format', 'path']);
    const sv = saved.silver || {}, g = saved.gold || {}, arr = a => (Array.isArray(a) ? a.filter(x => x && typeof x === 'object') : []);
    copy(c.silver, sv, ['schemaText', 'orderCol', 'tz', 'softDelete', 'cluster', 'aiReq', 'aiReply']);
    c.silver.cols = arr(sv.cols).filter(x => str(x.src)).map(x => ({ src: str(x.src), name: str(x.name), type: P.TYPES.indexOf(x.type) >= 0 || /^decimal\(\d+,\d+\)$/.test(x.type) ? x.type : 'string', clean: str(x.clean) || 'none', on: x.on !== false, key: !!x.key, notnull: !!x.notnull }));
    c.silver.rules = arr(sv.rules).map(x => ({ kind: P.RULES.some(r => r[0] === x.kind) ? x.kind : 'min', col: str(x.col), val: str(x.val), name: str(x.name) }));
    copy(c.gold, g, ['name', 'schemaText', 'mode', 'rebuildCol', 'softDelete', 'aiReq', 'aiReply']); if (!/^(dates|full)$/.test(c.gold.mode)) c.gold.mode = 'dates';
    c.gold.cols = arr(g.cols).filter(x => str(x.name)).map(x => ({ name: str(x.name), type: str(x.type) || 'string' }));
    c.gold.grain = (Array.isArray(g.grain) ? g.grain : []).filter(x => typeof x === 'string');
    c.gold.metrics = arr(g.metrics).map(x => ({ name: str(x.name), agg: P.AGGS.some(a => a[0] === x.agg) ? x.agg : 'sum', col: str(x.col), filter: str(x.filter) }));
    c.gold.derived = arr(g.derived).map(x => ({ name: str(x.name), expr: str(x.expr) }));
    return c;
  }
  function load() {
    const s = store.get('st', null); st = { example: !!(s && s.example), done: (s && Array.isArray(s.done) ? s.done : []).filter(x => typeof x === 'string') };
    const lg = store.get('log', null), d = P.defaultLog(); log = d;      // the logging setup outlives the entity: it is the team's, not the table's
    if (lg && typeof lg === 'object' && !Array.isArray(lg)) { ['on', 'start', 'ok', 'fail'].forEach(k => { if (typeof lg[k] === 'boolean') log[k] = lg[k]; }); ['line', 'call', 'nbPath'].forEach(k => { if (typeof lg[k] === 'string') log[k] = lg[k].slice(0, 600); }); if (P.LOG_LOADS.some(x => x[0] === lg.load)) log.load = lg.load;
      if (typeof lg.timeout === 'number') log.timeout = Math.max(0, Math.min(86400, Math.round(lg.timeout)));
      const uses = P.LOG_TOKENS.map(x => x[0]).concat(['fixed']);
      if (Array.isArray(lg.params)) log.params = lg.params.filter(r => r && typeof r === 'object').slice(0, 40).map(r => ({ name: String(r.name == null ? '' : r.name).slice(0, 100), use: uses.indexOf(r.use) >= 0 ? r.use : 'fixed', value: String(r.value == null ? '' : r.value).slice(0, 300) })); }
    const saved = store.get('cfg', null);
    if (saved) cfg = restore(saved); else if (store.get('blank', false)) { cfg = P.blank(); st.example = false; } else { cfg = window.PYG_EX(P); st.example = true; }
  }
  const save = () => { store.set('cfg', cfg); store.set('st', st); store.set('log', log); };
  const L = () => cfg.layer, sub = () => cfg[cfg.layer];

  function fill(skip) {
    document.querySelectorAll('[data-k]').forEach(el => { if (el === skip || el.tagName === 'SELECT' && el.id) return; const v = get(cfg, el.dataset.k); if (el.type === 'checkbox') { el.checked = !!v; return; } if (el.type === 'radio') el.checked = el.value === v; else el.value = v == null ? '' : v; });
    document.querySelectorAll('[data-g]').forEach(el => { if (el === skip || el.tagName === 'SELECT') return; if (el.type === 'checkbox') el.checked = !!log[el.dataset.g]; else el.value = log[el.dataset.g] == null ? '' : log[el.dataset.g]; });
    if ($('schemaIn') !== skip) $('schemaIn').value = L() === 'bronze' ? '' : sub().schemaText;
    if ($('aiReq') !== skip) $('aiReq').value = L() === 'bronze' ? '' : sub().aiReq;
    $('aiReply').value = L() === 'bronze' ? '' : sub().aiReply;
  }

  const opts = (list, cur, emptyLabel) => (emptyLabel != null ? '<option value="">' + esc(emptyLabel) + '</option>' : '') + list.map(o => { const v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
  const silverNames = () => cfg.silver.cols.filter(c => c.on).map(c => c.name).filter(Boolean);

  /* the parts of the form that are built from the data */
  function renderForm() {
    const layer = L();
    document.querySelectorAll('#layerBar [data-layer]').forEach(b => b.setAttribute('aria-selected', b.dataset.layer === layer ? 'true' : 'false'));
    $('exampleBanner').hidden = !st.example;
    $('inBronze').hidden = layer !== 'bronze'; $('inPaste').hidden = false; $('useSilverBox').hidden = layer !== 'gold'; $('schemaIn').hidden = layer === 'bronze';
    $('setBronze').hidden = layer !== 'bronze'; $('setSilver').hidden = layer !== 'silver'; $('setGold').hidden = layer !== 'gold';
    $('aiStep').hidden = layer === 'bronze'; $('outNum').textContent = layer === 'bronze' ? '4' : '5';
    const any = cfg.scope === 'any';
    $('entityBox').hidden = any; $('setAny').hidden = !any; $('anySilverOpts').hidden = layer !== 'silver';
    document.querySelector('section[aria-labelledby="s2"]').hidden = any;
    $('adfNote').hidden = any;
    if (any) { $('s3p').textContent = 'Nothing about the columns is needed: the notebook cleans whatever the file holds. Choose the options, and give the business key if the objects share one.'; $('setBronze').hidden = true; $('setSilver').hidden = true; $('setGold').hidden = true; $('aiStep').hidden = true; $('outNum').textContent = '3'; }
    document.querySelector('section[aria-labelledby="s3"] .step-num b').textContent = any ? '2' : '3';
    $('s2p').textContent = layer === 'bronze' ? 'Bronze takes the files as they are, so the page only needs the format. The context cell is optional: it shows what the files hold before you land them.' : layer === 'silver' ? 'The page can’t see your workspace. Run one cell against the bronze table and paste what it prints, so every column name and type is exact.' : 'Gold reads silver. Take the columns from the silver setup on this page, or run the cell against the silver table and paste what it prints.';
    $('s3p').textContent = layer === 'silver' ? 'Every silver column is named, typed and cleaned on purpose. Names are suggested in snake_case; change anything.' : layer === 'gold' ? 'Say what one row is and what to measure. The notebook recomputes only what changed and checks its totals against silver.' : 'Bronze is a faithful, replayable copy of the source.';
    $('s4p').textContent = layer === 'gold' ? 'For metrics the boxes above can’t express. Copilot writes the PySpark expressions; the page checks them against your columns before using them.' : 'For derived columns and quality rules the boxes above can’t express. Copilot writes the PySpark expressions; the page checks them against your columns before using them.';
    $('aiReq').placeholder = layer === 'gold' ? 'Count the orders where order_size is Large, and give their share of all orders.' : 'Add a column order_size: Small when the amount is under 100, Medium under 1000, otherwise Large.\nFlag rows where the ship date is before the order date.';
    if (layer === 'silver') {
      const sv = cfg.silver;
      $('mapBody').innerHTML = sv.cols.map((c, i) => '<tr data-i="' + i + '"><td class="ck"><input type="checkbox" data-f="on"' + (c.on ? ' checked' : '') + ' aria-label="Use ' + esc(c.src) + '"></td><td class="nm">' + esc(c.src) + '</td>'
        + '<td><input type="text" data-f="name" value="' + esc(c.name) + '" spellcheck="false" aria-label="Silver name for ' + esc(c.src) + '"></td>'
        + '<td><select data-f="type" aria-label="Type">' + opts(P.TYPES.indexOf(c.type) >= 0 ? P.TYPES : P.TYPES.concat([c.type]), c.type) + '</select></td>'
        + '<td>' + (P.CLEAN[c.type] ? '<select data-f="clean" aria-label="Clean">' + opts(P.CLEAN[c.type], c.clean) + '</select>' : '<span class="muted small">Cast</span>') + '</td>'
        + '<td class="ck"><input type="checkbox" data-f="key"' + (c.key ? ' checked' : '') + ' aria-label="Key"></td><td class="ck"><input type="checkbox" data-f="notnull"' + (c.notnull || c.key ? ' checked' : '') + (c.key ? ' disabled' : '') + ' aria-label="Not null"></td></tr>').join('')
        || '<tr><td colspan="7" class="muted">Paste the bronze schema in Step 2 and its columns appear here.</td></tr>';
      const on = sv.cols.filter(c => c.on);
      $('orderCol').innerHTML = opts(on.filter(c => /^(timestamp|date|bigint|int)$/.test(c.type)).map(c => c.name), sv.orderCol, 'None (the row ingested last wins)');
      $('softDel').innerHTML = opts(on.filter(c => c.type === 'boolean').map(c => c.name), sv.softDelete, 'None');
      $('clusterCol').innerHTML = opts(on.map(c => c.name), sv.cluster, 'No clustering');
      $('tzBox').hidden = !on.some(c => c.clean === 'utc');
      $('ruleList').innerHTML = sv.rules.map((r, i) => '<div class="rrow" data-list="rules" data-i="' + i + '">'
        + (r.kind === 'expr' ? '<input type="text" data-f="name" value="' + esc(r.name) + '" placeholder="rule_name" spellcheck="false" aria-label="Rule name">' : '<select data-f="col" aria-label="Column">' + opts(silverNames(), r.col, 'Column') + '</select>')
        + '<select data-f="kind" aria-label="Rule">' + opts(P.RULES.map(x => [x[0], x[1]]), r.kind) + '</select>'
        + (r.kind === 'notfuture' ? '<span></span>' : '<input type="text" data-f="val" value="' + esc(r.val) + '" placeholder="' + esc((P.RULES.find(x => x[0] === r.kind) || [])[2] || '') + '" spellcheck="false" aria-label="Value" style="grid-column:span 2">')
        + (r.kind === 'notfuture' ? '<span></span>' : '') + '<button type="button" class="x" data-del aria-label="Remove rule">&times;</button></div>').join('');
    }
    if (layer === 'gold') {
      const g = cfg.gold, names = g.cols.map(c => c.name);
      $('goldDel').innerHTML = opts(g.cols.filter(c => c.type === 'boolean').map(c => c.name), g.softDelete, 'None');
      $('grainChips').innerHTML = g.cols.length ? g.cols.filter(c => !/^_/.test(c.name)).map(c => '<button type="button" class="chip" data-grain="' + esc(c.name) + '" aria-pressed="' + (g.grain.indexOf(c.name) >= 0 ? 'true' : 'false') + '">' + esc(c.name) + '<small>' + esc(c.type) + '</small></button>').join('') : '<span class="note small">Give the silver columns in Step 2 first.</span>';
      $('rebuildBox').hidden = g.mode !== 'dates';
      $('rebuildCol').innerHTML = opts(g.cols.filter(c => g.grain.indexOf(c.name) >= 0 && /^(date|timestamp)$/.test(c.type)).map(c => c.name), g.rebuildCol, g.grain.length ? 'Choose a date column' : 'Choose the grain first');
      $('metricList').innerHTML = g.metrics.map((m, i) => '<div class="rrow" data-list="metrics" data-i="' + i + '"><input type="text" data-f="name" value="' + esc(m.name) + '" placeholder="metric_name" spellcheck="false" aria-label="Metric name">'
        + '<select data-f="agg" aria-label="Aggregation">' + opts(P.AGGS, m.agg) + '</select><select data-f="col" aria-label="Column">' + opts(names, m.col, m.agg === 'count' ? 'All rows' : 'Column') + '</select>'
        + '<input type="text" data-f="filter" value="' + esc(m.filter) + '" placeholder="only where (optional): status = \'CANCELLED\'" spellcheck="false" aria-label="Only where"><button type="button" class="x" data-del aria-label="Remove metric">&times;</button></div>').join('');
      $('derivedList').innerHTML = g.derived.map((d, i) => '<div class="rrow" data-list="derived" data-i="' + i + '"><input type="text" data-f="name" value="' + esc(d.name) + '" placeholder="metric_name" spellcheck="false" aria-label="Name">'
        + '<input type="text" data-f="expr" value="' + esc(d.expr) + '" placeholder="gross_sales_amount - cancelled_amount" spellcheck="false" aria-label="Formula" style="grid-column:span 3"><button type="button" class="x" data-del aria-label="Remove calculation">&times;</button></div>').join('');
    }
    $('logBox').hidden = !log.on; $('logLoad').innerHTML = opts(P.LOG_LOADS, log.load); $('logLineBox').hidden = log.load === 'none' || log.load === 'nbrun';
    $('nbrunBox').hidden = log.load !== 'nbrun'; $('callBox').hidden = log.load === 'nbrun';
    const lr = $('logRows');
    if (!(lr.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) lr.innerHTML = log.params.map((r, i) => '<div class="rrow log4" data-logrow="' + i + '"><input type="text" data-lf="name" value="' + esc(r.name) + '" placeholder="widget name" spellcheck="false" aria-label="Parameter name"><select data-lf="use" aria-label="Value">' + opts(P.LOG_TOKENS.map(k => [k[0], k[1].charAt(0).toUpperCase() + k[1].slice(1)]).concat([['fixed', 'Fixed text']]), r.use) + '</select>'
      + (r.use === 'fixed' ? '<input type="text" data-lf="value" value="' + esc(r.value) + '" placeholder="text to send" spellcheck="false" aria-label="Fixed text">' : '<span></span>') + '<button type="button" class="x" data-logdel aria-label="Remove parameter">&times;</button></div>').join('');
    $('logLineLbl').textContent = log.load === 'import' ? 'Import line' : 'Notebook to %run'; $('logLine').placeholder = log.load === 'import' ? 'from shared.logging import log_run' : '/Shared/utilities/nb_logging';
    $('logCall').placeholder = P.LOG_EXAMPLE;
    $('logTokens').innerHTML = P.LOG_TOKENS.map(k => '<button type="button" class="chip" data-token="' + k[0] + '" title="' + esc(k[1]) + '">{' + k[0] + '}</button>').join('');
    $('logHint').textContent = (log.fail ? 'To log a failure, the notebook\u2019s working steps go into one cell inside try/except; the error is logged and then raised again, so ADF still sees the activity fail. ' : '') + 'If your ADF pipeline also logs each run, a run is recorded twice: once from here and once from the pipeline. Choose one place, or use different statuses.';
    $('checklist').innerHTML = P.CHECKLIST.all.concat(P.CHECKLIST[layer]).map((t, i) => '<li><label><input type="checkbox" data-done="' + layer + i + '"' + (st.done.indexOf(layer + i) >= 0 ? ' checked' : '') + '> <span>' + esc(t) + '</span></label></li>').join('');
    renderOut();
  }

  /* everything computed from the form; safe to call on every keystroke */
  function renderOut() {
    const layer = L(), n = P.names(cfg);
    if (cfg.scope === 'any') $('nameStats').innerHTML = '<span class="stat">Notebook <b>' + esc(n.nb) + '</b></span><span class="stat">Writes <b>' + esc(layer === 'gold' ? n.gold : n.silver) + '</b></span>';
    else $('nameStats').innerHTML = '<span class="stat">Notebook <b>' + esc(n.nb) + '</b></span>' + (layer === 'bronze' ? '<span class="stat">Writes <b>' + esc(n.bronze) + '</b></span>' : layer === 'silver' ? '<span class="stat">Reads <b>' + esc(n.bronze) + '</b></span><span class="stat">Writes <b>' + esc(n.silver) + '</b></span><span class="stat">Quarantine <b>' + esc(n.quarantine) + '</b></span>' : '<span class="stat">Reads <b>' + esc(n.silver) + '</b></span><span class="stat">Writes <b>' + esc(n.gold) + '</b></span>');
    $('contextView').textContent = P.contextCell(cfg);
    if (layer !== 'bronze') {
      const s = sub(), parsed = P.parseSchema(s.schemaText), have = layer === 'silver' ? s.cols.length : s.cols.length;
      $('schemaStats').innerHTML = have ? '<span class="stat"><b>' + have + '</b> columns</span>' + (layer === 'silver' && parsed.cols.length > have ? '<span class="stat">' + (parsed.cols.length - have) + ' metadata columns (starting with _) are carried by the notebook itself</span>' : '') : '';
      $('schemaMsg').innerHTML = s.schemaText.trim() ? parsed.errors.map(e => S.msg('warn', esc(e))).join('') : '';
    } else { $('schemaStats').innerHTML = ''; $('schemaMsg').innerHTML = ''; }
    const probs = P.problems(cfg).concat(P.logProblems(log));
    $('setupMsg').innerHTML = probs.map(p => S.msg(p.sev, esc(p.msg))).join('');
    /* Copilot */
    ai = null;
    const want = cfg.scope !== 'any' && layer !== 'bronze' && sub().aiReq.trim().length > 0;   /* any object: no Copilot columns, nothing about the columns is known */
    $('aiBox').hidden = !want;
    if (want) {
      const prompt = S.fullPrompt(P.aiPrompt(cfg)); $('aiPromptView').textContent = prompt; S.count($('aiCount'), prompt);
      const msgs = [];
      if (sub().aiReply.trim()) {
        ai = P.aiParse(sub().aiReply, cfg, S.parseBlocks, S.fields);
        if (!ai.any) msgs.push(S.msg('err', 'No labelled blocks were found in the reply. Ask Copilot to answer in the reply format, inside one code block, and paste the whole reply.'));
        ai.skipped.forEach(s => msgs.push(S.msg('warn', '<b>Not written:</b> ' + esc(s))));
        if (ai.notes.length) msgs.push(S.msg('info', '<b>Confirm these assumptions:</b><ul>' + ai.notes.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>'));
        $('aiBody').innerHTML = ai.items.map(c => '<tr><td class="nm">' + esc(c.name) + '</td><td>' + esc(c.kind.charAt(0) + c.kind.slice(1).toLowerCase()) + (c.type ? ' <span class="muted">' + esc(c.type) + '</span>' : '') + '</td><td>' + (c.problems.length ? S.pill('err', 'Not used') : S.pill(c.replaces ? 'replace' : 'ok', c.replaces ? 'Replaces' : 'Added')) + '</td><td><span class="mono" style="overflow-wrap:anywhere">' + esc(c.expr) + '</span>' + (c.problems.length ? '<ul>' + c.problems.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '') + '</td></tr>').join('');
        $('aiReview').hidden = !ai.items.length;
      } else $('aiReview').hidden = true;
      $('aiMsg').innerHTML = msgs.join('');
    }
    /* output */
    const errs = probs.filter(p => p.sev === 'err');
    if (errs.length) { out = null; $('outWrap').hidden = true; $('outMsg').innerHTML = S.msg('warn', 'Fix the ' + (errs.length === 1 ? 'item' : errs.length + ' items') + ' marked in red in Step 3 and the notebook appears here.'); }
    else {
      out = P.build(cfg, ai, log); $('outWrap').hidden = false; $('outMsg').innerHTML = out.placeholders.length ? S.msg('warn', '<b>Replace before you run it:</b> ' + out.placeholders.map(p => '<span class="mono">' + esc(p) + '</span>').join(', ')) : '';
      const lines = out.code.split('\n').length, used = ai ? ai.ok.length : 0;
      $('outStats').innerHTML = '<span class="stat"><b>' + esc(out.names.nb) + '</b></span><span class="stat"><b>' + lines + '</b> lines</span>'
        + (layer === 'silver' && out.silver ? '<span class="stat"><b>' + out.silver.outCols.length + '</b> columns</span><span class="stat"><b>' + out.silver.rules.length + '</b> quality rules</span>' : '')
        + (layer === 'gold' && !out.any ? '<span class="stat"><b>' + (cfg.gold.metrics.length + cfg.gold.derived.length + (ai ? ai.ok.length : 0)) + '</b> metrics</span>' : '') + (used ? '<span class="stat" style="background:var(--info-soft);color:var(--info)"><b>' + used + '</b> from Copilot</span>' : '') + (out.logged ? '<span class="stat">Logs with your utility</span>' : '');
      $('codeTitle').textContent = out.names.nb + '.py'; $('codeView').textContent = out.code;
      $('adfView').textContent = out.adf; $('actView').textContent = JSON.stringify(out.activity, null, 4); $('checksView').textContent = out.checks;
    }
    save();
  }

  function onSchema(text) {
    const s = sub(); s.schemaText = text; const parsed = P.parseSchema(text);
    if (L() === 'silver') {
      const sv = cfg.silver; sv.cols = P.mapCols(parsed, sv.cols); const names = sv.cols.map(c => c.name);
      if (names.indexOf(sv.orderCol) < 0) sv.orderCol = P.suggestOrder(sv.cols);
      if (names.indexOf(sv.softDelete) < 0) sv.softDelete = (sv.cols.find(c => c.type === 'boolean' && /delet/.test(c.name)) || {}).name || '';
      if (names.indexOf(sv.cluster) < 0) sv.cluster = '';
      if (!sv.cols.some(c => c.key)) { const e = P.snake(cfg.entity).replace(/s$/, ''); const k = sv.cols.find(c => c.name === e + '_id') || sv.cols.find(c => c.name === 'id'); if (k) { k.key = true; k.notnull = true; } }
    } else if (L() === 'gold') { cfg.gold.cols = parsed.cols.map(c => ({ name: c.name, type: c.type })); pruneGold(); }
  }
  function pruneGold() { const g = cfg.gold, names = g.cols.map(c => c.name); g.grain = g.grain.filter(x => names.indexOf(x) >= 0); if (g.grain.indexOf(g.rebuildCol) < 0) g.rebuildCol = (g.cols.find(c => g.grain.indexOf(c.name) >= 0 && c.type === 'date') || {}).name || ''; if (names.indexOf(g.softDelete) < 0) g.softDelete = ''; }

  function toBlank(keep) { cfg = Object.assign(P.blank(), { layer: cfg.layer }); st.example = false; ai = null; fill(keep); renderForm(); }

  function init() {
    load(); S.nav(); fill(); S.tabs($('outTabs')); renderForm();
    $('layerBar').addEventListener('click', e => { const b = e.target.closest('[data-layer]'); if (!b) return; cfg.layer = b.dataset.layer; fill(); renderForm(); });
    document.addEventListener('input', e => {
      const el = e.target;
      if (el.id === 'schemaIn') { onSchema(el.value); renderForm(); return; }
      if (el.dataset && el.dataset.g && el.type === 'text') { log[el.dataset.g] = el.value; renderOut(); return; }
      if (el.dataset && el.dataset.g && el.type === 'number') { log[el.dataset.g] = Math.max(0, parseInt(el.value, 10) || 0); renderOut(); return; }
      const lrow = el.closest('[data-logrow]'); if (lrow && el.dataset.lf && el.tagName === 'INPUT') { const r = log.params[Number(lrow.dataset.logrow)]; if (r) r[el.dataset.lf] = el.value; renderOut(); return; }
      if (el.id === 'aiReq') { sub().aiReq = el.value; renderOut(); return; }
      if (el.id === 'aiReply') { sub().aiReply = el.value; renderOut(); return; }
      const row = el.closest('[data-i]');
      if (row && el.dataset.f && el.tagName === 'INPUT' && el.type === 'text') { const list = row.dataset.list ? (row.dataset.list === 'rules' ? cfg.silver.rules : cfg.gold[row.dataset.list]) : cfg.silver.cols; list[Number(row.dataset.i)][el.dataset.f] = el.value; renderOut(); return; }
      if (el.dataset && el.dataset.k && el.tagName !== 'SELECT' && el.type !== 'radio' && el.type !== 'checkbox') { set(cfg, el.dataset.k, el.value); renderOut(); }
    });
    document.addEventListener('change', e => {
      const el = e.target;
      const lrow2 = el.closest('[data-logrow]'); if (lrow2 && el.dataset.lf === 'use') { const r = log.params[Number(lrow2.dataset.logrow)]; if (r) r.use = el.value; renderForm(); return; }
      if (el.dataset && el.dataset.g && el.type !== 'text' && el.type !== 'number') { log[el.dataset.g] = el.type === 'checkbox' ? el.checked : el.value; renderForm(); return; }
      if (el.dataset && el.dataset.done != null) { st.done = st.done.filter(x => x !== el.dataset.done).concat(el.checked ? [el.dataset.done] : []); save(); return; }
      const row = el.closest('[data-i]');
      if (row && el.dataset.f) {
        const list = row.dataset.list ? (row.dataset.list === 'rules' ? cfg.silver.rules : cfg.gold[row.dataset.list]) : cfg.silver.cols, item = list[Number(row.dataset.i)];
        if (!item) return;
        if (el.type === 'checkbox') item[el.dataset.f] = el.checked; else if (el.tagName === 'SELECT') item[el.dataset.f] = el.value;
        if (!row.dataset.list) {     // column mapping: keep dependants consistent
          if (el.dataset.f === 'type') item.clean = item.type === 'string' ? 'trim' : 'none';
          if (el.dataset.f === 'key' && item.key) item.notnull = true;
          const names = silverNames(), sv = cfg.silver; ['orderCol', 'softDelete', 'cluster'].forEach(k => { if (names.indexOf(sv[k]) < 0) sv[k] = ''; });
        }
        renderForm(); return;
      }
      if (el.dataset && el.dataset.k && el.type === 'checkbox') { set(cfg, el.dataset.k, el.checked); renderForm(); return; }
      if (el.dataset && el.dataset.k && (el.tagName === 'SELECT' || el.type === 'radio')) { if (el.type === 'radio' && !el.checked) return; set(cfg, el.dataset.k, el.value); renderForm(); }
    });
    document.addEventListener('click', e => {
      const ldel = e.target.closest('[data-logdel]'); if (ldel) { log.params.splice(Number(ldel.closest('[data-logrow]').dataset.logrow), 1); renderForm(); return; }
      const tok = e.target.closest('[data-token]');
      if (tok) { const box = $('logCall'), at = box.selectionStart == null ? box.value.length : box.selectionStart, ins = '{' + tok.dataset.token + '}'; box.value = box.value.slice(0, at) + ins + box.value.slice(box.selectionEnd == null ? at : box.selectionEnd); log.call = box.value; box.focus(); box.setSelectionRange(at + ins.length, at + ins.length); renderOut(); return; }
      const del = e.target.closest('[data-del]'), gr = e.target.closest('[data-grain]');
      if (del) { const row = del.closest('[data-i]'); (row.dataset.list === 'rules' ? cfg.silver.rules : cfg.gold[row.dataset.list]).splice(Number(row.dataset.i), 1); renderForm(); }
      else if (gr) { const g = cfg.gold, i = g.grain.indexOf(gr.dataset.grain); if (i >= 0) g.grain.splice(i, 1); else g.grain.push(gr.dataset.grain); pruneGold(); renderForm(); }
    });
    $('addLogParam').addEventListener('click', () => { log.params.push({ name: '', use: 'fixed', value: '' }); renderForm(); });
    $('addRule').addEventListener('click', () => { cfg.silver.rules.push({ kind: 'min', col: '', val: '', name: '' }); renderForm(); });
    $('addMetric').addEventListener('click', () => { cfg.gold.metrics.push({ name: '', agg: 'sum', col: '', filter: '' }); renderForm(); });
    $('addDerived').addEventListener('click', () => { cfg.gold.derived.push({ name: '', expr: '' }); renderForm(); });
    $('useSilver').addEventListener('click', () => {
      const r = P.silver(cfg, cfg.silver.aiReply.trim() ? (() => { const keep = cfg.layer; cfg.layer = 'silver'; const a = P.aiParse(cfg.silver.aiReply, cfg, S.parseBlocks, S.fields); cfg.layer = keep; return a; })() : null);
      if (!r.outCols.length) { $('schemaMsg').innerHTML = S.msg('warn', 'There is no silver setup on this page yet. Set up the silver notebook first, or paste the silver table’s schema.'); return; }
      cfg.gold.schemaText = r.outCols.map(c => c.name + ' ' + c.type).join('\n'); cfg.gold.cols = r.outCols.map(c => ({ name: c.name, type: c.type })); pruneGold(); fill(); renderForm();
    });
    $('startOwn').addEventListener('click', () => toBlank(null));
    S.ownEntry({ isExample: () => st.example, toBlank });
    S.clearSetup({ onClear: () => { const layer = cfg.layer; store.clear(); store.set('blank', true); log = P.defaultLog(); st = { example: false, done: [] }; cfg = Object.assign(P.blank(), { layer }); fill(); renderForm(); } });
    S.wireCopy({
      context: () => $('contextView').textContent, aiPrompt: () => ({ name: 'notebook-logic-prompt.txt', text: $('aiPromptView').textContent }),
      code: () => out && ({ name: out.names.nb + '.py', text: out.code }), adf: () => out && out.adf, activity: () => out && JSON.stringify(out.activity, null, 4), checks: () => out && out.checks
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* ADF Pipeline Generator: page wiring. */
(function () {
  'use strict';
  const S = window.DE_SUITE, A = window.ADF, $ = S.$, esc = S.esc;
  const store = S.store('dea.');
  let cfg, std, st, out = null, ai = null, checkRes = null;

  const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const merge = (base, saved) => { if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return base; Object.keys(base).forEach(k => { if (saved == null || !(k in saved)) return; const b = base[k], s = saved[k]; if (b && typeof b === 'object' && !Array.isArray(b)) { if (s && typeof s === 'object' && !Array.isArray(s)) merge(b, s); } else if (Array.isArray(b)) { if (Array.isArray(s)) base[k] = s.filter(x => typeof x === 'string'); } else if (typeof s === typeof b) base[k] = s; }); return base; };

  function load() {
    std = merge(A.defaultStandards(), store.get('std', null));
    st = merge({ example: false, mode: 'build', check: '', done: [] }, store.get('st', null));
    const saved = store.get('cfg', null);
    if (saved) cfg = merge(A.blank(), saved);
    else if (store.get('blank', false)) cfg = A.blank();
    else { cfg = window.ADF_EX(A.blank); st.example = true; st.check = window.ADF_EX_CHECK; }
  }
  const save = () => { store.set('cfg', cfg); store.set('st', st); store.set('std', std); };

  /* ---- form binding ---- */
  function fill(skip) {
    document.querySelectorAll('[data-k]').forEach(el => {
      if (el === skip) return;
      const v = get(cfg, el.dataset.k);
      if (el.type === 'radio') el.checked = el.value === v; else if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v;
    });
    document.querySelectorAll('[data-s]').forEach(el => { el.value = std[el.dataset.s]; });
    if ($('checkInput') !== skip) $('checkInput').value = st.check || '';
  }
  function readEl(el) {
    if (el.dataset.k) {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'radio' && !el.checked) return;
      if (el.type === 'number') v = Math.max(0, parseInt(v, 10) || 0);
      set(cfg, el.dataset.k, v);
      if (el.dataset.k === 'schemaText' || el.dataset.k === 'src.table') onSchema(el.dataset.k === 'schemaText');
      document.querySelectorAll('[data-k="' + el.dataset.k + '"]').forEach(o => { if (o !== el && o.type !== 'radio') o.value = el.value; });
    } else if (el.dataset.s) {
      const k = el.dataset.s; std[k] = el.type === 'number' ? Math.max(Number(el.min) || 0, parseInt(el.value, 10) || 0) : el.value.trim();
    } else if (el.id === 'checkInput') st.check = el.value;
  }

  /* a new paste: pick up the table name, key and change column it suggests */
  function onSchema(pasted) {
    const p = A.parseSchema(cfg.schemaText);
    if (pasted && p.cols.length) {
      const names = Array.from(new Set(p.cols.map(c => c.table).filter(Boolean)));
      if (names.length && !names.some(n => n.toLowerCase() === cfg.src.table.toLowerCase())) { cfg.src.table = names[0]; if (p.cols[0].schema) cfg.src.schema = p.cols[0].schema; }
    }
    const cols = A.tableCols(cfg), has = n => cols.some(c => c.name.toLowerCase() === String(n).toLowerCase());
    const sug = A.suggest(cols);
    cfg.load.keys = cfg.load.keys.filter(has); if (!cfg.load.keys.length) cfg.load.keys = sug.keys;
    if (!has(cfg.load.wmCol)) cfg.load.wmCol = sug.wmCol;
    cfg.exclude = cfg.exclude.filter(has);
    const tb = document.querySelector('[data-k="src.table"]'), sc = document.querySelector('[data-k="src.schema"]');
    if (document.activeElement !== tb) tb.value = cfg.src.table; if (document.activeElement !== sc) sc.value = cfg.src.schema;
  }

  /* ---- render ---- */
  const flowRows = (flow) => flow.map((f, i) => '<tr><td class="muted">' + (i + 1) + '</td><td class="flowname">' + (f.depth ? '<span class="ind">' + '└─ '.padStart(f.depth * 3 + 3, ' ') + '</span>' : '') + esc(f.name) + '</td><td>' + esc(f.type) + '</td><td>'
    + (f.after.length ? f.after.map(a => '<span class="mono">' + esc(a.activity) + '</span>' + a.conds.map(c => '<span class="cond ' + esc(c) + '">' + esc(c) + '</span>').join('')).join('<br>') : (f.inside ? '<span class="muted">first inside ' + esc(f.inside) + '</span>' : '<span class="muted">starts the run</span>')) + '</td></tr>').join('');
  const CHECKLIST = ['Every placeholder <LIKE_THIS> is replaced with a real name', 'The linked services and integration runtime named here exist in this factory', 'The supporting SQL was read by someone who knows the target database',
    'A debug run on a small window succeeds', 'Source and target row counts match for that window', 'The watermark moves only after a successful load (force a failure and check)', 'Running the same window twice adds no duplicate rows',
    'The failure path fires: a log row is written and the alert arrives', 'The trigger time and time zone are right, including daylight saving', 'No secrets or connection strings are in the pipeline JSON'];

  function render() {
    const files = cfg.src.kind === 'files', sqlT = cfg.tgt.kind === 'sql' && !files, inc = !files && cfg.load.type === 'incremental';
    $('exampleBanner').hidden = !st.example;
    $('srcSql').hidden = files; $('srcFiles').hidden = !files;
    document.querySelectorAll('[data-only="sql"]').forEach(el => { el.hidden = files; });
    $('tgtSql').hidden = !sqlT; $('tgtAdls').hidden = sqlT;
    $('incBox').hidden = !inc; $('keyBox').hidden = !sqlT;
    $('overlapBox').hidden = !(inc && sqlT && cfg.load.wmType !== 'integer' && (cfg.tgt.write === 'merge' || cfg.tgt.write === 'scd2'));
    $('timeBox').hidden = cfg.sched.freq !== 'daily'; $('tzBox').hidden = cfg.sched.freq === 'none';
    $('aiStep').hidden = files;
    /* step 1 */
    $('schemaQueryView').textContent = A.schemaQuery(cfg.src.schema, [cfg.src.table.trim()]);
    const parsed = A.parseSchema(cfg.schemaText), cols = A.tableCols(cfg);
    const stats = [];
    if (cfg.schemaText.trim()) {
      stats.push('<span class="stat"><b>' + cols.length + '</b> columns' + (cfg.src.table ? ' in ' + esc(cfg.src.table) : '') + '</span>');
      const pk = cols.filter(c => c.pk).map(c => c.name); if (pk.length) stats.push('<span class="stat">Primary key <b>' + esc(pk.join(', ')) + '</b></span>');
      if (parsed.tables.length > 1) stats.push('<span class="stat limited">' + parsed.tables.length + ' tables pasted; using ' + esc(cfg.src.table) + '</span>');
    }
    $('schemaStats').innerHTML = stats.join('');
    const sm = parsed.errors.map(e => S.msg('warn', esc(e)));
    if (cfg.schemaText.trim() && parsed.cols.length && !cols.length) sm.push(S.msg('err', 'The paste has no columns for ' + esc(cfg.src.schema + '.' + cfg.src.table) + '. It holds ' + esc(parsed.tables.join(', ')) + '. Fix the table name or run the query again.'));
    $('schemaMsg').innerHTML = sm.join('');
    /* step 2 */
    const wm = $('wmCol'), keep = cfg.load.wmCol;
    wm.innerHTML = '<option value="">' + (cols.length ? 'Choose a column' : 'Paste the schema in Step 1 first') + '</option>' + cols.filter(c => A.isDateType(c.type) || A.isIntType(c.type) || c.type === 'bigint').map(c => '<option value="' + esc(c.name) + '">' + esc(c.name) + ' (' + esc(A.sqlType(c)) + ')</option>').join('');
    wm.value = keep; if (wm.value !== keep) { wm.insertAdjacentHTML('beforeend', '<option value="' + esc(keep) + '">' + esc(keep) + '</option>'); wm.value = keep; }
    const must = new Set(cfg.load.keys.concat(inc && cfg.load.wmCol ? [cfg.load.wmCol] : []).map(s => s.toLowerCase()));
    $('keyChips').innerHTML = cols.length ? cols.map(c => '<button type="button" class="chip" data-key="' + esc(c.name) + '" aria-pressed="' + (cfg.load.keys.some(k => k.toLowerCase() === c.name.toLowerCase()) ? 'true' : 'false') + '">' + esc(c.name) + (c.pk ? '<small>PK</small>' : '') + '</button>').join('') : '<span class="note small">Paste the schema in Step 1 to pick from its columns.</span>';
    $('colChips').innerHTML = cols.map(c => { const on = must.has(c.name.toLowerCase()) || cfg.exclude.indexOf(c.name) < 0; return '<button type="button" class="chip" data-col="' + esc(c.name) + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (must.has(c.name.toLowerCase()) ? ' disabled title="Needed as key or change column"' : '') + '>' + esc(c.name) + '<small>' + esc(A.sqlType(c)) + '</small></button>'; }).join('');
    $('colCount').textContent = cols.length ? '(' + (cols.length - cfg.exclude.length) + ' of ' + cols.length + ')' : '';
    $('colWrap').hidden = !cols.length;
    $('volumeQueryView').textContent = A.volumeQuery(cfg.src.schema, cfg.src.table.trim(), cfg.load.wmCol, cfg.load.wmType);
    const nbs = cfg.notebooks.split('\n').filter(s => s.trim()).length; $('nbCount').textContent = nbs ? '(' + nbs + ')' : '(optional)';
    const names = A.names(cfg, std); $('plName').placeholder = names.pipeline;
    const probs = A.problems(cfg, std);
    $('briefMsg').innerHTML = probs.map(p => S.msg(p.sev === 'info' ? 'info' : p.sev, esc(p.msg))).join('');
    /* step 3 */
    const want = !files && cfg.ai.request.trim().length > 0;
    $('aiBox').hidden = !want; ai = null;
    if (want) {
      const prompt = S.fullPrompt(A.aiPrompt(cfg)); $('aiPromptView').textContent = prompt; S.count($('aiCount'), prompt);
      const msgs = [];
      if (!cols.length) msgs.push(S.msg('warn', 'Paste the schema in Step 1 first: without column names Copilot has nothing to work with.'));
      if (cfg.ai.reply.trim()) {
        ai = A.aiParse(cfg.ai.reply, cfg, S.parseBlocks, S.fields);
        if (!ai.any) msgs.push(S.msg('err', 'No labelled blocks were found in the reply. Ask Copilot to answer in the reply format, inside one code block, and paste the whole reply.'));
        ai.skipped.forEach(s => msgs.push(S.msg('warn', '<b>Not written:</b> ' + esc(s))));
        if (ai.filter) msgs.push((ai.filterProblems || []).length ? S.msg('err', '<b>Row filter not used:</b> <span class="mono">' + esc(ai.filter) + '</span><ul>' + ai.filterProblems.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>') : S.msg('ok', '<b>Row filter added:</b> <span class="mono">' + esc(ai.filter) + '</span>'));
        if (ai.notes.length) msgs.push(S.msg('info', '<b>Confirm these assumptions:</b><ul>' + ai.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>'));
        $('aiBody').innerHTML = ai.columns.map(c => '<tr><td class="nm">' + esc(c.name) + '</td><td>' + (c.problems.length ? S.pill('err', 'Not used') : S.pill(c.replaces ? 'replace' : 'ok', c.replaces ? 'Replaces' : 'New')) + '</td><td class="fmt">' + esc(c.type) + '</td><td><span class="mono">' + esc(c.expr) + '</span>' + (c.problems.length ? '<ul>' + c.problems.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '') + '</td></tr>').join('');
        $('aiReview').hidden = !ai.columns.length;
      } else $('aiReview').hidden = true;
      $('aiMsg').innerHTML = msgs.join('');
    }
    /* step 4 */
    const errs = probs.filter(p => p.sev === 'err');
    const blocking = errs.filter(p => !/Overwrite with an incremental/.test(p.msg));
    if (blocking.length) { out = null; $('outWrap').hidden = true; $('outMsg').innerHTML = S.msg('warn', 'Fix the ' + (blocking.length === 1 ? 'item' : blocking.length + ' items') + ' marked in red in Step 2 and the pipeline appears here.'); }
    else {
      out = A.build(cfg, std, ai);
      const own = A.check(out.pipeline, std).filter(f => f.sev !== 'low');
      $('outWrap').hidden = false; $('outMsg').innerHTML = own.length ? S.msg('warn', 'The page’s own checks found something in this pipeline:<ul>' + own.map(f => '<li>' + esc((f.activity ? f.activity + ': ' : '') + f.msg) + '</li>').join('') + '</ul>') : '';
      const flow = A.flow(out.pipeline);
      const pattern = files ? 'File landing' : (inc ? 'Watermark incremental' : 'Full load') + (out.staged ? (out.write === 'scd2' ? ' + SCD Type 2' : ' + merge') : '');
      $('outStats').innerHTML = '<span class="stat">Pattern <b>' + esc(pattern) + '</b></span><span class="stat"><b>' + flow.length + '</b> activities</span><span class="stat"><b>' + out.datasets.length + '</b> datasets</span>' + (own.length ? '' : '<span class="stat" style="background:var(--ok-soft);color:var(--ok)">Structure checks passed</span>') + (out.placeholders.length ? '<span class="stat limited"><b>' + out.placeholders.length + '</b> placeholders to replace</span>' : '');
      $('flowBody').innerHTML = flowRows(flow);
      $('plTitle').textContent = 'Pipeline JSON · ' + out.names.pipeline; $('plView').textContent = out.json;
      $('dsList').innerHTML = out.datasets.map((d, i) => '<div class="codebox"><div class="codebox-bar"><span class="t">' + esc(d.name) + '</span><span class="r"><button class="btn primary" type="button" data-copy="ds' + i + '">Copy JSON</button></span></div><pre class="short">' + esc(JSON.stringify(d, null, 4)) + '</pre></div>').join('') + '<p class="note">One parameterized dataset per system, so the next pipeline reuses them. If one with this name already exists, compare its parameters and skip it.</p>';
      $('sqlView').textContent = out.sql;
      $('trBox').hidden = !out.trigger; $('trView').textContent = out.trigger ? JSON.stringify(out.trigger, null, 4) : '';
      $('trNote').textContent = out.trigger ? 'The trigger is created stopped. Start it after the test plan passes. Its first run is the next ' + (cfg.sched.freq === 'hourly' ? 'hour' : cfg.sched.time) + ' after you start it.' : 'No schedule: run it with Trigger now, or from another pipeline with Execute Pipeline.';
      $('stepsView').textContent = out.steps;
      $('objBody').innerHTML = out.objects.map(o => '<tr><td>' + esc(o.type) + '</td><td class="nm">' + esc(o.name) + '</td><td>' + esc(o.state) + '</td><td>' + esc(o.purpose) + '</td></tr>').join('');
      $('phMsg').innerHTML = out.placeholders.length ? S.msg('warn', '<b>Replace before you build:</b> ' + out.placeholders.map(p => '<span class="mono">' + esc(p) + '</span>').join(', ') + '. Fill in the matching box in Step 2 and they disappear.') : '';
    }
    $('rawNote').hidden = sqlT; if (!sqlT) $('rawNote').textContent = 'Files land under ' + std.rawPath.replace('{source}', names.srcShort).replace('{object}', names.obj) + (files ? '/<run id>/' : '/') + ' in the data lake container. Change the path under Team standards.';
    renderCheck();
    save();
  }

  function renderCheck() {
    const r = A.readPipeline(st.check); checkRes = null;
    if (r.empty) { $('checkOut').hidden = true; $('checkMsg').innerHTML = ''; return; }
    if (r.error) { $('checkOut').hidden = true; $('checkMsg').innerHTML = S.msg('err', esc(r.error)); return; }
    const F = A.check(r.pipeline, std), flow = A.flow(r.pipeline), ph = A.placeholders(JSON.stringify(r.pipeline));
    checkRes = { F, name: r.pipeline.name || '(no name)' };
    const n = s => F.filter(f => f.sev === s).length;
    $('checkMsg').innerHTML = ph.length ? S.msg('warn', '<b>Placeholders still in the JSON:</b> ' + ph.map(p => '<span class="mono">' + esc(p) + '</span>').join(', ')) : '';
    $('checkOut').hidden = false;
    $('checkStats').innerHTML = '<span class="stat"><b>' + esc(checkRes.name) + '</b></span><span class="stat"><b>' + flow.length + '</b> activities</span>' + (F.length ? '<span class="stat" style="background:var(--err-soft);color:var(--err)"><b>' + n('high') + '</b> high</span><span class="stat limited"><b>' + n('medium') + '</b> medium</span><span class="stat"><b>' + n('low') + '</b> low</span>' : '<span class="stat" style="background:var(--ok-soft);color:var(--ok)">No findings</span>');
    $('findWrap').hidden = !F.length;
    $('findBody').innerHTML = F.map(f => '<tr><td>' + S.pill(f.sev, f.sev) + '</td><td class="nm">' + esc(f.activity || 'Pipeline') + '</td><td>' + esc(f.rule) + '</td><td>' + esc(f.msg) + '</td></tr>').join('');
    $('checkFlow').innerHTML = flowRows(flow);
  }

  function toBlank(keep) {
    cfg = A.blank(); st.example = false; st.check = ''; ai = null;
    if (keep && keep.dataset && keep.dataset.k && (keep.tagName === 'SELECT' || keep.type === 'radio' || keep.type === 'checkbox')) readEl(keep);
    fill(keep); render();
  }

  function init() {
    load();
    $('tzSel').innerHTML = A.TZ.map(t => '<option>' + esc(t) + '</option>').join('');
    $('checklist').innerHTML = CHECKLIST.map((t, i) => '<li><label><input type="checkbox" data-done="' + i + '"> <span>' + esc(t) + '</span></label></li>').join('');
    S.nav(); fill(); onSchema(false);
    const wrap = $('modeBar').closest('.wrap'); // panes sit in .wrap, not next to the bar
    const mode = m => { $('modeBar').querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === m ? 'true' : 'false')); wrap.querySelectorAll(':scope > [data-pane]').forEach(p => { p.hidden = p.dataset.pane !== m; }); st.mode = m; store.set('st', st); };
    $('modeBar').querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => mode(b.dataset.tab)));
    mode(st.mode === 'check' ? 'check' : 'build');
    S.tabs($('outTabs'));
    document.querySelectorAll('[data-done]').forEach(el => { el.checked = st.done.indexOf(el.dataset.done) >= 0; });

    document.addEventListener('input', e => { const el = e.target; if (!(el.dataset && (el.dataset.k || el.dataset.s)) && el.id !== 'checkInput') return; readEl(el); render(); });
    document.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset && el.dataset.done != null) { st.done = Array.from(document.querySelectorAll('[data-done]')).filter(x => x.checked).map(x => x.dataset.done); save(); return; }
      if (el.dataset && (el.dataset.k || el.dataset.s) && (el.tagName === 'SELECT' || el.type === 'radio' || el.type === 'checkbox')) { readEl(el); render(); }
    });
    document.addEventListener('click', e => {
      const k = e.target.closest('[data-key]'), c = e.target.closest('[data-col]');
      if (k) { const n = k.dataset.key, i = cfg.load.keys.indexOf(n); if (i >= 0) cfg.load.keys.splice(i, 1); else cfg.load.keys.push(n); render(); }
      else if (c && !c.disabled) { const n = c.dataset.col, i = cfg.exclude.indexOf(n); if (i >= 0) cfg.exclude.splice(i, 1); else cfg.exclude.push(n); render(); }
    });
    $('startOwn').addEventListener('click', () => toBlank(null));
    $('stdReset').addEventListener('click', () => { std = A.defaultStandards(); fill(); render(); });
    $('stdFile').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      S.readFile(f).then(t => { try { const o = JSON.parse(t); std = merge(A.defaultStandards(), o && o.standards ? o.standards : o); fill(); render(); $('stdMsg').innerHTML = S.msg('ok', 'Standards loaded from ' + esc(f.name) + '.'); } catch (err) { $('stdMsg').innerHTML = S.msg('err', 'That file isn’t a standards file from this page.'); } e.target.value = ''; });
    });
    $('checkFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; S.readFile(f).then(t => { if (st.example) toBlank($('checkInput')); st.check = t; $('checkInput').value = t; render(); e.target.value = ''; }); });
    S.ownEntry({ isExample: () => st.example, toBlank });
    S.clearSetup({ onClear: () => { store.clear(); store.set('blank', true); std = A.defaultStandards(); st = { example: false, mode: st.mode, check: '', done: [] }; cfg = A.blank(); fill(); document.querySelectorAll('[data-done]').forEach(el => { el.checked = false; }); render(); } });
    const file = (ext, text) => ({ name: (out ? out.names.pipeline : 'pipeline') + ext, text });
    const getters = {
      schemaQuery: () => $('schemaQueryView').textContent, volumeQuery: () => $('volumeQueryView').textContent,
      aiPrompt: () => ({ name: 'adf-transformations-prompt.txt', text: $('aiPromptView').textContent }),
      pipeline: () => out && file('.json', out.json), sql: () => out && file('.sql', out.sql), steps: () => out && out.steps, trigger: () => out && out.trigger && JSON.stringify(out.trigger, null, 4),
      standards: () => ({ name: 'adf-team-standards.json', text: JSON.stringify({ standards: std }, null, 2) }),
      review: () => checkRes && ('Pipeline review: ' + checkRes.name + '\n' + (checkRes.F.length ? checkRes.F.map(f => '[' + f.sev.toUpperCase() + '] ' + (f.activity || 'Pipeline') + ' (' + f.rule + '): ' + f.msg).join('\n') : 'No findings.'))
    };
    document.addEventListener('click', e => { const b = e.target.closest('[data-copy^="ds"]'); if (b && out) { const d = out.datasets[Number(b.dataset.copy.slice(2))]; if (d) S.copyText(JSON.stringify(d, null, 4), b); } });
    S.wireCopy(getters);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

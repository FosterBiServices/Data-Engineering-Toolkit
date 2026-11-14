/* ADF Pipeline Generator: page wiring. */
(function () {
  'use strict';
  const S = window.DE_SUITE, A = window.ADF, $ = S.$, esc = S.esc;
  const store = S.store('dea.');
  let cfg, std, st, out = null, ai = null, checkRes = null;

  const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const merge = (base, saved) => { if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return base; Object.keys(base).forEach(k => { if (saved == null || !(k in saved)) return; const b = base[k], s = saved[k]; if (b && typeof b === 'object' && !Array.isArray(b)) { if (s && typeof s === 'object' && !Array.isArray(s)) merge(b, s); } else if (Array.isArray(b)) { if (Array.isArray(s)) base[k] = s.filter(x => typeof x === 'string'); } else if (typeof s === typeof b) base[k] = s; }); return base; };

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  /* standards from storage or a file: the log parameter rows are a list of objects, which merge() doesn't carry */
  function readStd(saved) {
    const s = merge(A.defaultStandards(), saved), uses = A.LOG_VALUES.map(v => v[0]).concat(['step']);
    const rows = isObj(saved) && isObj(saved.log) && Array.isArray(saved.log.params) ? saved.log.params.filter(isObj).map(r => ({ name: String(r.name == null ? '' : r.name).slice(0, 100), use: uses.indexOf(r.use) >= 0 ? r.use : 'fixed', value: String(r.value == null ? '' : r.value).slice(0, 300) })) : null;
    s.log.params = rows || A.defaultLogParams();
    if (!A.LOG_METHODS.some(m => m[0] === s.log.method)) s.log.method = 'sp_new';
    s.off = s.off.filter(x => A.CHECK_GROUPS.indexOf(x) >= 0);
    if (!(isObj(saved) && saved.v === 2)) { if (s.off.indexOf('Standards') < 0) s.off.push('Standards'); s.v = 2; }
    return s;
  }
  function readCfg(saved) {
    const c = merge(A.blank(), saved);
    ['src', 'tgt', 'list', 'read', 'sink', 'meta'].forEach(k => { const d = c.ds[k], sv = isObj(saved) && isObj(saved.ds) && isObj(saved.ds[k]) ? saved.ds[k] : {}; d.mode = d.mode === 'own' ? 'own' : 'new'; d.map = {};
      if (isObj(sv.map)) Object.keys(sv.map).slice(0, 40).forEach(n => { const m = sv.map[n]; if (isObj(m) && typeof m.use === 'string') d.map[n] = { use: m.use, value: String(m.value == null ? '' : m.value) }; }); });
    const sm = isObj(saved) && isObj(saved.med) ? saved.med : {}, uses = A.NB_VALUES.map(v => v[0]);
    const rows = a => (Array.isArray(a) ? a : []).filter(isObj).slice(0, 40).map(r => ({ name: String(r.name == null ? '' : r.name).slice(0, 100), use: uses.indexOf(r.use) >= 0 ? r.use : 'text', value: String(r.value == null ? '' : r.value).slice(0, 400) }));
    c.med.bronzeNb.params = isObj(sm.bronzeNb) && Array.isArray(sm.bronzeNb.params) ? rows(sm.bronzeNb.params) : A.medDefaults().bronzeNb.params;
    c.med.stages = (Array.isArray(sm.stages) ? sm.stages : []).filter(isObj).slice(0, 12).map(s => ({ label: String(s.label || '').slice(0, 40), loop: ['folders', 'files', 'once'].indexOf(s.loop) >= 0 ? s.loop : 'folders', path: String(s.path || '').slice(0, 300), nbPath: String(s.nbPath || '').slice(0, 300), params: rows(s.params), log: s.log === true }));
    if (['medallion', 'sql', 'files'].indexOf(c.src.kind) < 0) c.src.kind = 'medallion';
    c.vars = (isObj(saved) && Array.isArray(saved.vars) ? saved.vars : []).filter(isObj).slice(0, 40).map(v => ({ name: String(v.name == null ? '' : v.name).slice(0, 80), type: A.VAR_TYPES.some(t => t[0] === v.type) ? v.type : 'String', value: String(v.value == null ? '' : v.value).slice(0, 500) }));
    return c;
  }
  function load() {
    std = readStd(store.get('std', null));
    st = merge({ example: false, mode: 'build', check: '', done: [], runBy: 'auto' }, store.get('st', null));
    const saved = store.get('cfg', null);
    if (saved) cfg = readCfg(saved);
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
    document.querySelectorAll('[data-l]').forEach(el => { if (el !== skip && el.tagName !== 'SELECT') el.value = std.log[el.dataset.l] || ''; });
    document.querySelectorAll('[data-dsjson]').forEach(el => { if (el !== skip) el.value = cfg.ds[el.dataset.dsjson].json; });
    document.querySelectorAll('[data-dsmode]').forEach(el => { el.checked = cfg.ds[el.dataset.dsmode].mode === el.value; });
    $('runBy').value = /^(manual|child)$/.test(st.runBy) ? st.runBy : 'auto';
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
    } else if (el.dataset.l) std.log[el.dataset.l] = el.tagName === 'SELECT' ? el.value : el.value.trim();
    else if (el.dataset.dsjson) { cfg.ds[el.dataset.dsjson].json = el.value; cfg.ds[el.dataset.dsjson].map = {}; }
    else if (el.dataset.dsmode) { if (el.checked) cfg.ds[el.dataset.dsmode].mode = el.value; }
    else if (el.id === 'runBy') st.runBy = el.value;
    else if (el.id === 'checkInput') st.check = el.value;
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
    const kind = cfg.src.kind, med = kind === 'medallion', files = kind !== 'sql', sqlT = cfg.tgt.kind === 'sql' && !files, inc = !files && cfg.load.type === 'incremental';
    document.querySelectorAll('[data-not="medallion"]').forEach(el => { el.hidden = med; });
    $('medSub').hidden = !med; $('dsMed').hidden = !med; $('dsClassic').hidden = med;
    if (med) renderMed();
    $('exampleBanner').hidden = !st.example;
    $('srcSql').hidden = files; $('srcFiles').hidden = !files;
    document.querySelectorAll('[data-only="sql"]').forEach(el => { el.hidden = files; });
    document.querySelectorAll('[data-not="sql"]').forEach(el => { el.hidden = !files; });
    $('tgtSql').hidden = !sqlT; $('tgtAdls').hidden = sqlT;
    $('incBox').hidden = !inc; $('keyBox').hidden = !sqlT;
    $('overlapBox').hidden = !(inc && sqlT && cfg.load.wmType !== 'integer' && (cfg.tgt.write === 'merge' || cfg.tgt.write === 'scd2'));
    $('timeBox').hidden = cfg.sched.freq !== 'daily'; $('tzBox').hidden = cfg.sched.freq === 'none';
    $('aiStep').hidden = files;
    renderDatasets(files, sqlT, med); renderLogging(files, sqlT, inc);
    if (med) $('ctlBox').hidden = !/^sp_/.test(std.log.method);
    const mode = cfg.src.after, nm0 = A.names(cfg, std);
    $('fileNote').textContent = (mode === 'leave' ? 'Each run copies every matching file to the destination folder and leaves the originals. Running it again copies them again, so give each run its own folder with {run} or dates if the next step shouldn\u2019t see a file twice.' : mode === 'delete' ? 'Each run copies every matching file to the destination folder, then deletes the original once its copy succeeded.' : 'Each run lands every matching file exactly as it arrived, moves the original to the archive, and moves a file that can\u2019t be copied to quarantine.') + ' Cleaning and loading happen in the next layer (a bronze notebook, for example).';
    $('destIn').placeholder = std.rawPath.replace('{source}', nm0.srcShort).replace('{object}', nm0.obj) + '/{run}';
    if (!med) $('ctlBox').hidden = !(inc || std.log.method === 'sp_new' || std.log.method === 'sp_own');
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
      const own = A.check(out.pipeline, std, { off: out.names.noHandler ? ['Failure path'] : [] }).filter(f => f.sev !== 'low');
      $('outWrap').hidden = false; $('outMsg').innerHTML = own.length ? S.msg('warn', 'The page’s own checks found something in this pipeline:<ul>' + own.map(f => '<li>' + esc((f.activity ? f.activity + ': ' : '') + f.msg) + '</li>').join('') + '</ul>') : '';
      const flow = A.flow(out.pipeline);
      const pattern = med ? 'Files through ' + ['bronze'].concat(cfg.med.stages.map(s => s.label || 'layer')).join(', ') : files ? 'File landing' : (inc ? 'Watermark incremental' : 'Full load') + (out.staged ? (out.write === 'scd2' ? ' + SCD Type 2' : ' + merge') : '');
      $('outStats').innerHTML = '<span class="stat">Pattern <b>' + esc(pattern) + '</b></span><span class="stat"><b>' + flow.length + '</b> activities</span><span class="stat"><b>' + out.datasets.length + '</b> datasets</span>' + (own.length ? '' : '<span class="stat" style="background:var(--ok-soft);color:var(--ok)">Structure checks passed</span>') + (out.placeholders.length ? '<span class="stat limited"><b>' + out.placeholders.length + '</b> placeholders to replace</span>' : '');
      $('flowBody').innerHTML = flowRows(flow);
      $('plTitle').textContent = 'Pipeline JSON · ' + out.names.pipeline; $('plView').textContent = out.json;
      $('dsList').innerHTML = (out.reused.length ? S.msg('ok', 'Using your own dataset' + (out.reused.length > 1 ? 's' : '') + ' as ' + (out.reused.length > 1 ? 'they are' : 'it is') + ': ' + out.reused.map(d => '<span class="mono">' + esc(d.name) + '</span>').join(', ') + '. Nothing to create for ' + (out.reused.length > 1 ? 'them' : 'it') + '.') : '') + out.datasets.map((d, i) => '<div class="codebox"><div class="codebox-bar"><span class="t">' + esc(d.name) + '</span><span class="r"><button class="btn primary" type="button" data-copy="ds' + i + '">Copy JSON</button></span></div><pre class="short">' + esc(JSON.stringify(d, null, 4)) + '</pre></div>').join('') + (out.datasets.length ? '<p class="note">One parameterized dataset per system, so the next pipeline reuses them. If one with this name already exists, compare its parameters and skip it.</p>' : '');
      $('sqlView').textContent = out.sql;
      $('trBox').hidden = !out.trigger; $('trView').textContent = out.trigger ? JSON.stringify(out.trigger, null, 4) : '';
      $('trNote').textContent = out.trigger ? 'The trigger is created stopped. Start it after the test plan passes. Its first run is the next ' + (cfg.sched.freq === 'hourly' ? 'hour' : cfg.sched.time) + ' after you start it.' : 'No schedule: run it with Trigger now, or from another pipeline with Execute Pipeline.';
      $('stepsView').textContent = out.steps;
      $('objBody').innerHTML = out.objects.map(o => '<tr><td>' + esc(o.type) + '</td><td class="nm">' + esc(o.name) + '</td><td>' + esc(o.state) + '</td><td>' + esc(o.purpose) + '</td></tr>').join('');
      $('phMsg').innerHTML = out.placeholders.length ? S.msg('warn', '<b>Replace before you build:</b> ' + out.placeholders.map(p => '<span class="mono">' + esc(p) + '</span>').join(', ') + '. Fill in the matching box in Step 2 and they disappear.') : '';
    }
    $('rawNote').hidden = sqlT || files; if (!sqlT && !files) $('rawNote').textContent = 'Files land under ' + std.rawPath.replace('{source}', names.srcShort).replace('{object}', names.obj) + (files ? '/<run id>/' : '/') + ' in the data lake container. Change the path under Team standards.';
    renderLogging(files, sqlT, inc);   // again, now that the pipeline's steps are known
    renderVars();
    renderCheck();
    save();
  }

  const optsHtml = (list, cur) => list.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
  let fromInput = false;   /* only an input event keeps the box being typed in from redrawing */
  const typing = box => fromInput && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
  function renderDatasets(files, sqlT, med) {
    (med ? [['list'], ['read'], ['sink'], ['meta']] : [['src', 'Source'], ['tgt', files ? 'Destination' : 'Target']]).forEach(([k, label]) => {
      const d = cfg.ds[k], wantFile = files || (k === 'tgt' && !sqlT);
      if (label) $('dsTag' + k).textContent = label;
      document.querySelector('[data-dsown="' + k + '"]').hidden = d.mode !== 'own';
      if (d.mode !== 'own') return;
      const r = A.readDataset(d.json), own = A.ownDs(cfg, k), map = $('dsMap' + k);
      $('dsInfo' + k).innerHTML = own ? '<span class="stat"><b>' + esc(own.name) + '</b></span><span class="stat">' + esc(own.type) + '</span>' + (own.ls ? '<span class="stat">on <b>' + esc(own.ls) + '</b></span>' : '') + '<span class="stat"><b>' + own.params.length + '</b> parameter' + (own.params.length === 1 ? '' : 's') + '</span>' : '';
      $('dsMsg' + k).innerHTML = r && r.error ? S.msg('err', esc(r.error)) : own && !own.params.length ? S.msg('info', 'This dataset has no parameters, so it always points at the same place. The pipeline uses it as it is and doesn\u2019t pass it a ' + (wantFile ? 'folder or file name' : 'schema or table') + '.') : '';
      if (!own) { map.innerHTML = ''; return; }
      if (typing(map)) return;
      const uses = A.DS_USES[wantFile ? 'file' : 'table'];
      map.innerHTML = own.params.map(p => { const m = own.map[p]; return '<div class="rrow map3"><span class="mono" style="overflow-wrap:anywhere">' + esc(p) + '</span><select data-dsmap="' + k + '" data-p="' + esc(p) + '" aria-label="What to pass to ' + esc(p) + '">' + optsHtml(uses.some(u => u[0] === m.use) ? uses : uses.concat([[m.use, m.use]]), m.use) + '</select>'
        + (/^(fixed|variable|global|expr)$/.test(m.use) ? (m.use === 'expr' ? fxBox : x => x)('<input type="text" data-dsfixed="' + k + '" data-p="' + esc(p) + '" value="' + esc(m.value) + '" placeholder="' + ({ fixed: 'value to pass', variable: 'variable name', global: 'StorageAccountName', expr: "@concat(variables('path'), item().name)" }[m.use]) + '"' + (m.use === 'variable' ? ' list="varNames"' : '') + ' spellcheck="false" aria-label="Value for ' + esc(p) + '">') : '<span class="note small" style="overflow-wrap:anywhere">' + (m.use === 'none' ? (own.defaults.indexOf(p) >= 0 ? 'its default is used' : 'passed empty') : esc(fillsWith(k, m.use, med))) + '</span>') + '</div>'; }).join('');
    });
  }
  /* what the pipeline passes for a mapped parameter, in words, so a wrong container or folder shows before building */
  function fillsWith(k, use, med) {
    if (!med) return 'filled in by the pipeline';
    const m = cfg.med, src = cfg.src, lake = String(m.container || '').trim() || src.container.trim() || '(container not given)';
    const t = { container: { list: src.container.trim() || '(container not given)', read: src.container.trim() || '(container not given)', sink: lake, meta: lake },
      folder: { list: src.folder, read: src.folder, sink: m.bronzeFolder + (m.archive && m.archiveFolder !== m.bronzeFolder ? ', or ' + m.archiveFolder + ' when archiving' : ''), meta: 'each layer\u2019s folder: ' + (m.stages.map(s => s.path).filter(Boolean).join(', ') || 'none yet') },
      file: { list: '(empty: a folder is listed)', read: 'each file\u2019s name', sink: m.bronzeFile + (m.archive && m.archiveFile !== m.bronzeFile ? ', or ' + m.archiveFile + ' when archiving' : ''), meta: '(empty: a folder is listed)' } }[use];
    return t && t[k] != null ? 'gets ' + t[k] : 'filled in by the pipeline';
  }
  const NBV = A.NB_VALUES;
  const paramRows = (list, key) => list.map((r, i) => '<div class="rrow log4" data-pkey="' + key + '" data-pi="' + i + '"><input type="text" data-pf="name" value="' + esc(r.name) + '" placeholder="widget name" spellcheck="false" aria-label="Parameter name"><select data-pf="use" aria-label="Value">' + optsHtml(NBV, r.use) + '</select>'
    + (/^(text|global|expr|variable)$/.test(r.use) ? (r.use === 'expr' ? fxBox : x => x)('<input type="text" data-pf="value" value="' + esc(r.value) + '" placeholder="' + ({ text: 'text, tokens allowed', global: 'StorageAccountName', expr: "@string('Region A')", variable: 'variable name' }[r.use]) + '"' + (r.use === 'variable' ? ' list="varNames"' : '') + ' spellcheck="false" aria-label="Value">') : '<span></span>') + '<button type="button" class="x" data-delp aria-label="Remove parameter">&times;</button></div>').join('');
  const listFor = key => (key === 'bronze' ? cfg.med.bronzeNb.params : (cfg.med.stages[Number(key.slice(1))] || {}).params);
  function renderMed() {
    const m = cfg.med;
    $('lookupBox').hidden = !m.lookup.on; $('medCopy').hidden = m.action !== 'copy'; $('medNb').hidden = m.action !== 'notebook'; $('archiveBox').hidden = !m.archive;
    $('tokenList').textContent = A.TOKENS.map(t => '{' + t[0] + '}').join(' ');
    const pb = document.querySelector('[data-plist="bronze"]'); if (!typing(pb)) pb.innerHTML = paramRows(m.bronzeNb.params, 'bronze');
    const sl = $('stageList');
    if (!typing(sl)) sl.innerHTML = m.stages.map((s, i) => '<div class="dcard" data-si="' + i + '"><div class="dcard-head"><span class="dtag">Layer ' + (i + 2) + '</span><input type="text" data-sf="label" value="' + esc(s.label) + '" placeholder="silver" spellcheck="false" aria-label="Layer name" style="max-width:160px"><button type="button" class="linkbtn" data-delstage style="margin-left:auto">Remove</button></div>'
      + '<div class="qgrid"><label class="lab">Runs<select data-sf="loop">' + optsHtml([['folders', 'Once per object folder'], ['files', 'Once per file'], ['once', 'Once for the whole run']], s.loop) + '</select></label>'
      + (s.loop === 'folders' ? '<label class="lab wide">Folder that holds the object folders<input type="text" data-sf="path" value="' + esc(s.path) + '" placeholder="yourproject/bronze" spellcheck="false"></label>' : '')
      + '<label class="lab wide">Notebook path<input type="text" data-sf="nbPath" value="' + esc(s.nbPath) + '" placeholder="/Shared/yourproject/to_silver" spellcheck="false"></label></div>'
      + '<div class="details-head"><h3>Parameters it reads</h3><button type="button" class="btn" data-addp="s' + i + '">Add a parameter</button></div><div class="rowlist" data-plist="s' + i + '">' + paramRows(s.params, 's' + i) + '</div>'
      + '<label class="chk small"><input type="checkbox" data-sf="log"' + (s.log ? ' checked' : '') + '> Log each run of this notebook with my logging setup</label></div>').join('') || '<p class="note small">No layers yet. Bronze only, or add silver and gold.</p>';
    $('medPreview').innerHTML = A.medPreview(cfg).map(r => '<div><span class="muted">' + esc(r[0]) + ':</span> <span class="mono" style="overflow-wrap:anywhere">' + esc(r[1]) + '</span></div>').join('');
  }
  function renderVars() {
    const box = $('varRows');
    if (!typing(box)) box.innerHTML = cfg.vars.map((v, i) => '<div class="rrow log4" data-vi="' + i + '"><input type="text" data-vf="name" value="' + esc(v.name) + '" placeholder="bronze_root" spellcheck="false" aria-label="Variable name"><select data-vf="type" aria-label="Type">' + optsHtml(A.VAR_TYPES, v.type) + '</select>'
      + '<input type="text" data-vf="value" value="' + esc(v.value) + '" placeholder="default value" spellcheck="false" aria-label="Default value"><button type="button" class="x" data-vdel aria-label="Remove variable">&times;</button></div>').join('');
    const made = out && out.pipeline.properties.variables ? Object.keys(out.pipeline.properties.variables).filter(k => !A.userVars(cfg).some(v => v.name.trim() === k)) : [];
    $('autoVars').innerHTML = made.length ? 'Made by the page from your paths: ' + made.map(k => { const d = out.pipeline.properties.variables[k].defaultValue; return '<span class="mono">' + esc(k) + (d != null ? ' = ' + esc(d) : '') + '</span>'; }).join(', ') + '. Add a variable here with the same name to set it yourself.' : '';
    $('varNames').innerHTML = A.userVars(cfg).map(v => v.name.trim()).concat(made).map(k => '<option value="' + esc(k) + '">').join('');
  }
  function renderLogging(files, sqlT, inc) {
    const lg = std.log, m = lg.method;
    $('logMethod').innerHTML = optsHtml(A.LOG_METHODS, m);
    document.querySelectorAll('[data-log]').forEach(el => { el.hidden = el.dataset.log !== m; });
    $('logOwn').hidden = !(m === 'sp_own' || m === 'notebook');
    $('logParamsTitle').textContent = m === 'notebook' ? 'Base parameters the notebook reads' : 'Parameters the procedure takes';
    $('logNote').textContent = m === 'sp_new' ? 'The page writes a log table and procedure (Supporting SQL tab) and calls it at the end of a run and on failure. It needs a SQL database: the target, or the control database below.'
      : m === 'sp_own' ? 'Your procedure is called on the control database linked service. Row counts are passed as Int64, everything else as String.'
        : m === 'notebook' ? (cfg.src.kind === 'medallion' ? (cfg.med.logEach ? 'Your notebook is run after each file (success or failure) and after each layer run you tick. ' : 'Tick \u201cLog each file and layer run\u201d above to use it. ') : 'Your notebook is run at the end of a run and on failure. ') + 'Base parameters are always text, so counts are passed as text (0 when there is none). Read them with dbutils.widgets.get.'
          : 'Nothing is recorded. A failed run still shows as Failed in Monitor.';
    const box = $('logRows'); if (typing(box)) return;
    const choices = A.logChoices(cfg.src.kind), label = u => (A.LOG_VALUES.find(v => v[0] === u) || [u, u])[1];
    const steps = out ? A.flatten(out.pipeline).filter(f => /^(Copy|DatabricksNotebook|Lookup|GetMetadata|ExecutePipeline|SqlServerStoredProcedure|Script)$/.test(f.type) && !/^(nb|sp)_log_/.test(f.name)).map(f => [f.name, f.type, f.parent ? f.parent.name : '']) : [];
    const stepCtl = r => { const s = String(r.value || ''), i = s.indexOf('|'), act = i < 0 ? s : s.slice(0, i), f = i < 0 ? '' : s.slice(i + 1), st = steps.find(x => x[0] === act), fields = st ? A.stepFields(st[1]) : Object.keys(A.STEP_FIELDS).reduce((a, k) => a.concat(A.STEP_FIELDS[k].filter(x => !a.some(y => y[0] === x[0]))), []).concat(A.STEP_ANY);
      const fv = /^=/.test(f) ? '=' : f;
      return '<span class="stepctl"><select data-lf="stepAct" aria-label="Which step">' + optsHtml([['', 'Choose a step']].concat(steps.map(x => [x[0], x[0] + (x[2] ? ' (inside ' + x[2] + ')' : '')]), act && !st ? [[act, act + ' (not in this pipeline)']] : []), act) + '</select>'
        + '<select data-lf="stepField" aria-label="Which output">' + optsHtml([['', 'Choose an output']].concat(fields), fv) + '</select>'
        + (fv === '=' ? '<input type="text" data-lf="stepPath" value="' + esc(f.slice(1)) + '" placeholder="runOutput.rows_written" spellcheck="false" aria-label="Output path">' : '') + '</span>'; };
    box.innerHTML = (m === 'sp_own' || m === 'notebook') ? lg.params.map((r, i) => '<div class="rrow log4" data-logrow="' + i + '"><input type="text" data-lf="name" value="' + esc(r.name) + '" placeholder="parameter name" spellcheck="false" aria-label="Parameter name"><select data-lf="use" aria-label="Value">' + optsHtml(choices.some(c => c[0] === r.use) ? choices : choices.concat([[r.use, label(r.use) + ' (older choice)']]), r.use) + '</select>'
      + (r.use === 'step' ? stepCtl(r) : /^(fixed|global|expr|variable|error)$/.test(r.use) ? (r.use === 'expr' ? fxBox : x => x)('<input type="text" data-lf="value" value="' + esc(r.value) + '" placeholder="' + ({ fixed: 'text to pass', global: 'StorageAccountName', expr: "@string('no error')", variable: 'variable name', error: 'on success (optional): no error' }[r.use]) + '"' + (r.use === 'error' ? ' title="Passed when the step succeeded. Empty passes nothing."' : '') + (r.use === 'variable' ? ' list="varNames"' : '') + ' spellcheck="false" aria-label="Value">') : '<span></span>') + '<button type="button" class="x" data-logdel aria-label="Remove parameter">&times;</button></div>').join('') : '';
  }

  /* ---- expression helper: opened by the fx button beside any "ADF expression" box ---- */
  const fxBox = input => '<span class="fxwrap">' + input + '<button type="button" class="fxbtn" data-fx title="Help writing this expression" aria-label="Help writing this expression">fx</button></span>';
  const fx = { sel: '', ctx: null, where: '', reply: null };
  const chip = (ins, label, cls, hint) => '<button type="button" class="fxchip' + (cls ? ' ' + cls : '') + '" data-ins="' + esc(ins) + '"' + (hint ? ' data-hint="' + esc(hint) + '"' : '') + ' title="' + esc(hint || ins) + '">' + esc(label) + '</button>';
  function fxCheck() {
    const R = A.checkExpr($('fxText').value, fx.ctx), cls = { err: 'err', warn: 'warn', info: 'info' };
    $('fxCheck').innerHTML = !$('fxText').value.trim() ? '' : R.length ? R.map(r => S.msg(cls[r.sev], esc(r.msg))).join('') : S.msg('ok', 'Brackets, quotes and names check out. ADF Studio checks the rest when you validate the pipeline.');
  }
  function fxPromptText() { return S.fullPrompt(A.exprPrompt($('fxAsk').value, fx.ctx || A.exprContext(null, cfg), fx.where)); }
  function fxAiRender() {
    $('fxPrompt').textContent = fxPromptText();
    const t = $('fxReply').value; fx.reply = null; $('fxTake').hidden = true;
    if (!t.trim()) { $('fxAiMsg').innerHTML = ''; return; }
    const r = A.exprParse(t, S.parseBlocks);
    if (r.skipped) { $('fxAiMsg').innerHTML = S.msg('warn', '<b>Copilot didn\u2019t write one:</b> ' + esc(r.skipped)); return; }
    if (!r.expr) { $('fxAiMsg').innerHTML = S.msg('err', 'No EXPRESSION block was found. Paste the whole reply, inside its code block.'); return; }
    const errs = A.checkExpr(r.expr, fx.ctx).filter(x => x.sev === 'err');
    fx.reply = errs.length ? null : r.expr; $('fxTake').hidden = !fx.reply;
    $('fxAiMsg').innerHTML = (errs.length ? S.msg('err', '<b>Not used:</b> <span class="mono">' + esc(r.expr) + '</span><ul>' + errs.map(x => '<li>' + esc(x.msg) + '</li>').join('') + '</ul>Ask Copilot again with these problems.') : S.msg('ok', '<span class="mono">' + esc(r.expr) + '</span>'))
      + (r.notes.length ? S.msg('info', '<b>Confirm:</b><ul>' + r.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>') : '');
  }
  function fxInsert(text, snippet) {
    const ta = $('fxText'); let v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    if (!v.trim()) { v = ''; a = b = 0; if (!/^@/.test(text)) text = '@' + text; }
    ta.value = v.slice(0, a) + text + v.slice(b);
    const sel = text.match(/'[^']*'|\b(value|text|list|listOrText|a|b)\b/);   /* select the first placeholder so it can be typed over */
    if (sel && snippet) { ta.setSelectionRange(a + sel.index, a + sel.index + sel[0].length); } else { const p = a + text.length; ta.setSelectionRange(p, p); }
    ta.focus(); fxCheck();
  }
  function fxOpen(btn) {
    const input = btn.parentNode.querySelector('input'), row = input.closest('[data-logrow],[data-pi]');
    const q = s => '"' + String(s).replace(/["\\]/g, '\\$&') + '"';
    if (input.dataset.dsfixed) { fx.sel = '[data-dsfixed=' + q(input.dataset.dsfixed) + '][data-p=' + q(input.dataset.p) + ']'; fx.where = 'the value of dataset parameter ' + input.dataset.p; }
    else if (row && row.dataset.logrow != null) { fx.sel = '[data-logrow=' + q(row.dataset.logrow) + '] input[data-lf="value"]'; fx.where = 'logging parameter ' + ((row.querySelector('[data-lf="name"]') || {}).value || '') + ' (passed as ' + (std.log.method === 'notebook' ? 'a notebook base parameter, always text' : 'a procedure parameter') + ')'; }
    else if (row) { fx.sel = '[data-pkey=' + q(row.dataset.pkey) + '][data-pi=' + q(row.dataset.pi) + '] input[data-pf="value"]'; fx.where = 'notebook base parameter ' + ((row.querySelector('[data-pf="name"]') || {}).value || '') + ' (always text)'; }
    else return;
    fx.ctx = A.exprContext(out && out.pipeline, cfg);
    $('fxWhere').textContent = 'For ' + fx.where + '.' + (out ? '' : ' Build the pipeline first (fix the items in red) to list its steps.');
    $('fxText').value = input.value;
    $('fxSteps').innerHTML = fx.ctx.steps.length ? fx.ctx.steps.map(s => '<div class="fxrow"><span class="nm">' + esc(s.name) + '</span>' + s.fields.map(f => chip("activity('" + s.name + "')?.output?." + f[0], f[1], '', "activity('" + s.name + "')?.output?." + f[0])).join('') + chip("activity('" + s.name + "')?.error?.message", 'Error message', '', 'Filled in only when this step failed') + (s.inside ? '<span class="note small">inside ' + esc(s.inside) + '</span>' : '') + '</div>').join('')
      + '<p class="note small">A step inside a loop or an If can only be read by steps inside the same one. Numbers and objects need string() around them when the value is passed as text.</p>' : '<p class="note small">No steps yet.</p>';
    $('fxVars').innerHTML = fx.ctx.vars.length ? '<div class="fxrow">' + fx.ctx.vars.map(v => chip("variables('" + v + "')", v, 'fn')).join('') + '</div>' : '<p class="note small">None. Add one under Pipeline variables.</p>';
    $('fxRun').innerHTML = '<div class="fxrow">' + [['pipeline().Pipeline', 'Pipeline name'], ['pipeline().RunId', 'Run ID'], ['pipeline().TriggerTime', 'Trigger time'], ['pipeline().TriggerName', 'Trigger name'], ['pipeline().DataFactory', 'Factory name'], ['utcNow()', 'Now (UTC)'], ['pipeline().globalParameters.', 'Global parameter (type its name)']]
      .concat(fx.ctx.loop ? [['item().name', 'Loop item name']] : []).concat(fx.ctx.params.map(p => ['pipeline().parameters.' + p, 'Parameter ' + p])).map(r => chip(r[0], r[1], '', r[0])).join('') + '</div>';
    $('fxFuncs').innerHTML = '<div class="fxrow">' + A.EXPR_FUNCS.map(f => chip(f[1], f[0], 'fn', f[2] + ': ' + f[1])).join('') + '</div>';
    $('fxHint').textContent = 'Click anything below to put it in at the cursor.';
    $('fxReply').value = ''; fxAiRender(); fxCheck();
    $('fxModal').hidden = false; document.body.style.overflow = 'hidden';
    $('fxText').focus();
  }
  function fxClose(use) {
    $('fxModal').hidden = true; document.body.style.overflow = '';
    const input = document.querySelector(fx.sel);
    if (!input) return;
    if (use) { input.value = $('fxText').value.trim(); input.focus(); input.dispatchEvent(new Event('input', { bubbles: true })); }
    else input.focus();
  }
  function fxWire(getters) {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-fx]'); if (b) { fxOpen(b); return; }
      const c = e.target.closest('[data-ins]'); if (c && !$('fxModal').hidden) { fxInsert(c.dataset.ins, c.classList.contains('fn') && /\(/.test(c.dataset.ins) && !/^variables\(/.test(c.dataset.ins)); if (c.dataset.hint) $('fxHint').textContent = c.dataset.hint; }
    });
    $('fxText').addEventListener('input', e => { e.stopPropagation(); fxCheck(); });
    ['fxAsk', 'fxReply'].forEach(id => $(id).addEventListener('input', e => { e.stopPropagation(); fxAiRender(); }));
    $('fxTake').addEventListener('click', () => { if (fx.reply) { $('fxText').value = fx.reply; fxCheck(); $('fxText').focus(); } });
    $('fxUse').addEventListener('click', () => fxClose(true));
    $('fxCancel').addEventListener('click', () => fxClose(false));
    $('fxClose').addEventListener('click', () => fxClose(false));
    $('fxModal').addEventListener('click', e => { if (e.target === $('fxModal')) fxClose(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('fxModal').hidden) fxClose(false); });
    getters.fxPrompt = () => fxPromptText();
  }

  function renderCheck() {
    $('offChips').innerHTML = A.CHECK_GROUPS.map(g => '<button type="button" class="chip" data-off="' + esc(g) + '" aria-pressed="' + (std.off.indexOf(g) < 0 ? 'true' : 'false') + '">' + esc(g) + '</button>').join('');
    const r = A.readPipeline(st.check); checkRes = null;
    if (r.empty) { $('checkOut').hidden = true; $('checkMsg').innerHTML = ''; return; }
    if (r.error) { $('checkOut').hidden = true; $('checkMsg').innerHTML = S.msg('err', esc(r.error)); return; }
    const manual = st.runBy === 'manual', F = A.check(r.pipeline, std, { manual, child: st.runBy === 'child', off: std.off }), flow = A.flow(r.pipeline), ph = A.placeholders(JSON.stringify(r.pipeline));
    checkRes = { F, name: r.pipeline.name || '(no name)' };
    const n = s => F.filter(f => f.sev === s).length;
    $('checkMsg').innerHTML = ph.length ? S.msg('warn', '<b>Placeholders still in the JSON:</b> ' + ph.map(p => '<span class="mono">' + esc(p) + '</span>').join(', ')) : '';
    $('checkOut').hidden = false;
    $('checkStats').innerHTML = '<span class="stat"><b>' + esc(checkRes.name) + '</b></span><span class="stat"><b>' + flow.length + '</b> activities</span>' + (F.length ? '<span class="stat" style="background:var(--err-soft);color:var(--err)"><b>' + n('high') + '</b> high</span><span class="stat limited"><b>' + n('medium') + '</b> medium</span><span class="stat"><b>' + n('low') + '</b> low</span>' : '<span class="stat" style="background:var(--ok-soft);color:var(--ok)">No findings</span>');
    $('findWrap').hidden = !F.length;
    $('findBody').innerHTML = F.map(f => '<tr><td>' + S.pill(f.sev, f.sev) + '</td><td class="nm">' + esc(f.activity || 'Pipeline') + '</td><td>' + esc(f.rule) + '</td><td>' + esc(f.msg) + (f.fix ? '<div class="fix"><b>How to fix:</b> ' + esc(f.fix) + '</div>' : '') + '</td></tr>').join('');
    $('fixWrap').hidden = !F.length; checkRes.prompt = F.length ? S.fullPrompt(A.fixPrompt(r.pipeline, F, std, manual)) : '';
    $('fixView').textContent = checkRes.prompt; S.count($('fixCount'), checkRes.prompt);
    $('checkFlow').innerHTML = flowRows(flow);
  }

  function toBlank(keep) {
    const kind = cfg.src.kind; cfg = A.blank(); cfg.src.kind = kind; st.example = false; st.check = ''; ai = null;
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

    const ownField = el => el.dataset && (el.dataset.k || el.dataset.s || el.dataset.l || el.dataset.dsjson);
    document.addEventListener('input', e => { fromInput = true; try {
      const el = e.target; if (!el.dataset) return;
      const pr = el.closest('[data-pi]'), sc = el.closest('[data-si]');
      if (pr && el.dataset.pf && el.tagName === 'INPUT') { const r = (listFor(pr.dataset.pkey) || [])[Number(pr.dataset.pi)]; if (r) r[el.dataset.pf] = el.value; render(); e.stopImmediatePropagation(); return; }
      if (sc && el.dataset.sf && el.tagName === 'INPUT' && el.type === 'text') { const s = cfg.med.stages[Number(sc.dataset.si)]; if (s) s[el.dataset.sf] = el.value; render(); e.stopImmediatePropagation(); }
    } finally { fromInput = false; }
    }, true);
    document.addEventListener('input', e => { fromInput = true; try {
      const el = e.target, row = el.closest && el.closest('[data-logrow]');
      if (row && el.dataset.lf === 'stepPath') { const r = std.log.params[Number(row.dataset.logrow)]; if (r) { const s = String(r.value || ''), k = s.indexOf('|'); r.value = (k < 0 ? s : s.slice(0, k)) + '|=' + el.value; } render(); return; }
      if (row && el.dataset.lf && el.tagName === 'INPUT') { const r = std.log.params[Number(row.dataset.logrow)]; if (r) r[el.dataset.lf] = el.value; render(); return; }
      const vr = el.closest && el.closest('[data-vi]'); if (vr && el.dataset.vf && el.tagName === 'INPUT') { const v = cfg.vars[Number(vr.dataset.vi)]; if (v) v[el.dataset.vf] = el.value; render(); return; }
      if (el.dataset && el.dataset.dsfixed) { const d = cfg.ds[el.dataset.dsfixed], own = A.ownDs(cfg, el.dataset.dsfixed), cur = own && own.map[el.dataset.p]; d.map[el.dataset.p] = { use: cur ? cur.use : 'fixed', value: el.value }; render(); return; }
      if (el.closest('[data-pi]') || el.closest('[data-si]') || el.closest('[data-vi]')) return;
      if (!ownField(el) && el.id !== 'checkInput') return; readEl(el); render();
    } finally { fromInput = false; }
    });
    document.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset && el.dataset.done != null) { st.done = Array.from(document.querySelectorAll('[data-done]')).filter(x => x.checked).map(x => x.dataset.done); save(); return; }
      const pr = el.closest && el.closest('[data-pi]'), sc = el.closest && el.closest('[data-si]');
      if (pr && el.dataset.pf === 'use') { const r = (listFor(pr.dataset.pkey) || [])[Number(pr.dataset.pi)]; if (r) r.use = el.value; render(); return; }
      if (sc && el.dataset.sf && (el.tagName === 'SELECT' || el.type === 'checkbox')) { const s = cfg.med.stages[Number(sc.dataset.si)]; if (s) s[el.dataset.sf] = el.type === 'checkbox' ? el.checked : el.value; render(); return; }
      const vr2 = el.closest && el.closest('[data-vi]'); if (vr2 && el.dataset.vf === 'type') { const v = cfg.vars[Number(vr2.dataset.vi)]; if (v) v.type = el.value; render(); return; }
      const row = el.closest && el.closest('[data-logrow]');
      if (row && /^step(Act|Field)$/.test(el.dataset.lf || '')) { const r = std.log.params[Number(row.dataset.logrow)]; if (!r) return; const s = String(r.value || ''), k = s.indexOf('|'), act = k < 0 ? s : s.slice(0, k), f = k < 0 ? '' : s.slice(k + 1);
        r.value = el.dataset.lf === 'stepAct' ? el.value + '|' + (el.value === act ? f : '') : act + '|' + (el.value === '=' ? '=' : el.value); render(); return; }
      if (row && el.dataset.lf === 'use') { const r = std.log.params[Number(row.dataset.logrow)]; if (r) { if (r.use !== el.value) r.value = ''; r.use = el.value; } render(); return; }
      if (el.dataset && el.dataset.dsmap) { const own = A.ownDs(cfg, el.dataset.dsmap); const prev = own && own.map[el.dataset.p]; cfg.ds[el.dataset.dsmap].map[el.dataset.p] = { use: el.value, value: prev ? prev.value : '' }; render(); return; }
      if (el.id === 'runBy' || (el.dataset && (el.dataset.dsmode || ((el.dataset.k || el.dataset.s || el.dataset.l) && (el.tagName === 'SELECT' || el.type === 'radio' || el.type === 'checkbox'))))) { readEl(el); render(); }
    });
    document.addEventListener('click', e => {
      const k = e.target.closest('[data-key]'), c = e.target.closest('[data-col]');
      if (k) { const n = k.dataset.key, i = cfg.load.keys.indexOf(n); if (i >= 0) cfg.load.keys.splice(i, 1); else cfg.load.keys.push(n); render(); }
      else if (c && !c.disabled) { const n = c.dataset.col, i = cfg.exclude.indexOf(n); if (i >= 0) cfg.exclude.splice(i, 1); else cfg.exclude.push(n); render(); }
    });
    document.addEventListener('click', e => {
      const vd = e.target.closest('[data-vdel]'); if (vd) { cfg.vars.splice(Number(vd.closest('[data-vi]').dataset.vi), 1); render(); return; }
      const ap = e.target.closest('[data-addp]'), dp = e.target.closest('[data-delp]'), ds = e.target.closest('[data-delstage]');
      if (ap) { (listFor(ap.dataset.addp) || []).push({ name: '', use: 'text', value: '' }); render(); return; }
      if (dp) { const pr = dp.closest('[data-pi]'); (listFor(pr.dataset.pkey) || []).splice(Number(pr.dataset.pi), 1); render(); return; }
      if (ds) { cfg.med.stages.splice(Number(ds.closest('[data-si]').dataset.si), 1); render(); return; }
      const off = e.target.closest('[data-off]'), del = e.target.closest('[data-logdel]');
      if (off) { const g = off.dataset.off, i = std.off.indexOf(g); if (i >= 0) std.off.splice(i, 1); else std.off.push(g); render(); }
      else if (del) { std.log.params.splice(Number(del.closest('[data-logrow]').dataset.logrow), 1); render(); }
    });
    $('addVar').addEventListener('click', () => { cfg.vars.push({ name: '', type: 'String', value: '' }); render(); });
    $('addStage').addEventListener('click', () => { const n = cfg.med.stages.length, label = ['silver', 'gold'][n] || 'layer_' + (n + 2), prev = cfg.med.stages[n - 1];
      const base = String(cfg.med.bronzeFolder || '').replace(/\{(?!var:)[^}]*\}.*$/, '').replace(/\/+$/, '');   // keeps a leading {var:...}
      cfg.med.stages.push(A.medStage(label, 'folders', n === 0 ? base : (prev && prev.path ? prev.path.replace(/bronze/i, 'silver') : ''))); render(); });
    $('addLogParam').addEventListener('click', () => { std.log.params.push({ name: '', use: 'fixed', value: '' }); render(); });
    $('startOwn').addEventListener('click', () => toBlank(null));
    $('stdReset').addEventListener('click', () => { std = A.defaultStandards(); fill(); render(); });
    $('stdFile').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      S.readFile(f).then(t => { try { const o = JSON.parse(t); std = readStd(o && o.standards ? o.standards : o); fill(); render(); $('stdMsg').innerHTML = S.msg('ok', 'Standards loaded from ' + esc(f.name) + '.'); } catch (err) { $('stdMsg').innerHTML = S.msg('err', 'That file isn’t a standards file from this page.'); } e.target.value = ''; });
    });
    $('checkFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; S.readFile(f).then(t => { if (st.example) toBlank($('checkInput')); st.check = t; $('checkInput').value = t; render(); e.target.value = ''; }); });
    S.ownEntry({ isExample: () => st.example, toBlank });
    S.clearSetup({ onClear: () => { store.clear(); store.set('blank', true); std = A.defaultStandards(); st = { example: false, mode: st.mode, check: '', done: [], runBy: 'auto' }; cfg = A.blank(); fill(); document.querySelectorAll('[data-done]').forEach(el => { el.checked = false; }); render(); } });
    const file = (ext, text) => ({ name: (out ? out.names.pipeline : 'pipeline') + ext, text });
    const getters = {
      schemaQuery: () => $('schemaQueryView').textContent, volumeQuery: () => $('volumeQueryView').textContent,
      aiPrompt: () => ({ name: 'adf-transformations-prompt.txt', text: $('aiPromptView').textContent }),
      pipeline: () => out && file('.json', out.json), sql: () => out && file('.sql', out.sql), steps: () => out && out.steps, trigger: () => out && out.trigger && JSON.stringify(out.trigger, null, 4),
      standards: () => ({ name: 'adf-team-standards.json', text: JSON.stringify({ standards: std }, null, 2) }),
      review: () => checkRes && ('Pipeline review: ' + checkRes.name + '\n' + (checkRes.F.length ? checkRes.F.map(f => '[' + f.sev.toUpperCase() + '] ' + (f.activity || 'Pipeline') + ' (' + f.rule + '): ' + f.msg + (f.fix ? '\n    How to fix: ' + f.fix : '')).join('\n') : 'No findings.')),
      fixPrompt: () => checkRes && checkRes.prompt && ({ name: 'adf-fix-prompt.txt', text: checkRes.prompt })
    };
    document.addEventListener('click', e => { const b = e.target.closest('[data-copy^="ds"]'); if (b && out) { const d = out.datasets[Number(b.dataset.copy.slice(2))]; if (d) S.copyText(JSON.stringify(d, null, 4), b); } });
    fxWire(getters);
    S.wireCopy(getters);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

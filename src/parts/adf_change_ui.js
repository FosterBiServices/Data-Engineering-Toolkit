/* ADF Pipeline Generator: "Change a pipeline" tab. Wiring only; the work is in adf_change.js. Saved as dea.chg. */
(function () {
  'use strict';
  const S = window.DE_SUITE, A = window.ADF, $ = S.$, esc = S.esc, store = S.store('dea.');
  const blank = () => ({ pl: '', ds: '', changes: [], ask: '', reply: '', replyFor: '' });
  let g = blank(), view = null;   /* view: everything computed from g */
  const KIND = Object.fromEntries(A.CHANGE_KINDS);
  const str = v => (typeof v === 'string' ? v : '');

  function load() {
    const s = store.get('chg', null); if (!s || typeof s !== 'object') return;
    ['pl', 'ds', 'ask', 'reply', 'replyFor'].forEach(k => { g[k] = str(s[k]).slice(0, 2e6); });
    g.changes = (Array.isArray(s.changes) ? s.changes : []).filter(c => c && KIND[c.kind]).slice(0, 60).map(c => { const d = A.newChange(c.kind);
      Object.keys(d).forEach(k => { if (k === 'kind') return; if (Array.isArray(d[k])) d[k] = Array.isArray(c[k]) ? (k === 'params' ? c[k].filter(p => p && typeof p === 'object').map(p => ({ name: str(p.name), value: str(p.value), remove: !!p.remove })) : c[k].filter(x => typeof x === 'string')) : []; else if (typeof c[k] === typeof d[k]) d[k] = c[k]; });
      return d; });
  }
  const save = () => store.set('chg', g);
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return String(h); };

  /* ---------- compute ---------- */
  function compute() {
    const v = { msgs: [] }, r = A.readPipeline(g.pl);
    if (r.empty) return v; if (r.error) { v.msgs.push(S.msg('err', esc(r.error))); return v; }
    v.orig = r.pipeline; const d = A.readDatasets(g.ds); v.datasets = d.datasets; d.errors.forEach(e => v.msgs.push(S.msg('err', esc(e))));
    v.outline = A.outlinePipeline(v.orig);
    /* each change sees the pipeline as the changes above it left it */
    v.before = g.changes.map((c, i) => (c.kind === 'replace' || c.kind === 'toParam' ? A.applyChanges(v.orig, v.datasets, g.changes.slice(0, i), today()) : null));
    v.res = A.applyChanges(v.orig, v.datasets, g.changes, today());
    v.names = Array.from(new Set(v.outline.activities.map(a => a.name).concat(A.outlinePipeline(v.res.pipeline).activities.map(a => a.name))));
    v.prompt = g.ask.trim() ? S.fullPrompt(A.changePrompt(v.res.pipeline, g.ask, v.res.allDatasets)) : '';
    v.final = v.res.pipeline; v.finalDs = v.res.datasets.slice(); v.ai = null;
    if (g.ask.trim() && g.reply.trim()) {
      v.ai = A.changeParse(g.reply, S.parseBlocks);
      if (v.ai.pipeline && !v.ai.errors.length) { v.final = v.ai.pipeline; v.ai.datasets.forEach(ds => { const i = v.finalDs.findIndex(x => x.name === ds.name); if (i >= 0) v.finalDs[i] = ds; else v.finalDs.push(ds); }); }
      v.stale = g.replyFor && g.replyFor !== hash(JSON.stringify(v.res.pipeline) + g.ask);
    }
    if (g.changes.length || v.ai) v.review = A.reviewChange(v.orig, v.final, null, { fromCopilot: !!(v.ai && v.ai.pipeline && v.final === v.ai.pipeline), base: v.res.pipeline });
    v.notes = A.changeNotes(v.orig, Object.assign({}, v.res, { pipeline: v.final, datasets: v.finalDs }), g.changes, v.datasets.map(x => x.name)).concat(v.ai ? v.ai.also : []);
    return v;
  }
  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------- the change cards ---------- */
  const opt = (list, cur, empty) => (empty != null ? '<option value="">' + esc(empty) + '</option>' : '') + list.map(o => { const val = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(val) + '"' + (val === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + (cur && !list.some(o => (Array.isArray(o) ? o[0] : o) === cur) && cur !== '*' ? '<option value="' + esc(cur) + '" selected>' + esc(cur) + ' (not found)</option>' : '');
  const inp = (i, f, val, ph, lab, extra) => '<label class="lab">' + lab + '<input type="text" data-ci="' + i + '" data-cf="' + f + '" value="' + esc(val) + '" placeholder="' + esc(ph || '') + '" spellcheck="false" autocomplete="off"' + (extra || '') + '></label>';
  const sel = (i, f, list, cur, lab, empty) => '<label class="lab">' + lab + '<select data-ci="' + i + '" data-cf="' + f + '">' + opt(list, cur, empty) + '</select></label>';
  const chk = (i, f, on, lab) => '<label class="chk"><input type="checkbox" data-ci="' + i + '" data-cf="' + f + '"' + (on ? ' checked' : '') + '> ' + lab + '</label>';
  function card(c, i) {
    const o = view && view.outline, acts = view ? view.names : [], nbActs = o ? Array.from(new Set(o.activities.concat(A.outlinePipeline(view.res.pipeline).activities).filter(a => a.type === 'DatabricksNotebook').map(a => a.name))) : [];
    const params = o ? A.outlinePipeline(view.res.pipeline).parameters.map(p => p.name) : [], vars = o ? A.outlinePipeline(view.res.pipeline).variables.map(p => p.name) : [];
    let b = '';
    if (c.kind === 'replace') b = '<div class="qgrid">' + inp(i, 'find', c.find, 'yourproject/', 'Find') + inp(i, 'repl', c.repl, 'yourproject/{param:region}/', 'Replace with') + '</div>' + chk(i, 'cs', c.cs, 'Match upper and lower case') + '<div data-cfound="' + i + '"></div>';
    if (c.kind === 'toParam') b = '<div class="qgrid">' + inp(i, 'find', c.find, 'southern-region', 'The fixed value') + sel(i, 'as', [['param', 'A pipeline parameter (set per run, default = the value)'], ['var', 'A pipeline variable'], ['global', 'A global parameter (one value for the factory)']], c.as, 'Turn it into') + inp(i, 'name', c.name, 'region', 'Its name') + '</div>' + chk(i, 'cs', c.cs, 'Match upper and lower case') + '<div data-cfound="' + i + '"></div>';
    if (c.kind === 'param' || c.kind === 'var') {
      const list = c.kind === 'param' ? params : vars, word = c.kind === 'param' ? 'parameter' : 'variable';
      b = '<div class="qgrid">' + sel(i, 'action', [['add', 'Add one'], ['rename', 'Rename one'], ['default', 'Change its default'], ['remove', 'Remove one']], c.action, 'What to do')
        + (c.action === 'add' ? inp(i, 'name', c.name, c.kind === 'param' ? 'run_date' : 'target_path', 'Name') + sel(i, 'type', c.kind === 'param' ? [['String', 'Text'], ['Int', 'Whole number'], ['Bool', 'True / false']] : [['String', 'Text'], ['Boolean', 'True / false'], ['Array', 'List']], c.type, 'Type') + inp(i, 'value', c.value, '(optional)', 'Default value')
          : sel(i, 'name', list, c.name, 'The ' + word, 'Choose') + (c.action === 'rename' ? inp(i, 'newName', c.newName, '', 'New name') : c.action === 'default' ? inp(i, 'value', c.value, '', 'New default') : '')) + '</div>';
    }
    if (c.kind === 'rename') b = '<div class="qgrid">' + sel(i, 'activity', acts, c.activity, 'Activity', 'Choose') + inp(i, 'newName', c.newName, '', 'New name') + '</div>';
    if (c.kind === 'notebook' || c.kind === 'addNotebook') {
      b = '<div class="qgrid">' + (c.kind === 'notebook' ? sel(i, 'activity', nbActs, c.activity, 'Notebook step', 'Choose') + inp(i, 'path', c.path, '(leave empty to keep it)', 'New notebook path')
        : sel(i, 'after', acts, c.after, 'Runs after', 'Choose') + inp(i, 'name', c.name, 'nb_quality', 'Name of the new step') + inp(i, 'path', c.path, '/Shared/yourproject/nb_quality', 'Notebook path') + inp(i, 'ls', c.ls, '(empty: the one the other notebooks use)', 'Databricks linked service')) + '</div>'
        + (c.kind === 'addNotebook' ? chk(i, 'insert', c.insert, 'Put it between: steps that ran after ' + esc(c.after || 'that activity') + ' now run after the new one') : '')
        + '<div class="chgrows">' + c.params.map((p, j) => '<div class="chgrow"><input type="text" data-ci="' + i + '" data-pj="' + j + '" data-pf2="name" value="' + esc(p.name) + '" placeholder="parameter" spellcheck="false" aria-label="Parameter name"><input type="text" data-pv="1" data-ci="' + i + '" data-pj="' + j + '" data-pf2="value" value="' + esc(p.value) + '" placeholder="value, e.g. {param:region}" spellcheck="false" aria-label="Value"' + (p.remove ? ' disabled' : '') + '>'
          + (c.kind === 'notebook' ? '<label class="chk small"><input type="checkbox" data-ci="' + i + '" data-pj="' + j + '" data-pf2="remove"' + (p.remove ? ' checked' : '') + '> remove</label>' : '<span></span>') + '<button type="button" class="x" data-ci="' + i + '" data-pdel="' + j + '" aria-label="Remove row">&times;</button></div>').join('')
        + '<button type="button" class="linkbtn" data-ci="' + i + '" data-padd>+ ' + (c.kind === 'notebook' ? 'Set or remove a parameter' : 'A parameter it reads') + '</button></div>';
    }
    if (c.kind === 'dataset') b = '<div class="qgrid">' + sel(i, 'activity', [['*', 'Every step that uses it']].concat(acts.map(a => [a, a])), c.activity || '*', 'Where') + sel(i, 'from', o ? o.datasets : [], c.from, 'Dataset used now', 'Choose') + inp(i, 'to', c.to, 'ds_...', 'Dataset to use', ' list="chgDsNames"') + '</div>';
    if (c.kind === 'policy') b = '<div class="qgrid">' + sel(i, 'activity', [['*', 'Every activity that has these settings']].concat(acts.map(a => [a, a])), c.activity || '*', 'Which') + inp(i, 'timeout', c.timeout, '2 (hours) or 0.02:00:00', 'Timeout') + inp(i, 'retry', c.retry, '2', 'Retries') + inp(i, 'interval', c.interval, '60', 'Seconds between retries') + '</div>';
    if (c.kind === 'state') b = '<div class="qgrid">' + sel(i, 'activity', acts, c.activity, 'Activity', 'Choose') + sel(i, 'active', [['off', 'Turn it off (ADF skips it)'], ['on', 'Turn it on again']], c.active ? 'on' : 'off', 'What to do') + (c.active ? '' : sel(i, 'markAs', [['Succeeded', 'Succeeded'], ['Failed', 'Failed'], ['Skipped', 'Skipped']], c.markAs, 'Steps after it see it as')) + '</div>';
    if (c.kind === 'remove') b = '<div class="qgrid">' + sel(i, 'activity', acts, c.activity, 'Activity', 'Choose') + '</div><p class="note small">Steps that ran after it then run after what it ran after.</p>';
    if (c.kind === 'schedule') b = '<div class="qgrid">' + sel(i, 'freq', [['daily', 'Every day'], ['weekly', 'Every Monday'], ['hourly', 'Every hour']], c.freq, 'How often') + inp(i, 'time', c.time, '02:00', c.freq === 'hourly' ? 'At minute (hh:mm, minutes used)' : 'At (hh:mm)') + sel(i, 'tz', A.TZ, c.tz, 'Time zone') + inp(i, 'name', c.name, '(empty: named after the pipeline)', 'Trigger name') + '</div>';
    return '<div class="chgcard" data-card="' + i + '"><div class="chgcard-head"><span class="pill info">' + (i + 1) + '</span><b>' + esc(KIND[c.kind]) + '</b>'
      + (i ? '<button type="button" class="linkbtn" data-cup="' + i + '">Move up</button>' : '') + '<button type="button" class="linkbtn" data-cdel="' + i + '">Remove</button></div>' + b + '<div class="msgs" data-cmsg="' + i + '"></div></div>';
  }
  /* the places a find-and-replace touches, each with a tick box */
  function found(i) {
    const c = g.changes[i], box = document.querySelector('[data-cfound="' + i + '"]'); if (!box) return;
    if (!view || !view.orig || !c.find) { box.innerHTML = ''; return; }
    const st = view.before[i] || { pipeline: view.orig, allDatasets: view.datasets }, hits = A.findValue(st.pipeline, st.allDatasets, c.find, c.cs !== false)
      .filter(h => !(c.kind === 'toParam' && h.id === 'pipeline|properties/' + (c.as === 'var' ? 'variables' : 'parameters') + '/' + c.name + '/defaultValue'));
    box.innerHTML = hits.length ? '<p class="note small">Found in ' + hits.length + ' place' + (hits.length === 1 ? '' : 's') + '. Untick any that should stay as they are' + (hits.some(h => h.unsure) ? ' (notebook paths start unticked)' : '') + '.</p><div class="chgfound">'
      + hits.map(h => { const on = h.unsure ? c.keep.indexOf(h.id) >= 0 : c.skip.indexOf(h.id) < 0; return '<label><input type="checkbox" data-ci="' + i + '" data-hit="' + esc(h.id) + '" data-unsure="' + (h.unsure ? 1 : 0) + '"' + (on ? ' checked' : '') + '><span><b>' + esc(h.label) + '</b><br><span class="mono">' + esc(h.value.length > 140 ? h.value.slice(0, 137) + '...' : h.value) + '</span></span></label>'; }).join('') + '</div>'
      : '';
  }
  function renderCards() {
    $('chgList').innerHTML = g.changes.map(card).join('') || '<p class="note small">No changes yet. Choose one below.</p>';
    g.changes.forEach((c, i) => found(i));
  }

  /* ---------- everything else ---------- */
  function renderOut() {
    view = compute();
    const v = view;
    $('chgMsg').innerHTML = v.msgs.join('');
    $('chgStats').innerHTML = v.outline ? '<span class="stat">Pipeline <b>' + esc(v.outline.name || '(no name)') + '</b></span><span class="stat"><b>' + v.outline.activities.length + '</b> activities</span><span class="stat"><b>' + v.outline.parameters.length + '</b> parameters</span><span class="stat"><b>' + v.outline.variables.length + '</b> variables</span>' + (v.datasets.length ? '<span class="stat"><b>' + v.datasets.length + '</b> datasets pasted</span>' : '') : '';
    $('chgOutlineBox').hidden = !v.outline;
    if (v.outline) { const o = v.outline, line = (h, l) => '<div><b>' + h + ':</b> ' + (l.length ? esc(l.join(', ')) : '<span class="muted">none</span>') + '</div>';
      $('chgOutline').innerHTML = line('Activities', o.activities.map(a => '  '.repeat(a.depth) + a.name + ' (' + a.type + ')')) + line('Parameters', o.parameters.map(p => p.name + (p.value != null ? ' = ' + p.value : ''))) + line('Variables', o.variables.map(p => p.name + (p.value != null && p.value !== '' ? ' = ' + p.value : ''))) + line('Datasets used', o.datasets) + line('Notebooks', o.notebooks); }
    $('chgDsNames') && ($('chgDsNames').innerHTML = (v.datasets || []).map(d => '<option value="' + esc(d.name) + '"></option>').join(''));
    g.changes.forEach((c, i) => { const box = document.querySelector('[data-cmsg="' + i + '"]'); if (box) box.innerHTML = v.res ? (v.res.results[i].msgs || []).map(m => S.msg(m.sev, esc(m.msg))).join('') : ''; });
    /* Copilot */
    $('chgAiBox').hidden = !v.prompt; $('chgPromptView').textContent = v.prompt; if (v.prompt) S.count($('chgCount'), v.prompt);
    $('chgAiMsg').innerHTML = !v.ai ? '' : (v.ai.errors.map(e => S.msg('err', esc(e))).join('') + (v.stale ? S.msg('warn', 'The changes in Step 2 or the request changed after this reply. Copy the prompt again and send it to Copilot, so its reply starts from the same pipeline.') : '')
      + (v.ai.pipeline && !v.ai.errors.length ? S.msg('ok', 'Copilot’s pipeline is used below, after the review.' + (v.ai.notes.length ? '<ul>' + v.ai.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '')) : ''));
    /* review */
    const R = v.review; $('chgOut').hidden = !R; $('chgEmpty').hidden = !!R;
    if (R) {
      const errs = R.refs.length + R.fresh.filter(f => f.sev === 'high').length;
      $('chgOutStats').innerHTML = '<span class="stat"><b>' + R.diff.length + '</b> change' + (R.diff.length === 1 ? '' : 's') + '</span>' + (v.finalDs.length ? '<span class="stat"><b>' + v.finalDs.length + '</b> dataset' + (v.finalDs.length === 1 ? '' : 's') + ' changed</span>' : '') + (errs ? '<span class="stat" style="background:var(--err-soft);color:var(--err)"><b>' + errs + '</b> to fix</span>' : '<span class="stat" style="background:var(--ok-soft);color:var(--ok)">References and checks pass</span>');
      $('chgReview').innerHTML = R.flags.map(f => S.msg('warn', esc(f))).join('') + R.refs.map(f => S.msg('err', esc(f))).join('') + (R.fresh.length ? S.msg('warn', '<b>The checker found ' + R.fresh.length + ' new problem' + (R.fresh.length === 1 ? '' : 's') + ':</b><ul>' + R.fresh.map(f => '<li>' + esc((f.activity ? f.activity + ': ' : '') + f.msg) + (f.fix ? ' <i>' + esc(f.fix) + '</i>' : '') + '</li>').join('') + '</ul>') : '');
      $('chgAlsoBox').hidden = !v.notes.length; $('chgAlso').innerHTML = v.notes.map(n => '<li>' + esc(n) + '</li>').join('');
      const show = x => (x === undefined ? '<span class="muted">(none)</span>' : '<span class="mono">' + esc(typeof x === 'string' ? x : JSON.stringify(x)) + '</span>');
      $('chgDiffBody').innerHTML = R.diff.map(d => '<tr><td class="nm">' + esc(d.activity || 'Pipeline') + '</td><td>' + esc(d.what === 'changed' ? d.path : d.what + (d.path ? ' ' + d.path : ' (' + (d.detail || '') + ')')) + '</td><td style="overflow-wrap:anywhere">' + (d.what === 'added' ? '' : show(d.from)) + '</td><td style="overflow-wrap:anywhere">' + (d.what === 'removed' ? '' : show(d.to)) + '</td></tr>').join('') || '<tr><td colspan="4" class="muted">No difference from the pasted pipeline.</td></tr>';
      $('chgLines').innerHTML = lines(R.lines);
      $('chgJsonTitle').textContent = 'Pipeline JSON · ' + (v.final.name || 'pipeline'); $('chgJson').textContent = JSON.stringify(v.final, null, 4);
      $('chgDsOut').innerHTML = v.finalDs.map((d, k) => '<div class="codebox"><div class="codebox-bar"><span class="t">Dataset JSON · ' + esc(d.name) + '</span><span class="r"><button class="btn primary" type="button" data-chgds="' + k + '">Copy JSON</button></span></div><pre class="short">' + esc(JSON.stringify(d, null, 4)) + '</pre></div>').join('')
        + (v.res.trigger && !(v.ai && v.ai.pipeline) ? '<div class="codebox"><div class="codebox-bar"><span class="t">Trigger JSON · ' + esc(v.res.trigger.name) + '</span><span class="r"><button class="btn primary" type="button" data-copy="chgTrigger">Copy JSON</button></span></div><pre class="short">' + esc(JSON.stringify(v.res.trigger, null, 4)) + '</pre></div>' : '');
      $('chgSteps').textContent = steps(v);
    }
    save();
  }
  /* the line diff with unchanged runs folded */
  function lines(L) {
    const keep = new Array(L.length).fill(false); L.forEach((l, i) => { if (l.t !== ' ') for (let k = Math.max(0, i - 3); k <= Math.min(L.length - 1, i + 3); k++) keep[k] = true; });
    let out = '', skipped = 0;
    L.forEach((l, i) => { if (!keep[i]) { skipped++; return; } if (skipped) { out += '<div class="fold">… ' + skipped + ' unchanged line' + (skipped === 1 ? '' : 's') + '</div>'; skipped = 0; }
      out += '<div class="dl' + (l.t === '+' ? ' add' : l.t === '-' ? ' del' : '') + '"><span>' + (l.a || '') + '</span><span>' + (l.b || '') + '</span><span>' + (l.t === ' ' ? '' : l.t) + '</span><span>' + esc(l.s) + '</span></div>'; });
    if (skipped) out += '<div class="fold">… ' + skipped + ' unchanged line' + (skipped === 1 ? '' : 's') + '</div>';
    return out || '<div class="fold">No difference.</div>';
  }
  function steps(v) {
    const L = ['1. Keep the current version: in ADF Studio open ' + (v.orig.name || 'the pipeline') + ', code view {}, and save a copy of the JSON (or work in a Git branch).'];
    let n = 2;
    v.finalDs.forEach(d => L.push((n++) + '. Datasets > ' + d.name + ' > code view {} > replace everything with its new JSON > OK.'));
    L.push((n++) + '. Pipelines > ' + (v.orig.name || 'the pipeline') + ' > code view {} > replace everything with the new pipeline JSON > OK.' + (v.final.name !== v.orig.name ? ' (Its name changed to ' + v.final.name + ': paste it into a new pipeline instead.)' : ''));
    L.push((n++) + '. Select Validate and fix anything it flags.');
    if (v.res.trigger && !(v.ai && v.ai.pipeline)) L.push((n++) + '. Manage > Triggers > New > code view {} > paste the trigger JSON. It is created stopped.');
    v.notes.forEach(x => { if (!/^(Dataset .+ changed|Trigger )/.test(x)) L.push((n++) + '. ' + x); });
    L.push((n++) + '. Debug run on a small amount of data, then check the folders and logs say what you expect. Publish when it does.');
    return L.join('\n');
  }

  /* ---------- events ---------- */
  function setField(i, f, el) {
    const c = g.changes[i]; if (!c) return;
    if (el.type === 'checkbox') c[f] = el.checked; else if (f === 'active') c.active = el.value === 'on'; else c[f] = el.value;
  }
  function init() {
    if (!$('paneChange')) return;
    load();
    const dl = document.createElement('datalist'); dl.id = 'chgDsNames'; document.body.appendChild(dl);
    $('chgKind').innerHTML = A.CHANGE_KINDS.map(k => '<option value="' + k[0] + '">' + esc(k[1]) + '</option>').join('');
    $('chgPl').value = g.pl; $('chgDs').value = g.ds; $('chgAsk').value = g.ask; $('chgReply').value = g.reply;
    S.tabs($('chgTabs'));
    renderOut(); renderCards(); renderOut();
    $('chgAddBtn').addEventListener('click', () => { g.changes.push(A.newChange($('chgKind').value)); renderOut(); renderCards(); renderOut(); const last = $('chgList').lastElementChild; if (last) { last.scrollIntoView({ block: 'nearest' }); const f = last.querySelector('input,select'); if (f) f.focus(); } });
    $('chgPl').addEventListener('input', () => { g.pl = $('chgPl').value; renderOut(); renderCards(); });
    $('chgDs').addEventListener('input', () => { g.ds = $('chgDs').value; renderOut(); renderCards(); });
    $('chgAsk').addEventListener('input', () => { g.ask = $('chgAsk').value; renderOut(); });
    $('chgReply').addEventListener('input', () => { g.reply = $('chgReply').value; const v = compute(); g.replyFor = v.res ? hash(JSON.stringify(v.res.pipeline) + g.ask) : ''; renderOut(); });
    $('chgPlFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; S.readFile(f).then(t => { g.pl = t; $('chgPl').value = t; renderOut(); renderCards(); e.target.value = ''; }); });
    const pane = $('paneChange');
    pane.addEventListener('input', e => {
      const el = e.target, i = Number(el.dataset.ci); if (el.dataset.ci == null) return;
      if (el.dataset.pj != null) { const p = g.changes[i].params[Number(el.dataset.pj)]; if (p && el.type === 'text') p[el.dataset.pf2] = el.value; renderOut(); return; }
      if (el.dataset.cf && el.type === 'text') { setField(i, el.dataset.cf, el); renderOut(); if (el.dataset.cf === 'find' || el.dataset.cf === 'name') found(i); }
    });
    pane.addEventListener('change', e => {
      const el = e.target, i = Number(el.dataset.ci); if (el.dataset.ci == null) return; const c = g.changes[i]; if (!c) return;
      if (el.dataset.hit) { const id = el.dataset.hit, list = el.dataset.unsure === '1' ? c.keep : c.skip, want = el.dataset.unsure === '1' ? el.checked : !el.checked, k = list.indexOf(id); if (want && k < 0) list.push(id); if (!want && k >= 0) list.splice(k, 1); renderOut(); return; }
      if (el.dataset.pj != null && el.type === 'checkbox') { const p = c.params[Number(el.dataset.pj)]; if (p) p.remove = el.checked; renderOut(); renderCards(); return; }
      if (el.dataset.cf && (el.tagName === 'SELECT' || el.type === 'checkbox')) { setField(i, el.dataset.cf, el); renderOut(); renderCards(); renderOut(); }
    });
    pane.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cdel != null) { g.changes.splice(Number(b.dataset.cdel), 1); renderOut(); renderCards(); renderOut(); }
      else if (b.dataset.cup != null) { const i = Number(b.dataset.cup); const t = g.changes[i - 1]; g.changes[i - 1] = g.changes[i]; g.changes[i] = t; renderOut(); renderCards(); renderOut(); }
      else if (b.dataset.padd != null) { g.changes[Number(b.dataset.ci)].params.push({ name: '', value: '', remove: false }); renderCards(); }
      else if (b.dataset.pdel != null) { g.changes[Number(b.dataset.ci)].params.splice(Number(b.dataset.pdel), 1); renderOut(); renderCards(); }
      else if (b.dataset.chgds != null && view && view.finalDs) { const d = view.finalDs[Number(b.dataset.chgds)]; if (d) S.copyText(JSON.stringify(d, null, 4), b); }
    });
    S.wireCopy({
      chgPrompt: () => view && view.prompt && { name: 'adf-change-prompt.txt', text: view.prompt },
      chgPipeline: () => view && view.final && { name: (view.final.name || 'pipeline') + '.json', text: JSON.stringify(view.final, null, 4) },
      chgSteps: () => view && view.review && $('chgSteps').textContent,
      chgTrigger: () => view && view.res && view.res.trigger && JSON.stringify(view.res.trigger, null, 4)
    });
    /* Clear entries empties this tab too */
    ['clearYes', 'clearAllPages'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', () => { g = blank(); store.del('chg'); ['chgPl', 'chgDs', 'chgAsk', 'chgReply'].forEach(k => { $(k).value = ''; }); renderOut(); renderCards(); }); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

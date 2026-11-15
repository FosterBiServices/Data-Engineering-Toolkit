/* ADF Pipeline Generator: "Change a pipeline" tab. Wiring only; the work is in adf_change.js. Saved as dea.chg. */
(function () {
  'use strict';
  const S = window.DE_SUITE, A = window.ADF, $ = S.$, esc = S.esc, store = S.store('dea.');
  const blank = () => ({ pl: '', dsList: [], nbList: [], changes: [], ask: '', reply: '', replyFor: '' });   /* nbList: [{ for: notebook path, text }] */   /* dsList: [{ for: dataset name or '', text }] */
  let g = blank(), view = null;   /* view: everything computed from g */
  const KIND = Object.fromEntries(A.CHANGE_KINDS);
  const str = v => (typeof v === 'string' ? v : '');

  function load() {
    const s = store.get('chg', null); if (!s || typeof s !== 'object') return;
    ['pl', 'ask', 'reply', 'replyFor'].forEach(k => { g[k] = str(s[k]).slice(0, 2e6); });
    g.nbList = Array.isArray(s.nbList) ? s.nbList.filter(d => d && typeof d === 'object').slice(0, 40).map(d => ({ for: str(d.for).slice(0, 400), text: str(d.text).slice(0, 1e6), ai: d.ai !== false })) : [];
    g.dsList = Array.isArray(s.dsList) ? s.dsList.filter(d => d && typeof d === 'object').slice(0, 60).map(d => ({ for: str(d.for).slice(0, 200), text: str(d.text).slice(0, 1e6) })) : str(s.ds).trim() ? [{ for: '', text: str(s.ds) }] : [];
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
    v.orig = r.pipeline; const d = A.readDatasets(g.dsList.map(x => x.text).join('\n')); v.datasets = d.datasets; d.errors.forEach(e => v.msgs.push(S.msg('err', esc(e))));
    v.outline = A.outlinePipeline(v.orig);
    /* each change sees the pipeline as the changes above it left it */
    v.nbs = {}; g.nbList.forEach(n => { if (n.for.trim() && n.text.trim()) v.nbs[n.for.trim()] = A.readNotebook(n.text).text; });
    v.before = g.changes.map((c, i) => A.applyChanges(v.orig, v.datasets, g.changes.slice(0, i), today(), v.nbs));   /* each card picks from the pipeline as the cards above it left it */
    v.res = A.applyChanges(v.orig, v.datasets, g.changes, today(), v.nbs);
    v.names = Array.from(new Set(v.outline.activities.map(a => a.name).concat(A.outlinePipeline(v.res.pipeline).activities.map(a => a.name))));
    v.prompt = g.ask.trim() ? S.fullPrompt(A.changePrompt(v.res.pipeline, g.ask, v.res.allDatasets, Object.fromEntries(Object.keys(v.res.notebooks).filter(p => (g.nbList.find(n => n.for.trim() === p) || {}).ai !== false).map(p => [p, v.res.notebooks[p]])))) : '';
    v.final = v.res.pipeline; v.finalDs = v.res.datasets.slice(); v.finalNbs = Object.assign({}, v.res.notebooks); v.ai = null; v.aiNbs = [];
    if (g.ask.trim() && g.reply.trim()) {
      v.ai = A.changeParse(g.reply, S.parseBlocks);
      v.aiNbs = A.notebookParse(g.reply, S.parseBlocks);
      if (v.ai.pipeline && !v.ai.errors.length) { v.aiNbs.forEach(n => { v.finalNbs[n.path] = n.text; }); v.final = v.ai.pipeline; v.ai.datasets.forEach(ds => { const i = v.finalDs.findIndex(x => x.name === ds.name); if (i >= 0) v.finalDs[i] = ds; else v.finalDs.push(ds); }); }
      v.stale = g.replyFor && g.replyFor !== hash(JSON.stringify(v.res.pipeline) + g.ask);
    }
    if (g.changes.length || v.ai) v.review = A.reviewChange(v.orig, v.final, null, { fromCopilot: !!(v.ai && v.ai.pipeline && v.final === v.ai.pipeline), base: v.res.pipeline });
    v.nbReview = A.notebookReview(v.orig, v.final, v.finalNbs, g.changes).map(r => Object.assign(r, { orig: v.nbs[r.path], now: v.finalNbs[r.path], edited: v.nbs[r.path] != null && v.finalNbs[r.path] !== v.nbs[r.path] }));
    v.nbReview.forEach(r => { if (r.edited) { const was = new Set(String(r.orig).split('\n').map(l => l.trim().slice(0, 200))), now = String(r.now).split('\n'); r.hits = r.hits.filter(h => was.has(h.text) && now[h.line - 1] !== undefined && now[h.line - 1].trim().slice(0, 200) === h.text); } });   /* a line already changed is no longer flagged */
    v.nbNeeds = v.nbReview.filter(r => r.edited || r.added.length || r.changed.length || r.removed.length || r.missing.length || r.hits.length);
    v.notes = A.changeNotes(v.orig, Object.assign({}, v.res, { pipeline: v.final, datasets: v.finalDs }), g.changes, v.datasets.map(x => x.name)).filter(n => !/^Notebooks this pipeline runs/.test(n) || !v.nbNeeds.length).concat(v.nbNeeds.map(r => 'Notebook ' + r.path.split('/').pop() + ': ' + (r.edited ? 'a new version is ready' + (r.missing.length ? ', but it still doesn\u2019t read ' + r.missing.join(', ') : '') : r.missing.length ? (r.pasted ? 'doesn\u2019t read ' : 'is now sent ') + r.missing.join(', ') : r.hits.length ? 'check the line' + (r.hits.length > 1 ? 's that build' : ' that builds') + ' the text you replaced' : 'what it is sent changed') + '. See the Notebooks tab.'), v.ai ? v.ai.also : []);
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
    const here = o ? A.outlinePipeline((view.before[i] || view.res).pipeline) : null, params = here ? here.parameters.map(p => p.name) : [], vars = here ? here.variables.map(p => p.name) : [];
    let b = '';
    if (c.kind === 'replace') b = '<div class="qgrid">' + inp(i, 'find', c.find, 'yourproject/', 'Find') + inp(i, 'repl', c.repl, 'yourproject/{param:region}/', 'Replace with') + '</div>' + chk(i, 'cs', c.cs, 'Match upper and lower case') + '<div data-cfound="' + i + '"></div>';
    if (c.kind === 'toParam') b = '<div class="qgrid">' + inp(i, 'find', c.find, 'region-a', 'The fixed value') + sel(i, 'as', [['param', 'Pipeline parameter'], ['var', 'Pipeline variable'], ['global', 'Global parameter']], c.as, 'Turn it into') + inp(i, 'name', c.name, 'region', 'Its name') + '</div><p class="note small">' + ({ param: 'A pipeline parameter is set for each run (a trigger or Debug can pass another value); its default is the value above.', var: 'A pipeline variable starts with the value above and steps can change it during the run.', global: 'A global parameter has one value for the whole factory; create it under Manage > Global parameters.' }[c.as] || '') + '</p>' + chk(i, 'cs', c.cs, 'Match upper and lower case') + '<div data-cfound="' + i + '"></div>';
    if (c.kind === 'param' || c.kind === 'var') {
      const list = c.kind === 'param' ? params : vars, word = c.kind === 'param' ? 'parameter' : 'variable';
      b = '<div class="qgrid">' + sel(i, 'action', [['add', 'Add one'], ['rename', 'Rename one'], ['default', 'Change its default'], ['remove', 'Remove one']], c.action, 'What to do')
        + (c.action === 'add' ? inp(i, 'name', c.name, c.kind === 'param' ? 'run_date' : 'target_path', 'Name') + sel(i, 'type', c.kind === 'param' ? [['String', 'Text'], ['Int', 'Whole number'], ['Bool', 'True / false']] : [['String', 'Text'], ['Boolean', 'True / false'], ['Array', 'List']], c.type, 'Type') + inp(i, 'value', c.value, '(optional)', 'Default value')
          : sel(i, 'name', list, c.name, 'The ' + word, list.length ? 'Choose' : 'None yet') + (c.action === 'rename' ? inp(i, 'newName', c.newName, '', 'New name') : c.action === 'default' ? inp(i, 'value', c.value, '', 'New default') : '')) + '</div>'
        + (c.action !== 'add' && !list.length ? '<p class="note small">' + (o ? 'This pipeline has no ' + word + 's' + (i ? ' (counting the changes above)' : '') + '. Choose "Add one", or use "Fixed value to a parameter" to make one from a value it already uses.' : 'Paste the pipeline in Step 1 first.') + '</p>' : '');
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
    if (c.kind === 'dataset') b = '<div class="qgrid">' + sel(i, 'activity', [['*', 'Every step']].concat(acts.map(a => [a, a])), c.activity || '*', 'Where') + sel(i, 'from', o ? o.datasets : [], c.from, 'Dataset used now', 'Choose') + inp(i, 'to', c.to, 'ds_...', 'Dataset to use', ' list="chgDsNames"') + '</div>';
    if (c.kind === 'dsParam') b = '<div class="qgrid">' + sel(i, 'dataset', o ? A.outlinePipeline((view.before[i] || view.res).pipeline).datasets : [], c.dataset, 'Dataset', 'Choose') + sel(i, 'activity', [['*', 'Every step that uses it']].concat(acts.map(a => [a, a])), c.activity || '*', 'Where') + inp(i, 'name', c.name, 'location', 'Dataset parameter') + (c.remove ? '' : inp(i, 'value', c.value, '{var:location}', 'Value to send')) + '</div>' + chk(i, 'remove', c.remove, 'Stop sending it instead');
    if (c.kind === 'nbWidgets' || c.kind === 'nbReplace') {
      const paths = view && view.outline ? Array.from(new Set(view.outline.notebooks.concat(g.nbList.map(n => n.for).filter(Boolean)))).map(p => [p, p.split('/').pop() + (view.nbs[p] != null ? '' : ' (not pasted)')]) : [];
      b = '<div class="qgrid">' + sel(i, 'path', paths, c.path, 'Notebook', 'Choose') + (c.kind === 'nbReplace' ? inp(i, 'find', c.find, '/yourproject"', 'Find (in the notebook)') + inp(i, 'repl', c.repl, '/yourproject/{location}"', 'Replace with (Python)') : '') + '</div>' + (c.kind === 'nbReplace' ? chk(i, 'cs', c.cs, 'Match upper and lower case') : '');
    }
    if (c.kind === 'policy') b = '<div class="qgrid">' + sel(i, 'activity', [['*', 'Every activity']].concat(acts.map(a => [a, a])), c.activity || '*', 'Which') + inp(i, 'timeout', c.timeout, '2 (hours) or 0.02:00:00', 'Timeout') + inp(i, 'retry', c.retry, '2', 'Retries') + inp(i, 'interval', c.interval, '60', 'Seconds between retries') + '</div>';
    if (c.kind === 'state') b = '<div class="qgrid">' + sel(i, 'activity', acts, c.activity, 'Activity', 'Choose') + sel(i, 'active', [['off', 'Turn it off'], ['on', 'Turn it on']], c.active ? 'on' : 'off', 'What to do') + (c.active ? '' : sel(i, 'markAs', [['Succeeded', 'Succeeded'], ['Failed', 'Failed'], ['Skipped', 'Skipped']], c.markAs, 'Steps after it see it as')) + '</div>';
    if (c.kind === 'remove') b = '<div class="qgrid">' + sel(i, 'activity', acts, c.activity, 'Activity', 'Choose') + '</div><p class="note small">Steps that ran after it then run after what it ran after.</p>';
    if (c.kind === 'schedule') b = '<div class="qgrid">' + sel(i, 'freq', [['daily', 'Every day'], ['weekly', 'Every Monday'], ['hourly', 'Every hour']], c.freq, 'How often') + inp(i, 'time', c.time, '02:00', c.freq === 'hourly' ? 'At minute (hh:mm, minutes used)' : 'At (hh:mm)') + sel(i, 'tz', A.TZ, c.tz, 'Time zone') + inp(i, 'name', c.name, '(empty: named after the pipeline)', 'Trigger name') + '</div>';
    return '<div class="chgcard" data-card="' + i + '"><div class="chgcard-head"><span class="pill info">' + (i + 1) + '</span><b>' + esc(KIND[c.kind]) + '</b><span class="note small" style="flex-basis:100%;order:3;margin:0">' + esc(A.CHANGE_HINTS[c.kind] || '') + '</span>'
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

  /* ---------- one box per dataset the pipeline uses, plus any others ---------- */
  function dsRows() {
    const used = view && view.outline ? view.outline.datasets : [];
    used.forEach(n => { if (g.dsList.some(d => d.for === n)) return;
      const loose = g.dsList.find(d => !d.for && A.readDatasets(d.text).datasets.map(x => x.name).join() === n);   /* pasted before the boxes had names */
      if (loose) loose.for = n; else g.dsList.push({ for: n, text: '' }); });
    const order = used.map(n => g.dsList.findIndex(d => d.for === n)).concat(g.dsList.map((d, i) => i).filter(i => used.indexOf(g.dsList[i].for) < 0));
    $('chgDsWrap').hidden = !(view && view.outline);
    $('chgDsBox').innerHTML = order.map(i => { const d = g.dsList[i], named = used.indexOf(d.for) >= 0;
      return '<details class="chgdsrow" open><summary><b>' + esc(named ? d.for : 'Another dataset') + '</b><span data-dspill="' + i + '"></span>' + (named ? '' : '<button type="button" class="linkbtn" data-dsdel="' + i + '" style="margin-left:auto">Remove</button>') + '</summary>'
        + '<textarea class="mid" data-dsi="' + i + '" spellcheck="false" aria-label="JSON of ' + esc(named ? d.for : 'another dataset') + '" placeholder=\'{ "name": "' + esc(named ? d.for : 'ds_...') + '", "properties": { ... } }\'>' + esc(d.text) + '</textarea><div class="msgs" data-dsmsg="' + i + '"></div></details>'; }).join('');
    dsPills();
  }
  /* one box per notebook the pipeline runs, plus any others (with their path) */
  function nbRows() {
    const used = view && view.outline ? view.outline.notebooks : [];
    used.forEach(n => { if (!g.nbList.some(d => d.for === n)) g.nbList.push({ for: n, text: '' }); });
    const order = used.map(n => g.nbList.findIndex(d => d.for === n)).concat(g.nbList.map((d, i) => i).filter(i => used.indexOf(g.nbList[i].for) < 0));
    $('chgNbBox').innerHTML = order.map(i => { const d = g.nbList[i], named = used.indexOf(d.for) >= 0;
      return '<details class="chgdsrow" open><summary><b>' + esc(named ? d.for.split('/').pop() : 'Another notebook') + '</b><span data-nbpill="' + i + '"></span>' + (named ? '<span class="note small" style="flex-basis:100%">' + esc(d.for) + '</span>' : '<button type="button" class="linkbtn" data-nbdel="' + i + '" style="margin-left:auto">Remove</button>') + '</summary>'
        + (named ? '' : '<label class="lab">Its path in Databricks<input type="text" data-nbpath="' + i + '" value="' + esc(d.for) + '" placeholder="/Shared/yourproject/nb_gold" spellcheck="false"></label>')
        + '<textarea class="mid" data-nbi="' + i + '" spellcheck="false" aria-label="Notebook ' + esc(d.for) + '" placeholder="# Databricks notebook source">' + esc(d.text) + '</textarea>'
        + '<div class="reply-actions"><label class="btn filebtn">Open the .py or .ipynb file<input type="file" data-nbfile="' + i + '" accept=".py,.ipynb,.txt"></label><label class="chk small"><input type="checkbox" data-nbai="' + i + '"' + (d.ai !== false ? ' checked' : '') + '> Send it to Copilot in Step 3</label></div></details>'; }).join('') || '<p class="note small">This pipeline runs no notebooks.</p>';
    nbPills();
  }
  function nbPills() {
    g.nbList.forEach((d, i) => { const pill = document.querySelector('[data-nbpill="' + i + '"]'); if (!pill) return;
      if (!d.text.trim()) { pill.innerHTML = S.pill('info', 'Not pasted'); return; }
      const nb = A.readNotebook(d.text); pill.innerHTML = S.pill('ok', 'Pasted: ' + nb.lines.length + ' lines, reads ' + (nb.names.length ? nb.names.join(', ') : 'no widgets')); });
  }
  /* what each box holds: pasted, empty, or the wrong dataset */
  function dsPills() {
    g.dsList.forEach((d, i) => {
      const pill = document.querySelector('[data-dspill="' + i + '"]'), msg = document.querySelector('[data-dsmsg="' + i + '"]'); if (!pill) return;
      if (!d.text.trim()) { pill.innerHTML = S.pill('info', 'Not pasted'); if (msg) msg.innerHTML = ''; return; }
      const r = A.readDatasets(d.text), got = r.datasets.map(x => x.name);
      pill.innerHTML = r.errors.length ? S.pill('err', 'Can\u2019t be read') : S.pill('ok', 'Pasted' + (d.for ? '' : ': ' + got.join(', ')));
      if (msg) msg.innerHTML = r.errors.map(e => S.msg('err', esc(e))).join('') + (d.for && got.length && got.indexOf(d.for) < 0 ? S.msg('warn', 'This is ' + esc(got.join(', ')) + ', not ' + esc(d.for) + '.') : '');
    });
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
    $('chgAiBox').hidden = !v.prompt;
    $('chgAiWait').innerHTML = v.prompt ? '' : S.msg('info', !v.orig ? 'Paste the pipeline in Step 1 first: the prompt needs it.' : 'Type the change above and the prompt for Copilot appears here.'); $('chgPromptView').textContent = v.prompt; if (v.prompt) S.count($('chgCount'), v.prompt);
    $('chgAiMsg').innerHTML = !v.ai ? '' : (v.ai.errors.map(e => S.msg('err', esc(e))).join('') + (v.stale ? S.msg('warn', 'The changes in Step 2 or the request changed after this reply. Copy the prompt again and send it to Copilot, so its reply starts from the same pipeline.') : '')
      + (v.ai.pipeline && !v.ai.errors.length ? S.msg('ok', 'Copilot’s pipeline' + (v.aiNbs.length ? ' and ' + v.aiNbs.length + ' notebook' + (v.aiNbs.length === 1 ? '' : 's') : '') + ' are used below, after the review.' + (v.ai.notes.length ? '<ul>' + v.ai.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '')) : ''));
    /* review */
    const R = v.review; $('chgOut').hidden = !R; $('chgEmpty').hidden = !!R;
    if (R) {
      const errs = R.refs.length + R.fresh.filter(f => f.sev === 'high').length;
      $('chgOutStats').innerHTML = '<span class="stat"><b>' + R.diff.length + '</b> change' + (R.diff.length === 1 ? '' : 's') + '</span>' + (v.finalDs.length ? '<span class="stat"><b>' + v.finalDs.length + '</b> dataset' + (v.finalDs.length === 1 ? '' : 's') + ' changed</span>' : '') + (errs ? '<span class="stat" style="background:var(--err-soft);color:var(--err)"><b>' + errs + '</b> to fix</span>' : '<span class="stat" style="background:var(--ok-soft);color:var(--ok)">References and checks pass</span>');
      $('chgReview').innerHTML = R.flags.map(f => S.msg('warn', esc(f))).join('') + R.refs.map(f => S.msg('err', esc(f))).join('') + (R.fresh.length ? S.msg('warn', '<b>The checker found ' + R.fresh.length + ' new problem' + (R.fresh.length === 1 ? '' : 's') + ':</b><ul>' + R.fresh.map(f => '<li>' + esc((f.activity ? f.activity + ': ' : '') + f.msg) + (f.fix ? ' <i>' + esc(f.fix) + '</i>' : '') + '</li>').join('') + '</ul>') : '');
      $('chgAlsoBox').hidden = !v.notes.length; $('chgAlso').innerHTML = v.notes.map(n => '<li>' + esc(n) + '</li>').join('');
      const show = x => (x === undefined ? '<span class="muted">(none)</span>' : '<span class="mono">' + esc(typeof x === 'string' ? x : JSON.stringify(x)) + '</span>');
      $('chgDiffBody').innerHTML = R.diff.map(d => '<tr><td class="nm">' + esc(d.activity || 'Pipeline') + '</td><td>' + esc(d.what === 'changed' ? d.path : d.what + (d.path ? ' ' + d.path : ' (' + (d.detail || '') + ')')) + '</td><td style="overflow-wrap:anywhere">' + (d.what === 'added' ? '' : show(d.from)) + '</td><td style="overflow-wrap:anywhere">' + (d.what === 'removed' || (d.what === 'added' && !d.path) ? '' : show(d.to)) + '</td></tr>').join('') || '<tr><td colspan="4" class="muted">No difference from the pasted pipeline.</td></tr>';
      $('chgLines').innerHTML = lines(R.lines);
      $('chgJsonTitle').textContent = 'Pipeline JSON · ' + (v.final.name || 'pipeline'); $('chgJson').textContent = JSON.stringify(v.final, null, 4);
      $('chgDsOut').innerHTML = v.finalDs.map((d, k) => '<div class="codebox"><div class="codebox-bar"><span class="t">Dataset JSON · ' + esc(d.name) + '</span><span class="r"><button class="btn primary" type="button" data-chgds="' + k + '">Copy JSON</button></span></div><pre class="short">' + esc(JSON.stringify(d, null, 4)) + '</pre></div>').join('')
        + (v.res.trigger && !(v.ai && v.ai.pipeline) ? '<div class="codebox"><div class="codebox-bar"><span class="t">Trigger JSON · ' + esc(v.res.trigger.name) + '</span><span class="r"><button class="btn primary" type="button" data-copy="chgTrigger">Copy JSON</button></span></div><pre class="short">' + esc(JSON.stringify(v.res.trigger, null, 4)) + '</pre></div>' : '');
      $('chgNbOut').innerHTML = v.nbNeeds.map((r, k) => '<div class="chgnb"><div><b>' + esc(r.path.split('/').pop()) + '</b> <span class="note small">' + esc(r.path) + '</span></div>'
        + '<div class="note small">' + (r.gone ? 'No step runs it any more.' : 'Run by ' + esc(r.steps.join(', ')) + '.') + '</div>'
        + (r.added.length || r.changed.length || r.removed.length ? '<div><b>What the pipeline now sends it</b><ul>' + r.added.map(n => '<li>New: <span class="mono">' + esc(n) + '</span></li>').join('') + r.changed.map(x => '<li><span class="mono">' + esc(x.name) + '</span>: <span class="mono">' + esc(x.from) + '</span> \u2192 <span class="mono">' + esc(x.to) + '</span></li>').join('') + r.removed.map(n => '<li>No longer sent: <span class="mono">' + esc(n) + '</span></li>').join('') + '</ul></div>' : '')
        + (r.pasted && r.missing.length ? S.msg('warn', 'The notebook doesn\u2019t read ' + r.missing.map(esc).join(', ') + ' yet. These lines read ' + (r.missing.length === 1 ? 'it' : 'them') + ':<pre class="mono">' + esc(r.addLines.join('\n')) + '</pre><button type="button" class="btn" data-nbaddw="' + esc(r.path) + '">Add these lines for me</button> Then use the value where it belongs: "Notebook: find and replace", or ask Copilot in Step 3.') : '')
        + (!r.pasted && (r.added.length || r.changed.length) ? S.msg('info', 'Paste this notebook in Step 1 to check it reads ' + (r.added.length ? r.added.map(esc).join(', ') : 'what it is sent') + ', and to change it here.') : '')
        + (r.hits.length ? S.msg('info', '<b>Lines that build the text you replaced, so they may need the change too:</b><ul>' + r.hits.map(h => '<li>Line ' + h.line + ': <span class="mono">' + esc(h.text) + '</span></li>').join('') + '</ul>Change them with "Notebook: find and replace", or ask Copilot in Step 3.') : '')
        + (r.edited ? '<div><b>The new version</b> (' + (v.aiNbs.some(n => n.path === r.path) && v.ai && v.ai.pipeline && !v.ai.errors.length ? 'from Copilot' : 'from the changes in Step 2') + ')</div><div class="chgdiff">' + lines(A.lineDiff(r.orig, r.now)) + '</div><div class="reply-actions"><button class="btn" type="button" data-nbsave="' + k + '">Download</button><button class="btn primary" type="button" data-nbcopy="' + k + '">Copy the notebook</button></div>' : '')
        + '</div>').join('') || '<p class="note small">No notebook is affected by these changes.</p>';
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
    (v.nbNeeds || []).filter(r => r.edited).forEach(r => L.push((n++) + '. Databricks: open ' + r.path + ' and replace its contents with the new version (Notebooks tab), or import the downloaded file in its place.'));
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
    const hint = () => { $('chgKindHint').textContent = A.CHANGE_HINTS[$('chgKind').value] || ''; }; hint(); $('chgKind').addEventListener('change', hint);
    $('chgPl').value = g.pl; $('chgAsk').value = g.ask; $('chgReply').value = g.reply;
    S.tabs($('chgTabs'));
    renderOut(); renderCards(); renderOut(); dsRows(); nbRows();
    $('chgAddBtn').addEventListener('click', () => { g.changes.push(A.newChange($('chgKind').value)); renderOut(); renderCards(); renderOut(); const last = $('chgList').lastElementChild; if (last) { last.scrollIntoView({ block: 'nearest' }); const f = last.querySelector('input,select'); if (f) f.focus(); } });
    $('chgPl').addEventListener('input', () => { g.pl = $('chgPl').value; const before = view && view.outline ? view.outline.datasets.join() : ''; renderOut(); renderCards(); if ((view && view.outline ? view.outline.datasets.join() : '') !== before || $('chgDsWrap').hidden === !!(view && view.outline)) { dsRows(); nbRows(); } });
    $('chgNbAdd').addEventListener('click', () => { g.nbList.push({ for: '', text: '' }); nbRows(); const t = $('chgNbBox').querySelectorAll('input[data-nbpath]'); if (t.length) t[t.length - 1].focus(); });
    $('chgDsAdd').addEventListener('click', () => { g.dsList.push({ for: '', text: '' }); dsRows(); const t = $('chgDsBox').querySelectorAll('textarea'); if (t.length) t[t.length - 1].focus(); });
    $('chgAsk').addEventListener('input', () => { g.ask = $('chgAsk').value; renderOut(); });
    $('chgReply').addEventListener('input', () => { g.reply = $('chgReply').value; const v = compute(); g.replyFor = v.res ? hash(JSON.stringify(v.res.pipeline) + g.ask) : ''; renderOut(); });
    $('chgPlFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; S.readFile(f).then(t => { g.pl = t; $('chgPl').value = t; renderOut(); renderCards(); dsRows(); nbRows(); e.target.value = ''; }); });
    const pane = $('paneChange');
    pane.addEventListener('input', e => {
      if (e.target.dataset.nbi != null) { const d = g.nbList[Number(e.target.dataset.nbi)]; if (d) d.text = e.target.value; renderOut(); renderCards(); nbPills(); return; }
      if (e.target.dataset.nbpath != null) { const d = g.nbList[Number(e.target.dataset.nbpath)]; if (d) d.for = e.target.value; renderOut(); renderCards(); return; }
      if (e.target.dataset.dsi != null) { const d = g.dsList[Number(e.target.dataset.dsi)]; if (d) d.text = e.target.value; renderOut(); renderCards(); dsPills(); return; }
      const el = e.target, i = Number(el.dataset.ci); if (el.dataset.ci == null) return;
      if (el.dataset.pj != null) { const p = g.changes[i].params[Number(el.dataset.pj)]; if (p && el.type === 'text') p[el.dataset.pf2] = el.value; renderOut(); return; }
      if (el.dataset.cf && el.type === 'text') { setField(i, el.dataset.cf, el); renderOut(); if (el.dataset.cf === 'find' || el.dataset.cf === 'name') found(i); }
    });
    pane.addEventListener('change', e => { const el = e.target; if (el.dataset && el.dataset.nbai != null) { const d = g.nbList[Number(el.dataset.nbai)]; if (d) d.ai = el.checked; renderOut(); return; }
      if (el.dataset && el.dataset.nbfile != null) { const f = el.files[0], d = g.nbList[Number(el.dataset.nbfile)]; if (f && d) S.readFile(f).then(t => { d.text = A.readNotebook(t).text; renderOut(); renderCards(); nbRows(); }); el.value = ''; } });
    pane.addEventListener('change', e => {
      const el = e.target, i = Number(el.dataset.ci); if (el.dataset.ci == null) return; const c = g.changes[i]; if (!c) return;
      if (el.dataset.hit) { const id = el.dataset.hit, list = el.dataset.unsure === '1' ? c.keep : c.skip, want = el.dataset.unsure === '1' ? el.checked : !el.checked, k = list.indexOf(id); if (want && k < 0) list.push(id); if (!want && k >= 0) list.splice(k, 1); renderOut(); return; }
      if (el.dataset.pj != null && el.type === 'checkbox') { const p = c.params[Number(el.dataset.pj)]; if (p) p.remove = el.checked; renderOut(); renderCards(); return; }
      if (el.dataset.cf && (el.tagName === 'SELECT' || el.type === 'checkbox')) { setField(i, el.dataset.cf, el); renderOut(); renderCards(); renderOut(); }
    });
    pane.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.nbdel != null) { g.nbList.splice(Number(b.dataset.nbdel), 1); nbRows(); renderOut(); renderCards(); return; }
      if (b.dataset.nbaddw != null) { g.changes.push(Object.assign(A.newChange('nbWidgets'), { path: b.dataset.nbaddw })); renderOut(); renderCards(); renderOut(); return; }
      if (b.dataset.nbcopy != null && view && view.nbNeeds) { const r = view.nbNeeds[Number(b.dataset.nbcopy)]; if (r) S.copyText(r.now, b); return; }
      if (b.dataset.nbsave != null && view && view.nbNeeds) { const r = view.nbNeeds[Number(b.dataset.nbsave)]; if (r) S.saveText(r.path.split('/').pop().replace(/\.py$/, '') + '.py', r.now); return; }
      if (b.dataset.dsdel != null) { g.dsList.splice(Number(b.dataset.dsdel), 1); dsRows(); renderOut(); renderCards(); return; }
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
    ['clearYes', 'clearAllPages'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', () => { g = blank(); store.del('chg'); ['chgPl', 'chgAsk', 'chgReply'].forEach(k => { $(k).value = ''; }); renderOut(); renderCards(); dsRows(); nbRows(); }); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

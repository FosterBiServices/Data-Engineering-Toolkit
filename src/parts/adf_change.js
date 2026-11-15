/* ADF Pipeline Generator: change a pipeline that already works.
   The user pastes the pipeline (and any datasets to change with it), then lists changes. The page makes the common
   ones itself, exactly (A.applyChanges); anything else goes to Copilot (A.changePrompt / A.changeParse). Every result
   ends in the same review (A.reviewChange): what changed where, broken references, new checker findings, and what
   must change outside the pipeline. No DOM here, so Node can test it. */
(function (root) {
  'use strict';
  const A = root.ADF;
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const clone = v => JSON.parse(JSON.stringify(v));
  const X = v => ({ value: v, type: 'Expression' });
  const sq = s => "'" + String(s).replace(/'/g, "''") + "'";
  const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const CONTAINERS = { ForEach: ['activities'], Until: ['activities'], IfCondition: ['ifTrueActivities', 'ifFalseActivities'], Switch: ['defaultActivities'] };
  const NO_POLICY = /^(ForEach|Until|IfCondition|Switch|SetVariable|AppendVariable|Filter|Wait|Fail|ExecutePipeline)$/;

  /* ---------- reading what the user pasted ---------- */
  /* one or more dataset JSONs, one after another (each copied from its code view) */
  A.readDatasets = function (text) {
    const out = [], errs = [], t = String(text || '');
    let i = 0;
    while (i < t.length) {
      const s = t.indexOf('{', i); if (s < 0) break;
      let d = 0, q = false, e = -1;
      for (let k = s; k < t.length; k++) { const c = t[k]; if (q) { if (c === '\\') k++; else if (c === '"') q = false; continue; } if (c === '"') q = true; else if (c === '{') d++; else if (c === '}') { d--; if (!d) { e = k; break; } } }
      if (e < 0) { errs.push('A dataset JSON isn’t complete: copy it again from its code view.'); break; }
      const chunk = t.slice(s, e + 1); i = e + 1;
      let o; try { o = JSON.parse(chunk); } catch (err) { errs.push('A dataset JSON can’t be read: ' + err.message); continue; }
      if (!isObj(o) || !isObj(o.properties) || !o.name) { errs.push('Something pasted with the datasets isn’t a dataset (it needs a name and properties).'); continue; }
      if (Array.isArray(o.properties.activities)) { errs.push(o.name + ' is a pipeline: paste it in the pipeline box.'); continue; }
      out.push(o);
    }
    return { datasets: out, errors: errs };
  };

  /* an outline of the pipeline, for the page and for picking things in the change forms */
  A.outlinePipeline = function (pl) {
    const flat = A.flatten(clone(pl)), p = pl.properties || {};
    const nbs = [], dss = [];
    flat.forEach(f => { const t = f.a.typeProperties || {}; if (f.type === 'DatabricksNotebook') { const v = isObj(t.notebookPath) ? t.notebookPath.value : t.notebookPath; if (v && nbs.indexOf(v) < 0) nbs.push(String(v)); }
      JSON.stringify(f.a).replace(/"referenceName":"([^"]+)","type":"DatasetReference"/g, (m, n) => { if (dss.indexOf(n) < 0) dss.push(n); return m; }); });
    return { name: pl.name || '', activities: flat.map(f => ({ name: f.name, type: f.type, depth: f.depth, inside: f.parent ? f.parent.name : '' })),
      parameters: Object.keys(p.parameters || {}).map(k => ({ name: k, type: (p.parameters[k] || {}).type || 'String', value: (p.parameters[k] || {}).defaultValue })),
      variables: Object.keys(p.variables || {}).map(k => ({ name: k, type: (p.variables[k] || {}).type || 'String', value: (p.variables[k] || {}).defaultValue })),
      notebooks: nbs, datasets: dss };
  };

  /* ---------- expressions: where text sits, and how to write a value back ---------- */
  /* a full expression: literal pieces (in quotes) and code pieces */
  function tokens(body) {
    const out = []; let i = 0, code = '';
    while (i < body.length) {
      if (body[i] === "'") { if (code) { out.push({ code }); code = ''; } let j = i + 1, txt = ''; while (j < body.length) { if (body[j] === "'") { if (body[j + 1] === "'") { txt += "'"; j += 2; continue; } break; } txt += body[j]; j++; } out.push({ lit: txt }); i = j + 1; }
      else { code += body[i]; i++; }
    }
    if (code) out.push({ code });
    return out;
  }
  const untokens = list => list.map(t => (t.code != null ? t.code : sq(t.lit))).join('');
  /* text with @{...} parts: text pieces and expression pieces */
  function interp(s) {
    const out = []; let i = 0, txt = '';
    while (i < s.length) {
      if (s[i] === '@' && s[i + 1] === '@') { txt += '@'; i += 2; continue; }
      if (s[i] === '@' && s[i + 1] === '{') {
        if (txt) { out.push({ text: txt }); txt = ''; }
        let j = i + 2, d = 1, q = false; for (; j < s.length; j++) { const c = s[j]; if (q) { if (c === "'") { if (s[j + 1] === "'") { j++; continue; } q = false; } continue; } if (c === "'") q = true; else if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
        out.push({ expr: s.slice(i + 2, j) }); i = j + 1; continue;
      }
      txt += s[i]; i++;
    }
    if (txt) out.push({ text: txt });
    return out;
  }
  const uninterp = list => list.map(p => (p.expr != null ? '@{' + p.expr + '}' : p.text.replace(/@/g, '@@'))).join('');
  const kindOf = s => (/^@(?![@{])/.test(s) ? 'expr' : /@\{/.test(s) ? 'interp' : 'text');

  /* the replacement typed by the user: text, with {param:x} {var:x} {global:x} where a value comes from the run */
  A.REF_TOKENS = [['param', 'pipeline parameter'], ['var', 'pipeline variable'], ['global', 'global parameter']];
  const refExpr = (k, n) => (k === 'param' ? 'pipeline().parameters.' + n : k === 'var' ? "variables('" + n + "')" : 'pipeline().globalParameters.' + n);
  A.parseRepl = function (text) {
    const out = [], re = /\{(param|var|global):([A-Za-z_][\w]*)\}/g; let m, last = 0; const s = String(text == null ? '' : text);
    while ((m = re.exec(s))) { if (m.index > last) out.push({ text: s.slice(last, m.index) }); out.push({ ref: refExpr(m[1], m[2]), kind: m[1], name: m[2] }); last = re.lastIndex; }
    if (last < s.length) out.push({ text: s.slice(last) });
    return out;
  };
  const hasRef = pieces => pieces.some(p => p.ref);
  /* split a text on the find string and put the replacement pieces in between */
  function splice(text, re, pieces) {
    const out = []; let last = 0, m; re.lastIndex = 0;
    while ((m = re.exec(text))) { if (m.index > last) out.push({ text: text.slice(last, m.index) }); pieces.forEach(p => out.push(p)); last = re.lastIndex; if (!m[0].length) re.lastIndex++; }
    if (last < text.length) out.push({ text: text.slice(last) });
    const merged = []; out.forEach(p => { const l = merged[merged.length - 1]; if (p.text != null && l && l.text != null) l.text += p.text; else if (p.text !== '') merged.push(Object.assign({}, p)); });
    return merged;
  }
  /* pieces -> an expression body (no @): a literal, a reference, or concat(...) */
  const asExpr = pieces => { const parts = pieces.map(p => (p.ref ? p.ref : sq(p.text))); return parts.length === 1 ? parts[0] : parts.length ? 'concat(' + parts.join(', ') + ')' : "''"; };
  /* pieces -> a value for a property: plain text, or an expression */
  const asValue = pieces => { if (!hasRef(pieces)) return pieces.map(p => p.text).join(''); if (pieces.length === 1) return X('@' + pieces[0].ref); return X(pieces.map(p => (p.ref ? '@{' + p.ref + '}' : p.text.replace(/@/g, '@@'))).join('')); };

  /* ---------- finding a value everywhere it is used ---------- */
  const SKIP = { name: 1, type: 1, description: 1, dependsOn: 1, userProperties: 1, referenceName: 1, state: 1, onInactiveMarkAs: 1, annotations: 1, folder: 1 };
  /* every string in the pipeline (and pasted datasets) worth searching, with where it is */
  function strings(pl, datasets) {
    const out = [];
    const walkVal = (node, path, where, label, ctx) => {
      if (typeof node === 'string') { out.push({ where, path, label, ctx: ctx || kindOf(node), value: node }); return; }
      if (Array.isArray(node)) { node.forEach((v, i) => walkVal(v, path.concat(i), where, label, ctx)); return; }
      if (!isObj(node)) return;
      if (node.type === 'Expression' && typeof node.value === 'string') { out.push({ where, path: path.concat('value'), label, ctx: kindOf(node.value) === 'text' ? 'text' : kindOf(node.value), value: node.value }); return; }
      Object.keys(node).forEach(k => { if (SKIP[k]) return; walkVal(node[k], path.concat(k), where, label + (label ? '.' : '') + k, ctx); });
    };
    const walkActs = (list, path, chain) => (Array.isArray(list) ? list : []).forEach((a, i) => {
      if (!isObj(a)) return; const ap = path.concat(i), nm = chain.concat(String(a.name || '?')).join(' > ');
      ['typeProperties', 'inputs', 'outputs'].forEach(k => { if (a[k] == null) return;
        if (k === 'typeProperties') { const tp = a.typeProperties; Object.keys(tp).forEach(t => { if ((CONTAINERS[a.type] || []).indexOf(t) >= 0 || (a.type === 'Switch' && t === 'cases')) return; walkVal(tp[t], ap.concat('typeProperties', t), 'pipeline', nm + ': ' + t); }); }
        else walkVal(a[k], ap.concat(k), 'pipeline', nm + ': ' + k); });
      const tp = a.typeProperties || {};
      (CONTAINERS[a.type] || []).forEach(k => walkActs(tp[k], ap.concat('typeProperties', k), chain.concat(String(a.name || '?'))));
      if (a.type === 'Switch') (tp.cases || []).forEach((c, ci) => walkActs(c && c.activities, ap.concat('typeProperties', 'cases', ci, 'activities'), chain.concat(String(a.name || '?'))));
    });
    const p = pl.properties || {};
    walkActs(p.activities, ['properties', 'activities'], []);
    Object.keys(p.variables || {}).forEach(v => { const d = (p.variables[v] || {}).defaultValue; if (typeof d === 'string') out.push({ where: 'pipeline', path: ['properties', 'variables', v, 'defaultValue'], label: 'variable ' + v + ' (default value)', ctx: 'default', value: d }); });
    Object.keys(p.parameters || {}).forEach(v => { const d = (p.parameters[v] || {}).defaultValue; if (typeof d === 'string') out.push({ where: 'pipeline', path: ['properties', 'parameters', v, 'defaultValue'], label: 'parameter ' + v + ' (default value)', ctx: 'pdefault', value: d }); });
    (datasets || []).forEach(d => {
      const n = out.length; walkVal(d.properties.typeProperties || {}, ['properties', 'typeProperties'], 'dataset:' + d.name, '', null);
      for (let k = n; k < out.length; k++) out[k].label = 'dataset ' + d.name + ': ' + out[k].label;
    });
    return out.map(o => Object.assign(o, { id: o.where + '|' + o.path.join('/') }));
  }
  const findRe = (find, cs) => new RegExp(reEsc(find), cs ? 'g' : 'gi');
  /* where the text is used. In an expression only text inside quotes counts, never function or step names. */
  A.findValue = function (pl, datasets, find, cs) {
    if (!find) return [];
    const re = findRe(find, cs), test = s => { re.lastIndex = 0; return re.test(s); };
    return strings(pl, datasets).filter(o => {
      if (o.ctx === 'expr') return tokens(o.value.slice(1)).some(t => t.lit != null && test(t.lit));
      if (o.ctx === 'interp') return interp(o.value).some(p => (p.text != null ? test(p.text) : tokens(p.expr).some(t => t.lit != null && test(t.lit))));
      return test(o.value);
    }).map(o => ({ id: o.id, where: o.where, label: o.label, ctx: o.ctx, value: o.value, unsure: /(^|\.)notebookPath$/.test(o.label) || /: notebookPath/.test(o.label) }));   /* a notebook's own path is rarely meant: off until ticked */
  };

  const getAt = (rootObj, path) => path.reduce((a, k) => (a == null ? a : a[k]), rootObj);
  const setAt = (rootObj, path, v) => { const last = path[path.length - 1], parent = getAt(rootObj, path.slice(0, -1)); if (parent) parent[last] = v; };

  /* ---------- the changes ---------- */
  A.CHANGE_KINDS = [
    ['replace', 'Find and replace text'],
    ['toParam', 'Fixed value to a parameter'],
    ['param', 'Pipeline parameters'],
    ['var', 'Pipeline variables'],
    ['rename', 'Rename an activity'],
    ['notebook', 'Change a notebook step'],
    ['addNotebook', 'Add a notebook step'],
    ['dataset', 'Use another dataset'],
    ['dsParam', 'Send a value to a dataset parameter'],
    ['policy', 'Timeout and retries'],
    ['state', 'Turn an activity off or on'],
    ['remove', 'Remove an activity'],
    ['schedule', 'Add a schedule'],
    ['nbWidgets', 'Notebook: read what the pipeline sends'],
    ['nbReplace', 'Notebook: find and replace']
  ];
  A.CHANGE_HINTS = { replace: 'Paths, folders and other text inside values. Names of activities and datasets are left alone.', toParam: 'A value typed in, such as a folder, becomes a parameter, variable or global parameter everywhere it is used.', param: 'Add, rename, change the default of, or remove one.', var: 'Add, rename, change the default of, or remove one.', rename: 'Everything that refers to it is updated too.', notebook: 'Its path, or the parameters it is sent.', addNotebook: 'A new notebook step after an activity, or in between two.', dataset: 'Swap the dataset a step reads or writes.', dsParam: 'Every step that uses a dataset sends this value to one of its parameters (or stops sending it).', policy: 'For one activity or all of them.', state: 'A step that is off is skipped; the steps after it see it as succeeded.', remove: 'Steps that ran after it then run after what it ran after.', schedule: 'A trigger that runs the pipeline daily, weekly or hourly.', nbWidgets: 'Adds a widget line for each parameter a notebook step now sends that the pasted notebook doesn\u2019t read yet.', nbReplace: 'Changes text in a pasted notebook, for example a folder it builds itself. Type the new text as Python.' };
  A.newChange = kind => ({
    replace: { kind, find: '', repl: '', cs: true, skip: [], keep: [] },
    toParam: { kind, find: '', name: '', as: 'param', cs: true, skip: [], keep: [] },
    param: { kind, action: 'add', name: '', newName: '', type: 'String', value: '' },
    var: { kind, action: 'add', name: '', newName: '', type: 'String', value: '' },
    rename: { kind, activity: '', newName: '' },
    notebook: { kind, activity: '', path: '', params: [] },
    addNotebook: { kind, after: '', name: '', path: '', ls: '', params: [], insert: false },
    dataset: { kind, activity: '', from: '', to: '' },
    dsParam: { kind, dataset: '', activity: '*', name: '', value: '', remove: false },
    policy: { kind, activity: '*', timeout: '', retry: '', interval: '' },
    state: { kind, activity: '', active: false, markAs: 'Succeeded' },
    remove: { kind, activity: '' },
    schedule: { kind, freq: 'daily', time: '02:00', tz: 'UTC', name: '' },
    nbWidgets: { kind, path: '' },
    nbReplace: { kind, path: '', find: '', repl: '', cs: true }
  }[kind] || { kind });

  /* find an activity anywhere, with the list it sits in */
  function locate(pl, name) {
    let hit = null;
    const walk = (list, parent) => (Array.isArray(list) ? list : []).forEach(a => { if (hit || !isObj(a)) return; if (a.name === name) { hit = { a, list, parent }; return; } const tp = a.typeProperties || {}; (CONTAINERS[a.type] || []).forEach(k => walk(tp[k], a)); if (a.type === 'Switch') (tp.cases || []).forEach(c => walk(c && c.activities, a)); });
    walk((pl.properties || {}).activities, null);
    return hit;
  }
  const allActs = pl => { const out = []; const walk = list => (Array.isArray(list) ? list : []).forEach(a => { if (!isObj(a)) return; out.push(a); const tp = a.typeProperties || {}; (CONTAINERS[a.type] || []).forEach(k => walk(tp[k])); if (a.type === 'Switch') (tp.cases || []).forEach(c => walk(c && c.activities)); }); walk((pl.properties || {}).activities); return out; };
  /* change text inside every expression of the pipeline (for renames) */
  function rewriteExprs(node, fn) {
    if (Array.isArray(node)) node.forEach((v, i) => { if (typeof v === 'string') node[i] = fn(v); else rewriteExprs(v, fn); });
    else if (isObj(node)) Object.keys(node).forEach(k => { const v = node[k]; if (typeof v === 'string') { if (k === 'value' && node.type === 'Expression' || /^@/.test(v)) node[k] = fn(v); } else rewriteExprs(v, fn); });
  }
  const usesIn = (pl, re) => { let n = 0; rewriteExprs(clone(pl), s => { re.lastIndex = 0; if (re.test(s)) n++; return s; }); return n; };
  const timeout = v => { const s = String(v || '').trim(); if (!s) return ''; if (/^\d+(\.\d+)?$/.test(s)) { const h = Number(s), d = Math.floor(h / 24), hh = Math.floor(h % 24), mm = Math.round((h % 1) * 60); return d + '.' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00'; } return /^\d+\.\d{2}:\d{2}:\d{2}$/.test(s) ? s : null; };

  /* a value typed in a form ("text {param:x}") as a property value */
  const valueOf = t => asValue(A.parseRepl(t).filter(p => p.ref || p.text !== ''));

  /* replace the find text in the chosen places. Returns messages. */
  function replaceIn(state, find, repl, cs, skip, keep) {
    const msgs = [], pieces = A.parseRepl(repl), refs = hasRef(pieces), re = findRe(find, cs);
    const hits = A.findValue(state.pl, state.datasets, find, cs).filter(h => (skip || []).indexOf(h.id) < 0 && (!h.unsure || (keep || []).indexOf(h.id) >= 0));
    if (!hits.length) { msgs.push({ sev: 'warn', msg: '"' + find + '" isn’t used anywhere the page can change (names of activities, datasets and linked services are left alone).' }); return msgs; }
    const inits = [];
    hits.forEach(h => {
      const ds = h.where.indexOf('dataset:') === 0 ? state.datasets.find(d => 'dataset:' + d.name === h.where) : null, rootObj = ds || state.pl;
      const path = h.id.split('|')[1].split('/').map(k => (/^\d+$/.test(k) ? Number(k) : k));
      if (h.ctx === 'expr') { const t = tokens(h.value.slice(1)).map(tk => { if (tk.lit == null) return tk; re.lastIndex = 0; if (!re.test(tk.lit)) return tk; return { code: asExpr(splice(tk.lit, re, pieces)) }; }); setAt(rootObj, path, '@' + untokens(t)); }
      else if (h.ctx === 'interp') {
        const out = []; interp(h.value).forEach(p => { if (p.expr != null) { out.push({ expr: untokens(tokens(p.expr).map(tk => { if (tk.lit == null) return tk; re.lastIndex = 0; if (!re.test(tk.lit)) return tk; return { code: asExpr(splice(tk.lit, re, pieces)) }; })) }); return; }
          splice(p.text, re, pieces).forEach(q => out.push(q.ref ? { expr: q.ref } : { text: q.text })); });
        setAt(rootObj, path, uninterp(out));
      }
      else if (h.ctx === 'pdefault') { if (refs) msgs.push({ sev: 'warn', msg: 'Not changed: ' + h.label + '. A parameter’s default can’t read another parameter or variable.' }); else setAt(rootObj, path, h.value.replace(re, repl)); }
      else if (h.ctx === 'default') {
        if (!refs) { setAt(rootObj, path, h.value.replace(re, repl)); return; }
        /* a variable's default is never evaluated: set it at the start of the run instead */
        const v = path[2], np = splice(h.value, re, pieces); setAt(rootObj, path.slice(0, -1), Object.assign({}, getAt(rootObj, path.slice(0, -1)), { defaultValue: '' }));
        inits.push({ v, value: asExpr(np) });
      }
      else if (ds && refs) {
        /* a dataset can't read the pipeline: it gets a parameter, and every step using it passes the value */
        const pn = (pieces.find(p => p.ref) || {}).name || 'value', np = splice(h.value, re, pieces.map(p => (p.ref ? { ref: 'dataset().' + pn } : p)));
        ds.properties.parameters = ds.properties.parameters || {};
        if (!ds.properties.parameters[pn]) ds.properties.parameters[pn] = { type: 'string', defaultValue: (pieces.find(p => p.ref) ? h.value.match(re)[0] : '') };
        setAt(ds, path, np.length === 1 && np[0].ref ? X('@' + np[0].ref) : X(np.map(p => (p.ref ? '@{' + p.ref + '}' : p.text.replace(/@/g, '@@'))).join('')));
        const ref = pieces.find(p => p.ref).ref; let n = 0;
        allActs(state.pl).forEach(a => walkRefs(a, ds.name, r => { r.parameters = r.parameters || {}; if (r.parameters[pn] == null) { r.parameters[pn] = X('@' + ref); n++; } }));
        msgs.push({ sev: 'info', msg: 'Dataset ' + ds.name + ' gets a parameter ' + pn + ' (default "' + ds.properties.parameters[pn].defaultValue + '", so other pipelines using it keep working). ' + n + ' step' + (n === 1 ? '' : 's') + ' here now pass it.' });
        state.dsChanged[ds.name] = true;
      }
      else { setAt(rootObj, path, asValue(splice(h.value, re, pieces))); if (ds) state.dsChanged[ds.name] = true; }
    });
    inits.forEach(x => addInit(state.pl, x.v, x.value, msgs));
    msgs.unshift({ sev: 'ok', msg: 'Changed ' + hits.length + ' place' + (hits.length === 1 ? '' : 's') + '.' });
    return msgs;
  }
  /* dataset references of one activity, not of the activities inside it (those are visited on their own) */
  function walkRefs(node, dsName, fn, top) {
    if (Array.isArray(node)) { node.forEach(v => walkRefs(v, dsName, fn, false)); return; }
    if (!isObj(node)) return;
    if (node.type === 'DatasetReference' && node.referenceName === dsName) fn(node);
    const own = top !== false && typeof node.name === 'string' && isObj(node.typeProperties) ? CONTAINERS[node.type] || (node.type === 'Switch' ? ['cases', 'defaultActivities'] : []) : [];
    Object.keys(node).forEach(k => { if (k === 'typeProperties' && own.length) { Object.keys(node.typeProperties).forEach(t => { if (own.indexOf(t) < 0) walkRefs(node.typeProperties[t], dsName, fn, false); }); return; } walkRefs(node[k], dsName, fn, false); });
  }
  /* Set Variable at the start of the run, before everything that starts the run */
  function addInit(pl, v, body, msgs) {
    const acts = pl.properties.activities, name = 'set_' + v;
    if (acts.some(a => a.name === name)) { const a = acts.find(x => x.name === name); a.typeProperties.value = X('@' + body); return; }
    const prevInits = acts.filter(a => /^set_/.test(a.name) && a.userProperties && a.userProperties.some(u => u.name === 'init'));
    const roots = acts.filter(a => !(a.dependsOn || []).length && prevInits.indexOf(a) < 0);
    const init = { name, type: 'SetVariable', dependsOn: prevInits.length ? [{ activity: prevInits[prevInits.length - 1].name, dependencyConditions: ['Succeeded'] }] : [], policy: { secureOutput: false, secureInput: false }, userProperties: [{ name: 'init', value: 'set at the start of the run' }], typeProperties: { variableName: v, value: X('@' + body) } };
    roots.forEach(a => { a.dependsOn = [{ activity: name, dependencyConditions: ['Succeeded'] }]; });
    if (prevInits.length) acts.forEach(a => { (a.dependsOn || []).forEach(d => { if (d.activity === prevInits[prevInits.length - 1].name && a !== init && !/^set_/.test(a.name)) d.activity = name; }); });
    acts.splice(prevInits.length ? acts.indexOf(prevInits[prevInits.length - 1]) + 1 : 0, 0, init);
    msgs.push({ sev: 'info', msg: 'The variable ' + v + ' now gets its value from a Set Variable step at the start of the run (' + name + '), because a variable’s default value is never evaluated.' });
  }

  function addParam(pl, name, type, value) { const p = pl.properties.parameters = pl.properties.parameters || {}; if (p[name]) return false; p[name] = { type: type || 'String' }; if (value !== '' && value != null) p[name].defaultValue = type === 'Int' ? Number(value) : type === 'Bool' ? /^true$/i.test(value) : value; return true; }
  function addVar(pl, name, type, value) { const p = pl.properties.variables = pl.properties.variables || {}; if (p[name]) return false; p[name] = { type: type || 'String' }; if (value !== '' && value != null) p[name].defaultValue = value; return true; }
  const okName = n => /^[A-Za-z_][\w]*$/.test(n);
  const okAct = n => /^[^.+?/<>*%&:\\]{1,55}$/.test(n);

  function applyOne(state, c) {
    const pl = state.pl, P = pl.properties, msgs = [], err = m => [{ sev: 'err', msg: m }];
    switch (c.kind) {
      case 'replace': if (!c.find) return err('Type the text to find.'); return replaceIn(state, c.find, c.repl, c.cs !== false, c.skip, c.keep);
      case 'toParam': {
        if (!c.find) return err('Type the value to turn into a ' + (c.as === 'var' ? 'variable' : c.as === 'global' ? 'global parameter' : 'parameter') + '.');
        if (!okName(c.name)) return err('Give it a name: letters, digits and _ only, not starting with a digit.');
        if (c.as === 'param' && addParam(pl, c.name, 'String', c.find)) msgs.push({ sev: 'ok', msg: 'Added the parameter ' + c.name + ' (default "' + c.find + '").' });
        if (c.as === 'var' && addVar(pl, c.name, 'String', c.find)) msgs.push({ sev: 'ok', msg: 'Added the variable ' + c.name + ' (default "' + c.find + '").' });
        if (c.as === 'global') state.globals[c.name] = c.find;
        const own = ['pipeline|properties/' + (c.as === 'var' ? 'variables' : 'parameters') + '/' + c.name + '/defaultValue'];   /* its own default keeps the value */
        return msgs.concat(replaceIn(state, c.find, '{' + c.as + ':' + c.name + '}', c.cs !== false, (c.skip || []).concat(own), c.keep));
      }
      case 'param': case 'var': {
        const isP = c.kind === 'param', bag = isP ? (P.parameters = P.parameters || {}) : (P.variables = P.variables || {}), word = isP ? 'parameter' : 'variable';
        const ref = n => (isP ? new RegExp('pipeline\\(\\)\\.parameters\\.' + reEsc(n) + '\\b', 'g') : new RegExp("variables\\(\\s*'" + reEsc(n) + "'\\s*\\)", 'g'));
        if (c.action === 'add') { if (!okName(c.name)) return err('Give the ' + word + ' a name: letters, digits and _ only.'); if (bag[c.name]) return err('There is already a ' + word + ' called ' + c.name + '.'); (isP ? addParam : addVar)(pl, c.name, c.type, c.value); return [{ sev: 'ok', msg: 'Added the ' + word + ' ' + c.name + '.' }]; }
        if (!bag[c.name]) return err('There is no ' + word + ' called ' + (c.name || '(none chosen)') + '.');
        if (c.action === 'remove') { const n = usesIn(pl, ref(c.name)) + (isP ? 0 : allActs(pl).filter(a => (a.typeProperties || {}).variableName === c.name).length); if (n) return err(c.name + ' is still used in ' + n + ' place' + (n === 1 ? '' : 's') + '. Change those first.'); delete bag[c.name]; return [{ sev: 'ok', msg: 'Removed the ' + word + ' ' + c.name + '.' }]; }
        if (c.action === 'rename') {
          if (!okName(c.newName)) return err('Give the new name: letters, digits and _ only.'); if (bag[c.newName]) return err('There is already a ' + word + ' called ' + c.newName + '.');
          const nb = {}; Object.keys(bag).forEach(k => { nb[k === c.name ? c.newName : k] = bag[k]; }); if (isP) P.parameters = nb; else P.variables = nb;
          let n = 0; rewriteExprs(P.activities, s => s.replace(ref(c.name), () => { n++; return isP ? 'pipeline().parameters.' + c.newName : "variables('" + c.newName + "')"; }));
          if (!isP) allActs(pl).forEach(a => { if ((a.typeProperties || {}).variableName === c.name) { a.typeProperties.variableName = c.newName; n++; } });
          return [{ sev: 'ok', msg: 'Renamed the ' + word + ' ' + c.name + ' to ' + c.newName + ' (' + n + ' use' + (n === 1 ? '' : 's') + ' updated).' }].concat(isP ? [{ sev: 'info', msg: 'Triggers and Execute Pipeline steps that pass ' + c.name + ' must pass ' + c.newName + ' instead.' }] : []);
        }
        if (c.action === 'default') { if (isP && hasRef(A.parseRepl(c.value))) return err('A parameter’s default is plain text.'); bag[c.name].defaultValue = c.value; return [{ sev: 'ok', msg: 'Changed the default of ' + c.name + '.' }]; }
        return err('Choose what to do.');
      }
      case 'rename': {
        const h = locate(pl, c.activity); if (!h) return err('Choose the activity to rename.');
        if (!okAct(c.newName)) return err('Give the new name (up to 55 characters, none of . + ? / < > * % & : \\).'); if (locate(pl, c.newName)) return err('There is already an activity called ' + c.newName + '.');
        h.a.name = c.newName; h.list.forEach(s => (s.dependsOn || []).forEach(d => { if (d.activity === c.activity) d.activity = c.newName; }));
        let n = 0; rewriteExprs(P.activities, s => s.replace(new RegExp("activity\\(\\s*'" + reEsc(c.activity) + "'\\s*\\)", 'g'), () => { n++; return "activity('" + c.newName + "')"; }));
        return [{ sev: 'ok', msg: 'Renamed ' + c.activity + ' to ' + c.newName + (n ? ' and ' + n + ' expression' + (n === 1 ? '' : 's') + ' that read it' : '') + '.' }];
      }
      case 'notebook': {
        const h = locate(pl, c.activity); if (!h || h.a.type !== 'DatabricksNotebook') return err('Choose the notebook step.');
        const tp = h.a.typeProperties = h.a.typeProperties || {}, out = [];
        if (String(c.path || '').trim()) { tp.notebookPath = valueOf(c.path.trim()); out.push({ sev: 'ok', msg: 'Notebook path set.' }); }
        (c.params || []).forEach(p => { if (!p.name) return; tp.baseParameters = tp.baseParameters || {}; if (p.remove) { delete tp.baseParameters[p.name]; out.push({ sev: 'ok', msg: 'Removed the parameter ' + p.name + '.' }); } else { tp.baseParameters[p.name] = valueOf(p.value); out.push({ sev: 'ok', msg: 'Set the parameter ' + p.name + '.' }); } });
        return out.length ? out : err('Give a new path or a parameter to set.');
      }
      case 'addNotebook': {
        const h = locate(pl, c.after); if (!h) return err('Choose the activity it runs after.');
        if (!okAct(c.name)) return err('Name the new step.'); if (locate(pl, c.name)) return err('There is already an activity called ' + c.name + '.'); if (!String(c.path || '').trim()) return err('Give the notebook path.');
        const ls = String(c.ls || '').trim() || ((allActs(pl).find(a => a.type === 'DatabricksNotebook' && a.linkedServiceName) || {}).linkedServiceName || {}).referenceName || '<LS_DATABRICKS>';
        const bp = {}; (c.params || []).forEach(p => { if (p.name) bp[p.name] = valueOf(p.value); });
        const a = { name: c.name, type: 'DatabricksNotebook', dependsOn: [{ activity: c.after, dependencyConditions: ['Succeeded'] }], policy: { timeout: '0.02:00:00', retry: 0, retryIntervalInSeconds: 30, secureOutput: false, secureInput: false }, userProperties: [], typeProperties: { notebookPath: valueOf(c.path.trim()), baseParameters: bp }, linkedServiceName: { referenceName: ls, type: 'LinkedServiceReference' } };
        let moved = 0; if (c.insert) h.list.forEach(s => (s.dependsOn || []).forEach(d => { if (d.activity === c.after && (d.dependencyConditions || []).join() === 'Succeeded') { d.activity = c.name; moved++; } }));
        h.list.splice(h.list.indexOf(h.a) + 1, 0, a);
        return [{ sev: 'ok', msg: 'Added ' + c.name + ' after ' + c.after + (moved ? '; ' + moved + ' step' + (moved === 1 ? '' : 's') + ' that ran after ' + c.after + ' now run after it' : '') + '.' }];
      }
      case 'dataset': {
        if (!c.from || !c.to) return err('Choose the dataset to replace and the one to use.');
        let n = 0; (c.activity && c.activity !== '*' ? [(locate(pl, c.activity) || {}).a].filter(Boolean) : allActs(pl)).forEach(a => walkRefs(a, c.from, r => { r.referenceName = c.to; n++;
          const nd = state.datasets.find(d => d.name === c.to); if (nd && r.parameters) { const want = Object.keys(nd.properties.parameters || {}); Object.keys(r.parameters).forEach(k => { if (want.indexOf(k) < 0) delete r.parameters[k]; }); want.filter(k => r.parameters[k] == null && (nd.properties.parameters[k] || {}).defaultValue == null).forEach(k => msgs.push({ sev: 'warn', msg: a.name + ' passes nothing to ' + c.to + '’s parameter ' + k + '. Add it with "Find and replace" or in ADF Studio.' })); } }));
        return n ? [{ sev: 'ok', msg: n + ' use' + (n === 1 ? '' : 's') + ' of ' + c.from + ' now use ' + c.to + '.' }].concat(msgs) : err('Nothing here uses the dataset ' + c.from + '.');
      }
      case 'dsParam': {
        if (!c.dataset) return err('Choose the dataset.'); if (!okName(c.name)) return err('Give the dataset parameter\u2019s name.');
        if (!c.remove && !String(c.value || '').trim()) return err('Give the value to send, for example {var:location}.');
        let n = 0; (c.activity && c.activity !== '*' ? [(locate(pl, c.activity) || {}).a].filter(Boolean) : allActs(pl)).forEach(a => walkRefs(a, c.dataset, r => { if (c.remove) { if (r.parameters && c.name in r.parameters) { delete r.parameters[c.name]; n++; } return; } r.parameters = r.parameters || {}; r.parameters[c.name] = valueOf(c.value.trim()); n++; }));
        if (!n) return err(c.remove ? 'No step sends ' + c.name + ' to ' + c.dataset + '.' : 'No step here uses the dataset ' + c.dataset + '.');
        const nd = state.datasets.find(d => d.name === c.dataset), has = nd && Object.keys(nd.properties.parameters || {}).indexOf(c.name) >= 0;
        return [{ sev: 'ok', msg: n + ' use' + (n === 1 ? '' : 's') + ' of ' + c.dataset + (c.remove ? ' no longer send ' : ' now send ') + c.name + '.' }].concat(!c.remove && nd && !has ? [{ sev: 'warn', msg: 'The pasted ' + c.dataset + ' has no parameter called ' + c.name + '. Add it to the dataset, or ADF Studio will reject the pipeline.' }] : !c.remove && !nd ? [{ sev: 'info', msg: c.dataset + ' wasn\u2019t pasted, so the page can\u2019t check it has a parameter called ' + c.name + '.' }] : []);
      }
      case 'nbWidgets': {
        const src = state.nbs[c.path]; if (src == null) return err('Paste this notebook in Step 1 first (Notebooks this pipeline runs).');
        const nb = A.readNotebook(src), sent = {}; A.notebookSteps(pl).filter(x => x.path === c.path).forEach(x => Object.keys(x.params).forEach(k => { sent[k] = 1; }));
        const miss = Object.keys(sent).filter(k => nb.names.indexOf(k) < 0); if (!miss.length) return [{ sev: 'ok', msg: 'The notebook already reads everything its steps send.' }];
        const L = nb.lines.slice(), grp = re => { const i = L.findIndex(l => re.test(l)); if (i < 0) return -1; let j = i; while (j + 1 < L.length && re.test(L[j + 1])) j++; return j; };
        const v = k => k.replace(/\W/g, '_');
        let ti = grp(/^\s*dbutils\.widgets\.(text|dropdown|combobox)\(/); const tl = miss.map(k => 'dbutils.widgets.text("' + k + '", "")   # sent by the pipeline');
        if (ti < 0) { ti = L.findIndex(l => !/^\s*#/.test(l) && l.trim()) - 1; if (ti < -1) ti = -1; }
        L.splice(ti + 1, 0, ...tl);
        let gi = grp(/^\s*\w+\s*=\s*dbutils\.widgets\.get\(/); const gl = miss.map(k => v(k) + ' = dbutils.widgets.get("' + k + '").strip()');
        if (gi < 0) gi = ti + tl.length; L.splice(gi + 1, 0, ...gl);
        state.nbs[c.path] = L.join('\n'); state.nbChanged[c.path] = true;
        return [{ sev: 'ok', msg: 'Added widget lines for ' + miss.join(', ') + '. The notebook now has ' + miss.map(v).join(', ') + ' to use: say where with "Notebook: find and replace", or ask Copilot in Step 3.' }];
      }
      case 'nbReplace': {
        const src = state.nbs[c.path]; if (src == null) return err('Paste this notebook in Step 1 first (Notebooks this pipeline runs).'); if (!c.find) return err('Type the text to find.');
        const re = new RegExp(reEsc(c.find), c.cs !== false ? 'g' : 'gi'), lines = src.split('\n').map((l, i) => (re.test(l) ? i + 1 : 0)).filter(Boolean); re.lastIndex = 0;
        if (!lines.length) return err('"' + c.find + '" isn\u2019t in the notebook.');
        state.nbs[c.path] = src.replace(re, () => c.repl); state.nbChanged[c.path] = true;
        return [{ sev: 'ok', msg: 'Changed line' + (lines.length === 1 ? ' ' : 's ') + lines.join(', ') + '.' }];
      }
      case 'policy': {
        const to = timeout(c.timeout); if (to === null) return err('Timeout: hours (2) or d.hh:mm:ss (0.02:00:00).');
        const list = c.activity && c.activity !== '*' ? [(locate(pl, c.activity) || {}).a].filter(Boolean) : allActs(pl).filter(a => !NO_POLICY.test(a.type));
        if (!list.length) return err('Choose the activity.');
        list.forEach(a => { if (NO_POLICY.test(a.type)) return; a.policy = a.policy || {}; if (to) a.policy.timeout = to; if (String(c.retry).trim() !== '') a.policy.retry = Math.max(0, parseInt(c.retry, 10) || 0); if (String(c.interval).trim() !== '') a.policy.retryIntervalInSeconds = Math.max(30, parseInt(c.interval, 10) || 30); });
        return [{ sev: 'ok', msg: 'Updated ' + list.filter(a => !NO_POLICY.test(a.type)).length + ' activit' + (list.length === 1 ? 'y' : 'ies') + '.' }];
      }
      case 'state': {
        const h = locate(pl, c.activity); if (!h) return err('Choose the activity.');
        if (c.active) { delete h.a.state; delete h.a.onInactiveMarkAs; return [{ sev: 'ok', msg: c.activity + ' is on again.' }]; }
        h.a.state = 'Inactive'; h.a.onInactiveMarkAs = /^(Succeeded|Failed|Skipped)$/.test(c.markAs) ? c.markAs : 'Succeeded';
        return [{ sev: 'ok', msg: c.activity + ' is turned off; steps after it see it as ' + h.a.onInactiveMarkAs + '.' }];
      }
      case 'remove': {
        const h = locate(pl, c.activity); if (!h) return err('Choose the activity to remove.');
        const reads = usesIn({ properties: { activities: h.list.filter(x => x !== h.a) } }, new RegExp("activity\\(\\s*'" + reEsc(c.activity) + "'", 'g'));
        h.list.forEach(s => { const i = (s.dependsOn || []).findIndex(d => d.activity === c.activity); if (i < 0) return; const own = s.dependsOn.splice(i, 1)[0]; (h.a.dependsOn || []).forEach(d => { if (!s.dependsOn.some(x => x.activity === d.activity)) s.dependsOn.push({ activity: d.activity, dependencyConditions: own.dependencyConditions }); }); });
        h.list.splice(h.list.indexOf(h.a), 1);
        return [{ sev: 'ok', msg: 'Removed ' + c.activity + '; steps that ran after it now run after what it ran after.' }].concat(reads ? [{ sev: 'err', msg: reads + ' expression' + (reads === 1 ? '' : 's') + ' still read ' + c.activity + '’s output. Change them, or keep the step.' }] : []);
      }
      case 'schedule': {
        const hm = /^(\d{1,2}):(\d{2})$/.exec(String(c.time || '')); if (!hm) return err('Time as hh:mm, for example 02:00.');
        const rec = { frequency: c.freq === 'hourly' ? 'Hour' : c.freq === 'weekly' ? 'Week' : 'Day', interval: 1, startTime: (state.today || new Date().toISOString().slice(0, 10)) + 'T' + hm[1].padStart(2, '0') + ':' + hm[2] + ':00', timeZone: c.tz || 'UTC' };
        if (c.freq !== 'hourly') rec.schedule = { hours: [Number(hm[1])], minutes: [Number(hm[2])] }; else rec.schedule = { minutes: [Number(hm[2])] };
        if (c.freq === 'weekly') rec.schedule.weekDays = ['Monday'];
        const name = String(c.name || '').trim() || 'tr_' + String(pl.name || 'pipeline').replace(/^pl_/, '') + '_' + c.freq;
        state.trigger = { name, properties: { annotations: [], runtimeState: 'Stopped', pipelines: [{ pipelineReference: { referenceName: pl.name || '<PIPELINE_NAME>', type: 'PipelineReference' } }], type: 'ScheduleTrigger', typeProperties: { recurrence: rec } } };
        return [{ sev: 'ok', msg: 'Trigger ' + name + ' written (created stopped).' }];
      }
    }
    return err('Unknown change.');
  }

  /* apply the list in order, on copies; a change that fails leaves the pipeline as the change before it */
  A.applyChanges = function (pipeline, datasets, changes, today, notebooks) {
    const state = { pl: clone(pipeline), datasets: clone(datasets || []), dsChanged: {}, globals: {}, trigger: null, today, nbs: Object.assign({}, notebooks || {}), nbChanged: {} };
    ['parameters', 'variables'].forEach(k => { if (!isObj(state.pl.properties[k])) delete state.pl.properties[k]; });
    const results = (changes || []).map(c => {
      const before = clone({ pl: state.pl, datasets: state.datasets, nbs: state.nbs });
      let msgs; try { msgs = applyOne(state, c); } catch (e) { msgs = [{ sev: 'err', msg: 'This change couldn’t be made: ' + e.message }]; }
      if (msgs.some(m => m.sev === 'err')) { state.pl = before.pl; state.datasets = before.datasets; state.nbs = before.nbs; }
      return { change: c, msgs };
    });
    if (isObj(state.pl.properties.parameters) && !Object.keys(state.pl.properties.parameters).length) delete state.pl.properties.parameters;
    return { pipeline: state.pl, datasets: state.datasets.filter(d => state.dsChanged[d.name]), allDatasets: state.datasets, globals: state.globals, trigger: state.trigger, results, notebooks: state.nbs, nbChanged: Object.keys(state.nbChanged) };
  };

  /* ---------- review ---------- */
  /* every leaf that differs, grouped by activity */
  A.pipelineDiff = function (before, after) {
    const out = [], acts = pl => { const m = {}; allActs(pl).forEach(a => { m[a.name] = a; }); return m; }, A0 = acts(before), A1 = acts(after);
    const leaves = (node, path, bag) => { if (isObj(node) && node.type === 'Expression' && typeof node.value === 'string' && Object.keys(node).length === 2) bag[path] = node.value; else if (isObj(node)) { const k = Object.keys(node); if (!k.length) bag[path] = '{}'; k.forEach(x => { if ((CONTAINERS[node.type] || []).indexOf(x) >= 0 && path === 'typeProperties') return; leaves(node[x], path ? path + '.' + x : x, bag); }); } else if (Array.isArray(node)) { if (!node.length) bag[path] = '[]'; node.forEach((v, i) => leaves(v, path + '[' + i + ']', bag)); } else bag[path] = node; return bag; };
    const strip = a => { const c = clone(a); const tp = c.typeProperties || {}; (CONTAINERS[c.type] || []).forEach(k => delete tp[k]); if (c.type === 'Switch') delete tp.cases; return c; };
    /* a renamed activity: gone under one name, new under another, same type and nearly the same content */
    const gone = Object.keys(A0).filter(n => !A1[n]), fresh = Object.keys(A1).filter(n => !A0[n]), same = {}, sig = a => { const c = strip(a); delete c.name; delete c.dependsOn; return JSON.stringify(c).replace(/activity\('[^']*'\)/g, ''); };
    gone.forEach(n => { const m = fresh.find(f => !Object.values(same).includes(f) && A1[f].type === A0[n].type && sig(A1[f]) === sig(A0[n])); if (m) same[n] = m; });
    Object.keys(same).forEach(n => out.push({ what: 'changed', activity: same[n], path: 'name', from: n, to: same[n] }));
    fresh.forEach(n => { if (!Object.values(same).includes(n)) out.push({ what: 'added', activity: n, detail: A1[n].type }); });
    gone.forEach(n => { if (!same[n]) out.push({ what: 'removed', activity: n, detail: A0[n].type }); });
    Object.keys(same).forEach(n => { A0[same[n]] = A0[n]; });
    Object.keys(A1).forEach(n => { if (!A0[n]) return; const l0 = leaves(strip(A0[n]), '', {}), l1 = leaves(strip(A1[n]), '', {}); if (l0.name !== l1.name) { delete l0.name; delete l1.name; } Array.from(new Set(Object.keys(l0).concat(Object.keys(l1)))).forEach(k => { if ((l0[k] === '[]' || l0[k] === '{}') && l1[k] === undefined || (l1[k] === '[]' || l1[k] === '{}') && l0[k] === undefined) return; if (JSON.stringify(l0[k]) !== JSON.stringify(l1[k])) out.push({ what: 'changed', activity: n, path: k, from: l0[k], to: l1[k] }); }); });
    ['parameters', 'variables'].forEach(k => { const p0 = (before.properties || {})[k] || {}, p1 = (after.properties || {})[k] || {};
      Object.keys(p1).forEach(n => { if (!p0[n]) out.push({ what: 'added', activity: '', path: k + '.' + n, to: p1[n].defaultValue }); else if (JSON.stringify(p0[n]) !== JSON.stringify(p1[n])) out.push({ what: 'changed', activity: '', path: k + '.' + n, from: p0[n].defaultValue, to: p1[n].defaultValue }); });
      Object.keys(p0).forEach(n => { if (!p1[n]) out.push({ what: 'removed', activity: '', path: k + '.' + n }); }); });
    if (before.name !== after.name) out.push({ what: 'changed', activity: '', path: 'name', from: before.name, to: after.name });
    return out;
  };
  /* a line diff of the two JSON texts, for reading side by side */
  A.lineDiff = function (a, b) {
    const x = a.split('\n'), y = b.split('\n'), n = x.length, m = y.length;
    let s = 0; while (s < n && s < m && x[s] === y[s]) s++;
    let e = 0; while (e < n - s && e < m - s && x[n - 1 - e] === y[m - 1 - e]) e++;
    const X1 = x.slice(s, n - e), Y1 = y.slice(s, m - e), N = X1.length, M = Y1.length, out = [];
    for (let i = 0; i < s; i++) out.push({ t: ' ', a: i + 1, b: i + 1, s: x[i] });
    if (N * M > 4e6) { X1.forEach((l, i) => out.push({ t: '-', a: s + i + 1, s: l })); Y1.forEach((l, i) => out.push({ t: '+', b: s + i + 1, s: l })); }
    else {
      const L = Array.from({ length: N + 1 }, () => new Uint32Array(M + 1));
      for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--) L[i][j] = X1[i] === Y1[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      let i = 0, j = 0; while (i < N || j < M) { if (i < N && j < M && X1[i] === Y1[j]) { out.push({ t: ' ', a: s + i + 1, b: s + j + 1, s: X1[i] }); i++; j++; } else if (j < M && (i >= N || L[i][j + 1] >= L[i + 1][j])) { out.push({ t: '+', b: s + j + 1, s: Y1[j] }); j++; } else { out.push({ t: '-', a: s + i + 1, s: X1[i] }); i++; } }
    }
    for (let i = 0; i < e; i++) out.push({ t: ' ', a: n - e + i + 1, b: m - e + i + 1, s: x[n - e + i] });
    return out;
  };
  /* references that point at nothing */
  A.refProblems = function (pl) {
    const R = [], names = allActs(pl).map(a => a.name), P = pl.properties || {}, vars = Object.keys(P.variables || {}), params = Object.keys(P.parameters || {});
    rewriteExprs(clone(P.activities || []), s => { let m;
      const ar = /activity\(\s*'([^']*)'\s*\)/g; while ((m = ar.exec(s))) if (names.indexOf(m[1]) < 0) R.push('An expression reads the step ' + m[1] + ', which isn’t in the pipeline.');
      const vr = /variables\(\s*'([^']*)'\s*\)/g; while ((m = vr.exec(s))) if (vars.indexOf(m[1]) < 0) R.push('An expression reads the variable ' + m[1] + ', which isn’t defined.');
      const pr = /pipeline\(\)\.parameters\.(\w+)/g; while ((m = pr.exec(s))) if (params.indexOf(m[1]) < 0) R.push('An expression reads the parameter ' + m[1] + ', which isn’t defined.');
      return s; });
    allActs(pl).forEach(a => { const v = (a.typeProperties || {}).variableName; if (/^(SetVariable|AppendVariable)$/.test(a.type) && v && vars.indexOf(v) < 0) R.push(a.name + ' sets the variable ' + v + ', which isn’t defined.'); });
    return Array.from(new Set(R));
  };
  /* what the user must do outside this JSON */
  A.changeNotes = function (orig, res, changes, pastedNames) {
    const N = [], out = A.outlinePipeline(res.pipeline), used = out.datasets;
    const finds = (changes || []).filter(c => (c.kind === 'replace' || c.kind === 'toParam') && c.find).map(c => c.find);
    Object.keys(res.globals || {}).forEach(g => N.push('Create the global parameter ' + g + ' (Manage > Global parameters > New), value "' + res.globals[g] + '".'));
    (res.datasets || []).forEach(d => N.push('Dataset ' + d.name + ' changed: paste its new JSON into its code view. Other pipelines that use it are affected too.'));
    if (finds.length) {
      const notPasted = used.filter(n => (pastedNames || []).indexOf(n) < 0);
      if (notPasted.length) N.push('Not checked: the datasets ' + notPasted.join(', ') + ' weren’t pasted. If one has ' + finds.map(f => '"' + f + '"').join(' or ') + ' typed in (a fixed folder, for example), paste it in Step 1 so the page can change it too.');
      if (out.notebooks.length) N.push('Notebooks this pipeline runs: ' + out.notebooks.join(', ') + '. If one has ' + finds.map(f => '"' + f + '"').join(' or ') + ' typed in (a folder or table name), change it there too. Notebooks made with the Python Notebook Generator can be made again with the new values.');
    }
    const p0 = Object.keys((orig.properties || {}).parameters || {}), p1 = Object.keys((res.pipeline.properties || {}).parameters || {});
    const newP = p1.filter(p => p0.indexOf(p) < 0);
    if (newP.length) N.push('New parameter' + (newP.length > 1 ? 's' : '') + ' ' + newP.join(', ') + ': triggers and Execute Pipeline steps that run this pipeline use the default unless they pass a value.');
    if (res.trigger) N.push('Trigger ' + res.trigger.name + ': Manage > Triggers > New, code view {}, paste it. It is created stopped: start it after a test run.');
    return N;
  };
  /* everything for the review in one place */
  A.reviewChange = function (orig, after, std, extra) {
    const diff = A.pipelineDiff(orig, after), refs = A.refProblems(after);
    const key = f => f.sev + '|' + f.rule + '|' + f.activity + '|' + f.msg;
    const was = new Set(A.check(clone(orig), std).map(key)), now = A.check(clone(after), std);
    const fresh = now.filter(f => !was.has(key(f)) && f.sev !== 'low');
    const flags = [];
    if (extra && extra.fromCopilot) {
      (extra.base ? A.pipelineDiff(extra.base, after) : diff).filter(d => d.what === 'removed').forEach(d => flags.push('Copilot removed ' + (d.activity ? 'the activity ' + d.activity : d.path) + '. Check you asked for that.'));
      const base = extra.base || orig; if (base.name && after.name !== base.name) flags.push('Copilot renamed the pipeline to ' + after.name + '.');
    }
    return { diff, refs, fresh, flags, lines: A.lineDiff(JSON.stringify(orig, null, 4), JSON.stringify(after, null, 4)) };
  };

  /* ---------- Copilot, for changes the page can't make ---------- */
  A.changePrompt = function (pl, request, datasets, notebooks) {
    const nbp = A.notebookPromptPart ? A.notebookPromptPart(notebooks) : { context: [], start: [], rules: [], reply: [] };
    const L = ['You are a senior Azure Data Factory engineer changing a pipeline that already works. You cannot see the factory: use only the JSON under STARTING POINT.'];
    L.push('', 'TASK (the user’s request: all the change has to do)', String(request || '(not given)').trim());
    const o = A.outlinePipeline(pl);
    L.push('', 'CONTEXT', 'Activities (in order, with the container they sit in): ' + o.activities.map(a => a.name + ' [' + a.type + (a.inside ? ', inside ' + a.inside : '') + ']').join('; ') + '.',
      'Parameters: ' + (o.parameters.map(p => p.name).join(', ') || 'none') + '. Variables: ' + (o.variables.map(v => v.name).join(', ') || 'none') + '.',
      'Datasets it uses: ' + (o.datasets.join(', ') || 'none') + (datasets && datasets.length ? '; the JSON of ' + datasets.map(d => d.name).join(', ') + ' is included below' : '') + '.', ...nbp.context);
    L.push('', 'STARTING POINT', 'The pipeline:', JSON.stringify(pl, null, 2));
    (datasets || []).forEach(d => L.push('', 'Dataset ' + d.name + ':', JSON.stringify(d, null, 2)));
    nbp.start.forEach(x => L.push(x));
    L.push('', 'RULES',
      '- Change only what the TASK asks. Keep every other activity, name, dependency, dataset reference, parameter and expression exactly as it is.',
      '- Never invent dataset, linked service, notebook, procedure, table or column names. If the change needs one that isn’t in the JSON, use a placeholder in angle brackets like <NOTEBOOK_PATH> and list it under ALSO_CHANGE.',
      '- Expressions start with @, use single quotes for text (a quote inside text is written twice) and only ADF functions. Text with values inside uses @{...}. A literal @ in text is written @@.',
      '- A variable’s defaultValue and a parameter’s defaultValue are plain text: they are never evaluated. To build a value from a parameter, use a Set Variable step at the start, or the expression where the value is used.',
      '- Activity names stay unique. If you rename one, update every dependsOn and activity(\'name\') that uses it. A step inside a ForEach or If can only be depended on from inside the same container.',
      '- A dataset can’t read pipeline parameters: give the dataset a parameter (with the old value as its default) and pass the value from each step that uses it.',
      '- Valid JSON only: no comments, no trailing commas, no secrets or connection strings.',
      ...nbp.rules,
      '- If the TASK can’t be done from what the JSON holds, change nothing and say why under NOTES.');
    L.push('', 'REPLY FORMAT (a template: replace the placeholder lines with your answer)', 'Reply inside one code block, with these labelled blocks and nothing else:',
      '@@@ PIPELINE @@@', '{ the complete changed pipeline JSON }', '@@@ DATASET @@@', '{ a changed dataset’s complete JSON: one DATASET block per changed dataset; leave the block out if none changed }',
      ...nbp.reply,
      '@@@ ALSO_CHANGE @@@', '- anything the user must change outside this JSON (a notebook, a trigger, a global parameter), one per line, or: none', '@@@ NOTES @@@', '- what you changed, one line per change');
    return L.join('\n');
  };
  A.changeParse = function (reply, parseBlocks) {
    const res = { pipeline: null, datasets: [], also: [], notes: [], errors: [] }, blocks = parseBlocks(reply);
    const json = (body, what) => { const t = body.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim(); if (/^\{ (the complete changed|a changed dataset)/.test(t)) return null; const i = t.indexOf('{'), j = t.lastIndexOf('}'); if (i < 0) return null; try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { res.errors.push('The ' + what + ' JSON can’t be read: ' + e.message + '.'); return null; } };
    const lines = b => b.split('\n').map(x => x.replace(/^[-*]\s*/, '').trim()).filter(x => x && !/^(none\.?|anything the user must change|what you changed, one line)/i.test(x));
    blocks.forEach(b => {
      if (b.tag === 'PIPELINE') { const o = json(b.body, 'pipeline'); if (o) { const r = A.readPipeline(JSON.stringify(o)); if (r.error) res.errors.push(r.error); else res.pipeline = r.pipeline; } }
      else if (b.tag === 'DATASET') { const o = json(b.body, 'dataset'); if (o) { if (isObj(o) && o.name && isObj(o.properties)) res.datasets.push(o); else res.errors.push('A DATASET block isn’t a dataset (it needs a name and properties).'); } }
      else if (b.tag === 'ALSO_CHANGE') res.also = lines(b.body);
      else if (b.tag === 'NOTES') res.notes = lines(b.body);
    });
    if (!blocks.length) res.errors.push('No labelled blocks were found. Ask Copilot to answer in the reply format, inside one code block, and paste the whole reply.');
    else if (!res.pipeline && !res.errors.length) res.errors.push('The reply has no PIPELINE block with JSON in it.');
    return res;
  };
})(typeof window !== 'undefined' ? window : globalThis);
/* ---------- notebooks the pipeline runs: what they are sent, and what they must change ---------- */
(function (root) {
  'use strict';
  const A = root.ADF, isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const CONTAINERS = { ForEach: ['activities'], Until: ['activities'], IfCondition: ['ifTrueActivities', 'ifFalseActivities'], Switch: ['defaultActivities'] };
  const show = v => (isObj(v) ? String(v.value) : v == null ? '' : String(v));
  /* a Databricks .py export, plain Python, or an .ipynb: as Python text, with the widgets it reads */
  A.readNotebook = function (text) {
    let t = String(text || '');
    if (/^\s*\{/.test(t)) { try { const o = JSON.parse(t); if (Array.isArray(o.cells)) t = o.cells.map(c => (c.cell_type === 'markdown' ? '# MAGIC %md\n' + [].concat(c.source || []).join('').split('\n').map(l => '# MAGIC ' + l).join('\n') : [].concat(c.source || []).join(''))).join('\n\n# COMMAND ----------\n\n'); } catch (e) { /* not JSON: keep as text */ } }
    const lines = t.split('\n'), widgets = [], reads = [];
    lines.forEach((l, i) => {
      let m; const dr = /dbutils\.widgets\.(?:text|dropdown|combobox|multiselect)\(\s*["']([^"']+)["']\s*,\s*(?:f?["']([^"']*)["'])?/g; while ((m = dr.exec(l))) if (!widgets.some(w => w.name === m[1])) widgets.push({ name: m[1], line: i + 1, def: m[2] || '' });
      const gr = /(?:dbutils\.widgets\.get|getArgument)\(\s*["']([^"']+)["']/g; while ((m = gr.exec(l))) if (reads.indexOf(m[1]) < 0) reads.push(m[1]);
    });
    return { text: t, lines, widgets, reads, names: Array.from(new Set(widgets.map(w => w.name).concat(reads))) };
  };
  /* every notebook step: its path and the parameters it sends */
  A.notebookSteps = function (pl) {
    const out = [], walk = list => (Array.isArray(list) ? list : []).forEach(a => { if (!isObj(a)) return; const tp = a.typeProperties || {};
      if (a.type === 'DatabricksNotebook') out.push({ activity: a.name, path: show(tp.notebookPath), params: Object.assign({}, tp.baseParameters || {}) });
      (CONTAINERS[a.type] || []).forEach(k => walk(tp[k])); if (a.type === 'Switch') (tp.cases || []).forEach(c => walk(c && c.activities)); });
    walk(((pl || {}).properties || {}).activities);
    return out;
  };
  /* per notebook: what the pipeline sends now that it didn't (or no longer, or differently), whether the pasted
     notebook reads it, the exact lines to add, and the lines that hold text a change replaced */
  A.notebookReview = function (before, after, pasted, changes) {
    const B = A.notebookSteps(before), N = A.notebookSteps(after), paths = Array.from(new Set(N.map(s => s.path).concat(B.map(s => s.path))));
    const finds = (changes || []).filter(c => (c.kind === 'replace' || c.kind === 'toParam') && c.find).map(c => ({ find: c.find, to: c.kind === 'replace' ? c.repl : '{' + c.as + ':' + c.name + '}' }));
    return paths.map(path => {
      const now = N.filter(s => s.path === path), was = B.filter(s => s.path === path), src = (pasted || {})[path], nb = src ? A.readNotebook(src) : null;
      const sentNow = {}, sentWas = {}; now.forEach(s => Object.keys(s.params).forEach(k => { sentNow[k] = show(s.params[k]); })); was.forEach(s => Object.keys(s.params).forEach(k => { sentWas[k] = show(s.params[k]); }));
      const added = Object.keys(sentNow).filter(k => !(k in sentWas)), removed = Object.keys(sentWas).filter(k => !(k in sentNow)), changed = Object.keys(sentNow).filter(k => k in sentWas && sentNow[k] !== sentWas[k]).map(k => ({ name: k, from: sentWas[k], to: sentNow[k] }));
      const missing = nb ? Object.keys(sentNow).filter(k => nb.names.indexOf(k) < 0) : added;
      const addLines = missing.length ? missing.map(k => 'dbutils.widgets.text("' + k + '", "")').concat([''], missing.map(k => k.replace(/\W/g, '_') + ' = dbutils.widgets.get("' + k + '").strip()')) : [];
      const hits = []; if (nb) finds.forEach(f => { const low = f.find.toLowerCase(), bare = low.replace(/\/+$/, ''); nb.lines.forEach((l, i) => { const L = l.toLowerCase(); if (L.indexOf(low) >= 0 || (bare.length > 2 && L.indexOf(bare) >= 0 && /["'\/]/.test(l))) hits.push({ find: f.find, to: f.to, line: i + 1, text: l.trim().slice(0, 200) }); }); });
      return { path, steps: now.map(s => s.activity), gone: !now.length, pasted: !!nb, widgets: nb ? nb.names : [], added, removed, changed, missing, addLines, hits, unread: nb ? nb.widgets.filter(w => !(w.name in sentNow)).map(w => w.name) : [] };
    });
  };
  /* Copilot: the notebooks go into the change prompt, and come back as NOTEBOOK blocks */
  A.notebookPromptPart = function (pasted) {
    const P = Object.keys(pasted || {}).filter(p => String(pasted[p] || '').trim());
    if (!P.length) return { context: [], start: [], rules: [], reply: [] };
    return { context: ['The pipeline runs these notebooks, included below: ' + P.join(', ') + '. A notebook reads what a step sends it with dbutils.widgets.get("name").'],
      start: [].concat(...P.map(p => ['', 'Notebook ' + p + ':', String(pasted[p]).trim()])),
      rules: ['- When the TASK changes what a notebook step sends, or a folder or name the notebook builds itself, change that notebook too: keep everything else in it exactly as it is, and return it whole in a NOTEBOOK block whose first line is PATH: and its path. Leave out notebooks that need no change.'],
      reply: ['@@@ NOTEBOOK @@@', 'PATH: /the/notebook/path', '(the complete changed notebook; one NOTEBOOK block per changed notebook; leave the block out if none changed)'] };
  };
  A.notebookParse = function (reply, parseBlocks) {
    return parseBlocks(reply).filter(b => b.tag === 'NOTEBOOK').map(b => { const body = b.body.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, ''), m = /^\s*PATH:\s*(.+)\n/.exec(body); return m ? { path: m[1].trim(), text: body.slice(m[0].length).replace(/\s+$/, '') + '\n' } : null; })
      .filter(n => n && !/^\/the\/notebook\/path$/.test(n.path) && !/^\(the complete changed notebook/.test(n.text.trim()));
  };
})(typeof window !== 'undefined' ? window : globalThis);

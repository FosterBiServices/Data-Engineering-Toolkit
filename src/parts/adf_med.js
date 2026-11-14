/* ADF Pipeline Generator: files through bronze, silver and gold (the owner's process, kept general).
   No DOM. Adds A.medDefaults, A.compilePattern, A.medProblems, A.buildMed, A.medPreview to window.ADF. */
(function (root) {
  'use strict';
  const A = root.ADF;
  const X = v => ({ value: v, type: 'Expression' });
  const sq = s => "'" + String(s).replace(/'/g, "''") + "'";
  const ph = n => '<' + n + '>';
  const snake = A.snake;

  A.TOKENS = [['object', 'object name'], ['file', 'file name'], ['name', 'file name without extension'], ['yyyy', 'year'], ['MM', 'month'], ['dd', 'day'], ['HH', 'hour'], ['yesterday', "yesterday's date"], ['run', 'run id'], ['pipeline', 'pipeline name']];
  A.NB_VALUES = [['object', 'Object name'], ['obj_id', 'Object id (from the object list)'], ['file', 'File name'], ['layer', 'Layer'], ['text', 'Text (tokens allowed)'], ['variable', 'Pipeline variable'], ['global', 'Global parameter'], ['run', 'Run ID'], ['pipeline', 'Pipeline name'], ['expr', 'ADF expression']];
  A.medStage = (label, loop, path) => ({ label, loop, path, nbPath: '', params: [{ name: 'obj_name', use: 'object', value: '' }, { name: 'layer', use: 'layer', value: '' }], log: false });
  A.medDefaults = () => ({
    ls: '',
    lookup: { on: false, nbPath: '', idField: 'id', nameField: 'object_name', unknown: 'stop' },
    obj: { stripExt: true, dash: true },
    example: '',
    action: 'copy',
    container: '', bronzeFolder: 'bronze/{object}', bronzeFile: '{object}.parquet',
    archive: false, archiveFolder: 'archive/{object}', archiveFile: '{yyyy}-{MM}-{dd}_{object}.parquet',
    bronzeNb: { path: '', params: [{ name: 'file_name', use: 'file', value: '' }, { name: 'obj_name', use: 'object', value: '' }, { name: 'layer', use: 'layer', value: '' }] },
    logEach: true, failOnError: true, sequential: true, vars: true,
    stages: []
  });

  /* ---- patterns: text with {tokens} -> an ADF value (literal, or an expression built with concat) ---- */
  const TOKEN_RX = /\{((?:var:\s*)?[A-Za-z_]\w*)\}/g;
  A.patternTokens = p => (String(p || '').match(TOKEN_RX) || []).map(s => s.slice(1, -1)).filter(t => !/^var:/.test(t));
  const tokenExpr = (t, ctx) => (/^var:/.test(t) ? "variables('" + t.slice(4).trim() + "')" : {
    object: ctx.obj, file: ctx.file, name: ctx.name,
    yyyy: "formatDateTime(utcNow(), 'yyyy')", MM: "formatDateTime(utcNow(), 'MM')", dd: "formatDateTime(utcNow(), 'dd')", HH: "formatDateTime(utcNow(), 'HH')",
    yesterday: "formatDateTime(addDays(utcNow(), -1), 'yyyy-MM-dd')", run: 'pipeline().RunId', pipeline: 'pipeline().Pipeline'
  }[t]);
  /* returns { expr } (no leading @) or { lit }; vars: put the fixed start of the pattern into a pipeline variable */
  A.compilePattern = function (pattern, ctx, varName, vars) {
    const p = String(pattern == null ? '' : pattern).replace(/\\/g, '/');
    const parts = []; let last = 0, m; TOKEN_RX.lastIndex = 0;
    while ((m = TOKEN_RX.exec(p))) { if (m.index > last) parts.push({ lit: p.slice(last, m.index) }); const e = tokenExpr(m[1], ctx); parts.push(e ? { expr: e } : { lit: m[0] }); last = TOKEN_RX.lastIndex; }
    if (last < p.length) parts.push({ lit: p.slice(last) });
    if (varName && vars && parts.length && parts[0].lit && parts[0].lit.trim() && !vars.taken(varName)) { vars.add(varName, parts[0].lit); parts[0] = { expr: "variables('" + varName + "')" }; }
    if (!parts.some(x => x.expr)) return { lit: parts.map(x => x.lit).join('') };
    const items = parts.map(x => (x.expr ? x.expr : sq(x.lit)));
    return { expr: items.length === 1 ? items[0] : 'concat(' + items.join(', ') + ')' };
  };
  const val = c => (c.expr != null ? X('@' + c.expr) : (/^@/.test(c.lit) ? '@' + c.lit : c.lit));
  const asExpr = c => (c.expr != null ? c.expr : sq(c.lit));

  /* object name from a file name, and how a file or folder loop sees it */
  A.objExprFromFile = function (med, ends) {
    let e = 'item().name';
    if (med.obj.stripExt) e = ends && /^\.[\w.]+$/.test(ends.trim()) ? 'replace(' + e + ', ' + sq(ends.trim()) + ', ' + "'')" : "if(contains(item().name, '.'), substring(item().name, 0, lastIndexOf(item().name, '.')), item().name)";
    if (med.obj.dash) e = "replace(" + e + ", '-', '_')";
    return e;
  };
  /* a JavaScript mirror of the same rules, for the preview */
  A.medPreview = function (cfg) {
    const med = cfg.med, ends = (cfg.src.ends || '').trim(), file = (med.example || '').trim() || 'orders-2026.' + (ends.replace(/^\./, '') || 'csv');
    let obj = file; if (med.obj.stripExt) obj = ends && file.toLowerCase().endsWith(ends.toLowerCase()) ? file.slice(0, -ends.length) : (file.lastIndexOf('.') > 0 ? file.slice(0, file.lastIndexOf('.')) : file);
    if (med.obj.dash) obj = obj.replace(/-/g, '_');
    const d = new Date(), pad = n => String(n).padStart(2, '0'), y = new Date(d.getTime() - 864e5);
    const tok = { object: obj, file, name: file.replace(/\.[^.]*$/, ''), yyyy: String(d.getFullYear()), MM: pad(d.getMonth() + 1), dd: pad(d.getDate()), HH: pad(d.getHours()), yesterday: y.getFullYear() + '-' + pad(y.getMonth() + 1) + '-' + pad(y.getDate()), run: '<run id>', pipeline: '<pipeline>' };
    const uv = {}; A.userVars(cfg).forEach(v => { uv[v.name.trim()] = String(v.value == null ? '' : v.value); });
    const r = p => String(p || '').replace(TOKEN_RX, (m0, t) => (/^var:/.test(t) ? (t.slice(4).trim() in uv ? uv[t.slice(4).trim()] : '<' + t.slice(4).trim() + '>') : t in tok ? tok[t] : m0));
    const j = (f, n) => (r(f).replace(/\/+$/, '') + '/' + r(n)).replace(/^\/+/, '');
    const lake = String(med.container || '').trim() ? r(med.container).replace(/\/+$/, '') : (cfg.src.container || '<container>');
    const L = [['File', (cfg.src.container || '<container>') + ' / ' + j(cfg.src.folder, '{file}')], ['Object name', obj]];
    if (med.action === 'copy') { if (med.archive) L.push(['Archived first (if it exists)', lake + ' / ' + j(med.bronzeFolder, med.bronzeFile) + '  →  ' + lake + ' / ' + j(med.archiveFolder, med.archiveFile)]); L.push(['Copied to bronze', lake + ' / ' + j(med.bronzeFolder, med.bronzeFile)]); }
    /* the object folder a layer loops over: the last part of the bronze folder for this file */
    const folder = (r(med.bronzeFolder).replace(/\/+$/, '').split('/').pop()) || obj, fobj = med.obj.dash ? folder.replace(/-/g, '_') : folder;
    const rowsText = (rows, ctx, label) => (rows || []).filter(x => String(x.name || '').trim()).map(x => {
      const v = String(x.value == null ? '' : x.value), rr = p => String(p || '').replace(TOKEN_RX, (m0, t) => (/^var:/.test(t) ? (t.slice(4).trim() in uv ? uv[t.slice(4).trim()] : '<' + t.slice(4).trim() + '>') : t in ctx ? ctx[t] : t in tok ? tok[t] : m0));
      const shown = { object: ctx.object, obj_name: ctx.object, file: ctx.file, obj_id: med.lookup.on ? '<id from the object list>' : '(empty: no object list)', layer: label, text: rr(v), fixed: rr(v), variable: v.trim() in uv ? uv[v.trim()] : '<' + v.trim() + '>', global: '<global ' + v.trim() + '>', run: '<run id>', pipeline: '<pipeline>', expr: v.trim() ? '(expression) ' + v.trim() : '(empty)' }[x.use];
      return String(x.name).trim() + ' = ' + (shown == null ? '(' + x.use + ')' : shown === '' ? '(empty)' : shown); }).join(', ');
    if (med.action === 'notebook') L.push(['Bronze notebook gets', rowsText(med.bronzeNb.params, { object: obj, file, name: tok.name }, 'bronze')]);
    med.stages.forEach(s => {
      const label = s.label || 'Layer', ctx = s.loop === 'folders' ? { object: fobj, file: folder, name: folder } : s.loop === 'files' ? { object: obj, file, name: tok.name } : { object: '(none: runs once)', file: '(none)', name: '(none)' };
      L.push([label + (s.loop === 'folders' ? ': one run per folder in' : s.loop === 'files' ? ': one run per file' : ': runs once'), s.loop === 'folders' ? lake + ' / ' + r(s.path).replace(/\/+$/, '') + '/' + folder + '  (in a folder loop, {name} and {file} = ' + folder + ', {object} = ' + fobj + ')' : s.loop === 'files' ? obj : '']);
      const pv = rowsText(s.params, ctx, label); if (pv) L.push(['  ' + label + ' notebook gets', pv]);
    });
    return L;
  };

  /* ---- checks on the setup ---- */
  A.medProblems = function (cfg, std) {
    const R = [], add = (sev, msg) => R.push({ sev, msg }), med = cfg.med;
    const own = k => A.ownDs(cfg, k), dsErr = k => { const d = cfg.ds[k]; if (!d || d.mode !== 'own') return null; const r = A.readDataset(d.json); return !r ? 'paste its JSON' : r.error ? r.error : r.kind !== 'file' ? r.name + ' is a ' + r.type + ', not a file dataset' : null; };
    const LBL = { list: 'Dataset that lists the incoming files', read: 'Dataset that reads one file', sink: 'Bronze dataset', meta: 'Dataset that lists layer folders' };
    ['list', 'read', 'sink', 'meta'].forEach(k => { const e = dsErr(k); if (e) add('err', LBL[k] + ': ' + e + '.'); });
    if (!cfg.src.folder.trim()) add('err', 'Give the folder the files arrive in.');
    const bad = (label, p) => A.patternTokens(p).filter(t => !A.TOKENS.some(x => x[0] === t)).forEach(t => add('err', label + ': {' + t + '} isn’t a token. Use ' + A.TOKENS.map(x => '{' + x[0] + '}').join(' ') + '.'));
    const perItem = (label, p) => { if (A.patternTokens(p).some(t => /^(object|file|name)$/.test(t))) add('err', label + ' is read once for the whole run, so it can’t use {object}, {file} or {name}.'); };
    bad('Folder the files arrive in', cfg.src.folder); perItem('The folder the files arrive in', cfg.src.folder);
    bad('Bronze container', med.container); perItem('The bronze container', med.container);
    if (med.lookup.on) {
      if (!/^\/|^\.{1,2}\//.test(med.lookup.nbPath.trim())) add('err', 'Object list: give the path of the notebook that returns the list, starting with /.');
      if (!med.lookup.idField.trim() || !med.lookup.nameField.trim()) add('err', 'Object list: give the names of the id and name fields in the list it returns.');
    }
    const usesId = rows => rows.some(r => r.use === 'obj_id') || (std && std.log && std.log.method !== 'none' && (std.log.params || []).some(r => r.use === 'obj_id'));
    if (!med.lookup.on && (usesId(med.bronzeNb.params) || med.stages.some(s => usesId(s.params)))) add('err', 'A parameter sends the object id, but there is no object list to read it from. Turn on “Look up each object in a list”, or change that parameter.');
    if (med.action === 'copy') {
      [['Bronze folder', med.bronzeFolder], ['Bronze file name', med.bronzeFile]].concat(med.archive ? [['Archive folder', med.archiveFolder], ['Archive file name', med.archiveFile]] : []).forEach(([l, p]) => { if (!String(p).trim()) add('err', l + ' is empty.'); bad(l, p); });
      if (!/\{(object|file|name)\}/.test(med.bronzeFolder + med.bronzeFile)) add('warn', 'The bronze folder and file name don’t use {object}, {file} or {name}, so every file is written to the same place and only the last one is kept.');
      if (med.archive && med.archiveFolder.trim() + med.archiveFile.trim() === med.bronzeFolder.trim() + med.bronzeFile.trim()) add('err', 'The archive path is the same as the bronze path.');
      const s = own('sink'); if (s && !s.has('file')) add('err', 'The bronze dataset ' + s.name + ' has no file name parameter, so each file can’t be written under its own name.');
      if (s && s.type !== 'Parquet' && /\.parquet$/i.test(med.bronzeFile)) add('warn', 'The bronze dataset is ' + s.type + ' but the file name ends in .parquet.');
      const rd = own('read') || (cfg.ds.read.mode === 'new' ? null : null); if (rd && !rd.has('file')) add('err', 'The dataset that reads one file (' + rd.name + ') has no file name parameter.');
    } else {
      if (!/^\/|^\.{1,2}\//.test(med.bronzeNb.path.trim())) add('err', 'Bronze notebook: give its path, starting with /.');
      if (!med.bronzeNb.params.some(r => String(r.name).trim())) add('warn', 'The bronze notebook gets no parameters, so it can’t tell which file to load.');
    }
    const L = own('list') || (cfg.ds.list.mode === 'new' ? own('read') : null); if (L && !L.has('folder') && cfg.src.folder.trim()) add('info', 'The listing dataset ' + L.name + ' has no folder parameter, so it lists the folder set inside the dataset, not “' + cfg.src.folder + '”.');
    med.stages.forEach((s, i) => {
      const n = 'Layer ' + (i + 1) + (s.label ? ' (' + s.label + ')' : '');
      if (!String(s.label).trim()) add('err', n + ' needs a name, such as silver or gold.');
      if (!/^\/|^\.{1,2}\//.test(String(s.nbPath).trim())) add('err', n + ': give the notebook path, starting with /.');
      if (s.loop === 'folders') { if (!String(s.path).trim()) add('err', n + ': give the folder whose subfolders are the objects.'); bad(n + ' folder', s.path); perItem(n + ' folder', s.path); }
      if (s.loop === 'once' && s.params.some(r => /^(object|obj_id|file)$/.test(r.use))) add('err', n + ' runs once, so it has no object or file to send. Change those parameters, or make it run per folder or per file.');
    });
    const names = med.stages.map(s => snake(s.label)); names.forEach((x, i) => { if (x && names.indexOf(x) !== i) add('err', 'Two layers are both called ' + x + '.'); });
    return R;
  };

  /* ---- the pipeline ---- */
  A.buildMed = function (cfg, std, today) {
    std = Object.assign(A.defaultStandards(), std || {});
    const med = cfg.med, n = A.names(cfg, std);
    const policy = retry => ({ timeout: '0.' + String(std.timeoutHrs).padStart(2, '0') + ':00:00', retry: retry ? Number(std.retry) : 0, retryIntervalInSeconds: Number(std.retrySec), secureOutput: false, secureInput: false });
    const dep = (a, c) => [{ activity: a, dependencyConditions: Array.isArray(c) ? c : [c || 'Succeeded'] }];
    const lsRef = name => ({ referenceName: name, type: 'LinkedServiceReference' });
    const variables = {}, datasets = [], reused = [];
    const userNames = new Set(A.userVars(cfg).map(v => v.name.trim()));
    const vars = med.vars ? { taken: k => userNames.has(k), add: (k, v) => { if (!variables[k]) variables[k] = { type: 'String', defaultValue: v.replace(/\/+$/, '') + (/\/$/.test(v) ? '/' : '') }; } } : null;
    const ls = String(med.ls || '').trim() || ph('LS_ADLS'), nbLs = cfg.nbLs.trim() || ph('LS_DATABRICKS');
    const ends = (cfg.src.ends || '').trim(), fmt = /\.parquet$/i.test(ends) ? 'Parquet' : /\.json$/i.test(ends) ? 'Json' : 'DelimitedText';
    /* datasets: the user's own, or one the page creates */
    const fileDs = (name, type) => ({ name, properties: Object.assign({ linkedServiceName: lsRef(ls), parameters: { container: { type: 'string' }, folder_path: { type: 'string' }, file_name: { type: 'string' } }, annotations: [], type,
      typeProperties: Object.assign({ location: { type: 'AzureBlobFSLocation', fileName: X('@dataset().file_name'), folderPath: X('@dataset().folder_path'), fileSystem: X('@dataset().container') } },
        type === 'DelimitedText' ? { columnDelimiter: ',', escapeChar: '\\', firstRowAsHeader: true, quoteChar: '"' } : type === 'Parquet' ? { compressionCodec: 'snappy' } : {}) }, type === 'Parquet' || type === 'DelimitedText' ? { schema: [] } : {}) });
    const role = (own, def) => {
      if (!own) { if (!datasets.some(d => d.name === def.name)) datasets.push(def); return { name: def.name, type: def.properties.type, store: 'AzureBlobFS', ref: v => ({ referenceName: def.name, type: 'DatasetReference', parameters: { container: v.container, folder_path: v.folder, file_name: v.file == null ? '' : v.file } }) }; }
      if (reused.indexOf(own) < 0) reused.push(own);
      return { name: own.name, type: own.type, store: own.store, own, ref: v => { const ps = {}; own.params.forEach(k => { const m = own.map[k]; if (m.use === 'none' && own.defaults.indexOf(k) >= 0) return; ps[k] = A.dsValue(m, v); }); const r = { referenceName: own.name, type: 'DatasetReference' }; if (Object.keys(ps).length) r.parameters = ps; return r; } };
    };
    const oRead = A.ownDs(cfg, 'read'), oSink = A.ownDs(cfg, 'sink'), oList = A.ownDs(cfg, 'list'), oMeta = A.ownDs(cfg, 'meta');
    const rRead = role(oRead, fileDs(std.dsPrefix + 'adls_' + (fmt === 'DelimitedText' ? 'csv' : fmt.toLowerCase()) + '_file', fmt));
    const needSink = med.action === 'copy' || med.stages.some(s => s.loop === 'folders');
    const rSink = needSink ? role(oSink, fileDs(std.dsPrefix + 'adls_parquet_file', 'Parquet')) : null;
    const rList = oList ? role(oList, null) : rRead, rMeta = oMeta ? role(oMeta, null) : rSink;
    const readSet = r => ({ type: r.store + 'ReadSettings', recursive: false, enablePartitionDiscovery: false });
    const fmtRead = r => (/^(DelimitedText|Json|Parquet|Xml|Binary)$/.test(r.type) ? { formatSettings: { type: r.type + 'ReadSettings' } } : {});
    const fmtWrite = r => (r.type === 'DelimitedText' ? { formatSettings: { type: 'DelimitedTextWriteSettings', quoteAllText: true, fileExtension: '.txt' } } : r.type === 'Parquet' ? { formatSettings: { type: 'ParquetWriteSettings' } } : r.type === 'Json' ? { formatSettings: { type: 'JsonWriteSettings' } } : {});
    const container = cfg.src.container.trim() ? (vars ? (vars.add('container', cfg.src.container.trim()), X("@variables('container')")) : cfg.src.container.trim()) : ph('CONTAINER');
    /* expressions for a loop item */
    const fileCtx = { obj: A.objExprFromFile(med, ends), file: 'item().name', name: "if(contains(item().name, '.'), substring(item().name, 0, lastIndexOf(item().name, '.')), item().name)" };
    const folderCtx = { obj: med.obj.dash ? "replace(item().name, '-', '_')" : 'item().name', file: 'item().name', name: 'item().name' };
    const topCtx = { obj: null, file: null, name: null };
    /* bronze, archive and layer folders can sit in another container (a pattern, so {var:name} works); empty = the landing container */
    const lake = String(med.container || '').trim() ? val(A.compilePattern(med.container, topCtx, vars && !/^\{var:/.test(med.container.trim()) ? 'lake_container' : null, vars)) : container;

    const C = (p, ctx, v) => A.compilePattern(p, ctx, v, vars);
    const lg = Object.assign({ method: 'none', params: [] }, std.log || {});

    /* one Filter of the object list by the current object, for a loop; returns the activities and the id expression */
    const lookupName = 'nb_lookup_objects';
    const objectSteps = (tag) => {
      if (!med.lookup.on) return { acts: [], id: "''" };
      variables.object_name = { type: 'String' };
      const f = 'flt_' + tag + '_object', idf = med.lookup.idField.trim().replace(/[^\w]/g, '') || 'id', nmf = med.lookup.nameField.trim().replace(/[^\w]/g, '') || 'object_name';
      const acts = [{ name: 'sv_' + tag + '_object_name', type: 'SetVariable', dependsOn: [], policy: { secureOutput: false, secureInput: false }, userProperties: [], typeProperties: { variableName: 'object_name', value: X('@' + (tag === 'file' ? fileCtx.obj : folderCtx.obj)) } },
        { name: f, type: 'Filter', dependsOn: dep('sv_' + tag + '_object_name'), userProperties: [], typeProperties: { items: X("@activity('" + lookupName + "').output.runOutput"), condition: X("@equals(string(item()." + nmf + "), variables('object_name'))") } }];
      if (med.lookup.unknown === 'stop') {
        acts.push({ name: 'if_' + tag + '_object_unknown', type: 'IfCondition', dependsOn: dep(f), userProperties: [], typeProperties: { expression: X("@equals(activity('" + f + "').output.FilteredItemsCount, 0)"),
          ifTrueActivities: [{ name: 'fail_' + tag + '_object_unknown', type: 'Fail', dependsOn: [], userProperties: [], typeProperties: { message: X("@concat('No object named ', variables('object_name'), ' in the object list. Add it to the list, or remove the file.')"), errorCode: 'OBJECT_NOT_IN_LIST' } }] } });
      }
      /* safe either way: the failure log still runs when the object wasn't found */
      const id = "string(coalesce(first(activity('" + f + "').output.value)?." + idf + ", ''))";
      return { acts, id };
    };
    /* a value for a notebook parameter or a log column */
    const valueOf = (r, ctx, x) => {
      const u = r.use, v = String(r.value == null ? '' : r.value);
      const e = { step: A.stepExpr(v, false), object: ctx.obj, obj_name: ctx.obj, file: ctx.file, obj_id: x.id, layer: sq(x.layer || ''), run: 'pipeline().RunId', pipeline: 'pipeline().Pipeline', factory: 'pipeline().DataFactory', trig_time: 'string(pipeline().TriggerTime)', trig_name: 'pipeline().TriggerName',
        status: sq(x.status || ''), error: x.status === 'Succeeded' ? sq(v) : (x.err || "''"), rows_read: x.rowsRead ? 'string(' + x.rowsRead + ')' : "''", rows_written: x.rowsWritten ? 'string(' + x.rowsWritten + ')' : "''", duration: x.duration ? 'string(' + x.duration + ')' : "''",
        source: x.source ? asExpr(x.source) : "''", target: x.target ? asExpr(x.target) : "''", win_start: "''", win_end: "''", variable: "string(variables('" + (v.trim() || 'NAME') + "'))", global: 'pipeline().globalParameters.' + (v.trim().replace(/^pipeline\(\)\.globalParameters\./, '') || 'NAME'), expr: v.trim().replace(/^@/, '') || "''" }[u];
      if (u === 'text' || u === 'fixed') { const c = C(v, ctx.obj ? ctx : topCtx); return val(c); }
      if (e == null) return '';
      if (/^'(?:[^']|'')*'$/.test(e)) return e.slice(1, -1).replace(/''/g, "'");
      return X('@' + e);
    };
    const nbAct = (name, path, rows, ctx, x, after) => {
      const bp = {}; rows.filter(r => String(r.name || '').trim()).forEach(r => { bp[String(r.name).trim()] = valueOf(r, ctx, x); });
      return { name, type: 'DatabricksNotebook', dependsOn: after, policy: policy(false), userProperties: [], typeProperties: Object.assign({ notebookPath: String(path || '').trim() || ph('NOTEBOOK_PATH') }, Object.keys(bp).length ? { baseParameters: bp } : {}), linkedServiceName: lsRef(nbLs) };
    };
    /* the team's logging, called inside a loop or once */
    const logStep = (tag, ok, ctx, x, after) => {
      const m = lg.method; if (m === 'none') return null;
      const rows = (Array.isArray(lg.params) ? lg.params : []).filter(r => r && String(r.name || '').trim());
      const xx = Object.assign({}, x, { status: ok ? 'Succeeded' : 'Failed', err: ok ? "''" : x.err });
      if (m === 'notebook') { const a = nbAct('nb_log_' + tag + (ok ? '_success' : '_failure'), lg.nbPath || ph('LOG_NOTEBOOK_PATH'), rows, ctx, xx, after); a.linkedServiceName = lsRef(String(lg.nbLs || '').trim() || nbLs); return a; }
      const ps = {}, P = (v, t) => ({ value: v, type: t || 'String' });
      if (m === 'sp_new') Object.assign(ps, { pipeline_name: P(X('@pipeline().Pipeline')), run_id: P(X('@pipeline().RunId')), status: P(xx.status), rows_read: P(x.rowsRead ? X('@' + x.rowsRead) : '0', 'Int64'), rows_written: P(x.rowsWritten ? X('@' + x.rowsWritten) : '0', 'Int64'), window_start: P(''), window_end: P(''), error_message: P(ok ? '' : X('@' + x.err)) });
      else rows.forEach(r => { const v = valueOf(r, ctx, xx); ps[String(r.name).trim().replace(/^@/, '')] = P(v, /^rows_|duration/.test(r.use) && x[{ rows_read: 'rowsRead', rows_written: 'rowsWritten', duration: 'duration' }[r.use]] ? 'Int64' : 'String'); });
      return { name: 'sp_log_' + tag + (ok ? '_success' : '_failure'), type: 'SqlServerStoredProcedure', dependsOn: after, policy: policy(false), userProperties: [], typeProperties: { storedProcedureName: m === 'sp_new' ? '[' + std.ctlSchema + '].[usp_log_pipeline_run]' : (String(lg.proc || '').trim() || ph('LOG_PROCEDURE')), storedProcedureParameters: ps }, linkedServiceName: lsRef(n.ctlLs) };
    };
    /* close a list of steps: logging on success and failure, then optionally fail */
    const finish = (list, tag, ctx, x, doLog, failOn) => {
      const main = list.map(a => a.name), last = main[main.length - 1];
      x.err = 'coalesce(' + main.map(a => "activity('" + a + "')?.error?.message").join(', ') + ", 'See the failed activity in Monitor')";
      if (doLog) { const ok = logStep(tag, true, ctx, x, dep(last)); if (ok) list.push(ok); }
      let tail = null; const bad = doLog ? logStep(tag, false, ctx, x, dep(last, ['Failed', 'Skipped'])) : null;
      if (bad) { list.push(bad); tail = bad.name; }
      if (tail && failOn) list.push({ name: 'fail_' + tag, type: 'Fail', dependsOn: dep(tail, 'Completed'), userProperties: [], typeProperties: { message: X('@' + x.err), errorCode: tag.toUpperCase() + '_FAILED' } });
      return list;
    };

    const acts = []; let last = null;
    const top = a => { a.dependsOn = last ? dep(last) : a.dependsOn || []; acts.push(a); last = a.name; };
    if (med.lookup.on) top({ name: lookupName, type: 'DatabricksNotebook', dependsOn: [], policy: policy(false), userProperties: [], typeProperties: { notebookPath: med.lookup.nbPath.trim() || ph('OBJECT_LIST_NOTEBOOK_PATH') }, linkedServiceName: lsRef(nbLs) });
    /* bronze: list the files, then one pass per file */
    const landing = C(cfg.src.folder, topCtx, 'landing_path');
    top({ name: 'gm_list_files', type: 'GetMetadata', dependsOn: [], policy: policy(true), userProperties: [], typeProperties: Object.assign({ dataset: rList.ref({ container, folder: val(landing), file: '' }), fieldList: ['childItems'], storeSettings: readSet(rList) }, fmtRead(rList)) });
    const conds = ["equals(item().type, 'File')"];
    if (cfg.src.starts.trim()) conds.push('startswith(toLower(item().name), ' + sq(cfg.src.starts.trim().toLowerCase()) + ')');
    if (ends) conds.push('endswith(toLower(item().name), ' + sq(ends.toLowerCase()) + ')');
    const andAll = l => (l.length === 1 ? l[0] : 'and(' + andAll(l.slice(0, -1)) + ', ' + l[l.length - 1] + ')');
    top({ name: 'flt_files', type: 'Filter', dependsOn: [], userProperties: [], typeProperties: { items: X("@activity('gm_list_files').output.childItems"), condition: X('@' + andAll(conds)) } });
    {
      const os = objectSteps('file'), inner = os.acts.slice(); let prev = inner.length ? inner[inner.length - 1].name : null;
      const add = a => { a.dependsOn = prev ? dep(prev) : []; inner.push(a); prev = a.name; };
      const x = { id: os.id, layer: 'bronze' };
      if (med.action === 'copy') {
        const bf = C(med.bronzeFolder, fileCtx, 'bronze_path'), bn = C(med.bronzeFile, fileCtx);
        const sinkRef = () => rSink.ref({ container: lake, folder: val(bf), file: val(bn) });
        if (med.archive) {
          const af = C(med.archiveFolder, fileCtx, 'archive_path'), an = C(med.archiveFile, fileCtx);
          add({ name: 'gm_check_bronze_file', type: 'GetMetadata', dependsOn: [], policy: policy(true), userProperties: [], typeProperties: Object.assign({ dataset: sinkRef(), fieldList: ['exists'], storeSettings: readSet(rSink) }, fmtRead(rSink)) });
          add({ name: 'if_bronze_file_exists', type: 'IfCondition', dependsOn: [], userProperties: [], typeProperties: { expression: X("@activity('gm_check_bronze_file').output.exists"),
            ifTrueActivities: [{ name: 'cp_archive_bronze_file', type: 'Copy', dependsOn: [], policy: policy(true), userProperties: [], typeProperties: Object.assign({ source: Object.assign({ type: rSink.type + 'Source', storeSettings: readSet(rSink) }, fmtRead(rSink)), sink: Object.assign({ type: rSink.type + 'Sink', storeSettings: { type: rSink.store + 'WriteSettings' } }, fmtWrite(rSink)), enableStaging: false }),
              inputs: [sinkRef()], outputs: [rSink.ref({ container: lake, folder: val(af), file: val(an) })] }] } });
          x.target = af;
        }
        add({ name: 'cp_file_to_bronze', type: 'Copy', dependsOn: [], policy: policy(true), userProperties: [], typeProperties: { source: Object.assign({ type: rRead.type + 'Source', storeSettings: readSet(rRead) }, fmtRead(rRead)), sink: Object.assign({ type: rSink.type + 'Sink', storeSettings: { type: rSink.store + 'WriteSettings' } }, fmtWrite(rSink)), enableStaging: false,
          translator: { type: 'TabularTranslator', typeConversion: true, typeConversionSettings: { allowDataTruncation: false, treatBooleanAsNumber: false } } },
          inputs: [rRead.ref({ container, folder: val(landing), file: X('@item().name') })], outputs: [sinkRef()] });
        Object.assign(x, { rowsRead: "activity('cp_file_to_bronze').output.rowsRead", rowsWritten: "activity('cp_file_to_bronze').output.rowsCopied", duration: "activity('cp_file_to_bronze').output.copyDuration", source: { expr: "item().name" }, target: bf });
      } else add(nbAct('nb_bronze', med.bronzeNb.path, med.bronzeNb.params, fileCtx, x, []));
      finish(inner, 'file', fileCtx, x, med.logEach, med.failOnError);
      const seq = med.lookup.on || med.sequential;
      top({ name: 'fe_files', type: 'ForEach', dependsOn: [], userProperties: [], typeProperties: Object.assign({ items: X("@activity('flt_files').output.value"), isSequential: seq }, seq ? {} : { batchCount: 4 }, { activities: inner }) });
    }
    /* each layer after bronze */
    med.stages.forEach((s, i) => {
      const tag = snake(s.label) || 'layer_' + (i + 1), x = { layer: s.label || '' };
      if (s.loop === 'once') {
        Object.assign(x, { id: "''" });
        const list = [nbAct('nb_' + tag, s.nbPath, s.params, topCtx, x, [])];
        Object.assign(x, { rowsWritten: "activity('nb_" + tag + "').output.runOutput?.rows_written", rowsRead: "activity('nb_" + tag + "').output.runOutput?.rows_read", duration: "activity('nb_" + tag + "').output.executionDuration" });
        finish(list, tag, topCtx, x, s.log, med.failOnError);
        list[0].dependsOn = last ? dep(last) : []; list.forEach(a => acts.push(a)); last = list[0].name;
        return;
      }
      const ctx = s.loop === 'folders' ? folderCtx : fileCtx;
      let items;
      if (s.loop === 'folders') {
        const sp = C(s.path, topCtx, tag + '_path'); A.AUTO_VARS.add(tag + '_path');
        top({ name: 'gm_list_' + tag + '_folders', type: 'GetMetadata', dependsOn: [], policy: policy(true), userProperties: [], typeProperties: Object.assign({ dataset: rMeta.ref({ container: lake, folder: val(sp), file: '' }), fieldList: ['childItems'], storeSettings: readSet(rMeta) }, fmtRead(rMeta)) });
        top({ name: 'flt_' + tag + '_folders', type: 'Filter', dependsOn: [], userProperties: [], typeProperties: { items: X("@activity('gm_list_" + tag + "_folders').output.childItems"), condition: X("@equals(item().type, 'Folder')") } });
        items = "@activity('flt_" + tag + "_folders').output.value";
      } else items = "@activity('flt_files').output.value";
      const needId = s.params.some(r => r.use === 'obj_id') || (s.log && (lg.params || []).some(r => r.use === 'obj_id'));
      const os = needId ? objectSteps(tag) : { acts: [], id: "''" }, inner = os.acts.slice();
      Object.assign(x, { id: os.id });
      const nb = nbAct('nb_' + tag, s.nbPath, s.params, ctx, x, inner.length ? dep(inner[inner.length - 1].name) : []);
      inner.push(nb);
      Object.assign(x, { rowsWritten: "activity('nb_" + tag + "').output.runOutput?.rows_written", rowsRead: "activity('nb_" + tag + "').output.runOutput?.rows_read", duration: "activity('nb_" + tag + "').output.executionDuration" });
      finish(inner, tag, ctx, x, s.log, med.failOnError);
      const seq = needId || med.sequential;
      top({ name: 'fe_' + tag, type: 'ForEach', dependsOn: [], userProperties: [], typeProperties: Object.assign({ items: X(items), isSequential: seq }, seq ? {} : { batchCount: 4 }, { activities: inner }) });
    });
    /* alert on failure */
    if (cfg.alert === 'web') {
      acts.push({ name: 'web_alert_failure', type: 'WebActivity', dependsOn: dep(last, ['Failed', 'Skipped']), policy: Object.assign(policy(false), { retry: 1 }), userProperties: [], typeProperties: { url: X('@pipeline().globalParameters.' + std.alertParam), method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: X('{"title":"Pipeline failed","pipeline":"@{pipeline().Pipeline}","runId":"@{pipeline().RunId}","dataFactory":"@{pipeline().DataFactory}"}') } });
      acts.push({ name: 'fail_pipeline', type: 'Fail', dependsOn: dep('web_alert_failure', 'Completed'), userProperties: [], typeProperties: { message: X("@concat('Pipeline ', pipeline().Pipeline, ' failed. Run ', pipeline().RunId)"), errorCode: 'PIPELINE_FAILED' } });
    }
    { const used = JSON.stringify(acts); Object.keys(variables).forEach(k => { if (used.indexOf("variables('" + k + "')") < 0) delete variables[k]; }); }   // page-made variables nothing reads
    A.addUserVars(variables, cfg);
    const pipeline = { name: n.pipeline, properties: Object.assign({ activities: acts }, Object.keys(variables).length ? { variables } : {}, { annotations: [] }) };
    if ((cfg.goal || '').trim()) pipeline.properties.description = cfg.goal.trim().slice(0, 400);
    let trigger = null;
    if (cfg.sched.freq !== 'none') {
      const hm = /^(\d{1,2}):(\d{2})$/.exec(cfg.sched.time) || [0, '2', '00'], d = today || new Date().toISOString().slice(0, 10);
      const rec = { frequency: cfg.sched.freq === 'hourly' ? 'Hour' : 'Day', interval: 1, startTime: d + 'T' + String(hm[1]).padStart(2, '0') + ':' + hm[2] + ':00', timeZone: cfg.sched.tz || 'UTC' };
      if (cfg.sched.freq === 'daily') rec.schedule = { hours: [Number(hm[1])], minutes: [Number(hm[2])] };
      trigger = { name: n.trigger, properties: { annotations: [], runtimeState: 'Stopped', pipelines: [{ pipelineReference: { referenceName: n.pipeline, type: 'PipelineReference' } }], type: 'ScheduleTrigger', typeProperties: { recurrence: rec } } };
    }
    n.logMethod = lg.method; n.noHandler = !(med.logEach && lg.method !== 'none') && cfg.alert !== 'web'; n.files = true; n.sql = false; n.inc = false; n.fileMode = 'medallion';
    const sql = lg.method === 'sp_new' && med.logEach ? A.buildSql({ cfg, std, n, cols: [], write: 'files', staged: false, inc: false, dt: true, wm: '', files: true, sql: false, tgtT: '', stgT: '', wmT: '', logT: '[' + std.ctlSchema + '].[' + std.logTable + ']', logNew: true }) : '-- No supporting SQL is needed for this pipeline.\n';
    const out = { names: n, pipeline, datasets, reused, trigger, sql, write: 'files', staged: false, cols: [], notes: [], medallion: true };
    out.json = JSON.stringify(pipeline, null, 4);
    out.needsSql = !/^-- No supporting SQL/.test(sql);
    out.placeholders = A.placeholders(out.json + '\n' + JSON.stringify(datasets) + '\n' + sql);
    out.steps = A.medSteps(out, cfg, std);
    out.objects = A.objects(out, cfg, std).filter(o => !(o.type === 'Linked service' && /^<LS_(SOURCE|TARGET)>$/.test(o.name)));
    if (med.lookup.on) out.objects.splice(1, 0, { type: 'Notebook', name: med.lookup.nbPath.trim() || ph('OBJECT_LIST_NOTEBOOK_PATH'), state: 'Reuse', purpose: 'Returns the object list (dbutils.notebook.exit with a JSON list)' });
    med.stages.forEach(s => out.objects.push({ type: 'Notebook', name: s.nbPath.trim() || ph('NOTEBOOK_PATH'), state: 'Reuse', purpose: (s.label || 'Layer') + ' notebook' }));
    return out;
  };
  A.medSteps = function (o, cfg, std) {
    const med = cfg.med, L = [], v = Object.keys(o.pipeline.properties.variables || {}).filter(k => k !== 'object_name');
    L.push('PART A - Datasets');
    if (o.reused.length) L.push('Your datasets are used as they are: ' + o.reused.map(d => d.name).join(', ') + '.');
    o.datasets.forEach((d, i) => L.push((i + 1) + '. Author > Datasets > New dataset > Azure Data Lake Storage Gen2 > ' + ({ DelimitedText: 'DelimitedText', Parquet: 'Parquet', Json: 'JSON' }[d.properties.type] || d.properties.type) + '. Name it ' + d.name + ', pick the linked service, OK. Then open its code view {} and replace everything with the JSON for ' + d.name + '.'));
    if (!o.datasets.length && !o.reused.length) L.push('None.');
    L.push('', 'PART B - Pipeline', '1. Author > Pipelines > New pipeline > code view {} > replace everything with the Pipeline JSON > OK.', '2. Select Validate and fix what it flags (usually a dataset, linked service or notebook name).');
    if (v.length) L.push('3. Paths are pipeline variables (' + v.join(', ') + '). Change a path by selecting the empty canvas > Variables tab; nothing else needs editing.');
    if (o.placeholders.length) L.push((v.length ? '4' : '3') + '. Replace every placeholder: ' + o.placeholders.join(', ') + '.');
    if (med.lookup.on) L.push('', 'The object list notebook must end with dbutils.notebook.exit(json.dumps(rows)), where rows is a list like [{"' + med.lookup.idField + '": 1, "' + med.lookup.nameField + '": "orders"}]. ADF reads it as output.runOutput.');
    L.push('', 'PART C - Test plan', '1. Put one small file in the landing folder and select Debug.', '2. Check the bronze file landed where the preview on the page says' + (med.archive ? ', and that a second run archives the first file before replacing it.' : '.'),
      '3. Check your log has a row for the file' + (med.lookup.on ? ' with the right object id.' : '.'), '4. Rename the file to something not in the object list (or break its header) and run again: the failure should be logged' + (med.failOnError ? ' and the run should show Failed.' : '.'));
    med.stages.forEach((s, i) => L.push((5 + i) + '. Check the ' + (s.label || 'layer') + ' notebook ran ' + (s.loop === 'folders' ? 'once per folder' : s.loop === 'files' ? 'once per file' : 'once') + ' with the parameters you expect (Monitor > the activity > Input).'));
    return L.join('\n');
  };
})(typeof window !== 'undefined' ? window : globalThis);

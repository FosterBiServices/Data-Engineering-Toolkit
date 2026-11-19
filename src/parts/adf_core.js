/* ADF Pipeline Generator: everything that must be exact. No DOM in this file. */
(function (root) {
  'use strict';
  const A = {};

  /* ---------- small helpers ---------- */
  const q = n => '[' + String(n).replace(/]/g, ']]') + ']';
  const sq = s => "'" + String(s).replace(/'/g, "''") + "'";
  const X = v => ({ value: v, type: 'Expression' });
  const lit = s => String(s).replace(/@/g, '@@');                 // literal text inside an interpolated ADF string
  const snake = s => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  const ph = name => '<' + name + '>';
  A.snake = snake; A.q = q;

  A.SYSTEMS = {
    sqlserver: { label: 'SQL Server', ds: 'SqlServerTable', source: 'SqlServerSource', sink: 'SqlServerSink', short: 'sqlserver' },
    azuresql: { label: 'Azure SQL Database', ds: 'AzureSqlTable', source: 'AzureSqlSource', sink: 'AzureSqlSink', short: 'azuresql' },
    synapse: { label: 'Synapse dedicated SQL pool', ds: 'AzureSqlDWTable', source: 'SqlDWSource', sink: 'SqlDWSink', short: 'synapse' }
  };
  A.TZ = ['UTC', 'Eastern Standard Time', 'Central Standard Time', 'Mountain Standard Time', 'Pacific Standard Time', 'GMT Standard Time', 'W. Europe Standard Time', 'India Standard Time', 'AUS Eastern Standard Time'];

  /* ---- logging: the user's own method, or the page's stored procedure ---- */
  A.LOG_METHODS = [['sp_new', 'A stored procedure and log table the page creates'], ['sp_own', 'My own stored procedure'], ['notebook', 'My own Databricks notebook'], ['none', 'No logging']];
  A.LOG_VALUES = [['pipeline', 'Pipeline name'], ['run', 'Run ID'], ['status', 'Status (Succeeded or Failed)'], ['rows_read', 'Rows or files read'], ['rows_written', 'Rows or files written'], ['win_start', 'Window start'], ['win_end', 'Window end'],
    ['error', 'Error message'], ['duration', 'Copy or run duration'], ['obj_id', 'Object id (files and layers)'], ['obj_name', 'Object name (files and layers)'], ['file', 'File name (files)'], ['layer', 'Layer'], ['factory', 'Data factory name'], ['trig_time', 'Trigger time'], ['trig_name', 'Trigger name'], ['source', 'Source object'], ['target', 'Target object'],
    ['variable', 'Pipeline variable'], ['global', 'Global parameter'], ['expr', 'ADF expression'], ['fixed', 'Fixed text'], ['step', 'Output of an earlier step']];
  /* the short list shown for logging parameters; older choices still work when a saved setup has them */
  A.logChoices = kind => [['step', 'Output of an earlier step'], ['variable', 'Pipeline variable'], ['fixed', 'Fixed text'], ['expr', 'ADF expression'], ['global', 'Global parameter'], ['status', 'Status (Succeeded or Failed)'], ['error', 'Error message (filled in the failure log)']]
    .concat(kind === 'medallion' ? [['rows_written', 'Rows written by the step being logged'], ['duration', 'Duration of the step being logged (seconds)'], ['obj_name', 'Object name'], ['obj_id', 'Object id (from the object list)'], ['file', 'File name'], ['layer', 'Layer']] : [], [['pipeline', 'Pipeline name'], ['run', 'Run ID'], ['trig_time', 'Trigger time']]);
  /* "Output of an earlier step": value is "activity|field", or "activity|=path" for any other output */
  A.STEP_FIELDS = { Copy: [['rowsCopied', 'Rows copied'], ['rowsRead', 'Rows read'], ['filesWritten', 'Files written'], ['filesRead', 'Files read'], ['copyDuration', 'Copy duration (seconds)'], ['dataWritten', 'Bytes written']],
    DatabricksNotebook: [['runOutput', 'Notebook exit value'], ['executionDuration', 'Run duration (seconds)']], Lookup: [['firstRow', 'First row'], ['count', 'Row count']],
    GetMetadata: [['itemName', 'Item name'], ['lastModified', 'Last modified'], ['exists', 'Exists'], ['childItems', 'Child items']], ExecutePipeline: [['pipelineRunId', 'Child run ID']] };
  A.STEP_ANY = [['error', 'Its error message'], ['=', 'Other output (type its path)']];
  A.stepFields = type => (A.STEP_FIELDS[type] || []).concat(A.STEP_ANY);
  A.stepExpr = function (value, numeric) {
    const s = String(value || ''), i = s.indexOf('|'), act = (i < 0 ? s : s.slice(0, i)).trim().replace(/'/g, "''"), f = i < 0 ? '' : s.slice(i + 1).trim();
    if (!act) return "''";
    if (f === 'error') return "coalesce(activity('" + act + "')?.error?.message, '')";
    const path = (/^=/.test(f) ? f.slice(1).trim() : f).replace(/^output\./, '').split('.').filter(Boolean).map(p => p.replace(/[^\w\[\]]/g, '')).join('?.');
    if (!path) return "''";
    const read = "activity('" + act + "')?.output?." + path;
    if (numeric) return 'coalesce(' + read + ', 0)';
    return A.STEP_NUMERIC.test(path) ? 'string(coalesce(' + read + ', 0))' : "string(coalesce(" + read + ", ''))";   /* a count that is missing is 0, so int() still reads it */
  };
  A.STEP_NUMERIC = /^(rowsCopied|rowsRead|filesWritten|filesRead|copyDuration|dataWritten|dataRead|executionDuration|count)$/;
  /* the owner's own logging notebook layout (Nov 2026: "default the selections to my actual selections"): one row per
     object and step, for the bronze, silver and gold pattern; other patterns have no object or layer, so they keep the plain set */
  A.notebookLogParams = kind => kind === 'medallion'
    ? [['obj_id', 'obj_id', ''], ['obj_name', 'obj_name', ''], ['error_details', 'error', 'no error'], ['status', 'status', ''], ['number_rows', 'rows_written', ''], ['duration', 'duration', ''], ['layer', 'layer', ''], ['storage_name', 'global', 'StorageAccountName']].map(a => ({ name: a[0], use: a[1], value: a[2] }))
    : A.defaultLogParams();
  A.defaultLogParams = () => [['pipeline_name', 'pipeline'], ['run_id', 'run'], ['status', 'status'], ['error_message', 'error']].map(a => ({ name: a[0], use: a[1], value: '' }));

  /* ---- datasets: one the page creates, or the user's own, read from its code-view JSON ---- */
  const EXTRA_USES = [['variable', 'Pipeline variable'], ['global', 'Global parameter'], ['expr', 'ADF expression']];
  A.dsValue = function (m, v) {
    const s = String(m.value == null ? '' : m.value).trim();
    if (m.use === 'fixed') return m.value;
    if (m.use === 'none') return '';
    if (m.use === 'variable') return { value: "@variables('" + (s || 'NAME') + "')", type: 'Expression' };
    if (m.use === 'global') return { value: '@pipeline().globalParameters.' + (s.replace(/^pipeline\(\)\.globalParameters\./, '') || 'NAME'), type: 'Expression' };
    if (m.use === 'expr') return s ? { value: /^@/.test(s) ? s : '@' + s, type: 'Expression' } : '';
    return v[m.use] == null ? '' : v[m.use];
  };
  A.DS_USES = { table: [['schema', 'Schema name'], ['table', 'Table name'], ['fixed', 'Fixed text']].concat(EXTRA_USES, [['none', 'Leave empty']]), file: [['container', 'Container'], ['folder', 'Folder path'], ['file', 'File name'], ['fixed', 'Fixed text']].concat(EXTRA_USES, [['none', 'Leave empty']]) };
  const DS_SYS = { SqlServerTable: 'sqlserver', AzureSqlTable: 'azuresql', AzureSqlDWTable: 'synapse', AzureSqlMITable: 'azuresql' };
  A.readDataset = function (text) {
    let s = String(text || '').trim(); if (!s) return null;
    s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').replace(/[\u201C\u201D]/g, '"');
    const i = s.indexOf('{'), j = s.lastIndexOf('}'); if (i < 0 || j < i) return { error: 'This isn\u2019t JSON. Open the dataset in ADF Studio, select the code view button {} and copy everything.' };
    let o; try { o = JSON.parse(s.slice(i, j + 1)); } catch (e) { return { error: 'The JSON can\u2019t be read: ' + e.message + '. Copy it again from the code view.' }; }
    const pr = o && o.properties; if (!pr || typeof pr !== 'object') return { error: 'This JSON has no properties, so it isn\u2019t a dataset.' };
    if (Array.isArray(pr.activities)) return { error: 'That is a pipeline. Paste the dataset\u2019s JSON here (Author > Datasets > your dataset > code view {}).' };
    if (typeof pr.type !== 'string' || !pr.type) return { error: 'The JSON has no dataset type.' };
    if (!o.name || typeof o.name !== 'string') return { error: 'The JSON has no name. Copy the whole code view, starting at the first {.' };
    const tp = pr.typeProperties && typeof pr.typeProperties === 'object' ? pr.typeProperties : {}, loc = tp.location && typeof tp.location === 'object' ? tp.location : {};
    const defs = pr.parameters && typeof pr.parameters === 'object' ? pr.parameters : {}, params = Object.keys(defs), auto = {};
    const from = (v, use) => { const x = String(v && typeof v === 'object' ? v.value : v == null ? '' : v).trim(), m = /^@\{?dataset\(\)\.([A-Za-z_]\w*)\}?$/.exec(x); if (m && params.indexOf(m[1]) >= 0 && !auto[m[1]]) auto[m[1]] = use; };
    from(loc.fileSystem, 'container'); from(loc.container, 'container'); from(loc.bucketName, 'container'); from(loc.folderPath, 'folder'); from(loc.fileName, 'file'); from(tp.schema, 'schema'); from(tp.table, 'table'); from(tp.tableName, 'table');
    const kind = loc.type || /^(Binary|DelimitedText|Parquet|Json|Avro|Orc|Xml|Excel)$/.test(pr.type) ? 'file' : 'table';
    params.forEach(k => { if (auto[k]) return; const n = k.toLowerCase(); auto[k] = kind === 'file' ? (/container|filesystem|file_system|bucket/.test(n) ? 'container' : /folder|dir|path/.test(n) ? 'folder' : /file/.test(n) ? 'file' : 'none') : (/schema/.test(n) ? 'schema' : /table|object|entity/.test(n) ? 'table' : 'none'); });
    return { name: o.name, type: pr.type, kind, ls: String((pr.linkedServiceName && pr.linkedServiceName.referenceName) || ''), store: String(loc.type || 'AzureBlobFSLocation').replace(/Location$/, ''), system: DS_SYS[pr.type] || '', params, auto,
      defaults: params.filter(k => defs[k] && defs[k].defaultValue != null && defs[k].defaultValue !== '') };
  };
  A.ownDs = function (cfg, key) {
    const d = cfg.ds && cfg.ds[key]; if (!d || d.mode !== 'own') return null;
    const r = A.readDataset(d.json); if (!r || r.error) return null;
    r.map = {}; r.params.forEach(k => { const m = d.map && d.map[k]; r.map[k] = m && typeof m.use === 'string' && m.use ? { use: m.use, value: String(m.value || '') } : { use: r.auto[k], value: '' }; });
    r.has = u => r.params.some(k => r.map[k].use === u);
    return r;
  };

  A.defaultStandards = () => ({
    plPrefix: 'pl_', dsPrefix: 'ds_', trPrefix: 'tr_',
    ctlSchema: 'etl', stgSchema: 'stg', wmTable: 'watermark', logTable: 'pipeline_run_log',
    retry: 2, retrySec: 60, timeoutHrs: 2,
    alertParam: 'alert_webhook_url',
    log: { method: 'none', proc: '', nbPath: '', nbLs: '', params: A.defaultLogParams() }, off: ['Standards'], v: 2,
    rawPath: 'raw/{source}/{object}/{yyyy}/{MM}/{dd}', archivePath: 'archive/{source}/{object}/{yyyy}/{MM}/{dd}', quarantinePath: 'quarantine/{source}/{object}/{yyyy}/{MM}/{dd}'
  });
  A.blank = () => ({
    name: '', domain: '', goal: '',
    src: { kind: 'medallion', system: 'sqlserver', ls: '', ir: '', onprem: false, schema: 'dbo', table: '', container: '', folder: '', starts: '', ends: '.csv', after: 'leave', dest: '' },
    ds: { src: { mode: 'new', json: '', map: {} }, tgt: { mode: 'new', json: '', map: {} }, list: { mode: 'new', json: '', map: {} }, read: { mode: 'new', json: '', map: {} }, sink: { mode: 'new', json: '', map: {} }, meta: { mode: 'new', json: '', map: {} } },
    med: A.medDefaults ? A.medDefaults() : {},
    vars: [],
    schemaText: '', exclude: [],
    tgt: { kind: 'sql', system: 'azuresql', ls: '', schema: '', table: '', write: 'merge', container: '', storage: '' },
    ctlLs: '',
    load: { type: 'incremental', wmCol: '', wmType: 'datetime', keys: [], overlap: 0 },
    filter: '', ai: { request: '', reply: '' },
    sched: { freq: 'none', time: '02:00', tz: 'Eastern Standard Time' },
    alert: 'none', nbLs: '', notebooks: ''
  });

  /* ---------- reading the schema query's results ---------- */
  A.SCHEMA_COLS = ['TABLE_SCHEMA', 'TABLE_NAME', 'COLUMN_NAME', 'DATA_TYPE', 'MAX_LEN', 'PREC', 'SCALE', 'IS_NULLABLE', 'KEY_FLAG'];
  A.schemaQuery = function (schema, tables) {
    const list = (tables || []).filter(Boolean);
    return ['SELECT', '    c.TABLE_SCHEMA,', '    c.TABLE_NAME,', '    c.COLUMN_NAME,', '    c.DATA_TYPE,',
      '    c.CHARACTER_MAXIMUM_LENGTH AS MAX_LEN,', '    COALESCE(c.NUMERIC_PRECISION, c.DATETIME_PRECISION) AS PREC,', '    c.NUMERIC_SCALE            AS SCALE,',
      '    c.IS_NULLABLE,', "    CASE WHEN k.COLUMN_NAME IS NOT NULL THEN 'PK' ELSE '' END AS KEY_FLAG",
      'FROM INFORMATION_SCHEMA.COLUMNS c', 'LEFT JOIN (', '    SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME',
      '    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc', '    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku',
      '      ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME', '     AND tc.TABLE_SCHEMA   = ku.TABLE_SCHEMA',
      "    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'", ') k ON  k.TABLE_SCHEMA = c.TABLE_SCHEMA', '    AND k.TABLE_NAME   = c.TABLE_NAME',
      '    AND k.COLUMN_NAME  = c.COLUMN_NAME',
      'WHERE c.TABLE_SCHEMA = ' + sq(schema || 'dbo'),
      '  AND c.TABLE_NAME IN (' + (list.length ? list.map(sq).join(', ') : sq(ph('TABLE'))) + ')',
      'ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;'].join('\n');
  };
  A.volumeQuery = function (schema, table, wmCol, wmType) {
    const t = q(schema || 'dbo') + '.' + q(table || ph('TABLE'));
    if (!wmCol) return 'SELECT COUNT_BIG(*) AS total_rows\nFROM ' + t + ';';
    const c = q(wmCol), L = ['SELECT COUNT_BIG(*) AS total_rows,', '       MIN(' + c + ') AS oldest_change,', '       MAX(' + c + ') AS newest_change' + (wmType === 'integer' ? '' : ',')];
    if (wmType !== 'integer') L.push('       SUM(CASE WHEN ' + c + ' >= DATEADD(day, -1, SYSDATETIME()) THEN 1 ELSE 0 END) AS rows_changed_last_day');
    L.push('FROM ' + t + ';');
    return L.join('\n');
  };
  A.parseSchema = function (text) {
    const out = { cols: [], tables: [], errors: [] };
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
    if (!lines.length) return out;
    const split = l => l.indexOf('\t') >= 0 ? l.split('\t') : (l.indexOf(',') >= 0 ? l.split(',') : l.trim().split(/\s{2,}/));
    const first = split(lines[0]).map(s => s.trim().toUpperCase());
    let idx = {}, start = 0;
    if (first.indexOf('COLUMN_NAME') >= 0) { first.forEach((h, i) => { idx[h] = i; }); start = 1; }
    else A.SCHEMA_COLS.forEach((h, i) => { idx[h] = i; });
    if (idx.COLUMN_NAME == null || idx.DATA_TYPE == null) { out.errors.push('The paste needs the COLUMN_NAME and DATA_TYPE columns. Copy the results grid with headers.'); return out; }
    const num = v => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
    for (let i = start; i < lines.length; i++) {
      const c = split(lines[i]).map(s => s.trim()), g = k => (idx[k] == null ? '' : (c[idx[k]] || ''));
      const name = g('COLUMN_NAME'), type = g('DATA_TYPE').toLowerCase();
      if (!name || !type || /^null$/i.test(name)) continue;
      if (!/^[a-z][a-z0-9_ ]*$/.test(type)) { out.errors.push('Row ' + (i + 1) + ' was skipped: “' + type.slice(0, 30) + '” isn’t a data type.'); continue; }
      out.cols.push({
        schema: g('TABLE_SCHEMA'), table: g('TABLE_NAME'), name, type,
        len: /^null$/i.test(g('MAX_LEN')) ? null : num(g('MAX_LEN')), prec: num(g('PREC')), scale: num(g('SCALE')),
        nullable: !/^no$/i.test(g('IS_NULLABLE')), pk: /pk/i.test(g('KEY_FLAG'))
      });
    }
    out.tables = Array.from(new Set(out.cols.map(c => (c.schema ? c.schema + '.' : '') + c.table).filter(t => t !== '')));
    if (!out.cols.length && !out.errors.length) out.errors.push('No columns were read. Paste the results of the schema query, with headers.');
    return out;
  };
  A.sqlType = function (c) {
    const t = c.type;
    if (/^(n?varchar|n?char|varbinary|binary)$/.test(t)) return t + '(' + (c.len == null ? (/^n/.test(t) ? 50 : 50) : (c.len < 0 ? 'max' : c.len)) + ')';
    if (/^(decimal|numeric)$/.test(t)) return t + '(' + (c.prec || 18) + ', ' + (c.scale == null ? 0 : c.scale) + ')';
    if (/^(datetime2|datetimeoffset|time)$/.test(t)) return t + '(' + (c.prec == null || c.prec > 7 ? 7 : c.prec) + ')';
    return t;
  };
  A.isDateType = t => /^(datetime|datetime2|smalldatetime|datetimeoffset|date)$/.test(t);
  A.isIntType = t => /^(bigint|int|smallint|tinyint)$/.test(t);
  A.suggest = function (cols) {
    const keys = cols.filter(c => c.pk).map(c => c.name);
    const score = c => {
      const n = c.name.toLowerCase(); let s = 0;
      if (A.isDateType(c.type) && c.type !== 'date') s += 2; else if (c.type === 'rowversion' || c.type === 'timestamp') return 0; else if (!A.isDateType(c.type)) return 0;
      if (/modif|updat|chang|last/.test(n)) s += 5; else if (/creat|insert|load/.test(n)) s += 1;
      return s;
    };
    const best = cols.map(c => [score(c), c]).filter(p => p[0] > 2).sort((a, b) => b[0] - a[0])[0];
    return { keys, wmCol: best ? best[1].name : '', wmType: 'datetime' };
  };
  /* the table the brief names, or the only table in the paste */
  A.tableCols = function (cfg) {
    const all = A.parseSchema(cfg.schemaText).cols, t = (cfg.src.table || '').toLowerCase(), s = (cfg.src.schema || '').toLowerCase();
    let mine = all.filter(c => c.table.toLowerCase() === t && (!c.schema || !s || c.schema.toLowerCase() === s));
    if (!mine.length && !t) { const first = all[0]; mine = first ? all.filter(c => c.table === first.table && c.schema === first.schema) : []; }
    if (!mine.length && all.length && !all[0].table) mine = all;
    return mine;
  };

  /* ---------- Copilot: extra columns and a row filter, in plain words ---------- */
  A.aiPrompt = function (cfg) {
    const cols = A.tableCols(cfg), L = [];
    const sysl = (A.SYSTEMS[cfg.src.system] || A.SYSTEMS.sqlserver).label;
    L.push('You are writing T-SQL expressions for the source query of an Azure Data Factory Copy activity. You cannot see the database: use only the columns listed under CONTEXT.');
    L.push('', 'TASK (the user’s request: all the expressions have to do)', (cfg.ai.request || '(not given)').trim());
    L.push('', 'CONTEXT', 'Source: ' + sysl + ', table ' + q(cfg.src.schema || 'dbo') + '.' + q(cfg.src.table || ph('TABLE')), 'Columns (name | type | nullable | key):');
    cols.forEach(c => L.push('- ' + q(c.name) + ' | ' + A.sqlType(c) + ' | ' + (c.nullable ? 'null' : 'not null') + (c.pk ? ' | PK' : '')));
    if (cfg.load.type === 'incremental' && cfg.load.wmCol) L.push('Change column (the pipeline already filters on it; do not filter on it again): ' + q(cfg.load.wmCol));
    if (cfg.load.keys.length) L.push('Business key: ' + cfg.load.keys.map(q).join(', '));
    L.push('', 'STARTING POINT', 'The pipeline already selects every column above as it is' + (cfg.filter.trim() ? ' and keeps rows WHERE ' + cfg.filter.trim() : '') + '. You only add to that.');
    L.push('', 'RULES',
      '- Write a COLUMN block for each column the TASK changes or adds. Use an existing column’s name to replace it, or a new name to add a column. Leave out columns the TASK doesn’t change.',
      '- Write one FILTER block only if the TASK keeps or excludes rows. It is a single predicate, without the word WHERE.',
      '- Write every source column in square brackets, exactly as listed: [ColumnName]. Never use a column that isn’t listed.',
      '- T-SQL that runs on ' + sysl + ' only. Expressions and predicates only: no SELECT, no subqueries, no semicolons, no comments, no variables.',
      '- Give each COLUMN the exact SQL type of its result.',
      '- Do not change the business key' + (cfg.load.wmCol ? ' or the change column' : '') + '.',
      '- If the TASK can’t be done with the listed columns, write a SKIPPED block that says why instead of guessing.');
    L.push('', 'REPLY FORMAT (a template: replace the placeholder lines with your answer)', 'Reply inside one code block, with these labelled blocks and nothing else:',
      '@@@ COLUMN @@@', 'NAME: column name', 'TYPE: sql type', 'EXPR: t-sql expression', '@@@ FILTER @@@', 't-sql predicate', '@@@ SKIPPED @@@', 'what could not be done and why', '@@@ NOTES @@@', 'assumptions to confirm, one per line');
    return L.join('\n');
  };
  const BAD_SQL = /\b(insert|update|delete|drop|alter|create|truncate|exec|execute|merge|grant|revoke|declare|select|union|into|openrowset|xp_\w+|sp_\w+)\b/i;
  A.aiParse = function (reply, cfg, parseBlocks, fields) {
    const res = { columns: [], filter: '', notes: [], skipped: [], findings: [], any: false };
    const blocks = parseBlocks(reply); if (!blocks.length) return res;
    const cols = A.tableCols(cfg), known = new Set(cols.map(c => c.name.toLowerCase()));
    const refs = e => (e.match(/\[[^\]]+\]/g) || []).map(s => s.slice(1, -1));
    const vet = (what, e) => {
      const f = [];
      if (/;|--|\/\*/.test(e)) f.push(what + ' contains a semicolon or a comment.');
      const bad = BAD_SQL.exec(e.replace(/'(?:[^']|'')*'/g, "''")); if (bad) f.push(what + ' uses ' + bad[1].toUpperCase() + ', which isn’t allowed in an expression.');
      let d = 0; for (const ch of e.replace(/'(?:[^']|'')*'/g, "''")) { if (ch === '(') d++; if (ch === ')') d--; if (d < 0) break; }
      if (d !== 0) f.push(what + ' has brackets that don’t balance.');
      refs(e).filter(r => !known.has(r.toLowerCase())).forEach(r => f.push(what + ' uses [' + r + '], which isn’t a column of the source table.'));
      if (/@/.test(e.replace(/'(?:[^']|'')*'/g, "''"))) f.push(what + ' uses a variable (@).');
      return f;
    };
    const seen = new Set();
    blocks.forEach(b => {
      if (b.tag === 'COLUMN') {
        const f = fields(b.body, ['NAME', 'TYPE', 'EXPR']);
        const name = (f.NAME || '').replace(/^\[|\]$/g, '').trim(), type = (f.TYPE || '').trim(), expr = (f.EXPR || '').replace(/\s*\n\s*/g, ' ').trim();
        if (/^column name$/i.test(name) || /^t-sql expression$/i.test(expr)) return;      // the template repeated back
        res.any = true;
        const c = { name, type, expr, problems: [] };
        if (!name || !expr) c.problems.push('The block is missing NAME or EXPR.');
        if (name && !/^[A-Za-z_][A-Za-z0-9_ ]*$/.test(name)) c.problems.push('The name has characters a column name shouldn’t have.');
        if (!/^[a-z][a-z0-9]*(\s*\(\s*(max|\d+)\s*(,\s*\d+\s*)?\))?$/i.test(type)) c.problems.push('TYPE “' + type + '” isn’t a SQL type.');
        if (seen.has(name.toLowerCase())) c.problems.push('The name is used twice.');
        seen.add(name.toLowerCase());
        vet('The expression', expr).forEach(p => c.problems.push(p));
        const lower = name.toLowerCase();
        if (cfg.load.keys.some(k => k.toLowerCase() === lower)) c.problems.push('It replaces the business key ' + name + '.');
        if (cfg.load.type === 'incremental' && (cfg.load.wmCol || '').toLowerCase() === lower) c.problems.push('It replaces the change column ' + name + '.');
        c.replaces = known.has(lower);
        res.columns.push(c);
      } else if (b.tag === 'FILTER') {
        const e = b.body.replace(/\s*\n\s*/g, ' ').replace(/^where\s+/i, '').trim();
        if (!e || /^t-sql predicate$/i.test(e)) return;
        res.any = true; res.filter = e; res.filterProblems = vet('The filter', e);
      } else if (b.tag === 'NOTES') { b.body.split('\n').map(s => s.replace(/^[-*]\s*/, '').trim()).filter(s => s && !/^assumptions to confirm/i.test(s)).forEach(s => res.notes.push(s)); if (res.notes.length) res.any = true; }
      else if (b.tag === 'SKIPPED') { if (b.body && !/^what could not be done/i.test(b.body)) { res.skipped.push(b.body); res.any = true; } }
    });
    res.ok = res.columns.filter(c => !c.problems.length);
    res.filterOk = res.filter && !(res.filterProblems || []).length ? res.filter : '';
    return res;
  };

  /* ---------- names ---------- */
  const lsShort = (ls, fallback) => { const s = String(ls || '').replace(/^ls_/i, '').replace(/_(dev|test|tst|uat|qa|stg|prod|prd)$/i, ''); return snake(s) || fallback; };
  A.names = function (cfg, std) {
    std = std || A.defaultStandards();
    const files = cfg.src.kind === 'files' || cfg.src.kind === 'medallion';
    const segs = String(cfg.src.folder || '').replace(/\{[^}]*\}/g, '').split('/').filter(Boolean);
    const obj = files ? (snake(cfg.src.kind === 'medallion' ? segs[0] : segs.pop()) || 'files') : (snake(cfg.src.table) || 'table');
    const tobj = snake(cfg.tgt.table) || obj;
    const srcSys = files ? 'adls' : (A.SYSTEMS[cfg.src.system] || A.SYSTEMS.sqlserver).short;
    const srcShort = lsShort(cfg.src.ls, files ? 'adls' : srcSys);
    const sql = cfg.tgt.kind === 'sql' && !files;
    const tgtSys = sql ? (A.SYSTEMS[cfg.tgt.system] || A.SYSTEMS.azuresql) : null;
    const tgtShort = lsShort(cfg.tgt.ls, sql ? tgtSys.short : 'adls');
    const inc = !files && cfg.load.type === 'incremental';
    const kindWord = cfg.src.kind === 'medallion' ? 'medallion' : files ? (cfg.src.after === 'archive' ? 'landing' : 'copy') : (inc ? 'incremental' : 'full');
    const domain = snake(cfg.domain) || snake(srcShort.replace(new RegExp('^' + srcSys + '_?'), '')) || 'data';
    const n = {
      obj, tobj, files, sql, inc, domain, srcShort, tgtShort,
      pipeline: (cfg.name || '').trim() || (cfg.src.kind === 'medallion' ? std.plPrefix + obj : std.plPrefix + domain + '_' + obj + '_' + kindWord),
      srcLs: cfg.src.ls.trim() || ph(files ? 'LS_ADLS' : 'LS_SOURCE'), tgtLs: cfg.tgt.ls.trim() || ph(sql ? 'LS_TARGET' : 'LS_ADLS'),
      srcDs: std.dsPrefix + (/^(sqlserver|azuresql|synapse|adls)/.test(srcShort) ? '' : srcSys + '_') + srcShort + (files ? '_binary' : '_table'),
      stgTable: tobj, wmKey: (cfg.src.schema || 'dbo') + '.' + (cfg.src.table || ph('TABLE')),
      mergeProc: 'usp_merge_' + tobj, scdProc: 'usp_scd2_' + tobj
    };
    const oS = A.ownDs(cfg, 'src'), oT = A.ownDs(cfg, 'tgt');
    if (oS) { n.srcDs = oS.name; if (!cfg.src.ls.trim() && oS.ls) n.srcLs = oS.ls; }
    if (files) n.tgtLs = oT && oT.ls ? oT.ls : n.srcLs; else if (oT && !cfg.tgt.ls.trim() && oT.ls) n.tgtLs = oT.ls;
    n.tgtDs = sql ? std.dsPrefix + (/^(sqlserver|azuresql|synapse)/.test(tgtShort) ? '' : tgtSys.short + '_') + tgtShort + '_table' : std.dsPrefix + (/^adls/.test(tgtShort) ? '' : 'adls_') + tgtShort + '_parquet';
    if (oT) n.tgtDs = oT.name;
    n.ownSrc = oS; n.ownTgt = oT;
    /* control database: the SQL target, or the one named in the brief */
    const ctl = cfg.ctlLs.trim();
    if (sql && (!ctl || ctl === cfg.tgt.ls.trim() || ctl === n.tgtLs)) { n.ctlLs = n.tgtLs; n.ctlDs = n.tgtDs; n.ctlSys = tgtSys; n.ctlOwn = oT; }
    else { n.ctlLs = ctl || ph('LS_CONTROL_DB'); n.ctlSys = A.SYSTEMS.azuresql; n.ctlDs = std.dsPrefix + 'azuresql_' + lsShort(ctl, 'control').replace(/^azuresql_?/, '') + '_table'; if (/_$/.test(n.ctlDs.replace('_table', ''))) n.ctlDs = std.dsPrefix + 'azuresql_control_table'; }
    n.trigger = cfg.sched.freq === 'none' ? '' : std.trPrefix + (cfg.sched.freq === 'hourly' ? 'hourly_' : 'daily_' + cfg.sched.time.replace(':', '') + '_') + n.pipeline.replace(new RegExp('^' + std.plPrefix), '');
    return n;
  };

  /* ---------- output columns ---------- */
  A.outCols = function (cfg, ai) {
    const src = A.tableCols(cfg), must = new Set(cfg.load.keys.concat(cfg.load.type === 'incremental' && cfg.load.wmCol ? [cfg.load.wmCol] : []).map(s => s.toLowerCase()));
    const ex = new Set((cfg.exclude || []).map(s => s.toLowerCase()));
    const out = src.filter(c => must.has(c.name.toLowerCase()) || !ex.has(c.name.toLowerCase()))
      .map(c => ({ name: c.name, type: A.sqlType(c), expr: q(c.name), nullable: c.nullable, plain: true }));
    ((ai && ai.ok) || []).forEach(a => {
      const i = out.findIndex(c => c.name.toLowerCase() === a.name.toLowerCase());
      const col = { name: i >= 0 ? out[i].name : a.name, type: a.type.toLowerCase(), expr: a.expr, nullable: true, plain: false };
      if (i >= 0) out[i] = col; else out.push(col);
    });
    return out;
  };

  /* ---------- checks on the brief ---------- */
  A.problems = function (cfg, std) {
    const P = [], add = (sev, msg) => P.push({ sev, msg });
    const cols = A.tableCols(cfg), by = n => cols.find(c => c.name.toLowerCase() === String(n).toLowerCase());
    if (cfg.src.kind === 'medallion' && A.medProblems) return A.medProblems(cfg, std).concat(A.varProblems(cfg));
    P.push.apply(P, A.varProblems(cfg));
    const files = cfg.src.kind === 'files', sql = cfg.tgt.kind === 'sql' && !files, w = cfg.tgt.write, inc = !files && cfg.load.type === 'incremental';
    if (files) {
      const oS = A.ownDs(cfg, 'src'), oT = A.ownDs(cfg, 'tgt'), mode = cfg.src.after || 'archive';
      ['src', 'tgt'].forEach(k => { const d = cfg.ds && cfg.ds[k]; if (d && d.mode === 'own') { const r = A.readDataset(d.json); if (!r) add('err', 'Paste the JSON of your ' + (k === 'src' ? 'source' : 'destination') + ' dataset, or let the page create one.'); else if (r.error) add('err', (k === 'src' ? 'Source' : 'Destination') + ' dataset: ' + r.error); else if (r.kind !== 'file') add('err', 'The ' + (k === 'src' ? 'source' : 'destination') + ' dataset ' + r.name + ' is a ' + r.type + ', not a file dataset.'); } });
      if (!cfg.src.folder.trim() && (!oS || oS.has('folder'))) add('err', 'Give the folder the files arrive in.');
      if (!cfg.src.container.trim() && (!oS || oS.has('container'))) add('warn', 'No source container: the JSON uses the placeholder <LANDING_CONTAINER>.');
      const wild = oS && !oS.has('file');
      if (wild && mode === 'archive') add('err', 'Your source dataset ' + oS.name + ' has no file name parameter, so the page can\u2019t handle each file on its own, which archive and quarantine need. Under After copying choose \u201CLeave the originals\u201D or \u201CDelete the originals\u201D (the whole folder is copied in one step), or add a file name parameter to the dataset.');
      else if (wild) add('info', 'Your source dataset ' + oS.name + ' has no file name parameter, so the pipeline copies the whole folder in one Copy activity: every file matching ' + ((cfg.src.starts.trim() || '') + '*' + (cfg.src.ends.trim() || '')) + ', keeping its name.' + (cfg.src.dest.trim() && oT && !oT.has('folder') ? '' : ''));
      if (oT && !oT.has('file') && !wild) add('warn', 'Your destination dataset ' + oT.name + ' has no parameter for the file name. Copied files keep their names only if its file name is left empty in the dataset.');
      const fixedFolder = d => d && d.params.filter(k => d.auto[k] === 'folder' && d.map[k].use === 'fixed').map(k => d.map[k].value)[0];
      if (oT && !oT.has('folder') && cfg.src.dest.trim()) { const f = fixedFolder(oT); add('info', f != null ? 'Files go to ' + (f || '(empty)') + ', the fixed text you gave the destination dataset\u2019s folder parameter. The Destination folder box isn\u2019t used.' : 'Your destination dataset ' + oT.name + ' has no folder parameter, so files go to the folder set inside the dataset, not to \u201C' + cfg.src.dest.trim() + '\u201D.'); }
      if (oT && !oT.has('folder') && mode === 'archive') add('err', 'Landing with archive and quarantine writes to three folders, so the destination dataset ' + oT.name + ' needs a parameter set to Folder path' + (fixedFolder(oT) != null ? ' (yours is set to fixed text)' : '') + '. Change it below, or choose a simpler option under After copying.');
      if (oS && oT && oS.type !== oT.type && (oS.type === 'Binary' || oT.type === 'Binary')) add('err', 'A Binary dataset can only be copied to another Binary dataset. Yours are ' + oS.type + ' and ' + oT.type + '.');
      { const ty = (oS || oT || {}).type; if (ty && ty !== 'Binary') add('info', 'Your datasets are ' + ty + ', so each file is read and written again (quoting and line endings can change' + (ty === 'DelimitedText' ? ', and the page sets the sink to quote all text' : '') + '). For an exact, byte-for-byte copy use Binary datasets.'); }
      if (oS && !oT && oS.type !== 'Binary') add('err', 'Your source dataset is ' + oS.type + ' and the page\u2019s destination dataset is Binary. Use your own destination dataset too, or let the page create both.');
      if (!oS && oT && oT.type !== 'Binary') add('err', 'Your destination dataset is ' + oT.type + ' and the page\u2019s source dataset is Binary. Use your own source dataset too, or let the page create both.');
      if (std && std.log && /^sp_/.test(std.log.method) && !cfg.ctlLs.trim()) add('warn', 'Logging with a stored procedure needs a SQL database. Name its linked service under Control database, or choose another way to log (your own notebook, or none).');
      if (std && std.log && std.log.method === 'sp_own' && !String(std.log.proc || '').trim()) add('warn', 'Logging uses your own stored procedure but it has no name yet: the JSON uses <LOG_PROCEDURE>.');
      if (std && std.log && std.log.method === 'notebook' && !String(std.log.nbPath || '').trim()) add('warn', 'Logging uses your own notebook but it has no path yet: the JSON uses <LOG_NOTEBOOK_PATH>.');
      return P;
    }
    ['src', 'tgt'].forEach(k => { const d = cfg.ds && cfg.ds[k]; if (!d || d.mode !== 'own' || (k === 'tgt' && !sql && false)) return; const r = A.readDataset(d.json), wantFile = k === 'tgt' && !sql; if (!r) add('err', 'Paste the JSON of your ' + (k === 'src' ? 'source' : 'target') + ' dataset, or let the page create one.'); else if (r.error) add('err', (k === 'src' ? 'Source' : 'Target') + ' dataset: ' + r.error); else if ((r.kind === 'file') !== wantFile) add('err', 'The ' + (k === 'src' ? 'source' : 'target') + ' dataset ' + r.name + ' is a ' + r.type + '; this load needs a ' + (wantFile ? 'file' : 'table') + ' dataset there.'); });
    { const oT = A.ownDs(cfg, 'tgt'); if (oT && sql && (w === 'merge' || w === 'scd2') && !(oT.has('schema') && oT.has('table'))) add('err', 'A merge loads a staging table first, so the target dataset ' + oT.name + ' needs schema and table parameters. Map them below, or let the page create the dataset.'); }
    if (std && std.log && std.log.method === 'sp_own' && !String(std.log.proc || '').trim()) add('warn', 'Logging uses your own stored procedure but it has no name yet: the JSON uses <LOG_PROCEDURE>.');
    if (std && std.log && std.log.method === 'notebook' && !String(std.log.nbPath || '').trim()) add('warn', 'Logging uses your own notebook but it has no path yet: the JSON uses <LOG_NOTEBOOK_PATH>.');
    if (!cfg.src.table.trim()) add('err', 'Name the source table.');
    if (!cols.length) add('warn', 'No columns were read for this table, so the copy takes every column (SELECT *) and no table scripts can be written. Paste the schema query results in Step 1.');
    if (inc && !cfg.load.wmCol) add('err', 'An incremental load needs a change column (a modified date or an ever-increasing number). Choose one, or switch to a full load.');
    if (inc && cfg.load.wmCol && cols.length) {
      const c = by(cfg.load.wmCol);
      if (!c) add('err', 'The change column ' + cfg.load.wmCol + ' isn’t in the pasted schema.');
      else {
        if (cfg.load.wmType === 'datetime' && !A.isDateType(c.type)) add('err', cfg.load.wmCol + ' is ' + c.type + ', not a date and time. Set the change column type to Number, or choose another column.');
        if (cfg.load.wmType === 'integer' && !A.isIntType(c.type)) add('err', cfg.load.wmCol + ' is ' + c.type + ', not a whole number. Set the change column type to Date and time.');
        if (c.type === 'date') add('warn', cfg.load.wmCol + ' is a date with no time, so rows changed later the same day as a run are missed. Use a date and time column, or turn on an overlap of 1,440 minutes with a merge.');
        if (c.nullable) add('warn', cfg.load.wmCol + ' allows NULL. Rows where it is NULL are never picked up by an incremental load.');
      }
    }
    if (sql && (w === 'merge' || w === 'scd2') && !cfg.load.keys.length) add('err', (w === 'merge' ? 'A merge' : 'SCD Type 2') + ' needs a business key. Tick the key column(s).');
    cfg.load.keys.forEach(k => { const c = by(k); if (cols.length && !c) add('err', 'The key column ' + k + ' isn’t in the pasted schema.'); else if (c && c.nullable) add('warn', 'The key column ' + k + ' allows NULL. Rows with a NULL key never match in a merge and are inserted again on every run.'); });
    if (sql && inc && w === 'overwrite') add('err', 'Overwrite with an incremental load would leave only the last window in the target. The pipeline below appends instead; choose Merge to apply updates, or switch to a full load.');
    if (sql && inc && w === 'append') add('warn', 'Append with an incremental load adds a new row for every change, so an updated order appears twice. Choose Merge if the target should hold one row per key.');
    if (sql && !inc && w === 'append') add('warn', 'Append with a full load adds every source row again on each run. Choose Overwrite or Merge unless that’s intended.');
    if (sql && !cfg.tgt.table.trim()) add('err', 'Name the target table.');
    if (cfg.src.onprem && !cfg.src.ir.trim()) add('warn', 'The source is on-premises or behind a firewall: its linked service must use a self-hosted integration runtime. Add its name so the build steps can say which.');
    if (sql && cfg.tgt.system === 'synapse' && cfg.src.onprem) add('warn', 'Loading a dedicated SQL pool from an on-premises source needs staged copy. Turn on Enable staging on the Copy activity and pick a Blob or ADLS staging linked service.');
    if (sql && cfg.tgt.system === 'synapse' && w === 'scd2') add('warn', 'The SCD Type 2 procedure is written for Azure SQL Database and SQL Server. Review it before running it on a dedicated SQL pool.');
    if (!sql && inc) add('info', 'Parquet files are written one per window. A rerun after a failed run can land rows twice, so the next layer must keep the latest row per key (the silver notebook does).');
    if (!sql && !inc && std && std.log && /^sp_/.test(std.log.method) && !cfg.ctlLs.trim()) add('warn', 'Logging with a stored procedure needs a SQL database. Name its linked service under Control database, or choose another way to log (your own notebook, or none).');
    if (!sql && inc && !cfg.ctlLs.trim()) add('warn', 'The watermark table needs a SQL database. Name its linked service under Control database, or the JSON keeps the placeholder <LS_CONTROL_DB>.');
    if (cfg.filter && /;|--/.test(cfg.filter)) add('err', 'The row filter contains a semicolon or a comment. Use a single predicate.');
    if (cfg.notebooks.trim() && !cfg.nbLs.trim()) add('warn', 'Notebooks are listed but no Databricks linked service is named: the JSON uses <LS_DATABRICKS>.');
    return P;
  };

  /* ---------- building ---------- */
  const pathExpr = (pattern, n) => String(pattern).replace(/\{source\}/g, n.srcShort).replace(/\{object\}/g, n.obj)
    .replace(/\{run\}/g, '@{pipeline().RunId}').replace(/\{(yyyy|MM|dd|HH)\}/g, (m, f) => "@{formatDateTime(pipeline().TriggerTime, '" + f + "')}");

  A.build = function (cfg, std, ai, today) {
    if (cfg.src.kind === 'medallion' && A.buildMed) return A.buildMed(cfg, std, today);
    std = Object.assign(A.defaultStandards(), std || {});
    const n = A.names(cfg, std), cols = A.outCols(cfg, ai), has = cols.length > 0;
    const files = n.files, sql = n.sql, inc = n.inc;
    let write = sql ? cfg.tgt.write : 'files';
    if (sql && inc && write === 'overwrite') write = 'append';
    const staged = sql && (write === 'merge' || write === 'scd2');
    const wm = inc ? cfg.load.wmCol : '', dt = cfg.load.wmType !== 'integer';
    const overlap = inc && dt && staged;
    const srcSys = A.SYSTEMS[(n.ownSrc && n.ownSrc.system) || cfg.src.system] || A.SYSTEMS.sqlserver, tgtSys = A.SYSTEMS[(n.ownTgt && n.ownTgt.system) || cfg.tgt.system] || A.SYSTEMS.azuresql;
    const ctl = q(std.ctlSchema), wmT = ctl + '.' + q(std.wmTable), logT = ctl + '.' + q(std.logTable);
    const tgtT = q(cfg.tgt.schema || 'dbo') + '.' + q(cfg.tgt.table || ph('TARGET_TABLE')), stgT = q(std.stgSchema) + '.' + q(n.stgTable);
    const srcT = q(cfg.src.schema || 'dbo') + '.' + q(cfg.src.table || ph('TABLE'));
    const policy = (retry) => ({ timeout: '0.' + String(std.timeoutHrs).padStart(2, '0') + ':00:00', retry: retry ? Number(std.retry) : 0, retryIntervalInSeconds: Number(std.retrySec), secureOutput: false, secureInput: false });
    const dep = (a, c) => [{ activity: a, dependencyConditions: Array.isArray(c) ? c : [c || 'Succeeded'] }];
    const dsRef = (name, params) => ({ referenceName: name, type: 'DatasetReference', parameters: params });
    const lsRef = name => ({ referenceName: name, type: 'LinkedServiceReference' });
    const tableDs = (name, ls, sys) => ({ name, properties: { linkedServiceName: lsRef(ls), parameters: { schema_name: { type: 'string' }, table_name: { type: 'string' } }, annotations: [], type: sys.ds, schema: [], typeProperties: { schema: X('@dataset().schema_name'), table: X('@dataset().table_name') } } });
    const acts = [], datasets = [], params = {}, variables = {}, notes = [], reused = [];
    const addDs = d => { if (!datasets.some(x => x.name === d.name)) datasets.push(d); };
    const fileDs = (name, ls, type) => ({ name, properties: Object.assign({ linkedServiceName: lsRef(ls), parameters: { container: { type: 'string' }, folder_path: { type: 'string' }, file_name: { type: 'string' } }, annotations: [], type,
      typeProperties: Object.assign({ location: { type: 'AzureBlobFSLocation', fileName: X('@dataset().file_name'), folderPath: X('@dataset().folder_path'), fileSystem: X('@dataset().container') } }, type === 'Parquet' ? { compressionCodec: 'snappy' } : {}) }, type === 'Parquet' ? { schema: [] } : {}) });
    /* a dataset in one role: ref(values) builds the reference, whoever owns the dataset */
    const role = (own, def) => {
      if (!own) { addDs(def); const file = !!def.properties.parameters.container; return { name: def.name, type: def.properties.type, store: 'AzureBlobFS', ref: v => dsRef(def.name, file ? { container: v.container, folder_path: v.folder, file_name: v.file } : { schema_name: v.schema, table_name: v.table }) }; }
      if (reused.indexOf(own) < 0) reused.push(own);
      return { name: own.name, type: own.type, store: own.store, own, ref: v => { const ps = {}; own.params.forEach(k => { const m = own.map[k]; if (m.use === 'none' && own.defaults.indexOf(k) >= 0) return; ps[k] = A.dsValue(m, v); }); const r = { referenceName: own.name, type: 'DatasetReference' }; if (Object.keys(ps).length) r.parameters = ps; return r; } };
    };
    const FMT_READ = /^(Binary|DelimitedText|Json|Parquet|Xml)$/, fmtWrite = t => (t === 'DelimitedText' ? { type: 'DelimitedTextWriteSettings', quoteAllText: true, fileExtension: '.txt' } : t === 'Parquet' ? { type: 'ParquetWriteSettings' } : t === 'Json' ? { type: 'JsonWriteSettings' } : null);
    const readSet = r => ({ type: r.store + 'ReadSettings', recursive: false });
    const fileSource = r => Object.assign({ type: r.type + 'Source', storeSettings: readSet(r) }, FMT_READ.test(r.type) ? { formatSettings: { type: r.type + 'ReadSettings' } } : {});
    const fileSink = r => Object.assign({ type: r.type + 'Sink', storeSettings: { type: r.store + 'WriteSettings' } }, fmtWrite(r.type) ? { formatSettings: fmtWrite(r.type) } : {});
    const container = cfg.tgt.container.trim() || ph('DATALAKE_CONTAINER');
    const storage = cfg.tgt.storage.trim() || ph('STORAGE_ACCOUNT');
    const sp = (name, proc, ps, after, ls) => ({ name, type: 'SqlServerStoredProcedure', dependsOn: after, policy: policy(false), userProperties: [], typeProperties: { storedProcedureName: proc, storedProcedureParameters: ps }, linkedServiceName: lsRef(ls || n.ctlLs) });
    const P = (v, type) => ({ value: /^@/.test(String(v)) ? X(v) : v, type: type || 'String' });
    let last = null, rowsRead = '0', rowsWritten = '0', winStart = '', winEnd = '', nbPath = '';
    const mainNames = [];
    const push = a => { acts.push(a); mainNames.push(a.name); last = a.name; };

    if (!files) {
      const rSrc = role(n.ownSrc, tableDs(n.srcDs, n.srcLs, srcSys)), srcRef = () => rSrc.ref({ schema: cfg.src.schema || 'dbo', table: cfg.src.table || ph('TABLE') });
      /* watermark lookups */
      if (inc) {
        const rCtl = role(n.ctlOwn || null, tableDs(n.ctlDs, n.ctlLs, n.ctlSys));
        params.p_full_reload = { type: 'bool', defaultValue: false };
        const floor = dt ? '1900-01-01T00:00:00' : '0';
        push({ name: 'lkp_old_watermark', type: 'Lookup', dependsOn: [], policy: policy(true), userProperties: [], typeProperties: {
          source: { type: n.ctlSys.source, sqlReaderQuery: X("SELECT CASE WHEN LOWER('@{pipeline().parameters.p_full_reload}') = 'true' THEN " + sq(floor) + ' ELSE watermark_value END AS watermark_value FROM ' + lit(wmT) + ' WHERE table_name = ' + lit(sq(n.wmKey))), queryTimeout: '02:00:00', partitionOption: 'None' },
          dataset: rCtl.ref({ schema: std.ctlSchema, table: std.wmTable }), firstRowOnly: true } });
        const old = "@{activity('lkp_old_watermark').output.firstRow.watermark_value}";
        const maxExpr = dt ? 'CONVERT(varchar(33), MAX(' + q(wm) + '), 126)' : 'CONVERT(varchar(33), MAX(' + q(wm) + '))';
        push({ name: 'lkp_new_watermark', type: 'Lookup', dependsOn: dep('lkp_old_watermark'), policy: policy(true), userProperties: [], typeProperties: {
          source: { type: srcSys.source, sqlReaderQuery: X('SELECT COALESCE(' + lit(maxExpr) + ", '" + old + "') AS new_watermark FROM " + lit(srcT)), queryTimeout: '02:00:00', partitionOption: 'None' },
          dataset: srcRef(), firstRowOnly: true } });
        winStart = "@activity('lkp_old_watermark').output.firstRow.watermark_value"; winEnd = "@activity('lkp_new_watermark').output.firstRow.new_watermark";
        if (overlap) params.p_overlap_minutes = { type: 'int', defaultValue: Number(cfg.load.overlap) || 0 };
      }
      /* source query */
      const sel = has ? cols.map(c => c.plain ? c.expr : c.expr + ' AS ' + q(c.name)).join(', ') : '*';
      const where = [];
      if (inc) {
        const oldV = "@{activity('lkp_old_watermark').output.firstRow.watermark_value}", newV = "@{activity('lkp_new_watermark').output.firstRow.new_watermark}";
        if (dt) {
          const lo = "CONVERT(datetime2(7), '" + oldV + "', 126)";
          where.push(lit(q(wm)) + ' > ' + (overlap ? 'DATEADD(minute, -@{pipeline().parameters.p_overlap_minutes}, ' + lo + ')' : lo));
          where.push(lit(q(wm)) + " <= CONVERT(datetime2(7), '" + newV + "', 126)");
        } else { where.push(lit(q(wm)) + ' > ' + oldV); where.push(lit(q(wm)) + ' <= ' + newV); }
      }
      const filters = [cfg.filter.trim(), ai && ai.filterOk].filter(Boolean);
      filters.forEach(f => where.push('(' + lit(f) + ')'));
      const query = 'SELECT ' + lit(sel) + ' FROM ' + lit(srcT) + (where.length ? ' WHERE ' + where.join(' AND ') : '');
      const source = { type: srcSys.source, sqlReaderQuery: inc ? X(query) : query.replace(/@@/g, '@'), queryTimeout: '02:00:00', partitionOption: 'None' };
      const cpName = 'cp_' + n.obj + (sql ? (staged ? '_to_stg' : '_to_' + snake(cfg.tgt.schema || 'target')) : '_to_raw');
      const cp = { name: cpName, type: 'Copy', dependsOn: last ? dep(last) : [], policy: policy(true), userProperties: [], typeProperties: { source, enableStaging: false },
        inputs: [srcRef()] };
      if (sql) {
        const rTgt = role(n.ownTgt, tableDs(n.tgtDs, n.tgtLs, tgtSys));
        const sink = { type: tgtSys.sink };
        if (staged) sink.preCopyScript = 'TRUNCATE TABLE ' + stgT;
        else if (write === 'overwrite') sink.preCopyScript = 'TRUNCATE TABLE ' + tgtT;
        if (tgtSys.short === 'synapse') { sink.allowCopyCommand = true; } else { sink.writeBehavior = 'insert'; sink.sqlWriterUseTableLock = false; }
        sink.disableMetricsCollection = false;
        cp.typeProperties.sink = sink;
        cp.outputs = [rTgt.ref(staged ? { schema: std.stgSchema, table: n.stgTable } : { schema: cfg.tgt.schema || 'dbo', table: cfg.tgt.table || ph('TARGET_TABLE') })];
      } else {
        const rTgt = role(n.ownTgt, fileDs(n.tgtDs, n.tgtLs, 'Parquet'));
        const folder = pathExpr(std.rawPath, n);
        const file = inc ? n.obj + "_@{replace(replace(replace(activity('lkp_new_watermark').output.firstRow.new_watermark, ':', ''), '-', ''), '.', '')}.parquet" : n.obj + '.parquet';
        cp.typeProperties.sink = fileSink(rTgt);
        cp.outputs = [rTgt.ref({ container, folder: X(folder), file: /@\{/.test(file) ? X(file) : file })];
        nbPath = 'abfss://' + container + '@' + storage + '.dfs.core.windows.net/' + folder + '/' + file;
      }
      push(cp);
      rowsRead = "@activity('" + cpName + "').output.rowsRead"; rowsWritten = "@activity('" + cpName + "').output.rowsCopied";
      if (staged) push(sp(write === 'merge' ? 'sp_merge_' + n.tobj : 'sp_scd2_' + n.tobj, q(std.ctlSchema) + '.' + q(write === 'merge' ? n.mergeProc : n.scdProc), {}, dep(last), n.tgtLs));
    } else {
      /* file landing */
      const lc = cfg.src.container.trim() || ph('LANDING_CONTAINER');
      const landing = cfg.src.folder.trim().replace(/^\/+|\/+$/g, ''), mode = /^(leave|delete)$/.test(cfg.src.after) ? cfg.src.after : 'archive';
      const rSrc = role(n.ownSrc, fileDs(n.srcDs, n.srcLs, 'Binary'));
      const rDst = n.ownTgt ? role(n.ownTgt, null) : (n.ownSrc ? role(null, fileDs(std.dsPrefix + 'adls_' + n.tgtShort.replace(/^adls_?/, '') + '_binary', n.tgtLs, 'Binary')) : rSrc);
      const read = readSet(rSrc), ex = v => (/@\{/.test(v) ? X(v) : v);
      if (n.ownSrc && !n.ownSrc.has('file') && mode !== 'archive') {
        const custom0 = (cfg.src.dest || '').trim().replace(/^\/+|\/+$/g, ''), dest = custom0 ? pathExpr(custom0, n) : pathExpr(std.rawPath, n) + '/@{pipeline().RunId}';
        const pattern = (cfg.src.starts.trim() || '') + '*' + (cfg.src.ends.trim() || '');
        const wildRead = Object.assign(readSet(rSrc), { wildcardFileName: pattern });
        const FMT = /^(Binary|DelimitedText|Json|Parquet|Xml)$/;
        const cpName = 'cp_folder_to_' + (snake((custom0 || 'destination').split('/').filter(Boolean).pop().replace(/\{.*$/, '')) || 'destination');
        push({ name: cpName, type: 'Copy', dependsOn: [], policy: policy(true), userProperties: [], typeProperties: {
          source: Object.assign({ type: rSrc.type + 'Source', storeSettings: wildRead }, FMT.test(rSrc.type) ? { formatSettings: { type: rSrc.type + 'ReadSettings' } } : {}),
          sink: Object.assign({ type: rDst.type + 'Sink', storeSettings: { type: rDst.store + 'WriteSettings', copyBehavior: 'PreserveHierarchy' } }, rDst.type === 'DelimitedText' ? { formatSettings: { type: 'DelimitedTextWriteSettings', quoteAllText: true, fileExtension: (cfg.src.ends.trim() || '.csv') } } : rDst.type === 'Parquet' ? { formatSettings: { type: 'ParquetWriteSettings' } } : {}),
          enableStaging: false },
          inputs: [rSrc.ref({ container: lc, folder: landing, file: '' })], outputs: [rDst.ref({ container, folder: ex(dest), file: '' })] });
        if (mode === 'delete') push({ name: 'del_copied_files', type: 'Delete', dependsOn: dep(cpName), policy: policy(true), userProperties: [], typeProperties: { dataset: rSrc.ref({ container: lc, folder: landing, file: '' }), enableLogging: false, storeSettings: Object.assign(readSet(rSrc), { wildcardFileName: pattern }) } });
        rowsRead = "@activity('" + cpName + "').output.filesRead"; rowsWritten = "@activity('" + cpName + "').output.filesWritten";
        nbPath = 'abfss://' + container + '@' + storage + '.dfs.core.windows.net/' + dest;
        n.fileMode = mode; n.destFolder = dest; n.wild = true;
      } else {
      push({ name: 'gm_list_landing_files', type: 'GetMetadata', dependsOn: [], policy: policy(true), userProperties: [], typeProperties: Object.assign({ dataset: rSrc.ref({ container: lc, folder: landing, file: '' }), fieldList: ['childItems'], storeSettings: read }, FMT_READ.test(rSrc.type) ? { formatSettings: { type: rSrc.type + 'ReadSettings' } } : {}) });
      const conds = ["equals(item().type, 'File')"];
      if (cfg.src.starts.trim()) conds.push("startswith(toLower(item().name), '" + cfg.src.starts.trim().toLowerCase().replace(/'/g, "''") + "')");
      if (cfg.src.ends.trim()) conds.push("endswith(toLower(item().name), '" + cfg.src.ends.trim().toLowerCase().replace(/'/g, "''") + "')");
      const andAll = list => list.length === 1 ? list[0] : 'and(' + andAll(list.slice(0, -1)) + ', ' + list[list.length - 1] + ')';
      push({ name: 'flt_' + n.obj + '_files', type: 'Filter', dependsOn: dep('gm_list_landing_files'), userProperties: [], typeProperties: { items: X("@activity('gm_list_landing_files').output.childItems"), condition: X('@' + andAll(conds)) } });
      const flt = last, custom = (cfg.src.dest || '').trim().replace(/^\/+|\/+$/g, '');
      const raw = custom ? pathExpr(custom, n) : pathExpr(std.rawPath, n) + '/@{pipeline().RunId}', arch = pathExpr(std.archivePath, n), quar = pathExpr(std.quarantinePath, n);
      const here = () => rSrc.ref({ container: lc, folder: landing, file: X('@item().name') });
      const bcp = (name, after, toFolder) => ({ name, type: 'Copy', dependsOn: after, policy: policy(true), userProperties: [], typeProperties: { source: fileSource(rSrc), sink: fileSink(rDst), enableStaging: false }, inputs: [here()], outputs: [rDst.ref({ container, folder: ex(toFolder), file: X('@item().name') })] });
      const del = (name, after) => ({ name, type: 'Delete', dependsOn: after, policy: policy(true), userProperties: [], typeProperties: { dataset: here(), enableLogging: false, storeSettings: read } });
      const toName = 'cp_file_to_' + (custom ? snake(custom.split('/')[0].replace(/\{.*$/, '')) || 'destination' : 'raw');
      let inner;
      if (mode === 'archive') {
        variables.v_quarantined = { type: 'Array' };
        inner = [bcp(toName, [], raw), bcp('cp_file_to_archive', dep(toName), arch), del('del_landed_file', dep('cp_file_to_archive')),
          bcp('cp_file_to_quarantine', dep(toName, 'Failed'), quar), del('del_quarantined_file', dep('cp_file_to_quarantine')),
          { name: 'av_quarantined_file', type: 'AppendVariable', dependsOn: dep('cp_file_to_quarantine'), userProperties: [], typeProperties: { variableName: 'v_quarantined', value: X('@item().name') } }];
      } else inner = [bcp(toName, [], raw)].concat(mode === 'delete' ? [del('del_copied_file', dep(toName))] : []);
      push({ name: 'fe_' + (mode === 'archive' ? 'land' : 'copy') + '_files', type: 'ForEach', dependsOn: dep(flt), userProperties: [], typeProperties: { items: X("@activity('" + flt + "').output.value"), isSequential: false, batchCount: 4, activities: inner } });
      rowsRead = "@activity('" + flt + "').output.FilteredItemsCount"; rowsWritten = mode === 'archive' ? "@sub(activity('" + flt + "').output.FilteredItemsCount, length(variables('v_quarantined')))" : rowsRead;
      nbPath = 'abfss://' + container + '@' + storage + '.dfs.core.windows.net/' + raw;
      n.fileMode = mode; n.destFolder = raw;
      }
    }

    /* notebooks */
    const nbs = cfg.notebooks.split('\n').map(s => s.trim()).filter(Boolean);
    if (nbs.length) {
      const nbLs = cfg.nbLs.trim() || ph('LS_DATABRICKS'), chain = []; let prev = null;
      nbs.forEach(p => {
        const base = snake(p.split('/').pop()) || 'notebook', name = (/^nb_/.test(base) ? '' : 'nb_') + base;
        const bp = { batch_id: X('@pipeline().RunId') };
        if (/bronze/i.test(p) && nbPath) bp.source_path = /@\{/.test(nbPath) ? X(nbPath) : nbPath;
        chain.push({ name, type: 'DatabricksNotebook', dependsOn: prev ? dep(prev) : [], policy: policy(false), userProperties: [], typeProperties: { notebookPath: p, baseParameters: bp }, linkedServiceName: lsRef(nbLs) });
        prev = name;
      });
      if (files) push({ name: 'if_files_landed', type: 'IfCondition', dependsOn: dep(last), userProperties: [], typeProperties: { expression: X('@greater(' + (n.wild ? 'coalesce(' + rowsWritten.slice(1) + ', 0)' : rowsWritten.slice(1)) + ', 0)'), ifTrueActivities: chain } });
      else { chain[0].dependsOn = dep(last); chain.forEach(push); }
    }
    if (inc) push(sp('sp_update_watermark', ctl + '.' + q('usp_update_watermark'), { table_name: P(n.wmKey), watermark_value: P(winEnd) }, dep(last)));

    /* log, failure path: by the user's own method, or the page's procedure */
    const lg = Object.assign({ method: 'sp_new', proc: '', nbPath: '', nbLs: '', params: [] }, std.log || {}), method = A.LOG_METHODS.some(m => m[0] === lg.method) ? lg.method : 'sp_new';
    const srcObj = files ? (cfg.src.folder.trim() || (n.ownSrc ? n.ownSrc.name : '')) : (cfg.src.schema || 'dbo') + '.' + (cfg.src.table || ph('TABLE'));
    const tgtObj = files ? (n.destFolder || '') : sql ? (cfg.tgt.schema || 'dbo') + '.' + (cfg.tgt.table || ph('TARGET_TABLE')) : pathExpr(std.rawPath, n);
    const logValue = (use, ok, err, fixed) => ({ pipeline: ['@pipeline().Pipeline'], run: ['@pipeline().RunId'], status: [ok ? 'Succeeded' : 'Failed'], rows_read: [ok ? rowsRead : '0', 1], rows_written: [ok ? rowsWritten : '0', 1],
      win_start: [ok ? winStart : ''], win_end: [ok ? winEnd : ''], error: [ok ? String(fixed || '') : (err || '')], duration: [''], obj_id: [''], obj_name: [''], file: [''], layer: [''], variable: ['@string(variables(\'' + (String(fixed || '').trim() || 'NAME') + '\'))'], global: ['@pipeline().globalParameters.' + (String(fixed || '').trim() || 'NAME')], expr: [String(fixed || '').trim() ? (/^@/.test(String(fixed).trim()) ? String(fixed).trim() : '@' + String(fixed).trim()) : ''], factory: ['@pipeline().DataFactory'], trig_time: ['@pipeline().TriggerTime'], trig_name: ['@pipeline().TriggerName'], source: [srcObj], target: [tgtObj], fixed: [String(fixed || '')], step: ['@' + A.stepExpr(fixed, false)] }[use] || ['']);
    const logAct = (ok, err, after) => {
      const tag = ok ? 'success' : 'failure';
      if (method === 'none') return null;
      if (method === 'sp_new') return sp('sp_log_' + tag, ctl + '.' + q('usp_log_pipeline_run'), { pipeline_name: P('@pipeline().Pipeline'), run_id: P('@pipeline().RunId'), status: P(ok ? 'Succeeded' : 'Failed'), rows_read: P(ok ? rowsRead : '0', 'Int64'), rows_written: P(ok ? rowsWritten : '0', 'Int64'),
        window_start: P(ok ? winStart : ''), window_end: P(ok ? winEnd : ''), error_message: P(err || '') }, after);
      const rows = (Array.isArray(lg.params) ? lg.params : []).filter(r => r && String(r.name || '').trim());
      if (method === 'sp_own') { const ps = {}; rows.forEach(r => { const v = logValue(r.use, ok, err, r.value); const num = r.use === 'step' && A.STEP_NUMERIC.test(String(r.value || '').split('|')[1] || ''); ps[String(r.name).trim().replace(/^@/, '')] = num ? P('@' + A.stepExpr(r.value, true), 'Int64') : P(v[0], v[1] ? 'Int64' : 'String'); }); return sp('sp_log_' + tag, String(lg.proc || '').trim() || ph('LOG_PROCEDURE'), ps, after); }
      const bp = {}; rows.forEach(r => { const v = logValue(r.use, ok, err, r.value), s = String(v[0]); bp[String(r.name).trim()] = /^@/.test(s) ? X(v[1] ? '@string(' + s.slice(1) + ')' : s) : (/@\{/.test(s) ? X(s) : s); });
      return { name: 'nb_log_' + tag, type: 'DatabricksNotebook', dependsOn: after, policy: policy(false), userProperties: [], typeProperties: { notebookPath: String(lg.nbPath || '').trim() || ph('LOG_NOTEBOOK_PATH'), baseParameters: bp }, linkedServiceName: lsRef(String(lg.nbLs || '').trim() || cfg.nbLs.trim() || ph('LS_DATABRICKS')) };
    };
    const okLog = logAct(true, '', last ? dep(last) : []); if (okLog) push(okLog);
    if (files && variables.v_quarantined) push({ name: 'if_any_quarantined', type: 'IfCondition', dependsOn: dep(last), userProperties: [], typeProperties: { expression: X("@greater(length(variables('v_quarantined')), 0)"),
      ifTrueActivities: [{ name: 'fail_files_quarantined', type: 'Fail', dependsOn: [], userProperties: [], typeProperties: { message: X("@concat(string(length(variables('v_quarantined'))), ' file(s) could not be landed and were moved to quarantine: ', join(variables('v_quarantined'), ', '))"), errorCode: 'FILES_QUARANTINED' } }] } });
    const errExpr = '@coalesce(' + mainNames.map(a => "activity('" + a + "')?.error?.message").join(', ') + ", 'See the failed activity in Monitor')";
    /* the failure path starts from the last main activity (Failed or Skipped); a Fail activity ends it so the run still shows Failed */
    let tail = null; const hook = () => (tail ? dep(tail, 'Completed') : dep(last, ['Failed', 'Skipped']));
    const badLog = logAct(false, errExpr, hook()); if (badLog) { acts.push(badLog); tail = badLog.name; }
    if (cfg.alert === 'web') {
      acts.push({ name: 'web_alert_failure', type: 'WebActivity', dependsOn: hook(), policy: Object.assign(policy(false), { retry: 1 }), userProperties: [], typeProperties: { url: X('@pipeline().globalParameters.' + std.alertParam), method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: X('{"title":"Pipeline failed","pipeline":"@{pipeline().Pipeline}","runId":"@{pipeline().RunId}","dataFactory":"@{pipeline().DataFactory}","message":"Open the run in Monitor for the error."}') } });
      tail = 'web_alert_failure';
    }
    if (tail) acts.push({ name: 'fail_pipeline', type: 'Fail', dependsOn: dep(tail, 'Completed'), userProperties: [], typeProperties: { message: X("@concat('Pipeline ', pipeline().Pipeline, ' failed. Run ', pipeline().RunId)"), errorCode: 'PIPELINE_FAILED' } });
    n.logMethod = method; n.noHandler = !tail;

    A.addUserVars(variables, cfg);
    const pipeline = { name: n.pipeline, properties: { description: (cfg.goal || '').trim().slice(0, 400) || undefined, activities: acts, parameters: params, variables, annotations: [] } };
    if (!pipeline.properties.description) delete pipeline.properties.description;
    if (!Object.keys(variables).length) delete pipeline.properties.variables;
    if (!Object.keys(params).length) delete pipeline.properties.parameters;

    /* trigger */
    let trigger = null;
    if (cfg.sched.freq !== 'none') {
      const hm = /^(\d{1,2}):(\d{2})$/.exec(cfg.sched.time) || [0, '2', '00'], d = today || new Date().toISOString().slice(0, 10);
      const rec = { frequency: cfg.sched.freq === 'hourly' ? 'Hour' : 'Day', interval: 1, startTime: d + 'T' + String(hm[1]).padStart(2, '0') + ':' + hm[2] + ':00', timeZone: cfg.sched.tz || 'UTC' };
      if (cfg.sched.freq === 'daily') rec.schedule = { hours: [Number(hm[1])], minutes: [Number(hm[2])] };
      trigger = { name: n.trigger, properties: { annotations: [], runtimeState: 'Stopped', pipelines: [{ pipelineReference: { referenceName: n.pipeline, type: 'PipelineReference' } }], type: 'ScheduleTrigger', typeProperties: { recurrence: rec } } };
    }

    const sqlText = A.buildSql({ cfg, std, n, cols, write, staged, inc, dt, wm, files, sql, tgtT, stgT, wmT, logT, logNew: method === 'sp_new' });
    const out = { names: n, pipeline, datasets, reused, trigger, sql: sqlText, write, staged, cols, notes };
    out.json = JSON.stringify(pipeline, null, 4);
    out.needsSql = !/^-- No supporting SQL/.test(sqlText);
    out.placeholders = A.placeholders(out.json + '\n' + JSON.stringify(datasets) + '\n' + sqlText);
    out.steps = A.buildSteps(out, cfg, std);
    out.objects = A.objects(out, cfg, std);
    return out;
  };

  /* the user's own pipeline variables: typed defaults, never expressions */
  A.VAR_TYPES = [['String', 'Text'], ['Integer', 'Whole number'], ['Boolean', 'True / false'], ['Array', 'List']];
  A.userVars = cfg => (Array.isArray(cfg.vars) ? cfg.vars : []).filter(v => v && /^[A-Za-z_]\w*$/.test(String(v.name || '').trim()));
  A.addUserVars = function (variables, cfg) {
    A.userVars(cfg).forEach(v => {
      const name = v.name.trim(), type = A.VAR_TYPES.some(t => t[0] === v.type) ? v.type : 'String', raw = String(v.value == null ? '' : v.value).trim(), d = { type };
      if (raw !== '') {
        if (type === 'Integer') { const n = parseInt(raw, 10); if (!isNaN(n)) d.defaultValue = n; }
        else if (type === 'Boolean') d.defaultValue = /^(true|yes|1)$/i.test(raw);
        else if (type === 'Array') { try { const a = JSON.parse(raw); d.defaultValue = Array.isArray(a) ? a : raw.split(',').map(s => s.trim()); } catch (e) { d.defaultValue = raw.split(',').map(s => s.trim()).filter(Boolean); } }
        else d.defaultValue = raw;
      }
      variables[name] = d;      // the user's own definition wins over one the page made from a path
    });
    return variables;
  };
  A.varProblems = function (cfg) {
    const R = [], names = A.userVars(cfg).map(v => v.name.trim());
    (Array.isArray(cfg.vars) ? cfg.vars : []).forEach((v, i) => { const n = String(v && v.name || '').trim(); if (!n) { if (String(v && v.value || '').trim()) R.push({ sev: 'err', msg: 'Pipeline variable ' + (i + 1) + ' has a default but no name.' }); } else if (!/^[A-Za-z_]\w*$/.test(n)) R.push({ sev: 'err', msg: 'The variable name \u201C' + n + '\u201D can only have letters, digits and underscores, starting with a letter.' }); });
    names.filter((x, i) => names.indexOf(x) !== i).forEach(x => R.push({ sev: 'err', msg: 'Two pipeline variables are named ' + x + '.' }));
    A.userVars(cfg).forEach(v => { if (/^@(?!@)/.test(String(v.value || '').trim())) R.push({ sev: 'err', msg: 'The variable ' + v.name.trim() + ' has a default that starts with @. ADF never evaluates a default, so it would hold that text. Leave the default empty and set it with a Set Variable activity, or type the plain value.' }); if (v.type === 'Integer' && String(v.value || '').trim() && isNaN(parseInt(v.value, 10))) R.push({ sev: 'err', msg: 'The variable ' + v.name.trim() + ' is a whole number, but its default \u201C' + v.value + '\u201D isn\u2019t one.' }); });
    /* everything that names a variable must find it */
    const known = new Set(names), used = [];
    const scan = (where, s) => { (String(s || '').match(/\{var:([^}]*)\}/g) || []).forEach(t => used.push([where, t.slice(5, -1).trim()])); };
    const med = cfg.med || {};
    [['the folder the files arrive in', cfg.src && cfg.src.folder], ['the bronze folder', med.bronzeFolder], ['the bronze file name', med.bronzeFile], ['the archive folder', med.archiveFolder], ['the archive file name', med.archiveFile]].forEach(([w, s]) => scan(w, s));
    (med.stages || []).forEach(s => scan('the ' + (s.label || 'layer') + ' folder', s.path));
    const rowsWith = (where, rows) => (rows || []).forEach(r => { if (r && r.use === 'variable') used.push([where, String(r.value || '').trim()]); else if (r && /^(text|fixed)$/.test(r.use)) scan(where, r.value); });
    rowsWith('the bronze notebook', (med.bronzeNb || {}).params); (med.stages || []).forEach(s => rowsWith('the ' + (s.label || 'layer') + ' notebook', s.params));
    Object.keys(cfg.ds || {}).forEach(k => { const m = (cfg.ds[k] || {}).map || {}; Object.keys(m).forEach(p => { if (m[p] && m[p].use === 'variable' && cfg.ds[k].mode === 'own') used.push(['dataset parameter ' + p, String(m[p].value || '').trim()]); }); });
    used.forEach(([w, n]) => { if (!n) R.push({ sev: 'err', msg: 'A pipeline variable is used in ' + w + ' without a name.' }); else if (!known.has(n) && !A.AUTO_VARS.has(n)) R.push({ sev: 'err', msg: w.charAt(0).toUpperCase() + w.slice(1) + ' uses the variable ' + n + ', which isn\u2019t defined. Add it under Pipeline variables.' }); });
    return R;
  };
  A.AUTO_VARS = new Set(['container', 'landing_path', 'bronze_path', 'archive_path', 'object_name']);
  A.placeholders = text => Array.from(new Set(String(text).match(/<[A-Z][A-Z0-9_]{2,}>/g) || []));

  /* ---------- supporting SQL ---------- */
  A.buildSql = function (o) {
    const { cfg, std, n, cols, write, staged, inc, dt, wm, files, sql, tgtT, stgT, wmT, logT, logNew } = o;
    if (!logNew && !inc && (!sql || files)) return '-- No supporting SQL is needed for this pipeline.\n';
    const synapse = sql && cfg.tgt.system === 'synapse' && n.ctlLs === n.tgtLs;
    const L = [], ctl = q(std.ctlSchema), GO = 'GO';
    const proc = (name, body) => synapse
      ? ["IF OBJECT_ID('" + name.replace(/'/g, "''") + "', 'P') IS NOT NULL DROP PROCEDURE " + name + ';', GO, 'CREATE PROCEDURE ' + name].concat(body, GO)
      : ['CREATE OR ALTER PROCEDURE ' + name].concat(body, GO);
    const schema = s => ["IF SCHEMA_ID('" + s + "') IS NULL EXEC('CREATE SCHEMA " + q(s) + "');", GO];
    L.push('/* Supporting SQL for ' + n.pipeline + '. Safe to run more than once.', '   Run it in the ' + (sql ? 'target' : 'control') + ' database (linked service ' + n.ctlLs + ')' + (sql && n.ctlLs !== n.tgtLs ? '; the table and merge scripts at the end go in the target database (' + n.tgtLs + ')' : '') + '. */', '');
    if (logNew || inc || staged) { L.push.apply(L, schema(std.ctlSchema)); L.push(''); }
    if (logNew) {
    L.push("IF OBJECT_ID('" + std.ctlSchema + '.' + std.logTable + "', 'U') IS NULL", 'CREATE TABLE ' + logT + ' (', '    log_id         bigint IDENTITY(1,1) NOT NULL,', '    pipeline_name  nvarchar(200)  NOT NULL,', '    run_id         nvarchar(100)  NOT NULL,',
      '    status         nvarchar(20)   NOT NULL,', '    rows_read      bigint         NULL,', '    rows_written   bigint         NULL,', '    window_start   nvarchar(50)   NULL,', '    window_end     nvarchar(50)   NULL,',
      '    error_message  nvarchar(4000) NULL,', '    logged_at_utc  datetime2(3)   NOT NULL DEFAULT SYSUTCDATETIME()', ');', GO, '');
    L.push.apply(L, proc(ctl + '.' + q('usp_log_pipeline_run'), ['    @pipeline_name nvarchar(200), @run_id nvarchar(100), @status nvarchar(20),', '    @rows_read bigint = NULL, @rows_written bigint = NULL,', '    @window_start nvarchar(50) = NULL, @window_end nvarchar(50) = NULL, @error_message nvarchar(4000) = NULL',
      'AS', 'BEGIN', '    SET NOCOUNT ON;', '    INSERT INTO ' + logT + ' (pipeline_name, run_id, status, rows_read, rows_written, window_start, window_end, error_message)',
      "    VALUES (@pipeline_name, @run_id, @status, @rows_read, @rows_written, NULLIF(@window_start, ''), NULLIF(@window_end, ''), NULLIF(LEFT(@error_message, 4000), ''));", 'END'])); L.push('');
    }
    if (inc) {
      const floor = dt ? '1900-01-01T00:00:00' : '0';
      L.push('-- One row per source table. The value is text: an ISO date and time, or a number.',
        "IF OBJECT_ID('" + std.ctlSchema + '.' + std.wmTable + "', 'U') IS NULL", 'CREATE TABLE ' + wmT + ' (', '    table_name       nvarchar(300) NOT NULL PRIMARY KEY,', '    watermark_value  varchar(50)   NOT NULL,', '    updated_at_utc   datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME()', ');', GO, '',
        '-- First run: start from the beginning. The pipeline fails on its first Lookup if this row is missing.',
        'IF NOT EXISTS (SELECT 1 FROM ' + wmT + ' WHERE table_name = ' + sq(n.wmKey) + ')', '    INSERT INTO ' + wmT + ' (table_name, watermark_value) VALUES (' + sq(n.wmKey) + ', ' + sq(floor) + ');', GO, '');
      L.push.apply(L, proc(ctl + '.' + q('usp_update_watermark'), ['    @table_name nvarchar(300), @watermark_value varchar(50)', 'AS', 'BEGIN', '    SET NOCOUNT ON;',
        '    UPDATE ' + wmT + ' SET watermark_value = @watermark_value, updated_at_utc = SYSUTCDATETIME() WHERE table_name = @table_name;',
        '    IF @@ROWCOUNT = 0', '        INSERT INTO ' + wmT + ' (table_name, watermark_value) VALUES (@table_name, @watermark_value);', 'END'])); L.push('');
    }
    if (!sql || files) return L.join('\n').trim() + '\n';
    if (!cols.length) { L.push('-- No columns were read from the source, so the table and merge scripts can’t be written.', '-- Paste the schema query results in Step 1 to get them.'); return L.join('\n').trim() + '\n'; }
    const keys = cfg.load.keys.map(k => (cols.find(c => c.name.toLowerCase() === k.toLowerCase()) || { name: k }).name);
    const isKey = c => keys.some(k => k.toLowerCase() === c.name.toLowerCase());
    const pad = Math.max.apply(null, cols.map(c => q(c.name).length).concat([12]));
    const colLine = (c, forceNull) => '    ' + q(c.name).padEnd(pad) + ' ' + c.type + (!forceNull && (isKey(c) || c.nullable === false) ? ' NOT NULL' : ' NULL');
    const table = (full, name2, extra, forceNull) => ["IF OBJECT_ID('" + full.replace(/[\[\]]/g, '').replace(/'/g, "''") + "', 'U') IS NULL", 'CREATE TABLE ' + full + ' ('].concat(cols.map(c => colLine(c, forceNull)).concat(extra || []).join(',\n').split('\n'), [');', GO, '']);
    if (n.ctlLs !== n.tgtLs) L.push('/* ---- From here on: run in the target database (' + n.tgtLs + ') ---- */', '');
    if (cfg.tgt.schema && !/^dbo$/i.test(cfg.tgt.schema)) { L.push.apply(L, schema(cfg.tgt.schema)); L.push(''); }
    const scd = write === 'scd2';
    L.push('-- Target table. Skipped if it already exists: compare the columns if it does.');
    L.push.apply(L, table(tgtT, cfg.tgt.table, scd ? ['    ' + q('valid_from').padEnd(pad) + ' datetime2(7) NOT NULL', '    ' + q('valid_to').padEnd(pad) + ' datetime2(7) NULL', '    ' + q('is_current').padEnd(pad) + ' bit NOT NULL'] : []));
    if (!staged) return L.join('\n').trim() + '\n';
    L.push.apply(L, schema(std.stgSchema)); L.push('');
    L.push('-- Staging table: emptied by the Copy activity before each load.');
    L.push.apply(L, table(stgT, n.stgTable, [], true));
    const wmc = wm ? (cols.find(c => c.name.toLowerCase() === wm.toLowerCase()) || {}).name : '';
    const order = wmc ? q(wmc) + ' DESC' : '(SELECT NULL)';
    const list = (pfx, cs) => cs.map(c => (pfx ? pfx + '.' : '') + q(c.name)).join(', ');
    const on = keys.map(k => 't.' + q(k) + ' = s.' + q(k)).join(' AND ');
    const part = keys.map(q).join(', ');
    const nonKey = cols.filter(c => !isKey(c));
    if (!scd) {
      const body = ['AS', 'BEGIN', '    SET NOCOUNT ON; SET XACT_ABORT ON;', '',
        '    -- One row per key from staging' + (wmc ? ': the latest by ' + q(wmc) : '') + ', so a key that arrives twice can’t break the merge.',
        '    MERGE ' + tgtT + ' AS t', '    USING (', '        SELECT ' + list('', cols), '        FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY ' + part + ' ORDER BY ' + order + ') AS rn FROM ' + stgT + ') d', '        WHERE d.rn = 1', '    ) AS s', '       ON ' + on];
      if (nonKey.length) body.push('    WHEN MATCHED' + (wmc ? ' AND (s.' + q(wmc) + ' >= t.' + q(wmc) + ' OR t.' + q(wmc) + ' IS NULL)' : '') + ' THEN', '        UPDATE SET ' + nonKey.map(c => 't.' + q(c.name) + ' = s.' + q(c.name)).join(',\n                   '));
      body.push('    WHEN NOT MATCHED BY TARGET THEN', '        INSERT (' + list('', cols) + ')', '        VALUES (' + list('s', cols) + ');', 'END');
      L.push('-- Merge: updates rows that changed' + (wmc ? ' (an older version never overwrites a newer one)' : '') + ', inserts new ones. Rerunning the same staging rows changes nothing.');
      L.push.apply(L, proc(q(std.ctlSchema) + '.' + q(n.mergeProc), body));
    } else {
      const tracked = nonKey.filter(c => c.name !== wmc), eff = wmc && dt ? 's.' + q(wmc) : '@now';
      L.push('-- SCD Type 2: a changed row closes the current version and opens a new one. Rerunning the same staging rows changes nothing.');
      L.push.apply(L, proc(q(std.ctlSchema) + '.' + q(n.scdProc), ['AS', 'BEGIN', '    SET NOCOUNT ON; SET XACT_ABORT ON;', '    DECLARE @now datetime2(7) = SYSUTCDATETIME();', '',
        '    SELECT ' + list('', cols), '    INTO #src', '    FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY ' + part + ' ORDER BY ' + order + ') AS rn FROM ' + stgT + ') d', '    WHERE d.rn = 1;', '',
        '    BEGIN TRANSACTION;', '', '    -- 1. Close the current version of every key whose tracked columns changed',
        '    UPDATE t', '       SET t.[valid_to] = ' + eff + ', t.[is_current] = 0', '      FROM ' + tgtT + ' AS t', '      JOIN #src AS s ON ' + on, '     WHERE t.[is_current] = 1' + (wmc && dt ? ' AND s.' + q(wmc) + ' > t.[valid_from]   -- a late, older version never closes a newer one' : ''),
        '       AND EXISTS (SELECT ' + (tracked.length ? list('s', tracked) : '1') + ' EXCEPT SELECT ' + (tracked.length ? list('t', tracked) : '1') + ');', '',
        '    -- 2. Open a version for every key with no current row (new keys, and the ones just closed)',
        '    INSERT INTO ' + tgtT + ' (' + list('', cols) + ', [valid_from], [valid_to], [is_current])', '    SELECT ' + list('s', cols) + ', ' + eff + ', NULL, 1', '      FROM #src AS s',
        '     WHERE NOT EXISTS (SELECT 1 FROM ' + tgtT + ' AS t WHERE ' + on + ' AND t.[is_current] = 1);', '', '    COMMIT TRANSACTION;', 'END']));
    }
    return L.join('\n').trim() + '\n';
  };

  /* ---------- objects table and build steps ---------- */
  A.objects = function (o, cfg, std) {
    const n = o.names, R = [], add = (type, name, state, purpose) => R.push({ type, name, state, purpose });
    add('Linked service', n.srcLs, 'Reuse', n.files ? 'The storage account files land in' : 'Source ' + (A.SYSTEMS[cfg.src.system] || {}).label);
    if (cfg.src.ir.trim()) add('Integration runtime', cfg.src.ir.trim(), 'Reuse', 'Self-hosted runtime the source linked service connects through');
    if (!n.files && n.tgtLs !== n.srcLs) add('Linked service', n.tgtLs, 'Reuse', n.sql ? 'Target database' : 'Data lake');
    if (n.ctlLs !== n.tgtLs && (n.inc || ((!n.sql || n.files) && /^sp_/.test(n.logMethod)))) add('Linked service', n.ctlLs, 'Reuse', 'Control database (watermark and log tables)');
    o.reused.forEach(d => add('Dataset', d.name, 'Reuse', 'Yours, used as it is (' + d.type + ')'));
    o.datasets.forEach(d => add('Dataset', d.name, 'New', d.properties.type + ', parameterized, on ' + d.properties.linkedServiceName.referenceName));
    const lm = n.logMethod, lg = std.log || {};
    if (lm === 'sp_new') add('Table', std.ctlSchema + '.' + std.logTable, 'New', 'One row per pipeline run');
    if (n.inc) add('Table', std.ctlSchema + '.' + std.wmTable, 'New', 'Last value loaded per source table');
    if (o.staged) add('Table', std.stgSchema + '.' + n.stgTable, 'New', 'Staging, emptied before each load');
    if (n.sql) add('Table', (cfg.tgt.schema || 'dbo') + '.' + (cfg.tgt.table || ph('TARGET_TABLE')), 'New or reuse', 'Target');
    if (lm === 'sp_new') add('Stored procedure', std.ctlSchema + '.usp_log_pipeline_run', 'New', 'Writes the run log');
    if (lm === 'sp_own') add('Stored procedure', String(lg.proc || '').trim() || ph('LOG_PROCEDURE'), 'Reuse', 'Your logging procedure');
    if (lm === 'notebook') add('Notebook', String(lg.nbPath || '').trim() || ph('LOG_NOTEBOOK_PATH'), 'Reuse', 'Your logging notebook');
    if (n.inc) add('Stored procedure', std.ctlSchema + '.usp_update_watermark', 'New', 'Moves the watermark after a successful load');
    if (o.staged) add('Stored procedure', std.ctlSchema + '.' + (o.write === 'merge' ? n.mergeProc : n.scdProc), 'New', o.write === 'merge' ? 'Merges staging into the target' : 'Applies SCD Type 2 from staging');
    if (cfg.alert === 'web') add('Global parameter', std.alertParam, 'Reuse or new', 'URL the failure alert is posted to (a Logic App or Teams workflow)');
    add('Pipeline', n.pipeline, 'New', '');
    if (o.trigger) add('Trigger', o.trigger.name, 'New', 'Created stopped; start it after testing');
    return R;
  };
  A.buildSteps = function (o, cfg, std) {
    const n = o.names, L = [], sec = t => { if (L.length) L.push(''); L.push(t); };
    sec('PART A - Supporting SQL');
    if (!o.needsSql) L.push('Nothing to run: this pipeline needs no tables or procedures from the page.'); else
    L.push('1. Open the ' + (n.sql ? 'target' : 'control') + ' database in SSMS or the Azure portal query editor.', '2. Run the Supporting SQL script. It creates ' + (n.logMethod === 'sp_new' ? ['the log table'] : []).concat(n.inc ? ['the watermark table with its first row'] : [], o.staged ? ['the staging table'] : [], n.sql ? ['the target table if it is missing'] : []).join(', ') + ' and the stored procedures. It can be run again safely.',
      '3. If the target table already exists, the script leaves it alone: compare its columns with the script’s.');
    sec('PART B - Datasets');
    o.datasets.forEach((d, i) => L.push((i + 1) + '. Author > Datasets > New dataset. Choose ' + ({ SqlServerTable: 'SQL Server', AzureSqlTable: 'Azure SQL Database', AzureSqlDWTable: 'Azure Synapse Analytics', Parquet: 'Azure Data Lake Storage Gen2, then Parquet', Binary: 'Azure Data Lake Storage Gen2, then Binary' }[d.properties.type]) + ', name it ' + d.name + ', pick linked service ' + d.properties.linkedServiceName.referenceName + ' and select OK without choosing a table or file. Then select the code view button {} and replace everything with the JSON for ' + d.name + '.'));
    o.reused.forEach(d => L.push((o.datasets.length ? '   ' : '') + 'Your dataset ' + d.name + ' is used as it is' + (d.params.length ? ', with ' + d.params.map(k => k + ' = ' + ({ none: 'empty', fixed: 'fixed text' }[d.map[k].use] || d.map[k].use)).join(', ') : ' (it has no parameters)') + '. Nothing to create.'));
    if (o.datasets.length) L.push((o.datasets.length + 1) + '. Skip a dataset that already exists with the same name and parameters.');
    sec('PART C - Pipeline');
    L.push('1. Author > Pipelines > New pipeline. Select the code view button {} at the top right.', '2. Replace everything with the Pipeline JSON and select OK. The pipeline takes its name, ' + n.pipeline + ', from the JSON.',
      '3. Select Validate. Fix anything it flags: usually a linked service or dataset name that doesn’t exist in this factory.');
    let i = 4;
    if (cfg.alert === 'web') L.push((i++) + '. Manage > Global parameters: add ' + std.alertParam + ' (String) with the URL that receives the failure alert, if it isn’t there yet.');
    if (cfg.src.onprem) L.push((i++) + '. Manage > Linked services > ' + n.srcLs + ': confirm Connect via integration runtime is ' + (cfg.src.ir.trim() || 'your self-hosted runtime') + '.');
    if (n.sql && cfg.tgt.system === 'synapse') L.push((i++) + '. On the Copy activity, Settings tab: turn on Enable staging and choose a staging linked service if the source isn’t Azure Blob or ADLS.');
    if (o.placeholders.length) L.push((i++) + '. Replace every placeholder: ' + o.placeholders.join(', ') + '.');
    sec('PART D - Trigger');
    if (o.trigger) L.push('1. In the pipeline, Add trigger > New/Edit > New. Or Manage > Triggers > New, open its code view {} and paste the Trigger JSON.', '2. It is created stopped. Start it only after the test plan passes, then Publish all.');
    else L.push('No schedule was asked for. Run it with Add trigger > Trigger now, or from another pipeline with Execute Pipeline.');
    sec('PART E - Test plan');
    const T = [];
    if (n.files) T.push('Put two small files in the source folder and select Debug. Both should appear in the destination folder' + (n.fileMode === 'archive' ? ', then in archive, and the source folder should be empty.' : n.fileMode === 'delete' ? ', and the source folder should be empty.' : '; the originals stay where they are.'), 'Run it again with ' + (n.fileMode === 'leave' ? 'the same files: check what you expect to happen to files copied before (each run copies every matching file again).' : 'an empty source folder: it should succeed with 0 files.'));
    else {
      T.push('Select Debug' + (n.inc ? ' with p_full_reload = false. The first run loads everything after the seeded watermark; for a large table, set the watermark row to a recent value first to load a small window.' : '.'));
      T.push('Compare counts: rows read and written (' + (n.logMethod === 'sp_new' ? 'in ' + std.ctlSchema + '.' + std.logTable : 'the Copy activity\u2019s output in the debug run') + ') against SELECT COUNT(*) on the source for the same window' + (n.sql ? ', and against the ' + (o.staged ? 'staging' : 'target') + ' table.' : '.'));
      if (n.inc) T.push('Check the watermark moved: SELECT * FROM ' + std.ctlSchema + '.' + std.wmTable + ' WHERE table_name = ' + sq(n.wmKey) + ';');
      if (n.inc) T.push('Force a failure (' + (cfg.tgt.kind === 'adls' ? 'for one run, change the table name in the Copy source query to one that doesn\u2019t exist' : 'rename the ' + (o.staged ? 'staging' : 'target') + ' table for one run') + ') and confirm the watermark did not move.');
      if (o.staged) T.push('Run the same window twice (set the watermark row back to its earlier value): the target row count must not change.');
    }
    if (n.noHandler) T.push((n.inc && !n.files ? 'That failed run' : 'Force a failure (for example a wrong folder) and confirm it') + ' shows Failed in Monitor. Nothing logs or alerts: you chose no logging and no alert.'); else
    T.push('Failure path: after the forced failure, confirm ' + [n.logMethod !== 'none' ? 'a Failed entry in your log' : '', cfg.alert === 'web' ? 'the alert arriving' : ''].filter(Boolean).join(', ') + ' and the pipeline run showing Failed in Monitor.');
    if (o.trigger) T.push('Check the trigger time and time zone (' + (cfg.sched.tz || 'UTC') + '), including across a daylight saving change.');
    T.forEach((t, k) => L.push((k + 1) + '. ' + t));
    return L.join('\n');
  };

  /* ---------- reading any pipeline JSON: flow table and checks ---------- */
  const CONTAINERS = { ForEach: ['activities'], Until: ['activities'], IfCondition: ['ifTrueActivities', 'ifFalseActivities'], Switch: ['defaultActivities'] };
  A.flatten = function (pipeline) {
    const out = [];
    const walk = (raw, parent, branch, depth) => {
      const list = (Array.isArray(raw) ? raw : []).filter(a => a && typeof a === 'object' && !Array.isArray(a));
      list.forEach(a => {                      // pasted JSON can hold anything: settle the shapes the checks rely on
        a.name = String(a.name == null ? '' : a.name); a.type = String(a.type == null ? '' : a.type);
        a.dependsOn = (Array.isArray(a.dependsOn) ? a.dependsOn : []).filter(d => d && typeof d === 'object').map(d => ({ activity: String(d.activity == null ? '' : d.activity), dependencyConditions: (Array.isArray(d.dependencyConditions) ? d.dependencyConditions : []).map(String) }));
        if (!a.typeProperties || typeof a.typeProperties !== 'object' || Array.isArray(a.typeProperties)) a.typeProperties = {};
        if (a.policy != null && typeof a.policy !== 'object') a.policy = {};
      });
      list.forEach(a => {
      out.push({ a, name: a.name, type: a.type, parent, branch, depth, siblings: list });
      const tp = a.typeProperties;
      (CONTAINERS[a.type] || []).forEach(k => walk(tp[k], a, k, depth + 1));
      if (a.type === 'Switch') (Array.isArray(tp.cases) ? tp.cases : []).forEach(c => { if (c && typeof c === 'object') walk(c.activities, a, 'case ' + c.value, depth + 1); });
      });
    };
    walk((pipeline && pipeline.properties && pipeline.properties.activities) || [], null, '', 0);
    return out;
  };
  A.readPipeline = function (text) {
    let t = String(text || '').trim();
    if (!t) return { empty: true };
    t = t.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').replace(/[“”]/g, '"');
    const i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i < 0 || j < i) return { error: 'This isn’t JSON: no { } found. Copy the pipeline from the code view {} in ADF Studio.' };
    let obj;
    try { obj = JSON.parse(t.slice(i, j + 1)); } catch (e) { return { error: 'The JSON can’t be read: ' + e.message + '. Copy it again from the code view; a partial copy is the usual cause.' }; }
    if (obj && !obj.properties && Array.isArray(obj.activities)) obj = { name: obj.name || '', properties: obj };
    if (!obj || !obj.properties || !Array.isArray(obj.properties.activities)) return { error: 'This JSON has no properties.activities list, so it isn’t a pipeline. Datasets, triggers and linked services can’t be checked here.' };
    return { pipeline: obj };
  };
  const strings = (node, cb, key) => { if (typeof node === 'string') cb(node, key); else if (Array.isArray(node)) node.forEach(v => strings(v, cb, key)); else if (node && typeof node === 'object') Object.keys(node).forEach(k => strings(node[k], cb, k)); };
  const PREFIX = { Lookup: 'lkp_', Copy: 'cp_', SqlServerStoredProcedure: 'sp_', GetMetadata: 'gm_', Filter: 'flt_', ForEach: 'fe_', IfCondition: 'if_', WebActivity: 'web_', Fail: 'fail_', DatabricksNotebook: 'nb_', Delete: 'del_', SetVariable: 'sv_', AppendVariable: 'av_', ExecutePipeline: 'ep_', Script: 'scr_', Wait: 'wait_', Until: 'until_', Switch: 'sw_', ExecuteDataFlow: 'df_' };
  A.CHECK_GROUPS = ['Correctness', 'Rerun safety', 'Failure path', 'Dependencies', 'Expressions', 'Structure', 'Secrets', 'Performance', 'Maintainability', 'Standards'];
  A.check = function (pipeline, std, opts) {
    std = Object.assign(A.defaultStandards(), std || {}); opts = opts || {};
    const F = [], add = (sev, rule, msg, activity, fix) => F.push({ sev, rule, msg, activity: activity || '', fix: fix || '' });
    const flat = A.flatten(pipeline), props = pipeline.properties || {};
    ['parameters', 'variables'].forEach(k => { if (!props[k] || typeof props[k] !== 'object') props[k] = {}; });
    pipeline.name = pipeline.name == null ? '' : String(pipeline.name);
    const byName = {}; flat.forEach(f => { (byName[f.name] = byName[f.name] || []).push(f); });
    if (!pipeline.name) add('low', 'Standards', 'The pipeline has no name in the JSON; ADF Studio will ask for one.');
    else if (std.plPrefix && pipeline.name.indexOf(std.plPrefix) !== 0) add('low', 'Standards', 'The pipeline name doesn’t start with ' + std.plPrefix + '.');
    if (!flat.length) add('high', 'Structure', 'The pipeline has no activities.');
    Object.keys(byName).forEach(k => { if (!k) add('high', 'Structure', 'An activity has no name.'); else if (byName[k].length > 1) add('high', 'Structure', 'The activity name ' + k + ' is used ' + byName[k].length + ' times. Names must be unique in a pipeline.', k); });
    /* per scope: dependencies */
    const OKC = ['Succeeded', 'Failed', 'Skipped', 'Completed'];
    const anc = new Map();   // activity object -> set of ancestor names (same scope, then the containers')
    flat.forEach(f => {
      const sib = {}; f.siblings.forEach(s => { sib[s.name] = s; });
      (f.a.dependsOn || []).forEach(d => {
        if (!sib[d.activity]) add('high', 'Dependencies', 'It runs after ' + d.activity + ', which ' + (byName[d.activity] ? 'is in a different container (ForEach or If), so it can’t be depended on from here' : 'doesn’t exist') + '.', f.name);
        (d.dependencyConditions || []).forEach(c => { if (OKC.indexOf(c) < 0) add('high', 'Dependencies', 'Unknown dependency condition “' + c + '”. Use Succeeded, Failed, Skipped or Completed.', f.name); });
        if (!(d.dependencyConditions || []).length) add('high', 'Dependencies', 'The dependency on ' + d.activity + ' has no condition.', f.name);
      });
      if (f.name.length > 55) add('medium', 'Structure', 'The name is longer than 55 characters, the limit for an activity name.', f.name);
      if (/[&:<>\/\\|?*"]|^\s|\s$/.test(f.name)) add('medium', 'Structure', 'The name has a character ADF doesn’t allow in activity names.', f.name);
    });
    const up = (f, seen) => {   // names upstream of f inside its scope
      const sib = {}; f.siblings.forEach(s => { sib[s.name] = s; });
      const go = (a) => (a.dependsOn || []).forEach(d => { if (seen.has(d.activity)) return; seen.add(d.activity); if (sib[d.activity]) go(sib[d.activity]); });
      go(f.a); return seen;
    };
    let cycle = false;
    flat.forEach(f => {
      const s = up(f, new Set()); if (s.has(f.name) && !cycle) { cycle = true; add('high', 'Dependencies', 'The dependencies form a loop through ' + f.name + ', so it can never start.', f.name); }
      let p = f.parent; const all = new Set(s);
      while (p) { const pf = flat.find(x => x.a === p); all.add(pf.name); up(pf, new Set()).forEach(x => all.add(x)); p = pf.parent; }
      anc.set(f.a, all);
    });
    /* nesting rules */
    flat.forEach(f => {
      const chain = []; let p = f.parent; while (p) { chain.push(p.type); p = (flat.find(x => x.a === p) || {}).parent; }
      if ((f.type === 'ForEach' || f.type === 'Until') && chain.some(t => t === 'ForEach' || t === 'Until')) add('high', 'Structure', 'A ' + f.type + ' can’t sit inside another ForEach or Until. Move the inner loop to its own pipeline and call it with Execute Pipeline.', f.name);
      if ((f.type === 'IfCondition' || f.type === 'Switch') && chain.some(t => t === 'IfCondition' || t === 'Switch')) add('high', 'Structure', 'An If Condition or Switch can’t sit inside another one. Move the inner one to its own pipeline.', f.name);
      if (f.type === 'ForEach' && !(f.a.typeProperties || {}).isSequential && (f.a.typeProperties || {}).batchCount == null) add('low', 'Performance', 'The ForEach runs in parallel with no batch count, so ADF uses 20 at a time. Set a batch count the source and target can take.', f.name);
      if (f.type === 'ForEach' && !(f.a.typeProperties || {}).isSequential && flat.some(x => x.parent === f.a && x.type === 'SetVariable')) add('high', 'Correctness', 'Set Variable inside a parallel ForEach: every iteration shares the one variable and they overwrite each other. Make the loop sequential or drop the variable.', f.name);
    });
    /* expressions */
    const pdef = props.parameters || {}, vdef = props.variables || {};
    const secrets = /(AccountKey\s*=|SharedAccessSignature\s*=|[?&]sig=[A-Za-z0-9%]{10,}|password\s*=\s*[^;@\s]{3,}|pwd\s*=\s*[^;@\s]{3,}|client_secret|Bearer\s+[A-Za-z0-9._-]{20,})/i;
    flat.forEach(f => {
      const own = Object.assign({}, f.a); const tp = Object.assign({}, own.typeProperties || {});
      (CONTAINERS[f.type] || []).concat(['cases']).forEach(k => { delete tp[k]; }); own.typeProperties = tp;
      const mine = anc.get(f.a);
      strings(own, (s, key) => {
        if (key === 'name' || key === 'activity') return;
        let m; const re = /activity\('([^']+)'\)/g;
        while ((m = re.exec(s))) {
          if (!byName[m[1]]) add('high', 'Expressions', 'An expression reads activity(\'' + m[1] + '\'), which doesn’t exist.', f.name, 'Open ' + f.name + ', find the expression and correct the activity name. Names are case-sensitive; the activities here are: ' + Object.keys(byName).slice(0, 12).join(', ') + '.');
          else if (m[1] !== f.name && !mine.has(m[1])) add('medium', 'Expressions', 'An expression reads the output of ' + m[1] + ', but this activity doesn\u2019t run after it, so the output may not be there.', f.name, 'Drag the green On success arrow from ' + m[1] + ' to ' + f.name + ' (directly, or through the activities between them).');
        }
        const rp = /pipeline\(\)\.parameters\.([A-Za-z_][A-Za-z0-9_]*)/g; while ((m = rp.exec(s))) if (!(m[1] in pdef)) add('high', 'Expressions', 'It uses the parameter ' + m[1] + ', which the pipeline doesn’t define.', f.name, 'Select the empty canvas, open the Parameters tab below it and add ' + m[1] + ' with a type and default. Or correct the name in the expression.');
        const rv = /variables\('([^']+)'\)/g; while ((m = rv.exec(s))) if (!(m[1] in vdef)) add('high', 'Expressions', 'It uses the variable ' + m[1] + ', which the pipeline doesn’t define.', f.name);
        if (secrets.test(s)) add('high', 'Secrets', 'A setting looks like it holds a secret (a key, password or token). Keep secrets in Azure Key Vault through the linked service, never in pipeline JSON.', f.name, 'Move the value into Key Vault, reference it from the linked service (or read it with a Web activity with Secure output on), and remove it from this activity.');
      });
      if ((f.type === 'SetVariable' || f.type === 'AppendVariable') && tp.variableName && !(tp.variableName in vdef)) add('high', 'Expressions', 'It sets the variable ' + tp.variableName + ', which the pipeline doesn’t define.', f.name);
      if (PREFIX[f.type] && f.name && f.name.indexOf(PREFIX[f.type]) !== 0) add('low', 'Standards', 'A ' + f.type + ' activity is named ' + PREFIX[f.type] + '<object> under the team standards.', f.name, 'Select the activity and change Name on the General tab. Then update any expression that reads activity(\'' + f.name + '\').');
      if (/^(Copy|Lookup|GetMetadata)$/.test(f.type)) {
        const pol = f.a.policy || {};
        if (!pol.retry) add('low', 'Standards', 'No retry. The team standard is ' + std.retry + ' retries, ' + std.retrySec + ' seconds apart, for Copy, Lookup and Get Metadata.', f.name, 'Select the activity, General tab: set Retry to ' + std.retry + ' and Retry interval (sec) to ' + std.retrySec + '.');
        if (!pol.timeout || /^[1-9]\d*\./.test(pol.timeout)) add('low', 'Standards', 'The timeout is ' + (pol.timeout ? pol.timeout.split('.')[0] + ' day(s)' : 'the default') + '. A stuck activity holds the run that long; the team standard is ' + std.timeoutHrs + ' hours.', f.name, 'Select the activity, General tab: set Timeout to 0.' + String(std.timeoutHrs).padStart(2, '0') + ':00:00 (days.hours:minutes:seconds).');
      }
      if (f.type === 'Lookup' && tp.firstRowOnly === false) add('low', 'Correctness', 'This Lookup returns many rows. A Lookup stops at 5,000 rows or 4 MB without an error, so a longer list is cut short.', f.name);
      if (f.type === 'Copy') {
        const sink = tp.sink || {}, src = tp.source || {};
        const qy = src.sqlReaderQuery && (src.sqlReaderQuery.value || src.sqlReaderQuery);
        if (typeof qy === 'string' && /select\s+\*/i.test(qy)) add('low', 'Correctness', 'The source query uses SELECT *. A new source column changes what is copied without anyone deciding it; list the columns.', f.name, 'On the Source tab, replace * in the query with the column names you need.');
        if (/Sql|DW/.test(String(sink.type || '')) && !sink.preCopyScript && sink.writeBehavior !== 'upsert' && !sink.sqlWriterStoredProcedureName && !flat.some(x => x.type === 'SqlServerStoredProcedure' || x.type === 'Script'))
          add('medium', 'Rerun safety', 'The copy inserts into a SQL table with no pre-copy script, upsert or merge step, so rerunning the same window adds the rows again.', f.name, 'On the Sink tab, either set Pre-copy script to delete or truncate what this run reloads, set Write behavior to Upsert with key columns, or copy to a staging table and merge with a Stored Procedure activity.');
      }
    });
    /* ---- problems found in real pipelines ---- */
    const sval = v => String(v && typeof v === 'object' && !Array.isArray(v) ? v.value : v == null ? '' : v);
    const norm = v => sval(v).replace(/\s+/g, '').replace(/^@/, '');
    /* defaults are never evaluated: "@if(...)" stays that text */
    [['variable', props.variables], ['parameter', props.parameters]].forEach(([kind, defs]) => Object.keys(defs || {}).forEach(k => {
      const d = defs[k] && defs[k].defaultValue;
      if (typeof d === 'string' && /^@(?!@)/.test(d.trim())) add('high', 'Expressions', 'The ' + kind + ' ' + k + ' has the default value ' + d.trim().slice(0, 70) + (d.length > 70 ? '…' : '') + '. ADF never evaluates a default value, so the ' + kind + ' holds that text, not its result' + (new RegExp("equals\\(\\s*" + kind + "s\\('" + k + "'\\)", 'i').test(JSON.stringify(pipeline)) ? ', and every equals(' + kind + 's(\'' + k + '\'), ...) that tests it is false' : '') + '.', '',
        kind === 'variable' ? 'Leave the default empty and add a Set Variable activity at the start of the pipeline: Variables tab > ' + k + ', Value = ' + d.trim().slice(0, 60) + '. Make every activity that reads ' + k + ' run after it.' : 'Parameters can’t hold expressions. Pass the value from the caller or trigger, or make it a variable set by a Set Variable activity.');
    }));
    /* a wildcard inside a loop works on every file, every time */
    flat.forEach(f => {
      let p = f.parent, loop = null; while (p && !loop) { const pf = flat.find(x => x.a === p); if (p.type === 'ForEach') loop = p; p = pf && pf.parent; }
      if (!loop || !/^(Copy|Delete)$/.test(f.type)) return;
      const tp = f.a.typeProperties || {}, ss = f.type === 'Copy' ? ((tp.source || {}).storeSettings || {}) : (tp.storeSettings || {});
      const wf = ss.wildcardFileName, wd = ss.wildcardFolderPath;
      if ((wf != null || wd != null) && !/item\(\)/.test(sval(wf) + sval(wd)))
        add('high', 'Correctness', 'It is inside the loop ' + loop.name + ' but uses a wildcard (' + [wd != null ? 'folder ' + sval(wd) : '', wf != null ? 'file ' + sval(wf) : ''].filter(Boolean).join(', ') + ') that doesn’t use the loop’s item, so every pass ' + (f.type === 'Delete' ? 'deletes all the matching files: the first pass removes files the later passes still need.' : 'copies all the matching files, not just its own.'), f.name,
          'Select ' + f.name + ', ' + (f.type === 'Copy' ? 'Source' : 'Source') + ' tab: change File path type from Wildcard file path to File path in dataset, so the dataset’s file name parameter (@item().name) picks the one file. Or take the activity out of the loop and let one wildcard run handle every file.');
    });
    /* a ForEach straight over a folder listing: childItems holds folders too (review, Nov 2026) */
    flat.filter(f => f.type === 'ForEach').forEach(f => {
      const m = /^@\s*activity\('([^']+)'\)\??\.output\??\.childItems\s*$/i.exec(sval((f.a.typeProperties || {}).items).trim()); if (!m) return;
      if (!flat.some(x => x.name === m[1] && x.type === 'GetMetadata')) return;
      add('medium', 'Correctness', f.name + ' loops over everything ' + m[1] + ' lists. A folder listing (Child items) holds subfolders as well as files, so a subfolder in that folder reaches the copy as if it were a file, and the run fails or copies the wrong thing.', f.name,
        'Add a Filter activity after ' + m[1] + ': Items = @activity(\'' + m[1] + '\').output.childItems, Condition = @equals(item().type, \'File\') (add an and(...) with endswith(item().name, \'.csv\') to keep one kind). Then set ' + f.name + ' Items to @activity(\'<filter name>\').output.value and make it run after the Filter.');
    });
    /* the existence check and the copy must point at the same file */
    flat.filter(f => f.type === 'GetMetadata' && (f.a.typeProperties.fieldList || []).indexOf('exists') >= 0).forEach(g => {
      const ref = g.a.typeProperties.dataset || {}, ds = ref.referenceName, gp = ref.parameters || {};
      g.siblings.filter(s => s.type === 'Copy' && s !== g.a && ((s.outputs || [])[0] || {}).referenceName === ds).forEach(c => {
        const cp = (c.outputs[0].parameters || {}), diff = Object.keys(Object.assign({}, gp, cp)).filter(k => norm(gp[k]) !== norm(cp[k]));
        if (diff.length) add('high', 'Correctness', g.name + ' checks whether a file exists, but not the file ' + c.name + ' writes: ' + diff.map(k => k + ' is ' + (sval(gp[k]) || '(empty)').replace(/\s+/g, ' ') + ' in the check and ' + (sval(cp[k]) || '(empty)').replace(/\s+/g, ' ') + ' in the copy').join('; ') + '. The check never finds the file, so whatever depends on it (archiving the old file) never runs.', g.name,
          'Open ' + g.name + ', Settings tab, and give the dataset parameters exactly the values ' + c.name + ' uses on its Sink tab (copy them across).');
      });
    });
    /* the archive copy, run when the file exists, must read the file the main copy is about to replace */
    flat.filter(f => f.type === 'IfCondition').forEach(f => {
      const m = /activity\('([^']+)'\)\??\.output\??\.exists/.exec(sval((f.a.typeProperties || {}).expression)); if (!m) return;
      const g = flat.find(x => x.name === m[1] && x.type === 'GetMetadata'); if (!g) return;
      const ds = ((g.a.typeProperties.dataset || {}).referenceName);
      const main = f.siblings.find(s => s.type === 'Copy' && ((s.outputs || [])[0] || {}).referenceName === ds); if (!main) return;
      const mp = main.outputs[0].parameters || {};
      flat.filter(x => x.parent === f.a && x.type === 'Copy' && ((x.a.inputs || [])[0] || {}).referenceName === ds).forEach(c => {
        const ip = c.a.inputs[0].parameters || {}, diff = Object.keys(Object.assign({}, mp, ip)).filter(k => norm(mp[k]) !== norm(ip[k]));
        if (diff.length) add('high', 'Correctness', c.name + ' archives a file, but not the file ' + main.name + ' writes: ' + diff.map(k => k + ' is ' + (sval(ip[k]) || '(empty)').replace(/\s+/g, ' ') + ' in the archive copy and ' + (sval(mp[k]) || '(empty)').replace(/\s+/g, ' ') + ' in ' + main.name).join('; ') + '. When the old file exists, the archive copy looks for a file that isn\u2019t there and fails.', c.name,
          'Open ' + c.name + ', Source tab, and give the dataset parameters exactly the values ' + main.name + ' uses on its Sink tab. Keep only the folder (and file name, if you rename it) different on ' + c.name + '\u2019s Sink tab.');
      });
    });
    /* the first item of a Filter that may be empty */
    const allText = JSON.stringify(pipeline);
    flat.filter(f => f.type === 'Filter').forEach(fl => {
      const nm = fl.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), idx = new RegExp("(first\\(\\s*activity\\('" + nm + "'\\)\\.output\\.value\\s*\\)|activity\\('" + nm + "'\\)\\.output\\.value\\[0\\])(?!\\?)", 'i');
      const guarded = new RegExp("activity\\('" + nm + "'\\)\\.output\\.FilteredItemsCount|coalesce\\(\\s*first\\(\\s*activity\\('" + nm + "'\\)", 'i').test(allText);
      if (guarded) return;
      const own = f => { const tp = Object.assign({}, f.a.typeProperties || {}); (CONTAINERS[f.type] || []).concat(['cases']).forEach(k => { delete tp[k]; }); return JSON.stringify(tp); };
      const users = flat.filter(f => f !== fl && idx.test(own(f)));
      if (users.length) add('medium', 'Correctness', 'When ' + fl.name + ' finds nothing, ' + users.map(u => u.name).join(', ') + ' read' + (users.length === 1 ? 's' : '') + ' its first item anyway, and the expression fails. For example, a file whose name isn’t in the object list.', users[0].name,
        'After ' + fl.name + ', add an If Condition with @equals(activity(\'' + fl.name + '\').output.FilteredItemsCount, 0) and a Fail activity on True with a clear message (“No object for this file”), and make the next steps run after it. Or read the value safely: @coalesce(first(activity(\'' + fl.name + '\').output.value)?.id, \'\').');
    });
    /* notebook parameter names that differ only by letter case */
    { const seen = {}; flat.filter(f => f.type === 'DatabricksNotebook').forEach(f => Object.keys(f.a.typeProperties.baseParameters || {}).forEach(k => { const l = k.toLowerCase(); (seen[l] = seen[l] || {}); (seen[l][k] = seen[l][k] || []).push(f.name); }));
      Object.keys(seen).forEach(l => { const sp = Object.keys(seen[l]); if (sp.length < 2) return; sp.sort((a, b) => seen[l][b].length - seen[l][a].length);
        sp.slice(1).forEach(k => add('medium', 'Correctness', 'It sends the notebook parameter ' + k + ', but other notebooks here get ' + sp[0] + '. Widget names are case-sensitive, so a notebook reading dbutils.widgets.get("' + sp[0] + '") doesn’t see this value.', seen[l][k][0], 'Select ' + seen[l][k].join(', ') + ', Settings tab > Base parameters, and rename ' + k + ' to ' + sp[0] + ' (or rename it in the notebook).')); }); }
    /* notebooks in a personal folder */
    { const mine = flat.filter(f => f.type === 'DatabricksNotebook' && /^\/Users\//.test(sval(f.a.typeProperties.notebookPath)));
      if (mine.length) add('low', 'Maintainability', mine.length + ' notebook activit' + (mine.length === 1 ? 'y runs a notebook' : 'ies run notebooks') + ' kept in a personal workspace folder (' + Array.from(new Set(mine.map(f => sval(f.a.typeProperties.notebookPath).split('/').slice(0, 3).join('/')))).join(', ') + '). If that account is removed or renamed, the pipeline can’t find them.', mine[0].name,
        'Move shared notebooks to /Shared or a Git folder (Repos), then update Notebook path on each activity: ' + mine.map(f => f.name).join(', ') + '.'); }
    /* environment values typed in */
    { const typed = []; flat.filter(f => f.type === 'DatabricksNotebook').forEach(f => { const bp = f.a.typeProperties.baseParameters || {}; Object.keys(bp).forEach(k => { const v = bp[k]; if (/storage|account|server|host|database|workspace|env/i.test(k) && typeof v === 'string' && v.trim() && !/^@/.test(v.trim())) typed.push(f.name + ' ' + k + ' = ' + v); }); });
      if (typed.length) add('low', 'Maintainability', 'Environment values are typed in: ' + typed.slice(0, 4).join('; ') + (typed.length > 4 ? '; …' : '') + '. Moving this pipeline to another environment means editing each one.', typed[0].split(' ')[0],
        'Use a global parameter instead (Manage > Global parameters, for example StorageAccountName) and set each value to @pipeline().globalParameters.StorageAccountName.'); }
    /* watermark order */
    const top = flat.filter(f => !f.parent);
    const isWmUpdate = f => /^(SqlServerStoredProcedure|Script)$/.test(f.type) && /watermark|high_?water|\bwm\b/i.test(f.name + ' ' + JSON.stringify(f.a.typeProperties || {})) && /upd|set|save|write|move/i.test(f.name + ' ' + String((f.a.typeProperties || {}).storedProcedureName || ''));
    const succUp = f => { const sib = {}; f.siblings.forEach(s => { sib[s.name] = s; }); const seen = new Set(); const go = a => (a.dependsOn || []).forEach(d => { const c = d.dependencyConditions || []; if (c.length !== 1 || c[0] !== 'Succeeded' || seen.has(d.activity)) return; seen.add(d.activity); if (sib[d.activity]) go(sib[d.activity]); }); go(f.a); return seen; };
    const loads = flat.filter(f => f.type === 'Copy' || f.type === 'ExecuteDataFlow' || (f.type === 'SqlServerStoredProcedure' && /merge|upsert|scd|load/i.test(f.name)));
    const usesWm = flat.some(f => /watermark/i.test(JSON.stringify(f.a.typeProperties || {})) || /watermark/i.test(f.name));
    const wmUpd = flat.filter(isWmUpdate);
    wmUpd.forEach(w => {
      const s = succUp(w), all = anc.get(w.a);
      loads.filter(l => l.siblings === w.siblings && l.a !== w.a).forEach(l => {
        if (!all.has(l.name)) add('high', 'Correctness', 'The watermark is updated without waiting for ' + l.name + '. If that load fails, the watermark has already moved and those rows are never picked up.', w.name, 'Delete the arrow going into ' + w.name + ' and drag the green On success arrow from ' + l.name + ' (or from the last step of the load) to it.');
        else if (!s.has(l.name)) add('high', 'Correctness', 'The watermark update runs after ' + l.name + ' on a path that isn’t Succeeded only, so it can move after a failed load.', w.name, 'Make every arrow between ' + l.name + ' and ' + w.name + ' an On success arrow (green).');
      });
      if (!loads.some(l => l.siblings === w.siblings)) add('medium', 'Correctness', 'The watermark is updated but no load (Copy, data flow or merge) runs before it in the same place.', w.name);
    });
    if (usesWm && !wmUpd.length && flat.some(f => f.type === 'Copy')) add('medium', 'Correctness', 'The pipeline reads a watermark but nothing updates it after the load, so every run reloads the same window. (If another pipeline or the merge procedure updates it, ignore this.)');
    /* failure path */
    if (opts.child) { /* run by Execute Pipeline: the caller sees its failure and handles it */ }
    const manual = !!opts.manual || !!opts.child, leaves = top.filter(f => !top.some(g => (g.a.dependsOn || []).some(d => d.activity === f.name)));
    const hasFail = flat.some(f => (f.a.dependsOn || []).some(d => (d.dependencyConditions || []).some(c => c === 'Failed' || c === 'Completed')));
    const lastMain = (leaves[leaves.length - 1] || top[top.length - 1] || {}).name || 'the last activity';
    if (flat.length && !hasFail) add(manual ? 'low' : 'medium', 'Failure path', manual
      ? (opts.child ? 'Optional: nothing runs here when an activity fails. That is usually right for a pipeline started by Execute Pipeline: the failure reaches the calling pipeline, which can log it.' : 'Optional: nothing runs when an activity fails. For a pipeline you run and watch by hand that is fine: the failed activity shows in the run\u2019s output. Add a failure path only if you want a log entry or a message.')
      : 'Nothing runs when an activity fails: no log entry and no alert. Someone has to notice the failed run in Monitor.',
      '', 'Add the activity that should run on failure (your logging notebook or procedure, or a Web activity for an alert). On ' + lastMain + ', select the + at its right edge, choose On failure and connect it to the new activity; add On skipped from the same activity too, so a failure earlier in the chain also reaches it. Then end the path with a Fail activity (Activities > General > Fail) connected On completion. If you don\u2019t want one, set \u201CHow is this pipeline run?\u201D to By hand, or turn the Failure path checks off.');
    const handlers = top.filter(f => (f.a.dependsOn || []).some(d => (d.dependencyConditions || []).indexOf('Failed') >= 0));
    if (handlers.length && !flat.some(f => f.type === 'Fail')) {
      const down = f => { const nx = top.filter(g => (g.a.dependsOn || []).some(d => d.activity === f.name)); return nx.length ? down(nx[nx.length - 1]) : f; }, end = down(handlers[handlers.length - 1]).name;
      add(manual ? 'low' : 'medium', 'Failure path', 'When ' + handlers.map(h => h.name).join(', ') + ' runs after a failure and itself succeeds, ADF reports the whole run as Succeeded, even though an activity failed. ' + (manual ? 'Run by hand, you would still see the failed activity in the output, but the run list in Monitor says Succeeded.' : 'Monitor, and any trigger, alert rule or pipeline that looks at the run\u2019s status, sees a success.'),
        handlers[0].name, 'In ADF Studio: 1. In the Activities pane open General and drag Fail onto the canvas. 2. On ' + end + ', select the + at its right edge, choose On completion and connect it to the Fail activity. 3. On the Fail activity\u2019s Settings tab, set Fail message (for example @concat(\'Pipeline \', pipeline().Pipeline, \' failed\')) and Error code (for example PIPELINE_FAILED). The failure path still runs first; the run then shows Failed.');
    }
    handlers.forEach(h => { const ds = h.a.dependsOn || []; if (ds.length > 1 && ds.every(d => (d.dependencyConditions || []).length === 1 && d.dependencyConditions[0] === 'Failed')) add('high', 'Failure path', 'It waits for ' + ds.length + ' activities to all fail. Dependencies are combined with AND, so it only runs if every one of them fails.', h.name, 'Delete those arrows. From ' + lastMain + ' alone, connect On failure and On skipped to ' + h.name + ': a failure anywhere earlier skips the last activity, so both cases reach it.'); });
    const off = Array.isArray(opts.off) ? opts.off : (Array.isArray(std.off) ? std.off : []);
    for (let k = F.length - 1; k >= 0; k--) if (off.indexOf(F[k].rule) >= 0) F.splice(k, 1);
    const order = { high: 0, medium: 1, low: 2 };
    return F.sort((a, b) => order[a.sev] - order[b.sev]);
  };
  /* ---------- writing an ADF expression: what can be referenced, a check, and a Copilot prompt ---------- */
  A.EXPR_FUNCS = [
    ['concat', "concat('text ', variables('name'))", 'Join text'], ['string', 'string(value)', 'Turn a number or object into text'], ['int', "int('42')", 'Text to a whole number'],
    ['coalesce', "coalesce(value, 'fallback')", 'First value that isn’t null'], ['if', "if(equals(a, b), 'yes', 'no')", 'Choose between two values'], ['equals', 'equals(a, b)', 'True when equal'],
    ['greater', 'greater(a, b)', 'True when a > b'], ['and', 'and(a, b)', 'Both true'], ['or', 'or(a, b)', 'Either true'], ['not', 'not(a)', 'Opposite'],
    ['utcNow', 'utcNow()', 'Current date and time (UTC)'], ['formatDateTime', "formatDateTime(utcNow(), 'yyyy-MM-dd')", 'Date as text'], ['addDays', 'addDays(utcNow(), -1)', 'Add days to a date'],
    ['convertFromUtc', "convertFromUtc(utcNow(), 'Eastern Standard Time')", 'UTC to a time zone'], ['replace', "replace(text, '-', '_')", 'Replace text'], ['toLower', 'toLower(text)', 'Lower case'],
    ['toUpper', 'toUpper(text)', 'Upper case'], ['trim', 'trim(text)', 'Remove outer spaces'], ['substring', 'substring(text, 0, 4)', 'Part of text (start, length)'], ['split', "split(text, '/')", 'Text to a list'],
    ['length', 'length(listOrText)', 'Count items or characters'], ['first', 'first(list)', 'First item'], ['last', 'last(list)', 'Last item'], ['contains', "contains(text, 'abc')", 'True when it contains'],
    ['startsWith', "startsWith(text, 'abc')", 'True when it starts with'], ['endsWith', "endsWith(text, '.csv')", 'True when it ends with'], ['json', "json('{\"a\":1}')", 'Text to an object'], ['add', 'add(1, 2)', 'Add numbers'], ['sub', 'sub(5, 2)', 'Subtract numbers']
  ];
  const KNOWN_FUNCS = new Set(A.EXPR_FUNCS.map(f => f[0].toLowerCase()).concat(['activity', 'variables', 'pipeline', 'item', 'dataset', 'linkedservice', 'trigger', 'mul', 'div', 'mod', 'min', 'max', 'range', 'less', 'lessorequals', 'greaterorequals', 'empty', 'union', 'intersection', 'skip', 'take', 'createarray', 'array', 'bool', 'float', 'base64', 'base64tostring', 'uricomponent', 'uricomponenttostring', 'guid', 'indexof', 'lastindexof', 'adddays', 'addhours', 'addminutes', 'addseconds', 'addtotime', 'subtractfromtime', 'getfutureltime', 'getfuturetime', 'getpasttime', 'dayofmonth', 'dayofweek', 'dayofyear', 'startofday', 'startofmonth', 'startofhour', 'ticks', 'converttimezone', 'converttoutc', 'xml', 'xpath', 'decimal']));
  /* what an expression can refer to, from the pipeline the page built (or any pipeline JSON) */
  A.exprContext = function (pipeline, cfg) {
    const flat = pipeline ? A.flatten(pipeline) : [];
    const steps = flat.filter(f => /^(Copy|DatabricksNotebook|Lookup|GetMetadata|ExecutePipeline|SqlServerStoredProcedure|Script|Filter|WebActivity)$/.test(f.type) && !/^(nb|sp)_log_/.test(f.name))
      .map(f => ({ name: f.name, type: f.type, inside: f.parent ? f.parent.name : '', fields: (A.STEP_FIELDS[f.type] || []).concat(f.type === 'Filter' ? [['value', 'Matching items'], ['FilteredItemsCount', 'How many matched']] : []) }));
    const vars = Object.keys(((pipeline || {}).properties || {}).variables || {});
    (cfg && Array.isArray(cfg.vars) ? A.userVars(cfg) : []).forEach(v => { if (vars.indexOf(v.name.trim()) < 0) vars.push(v.name.trim()); });
    const params = Object.keys(((pipeline || {}).properties || {}).parameters || {});
    return { steps, vars, params, loop: flat.some(f => f.type === 'ForEach') };
  };
  /* a check that needs no factory: syntax, and the names it uses */
  A.checkExpr = function (text, ctx) {
    const R = [], s = String(text || '').trim();
    if (!s) return [{ sev: 'err', msg: 'Empty.' }];
    if (!/^@/.test(s) && !/@\{/.test(s)) R.push({ sev: 'err', msg: 'An expression starts with @ (or uses @{...} inside text). Without it, ADF passes the words as they are.' });
    let q = false, d = 0, bad = false;
    const body = s.replace(/^@/, '');
    for (let i = 0; i < body.length; i++) { const c = body[i]; if (c === "'") { if (q && body[i + 1] === "'") { i++; continue; } q = !q; continue; } if (q) continue; if (c === '(' || c === '[') d++; if (c === ')' || c === ']') d--; if (d < 0) bad = true; }
    if (q) R.push({ sev: 'err', msg: 'A quote isn’t closed. Text goes in single quotes, and a quote inside text is written twice (’’).' });
    if (d !== 0 || bad) R.push({ sev: 'err', msg: 'The brackets don’t balance.' });
    if (/"/.test(body.replace(/'(?:[^']|'')*'/g, ''))) R.push({ sev: 'err', msg: 'Use single quotes for text in ADF expressions, not double quotes.' });
    const noStr = body.replace(/'(?:[^']|'')*'/g, "''"); let m;
    const fr = /([A-Za-z_]\w*)\s*\(/g; while ((m = fr.exec(noStr))) if (!KNOWN_FUNCS.has(m[1].toLowerCase()) && noStr[m.index - 1] !== '.') R.push({ sev: 'warn', msg: m[1] + '() isn’t an ADF function the page knows. Check the spelling (names are case-insensitive).' });
    if (ctx) {
      const ar = /activity\(\s*'([^']*)'\s*\)/g, seen = {}; while ((m = ar.exec(body))) { const hit = ctx.steps.find(x => x.name === m[1]); if (hit && hit.inside && !seen[m[1]]) { seen[m[1]] = 1; R.push({ sev: 'warn', msg: m[1] + ' runs inside ' + hit.inside + ': ADF only lets steps inside ' + hit.inside + ' read it. Anywhere else the pipeline fails validation.' }); } if (!hit) R.push({ sev: 'err', msg: 'There is no step called ' + m[1] + ' in this pipeline' + (ctx.steps.length ? ' (steps: ' + ctx.steps.map(x => x.name).slice(0, 8).join(', ') + ')' : '') + '.' }); }
      const vr = /variables\(\s*'([^']*)'\s*\)/g; while ((m = vr.exec(body))) if (ctx.vars.indexOf(m[1]) < 0) R.push({ sev: 'err', msg: 'There is no pipeline variable called ' + m[1] + '. Add it under Pipeline variables.' });
      const pr = /pipeline\(\)\.parameters\.(\w+)/g; while ((m = pr.exec(body))) if (ctx.params.indexOf(m[1]) < 0) R.push({ sev: 'err', msg: 'The pipeline has no parameter called ' + m[1] + '.' });
      if (/item\(\)/.test(body) && !ctx.loop) R.push({ sev: 'warn', msg: 'item() only has a value inside a ForEach or Filter. This pipeline has no loop.' });
    }
    if (/activity\(\s*'[^']*'\s*\)\.output\.[\w.]+/.test(body) && !/\?\./.test(body)) R.push({ sev: 'info', msg: 'If that step can be skipped (for example after a failure), read its output with ?. so the expression doesn’t fail: activity(’name’)?.output?.rowsCopied.' });
    return R;
  };
  A.exprPrompt = function (request, ctx, where) {
    const L = ['You are writing one Azure Data Factory pipeline expression. You cannot see the factory: use only the steps, outputs and variables listed under CONTEXT.'];
    L.push('', 'TASK (the user’s request: all the expression has to do)', (request || '(not given)').trim());
    L.push('', 'CONTEXT', 'Where it is used: ' + (where || 'an activity parameter') + '.');
    if (ctx.steps.length) { L.push('Steps it can read (activity name | type | outputs):'); ctx.steps.forEach(s => L.push('- ' + s.name + ' | ' + s.type + (s.inside ? ' (inside ' + s.inside + ')' : '') + ' | ' + (s.fields.map(f => 'output.' + f[0]).join(', ') || 'output') + ', error.message')); }
    if (ctx.vars.length) L.push('Pipeline variables: ' + ctx.vars.join(', '));
    if (ctx.params.length) L.push('Pipeline parameters: ' + ctx.params.join(', '));
    L.push('Always available: pipeline().Pipeline, pipeline().RunId, pipeline().TriggerTime, pipeline().TriggerName, pipeline().DataFactory, pipeline().globalParameters.<name>, utcNow()' + (ctx.loop ? ', and item() inside a loop' : '') + '.');
    L.push('', 'RULES', '- One expression that starts with @. Use only ADF expression functions, with text in single quotes (a quote inside text is written twice).',
      '- Use only the step, variable and parameter names listed. Read a step’s output with ?. (activity(\'name\')?.output?.field) when the step may have been skipped.',
      '- The value is passed as text unless the TASK says otherwise: wrap numbers and objects in string().',
      '- A step marked (inside X) can only be read by steps inside that same X.',
      '- If the TASK can’t be done with what is listed, write a SKIPPED block that says why instead of guessing.');
    L.push('', 'REPLY FORMAT (a template: replace the placeholder lines with your answer)', 'Reply inside one code block, with these labelled blocks and nothing else:', '@@@ EXPRESSION @@@', '@the expression', '@@@ NOTES @@@', 'what it does and anything to confirm, one per line', '@@@ SKIPPED @@@', 'only if it can’t be done: why');
    return L.join('\n');
  };
  A.exprParse = function (reply, parseBlocks) {
    const res = { expr: '', notes: [], skipped: '' };
    parseBlocks(reply).forEach(b => {
      if (b.tag === 'EXPRESSION' && !/^@the expression$/i.test(b.body.trim())) res.expr = b.body.replace(/\s*\n\s*/g, ' ').trim();
      else if (b.tag === 'NOTES') b.body.split('\n').map(x => x.replace(/^[-*]\s*/, '').trim()).filter(x => x && !/^what it does and anything/i.test(x)).forEach(x => res.notes.push(x));
      else if (b.tag === 'SKIPPED' && !/^only if it can/i.test(b.body.trim())) res.skipped = b.body.trim();
    });
    if (!res.expr && !res.skipped) { const m = /(^|\n)\s*(@[^\n]+)/.exec(String(reply || '')); if (m) res.expr = m[2].trim(); }
    return res;
  };
  A.fixPrompt = function (pipeline, findings, std, manual) {
    std = Object.assign(A.defaultStandards(), std || {});
    const L = ['You are a senior Azure Data Factory engineer correcting a pipeline. You cannot see the factory: use only what is in the pipeline JSON under STARTING POINT.'];
    L.push('', 'TASK (all the reply has to do)', 'Fix the problems listed under CONTEXT in the pipeline JSON, changing nothing else, and return the complete corrected pipeline.');
    L.push('', 'CONTEXT', 'Problems found by an automatic check, most serious first:');
    findings.forEach((f, i) => L.push((i + 1) + '. [' + f.sev + '] ' + (f.activity || 'Pipeline') + ': ' + f.msg + (f.fix ? ' Suggested fix: ' + f.fix : '')));
    L.push('How it is run: ' + (manual ? 'by hand, watched by the person running it.' : 'by a trigger or from another pipeline.'));
    L.push('Team standards: pipeline names start with ' + std.plPrefix + '; Copy, Lookup and Get Metadata retry ' + std.retry + ' times, ' + std.retrySec + ' seconds apart, timeout 0.' + String(std.timeoutHrs).padStart(2, '0') + ':00:00.');
    L.push('', 'STARTING POINT', JSON.stringify(pipeline, null, 2));
    L.push('', 'RULES', '- Keep every activity, dataset reference, linked service reference, parameter and expression exactly as it is unless a listed problem requires changing it.',
      '- Never invent dataset, linked service, notebook, procedure, table or column names. If a fix needs one that isn\u2019t in the JSON, use a placeholder in angle brackets like <LOG_NOTEBOOK_PATH> and list it under NOTES.',
      '- Activity names stay unique. If you rename an activity, update every dependsOn and every activity(\'name\') expression that uses it.',
      '- Every dependsOn entry has dependencyConditions from: Succeeded, Failed, Skipped, Completed.',
      '- A failure path starts from the last main activity with the conditions Failed and Skipped, and ends with a Fail activity.',
      '- Valid JSON only inside the code block: no comments, no trailing commas. No secrets or connection strings.',
      '- If a problem can\u2019t be fixed from what the JSON holds, leave that part unchanged and say so under NOTES.');
    L.push('', 'REPLY FORMAT (a template: replace the placeholder lines with your answer)', 'One code block holding the complete pipeline JSON, then the notes:', '```json', '{ "name": "...", "properties": { "activities": [ ... ] } }', '```', 'NOTES', '- what you changed, one line per problem number', '- placeholders to replace, and anything you could not fix');
    return L.join('\n');
  };
  A.flow = function (pipeline) {
    return A.flatten(pipeline).map(f => ({ name: f.name, type: f.type, depth: f.depth, inside: f.parent ? f.parent.name + (f.branch && f.branch !== 'activities' ? ' (' + f.branch.replace('ifTrueActivities', 'when true').replace('ifFalseActivities', 'when false').replace('defaultActivities', 'default') + ')' : '') : '',
      after: (f.a.dependsOn || []).map(d => ({ activity: d.activity, conds: d.dependencyConditions || [] })) }));
  };
  A.placeholdersIn = A.placeholders;

  root.ADF = A;
  if (typeof module !== 'undefined') module.exports = A;
})(typeof window !== 'undefined' ? window : globalThis);

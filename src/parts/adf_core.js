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

  A.defaultStandards = () => ({
    plPrefix: 'pl_', dsPrefix: 'ds_', trPrefix: 'tr_',
    ctlSchema: 'etl', stgSchema: 'stg', wmTable: 'watermark', logTable: 'pipeline_run_log',
    retry: 2, retrySec: 60, timeoutHrs: 2,
    alertParam: 'alert_webhook_url',
    rawPath: 'raw/{source}/{object}/{yyyy}/{MM}/{dd}', archivePath: 'archive/{source}/{object}/{yyyy}/{MM}/{dd}', quarantinePath: 'quarantine/{source}/{object}/{yyyy}/{MM}/{dd}'
  });
  A.blank = () => ({
    name: '', domain: '', goal: '',
    src: { kind: 'sql', system: 'sqlserver', ls: '', ir: '', onprem: false, schema: 'dbo', table: '', container: '', folder: '', starts: '', ends: '.csv' },
    schemaText: '', exclude: [],
    tgt: { kind: 'sql', system: 'azuresql', ls: '', schema: '', table: '', write: 'merge', container: '', storage: '' },
    ctlLs: '',
    load: { type: 'incremental', wmCol: '', wmType: 'datetime', keys: [], overlap: 0 },
    filter: '', ai: { request: '', reply: '' },
    sched: { freq: 'daily', time: '02:00', tz: 'Eastern Standard Time' },
    alert: 'web', nbLs: '', notebooks: ''
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
    const files = cfg.src.kind === 'files';
    const obj = files ? (snake((cfg.src.folder || '').split('/').filter(Boolean).pop() || '') || 'files') : (snake(cfg.src.table) || 'table');
    const tobj = snake(cfg.tgt.table) || obj;
    const srcSys = files ? 'adls' : (A.SYSTEMS[cfg.src.system] || A.SYSTEMS.sqlserver).short;
    const srcShort = lsShort(cfg.src.ls, files ? 'adls' : srcSys);
    const sql = cfg.tgt.kind === 'sql' && !files;
    const tgtSys = sql ? (A.SYSTEMS[cfg.tgt.system] || A.SYSTEMS.azuresql) : null;
    const tgtShort = lsShort(cfg.tgt.ls, sql ? tgtSys.short : 'adls');
    const inc = !files && cfg.load.type === 'incremental';
    const kindWord = files ? 'landing' : (inc ? 'incremental' : 'full');
    const domain = snake(cfg.domain) || snake(srcShort.replace(new RegExp('^' + srcSys + '_?'), '')) || 'data';
    const n = {
      obj, tobj, files, sql, inc, domain, srcShort, tgtShort,
      pipeline: (cfg.name || '').trim() || (std.plPrefix + domain + '_' + obj + '_' + kindWord),
      srcLs: cfg.src.ls.trim() || ph(files ? 'LS_ADLS' : 'LS_SOURCE'), tgtLs: cfg.tgt.ls.trim() || ph(sql ? 'LS_TARGET' : 'LS_ADLS'),
      srcDs: std.dsPrefix + (/^(sqlserver|azuresql|synapse|adls)/.test(srcShort) ? '' : srcSys + '_') + srcShort + (files ? '_binary' : '_table'),
      stgTable: tobj, wmKey: (cfg.src.schema || 'dbo') + '.' + (cfg.src.table || ph('TABLE')),
      mergeProc: 'usp_merge_' + tobj, scdProc: 'usp_scd2_' + tobj
    };
    if (files) n.tgtLs = n.srcLs;
    n.tgtDs = sql ? std.dsPrefix + (/^(sqlserver|azuresql|synapse)/.test(tgtShort) ? '' : tgtSys.short + '_') + tgtShort + '_table' : std.dsPrefix + (/^adls/.test(tgtShort) ? '' : 'adls_') + tgtShort + '_parquet';
    /* control database: the SQL target, or the one named in the brief */
    const ctl = cfg.ctlLs.trim();
    if (sql && (!ctl || ctl === cfg.tgt.ls.trim())) { n.ctlLs = n.tgtLs; n.ctlDs = n.tgtDs; n.ctlSys = tgtSys; }
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
    const files = cfg.src.kind === 'files', sql = cfg.tgt.kind === 'sql' && !files, w = cfg.tgt.write, inc = !files && cfg.load.type === 'incremental';
    if (files) {
      if (!cfg.src.folder.trim()) add('err', 'Give the landing folder the files arrive in.');
      if (!cfg.src.container.trim()) add('warn', 'No landing container: the datasets use the placeholder <LANDING_CONTAINER>.');
      return P;
    }
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
    if (!sql && inc && !cfg.ctlLs.trim()) add('warn', 'The watermark and log tables need a SQL database. Name its linked service under Control database, or the JSON keeps the placeholder <LS_CONTROL_DB>.');
    if (cfg.filter && /;|--/.test(cfg.filter)) add('err', 'The row filter contains a semicolon or a comment. Use a single predicate.');
    if (cfg.notebooks.trim() && !cfg.nbLs.trim()) add('warn', 'Notebooks are listed but no Databricks linked service is named: the JSON uses <LS_DATABRICKS>.');
    return P;
  };

  /* ---------- building ---------- */
  const pathExpr = (pattern, n) => String(pattern).replace(/\{source\}/g, n.srcShort).replace(/\{object\}/g, n.obj)
    .replace(/\{(yyyy|MM|dd|HH)\}/g, (m, f) => "@{formatDateTime(pipeline().TriggerTime, '" + f + "')}");

  A.build = function (cfg, std, ai, today) {
    std = Object.assign(A.defaultStandards(), std || {});
    const n = A.names(cfg, std), cols = A.outCols(cfg, ai), has = cols.length > 0;
    const files = n.files, sql = n.sql, inc = n.inc;
    let write = sql ? cfg.tgt.write : 'files';
    if (sql && inc && write === 'overwrite') write = 'append';
    const staged = sql && (write === 'merge' || write === 'scd2');
    const wm = inc ? cfg.load.wmCol : '', dt = cfg.load.wmType !== 'integer';
    const overlap = inc && dt && staged;
    const srcSys = A.SYSTEMS[cfg.src.system] || A.SYSTEMS.sqlserver, tgtSys = A.SYSTEMS[cfg.tgt.system] || A.SYSTEMS.azuresql;
    const ctl = q(std.ctlSchema), wmT = ctl + '.' + q(std.wmTable), logT = ctl + '.' + q(std.logTable);
    const tgtT = q(cfg.tgt.schema || 'dbo') + '.' + q(cfg.tgt.table || ph('TARGET_TABLE')), stgT = q(std.stgSchema) + '.' + q(n.stgTable);
    const srcT = q(cfg.src.schema || 'dbo') + '.' + q(cfg.src.table || ph('TABLE'));
    const policy = (retry) => ({ timeout: '0.' + String(std.timeoutHrs).padStart(2, '0') + ':00:00', retry: retry ? Number(std.retry) : 0, retryIntervalInSeconds: Number(std.retrySec), secureOutput: false, secureInput: false });
    const dep = (a, c) => [{ activity: a, dependencyConditions: Array.isArray(c) ? c : [c || 'Succeeded'] }];
    const dsRef = (name, params) => ({ referenceName: name, type: 'DatasetReference', parameters: params });
    const lsRef = name => ({ referenceName: name, type: 'LinkedServiceReference' });
    const tableDs = (name, ls, sys) => ({ name, properties: { linkedServiceName: lsRef(ls), parameters: { schema_name: { type: 'string' }, table_name: { type: 'string' } }, annotations: [], type: sys.ds, schema: [], typeProperties: { schema: X('@dataset().schema_name'), table: X('@dataset().table_name') } } });
    const acts = [], datasets = [], params = {}, variables = {}, notes = [];
    const addDs = d => { if (!datasets.some(x => x.name === d.name)) datasets.push(d); };
    const container = cfg.tgt.container.trim() || ph('DATALAKE_CONTAINER');
    const storage = cfg.tgt.storage.trim() || ph('STORAGE_ACCOUNT');
    const sp = (name, proc, ps, after, ls) => ({ name, type: 'SqlServerStoredProcedure', dependsOn: after, policy: policy(false), userProperties: [], typeProperties: { storedProcedureName: proc, storedProcedureParameters: ps }, linkedServiceName: lsRef(ls || n.ctlLs) });
    const P = (v, type) => ({ value: /^@/.test(String(v)) ? X(v) : v, type: type || 'String' });
    let last = null, rowsRead = '0', rowsWritten = '0', winStart = '', winEnd = '', nbPath = '';
    const mainNames = [];
    const push = a => { acts.push(a); mainNames.push(a.name); last = a.name; };

    if (!files) {
      addDs(tableDs(n.srcDs, n.srcLs, srcSys));
      /* watermark lookups */
      if (inc) {
        addDs(tableDs(n.ctlDs, n.ctlLs, n.ctlSys));
        params.p_full_reload = { type: 'bool', defaultValue: false };
        const floor = dt ? '1900-01-01T00:00:00' : '0';
        push({ name: 'lkp_old_watermark', type: 'Lookup', dependsOn: [], policy: policy(true), userProperties: [], typeProperties: {
          source: { type: n.ctlSys.source, sqlReaderQuery: X("SELECT CASE WHEN LOWER('@{pipeline().parameters.p_full_reload}') = 'true' THEN " + sq(floor) + ' ELSE watermark_value END AS watermark_value FROM ' + lit(wmT) + ' WHERE table_name = ' + lit(sq(n.wmKey))), queryTimeout: '02:00:00', partitionOption: 'None' },
          dataset: dsRef(n.ctlDs, { schema_name: std.ctlSchema, table_name: std.wmTable }), firstRowOnly: true } });
        const old = "@{activity('lkp_old_watermark').output.firstRow.watermark_value}";
        const maxExpr = dt ? 'CONVERT(varchar(33), MAX(' + q(wm) + '), 126)' : 'CONVERT(varchar(33), MAX(' + q(wm) + '))';
        push({ name: 'lkp_new_watermark', type: 'Lookup', dependsOn: dep('lkp_old_watermark'), policy: policy(true), userProperties: [], typeProperties: {
          source: { type: srcSys.source, sqlReaderQuery: X('SELECT COALESCE(' + lit(maxExpr) + ", '" + old + "') AS new_watermark FROM " + lit(srcT)), queryTimeout: '02:00:00', partitionOption: 'None' },
          dataset: dsRef(n.srcDs, { schema_name: cfg.src.schema || 'dbo', table_name: cfg.src.table || ph('TABLE') }), firstRowOnly: true } });
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
        inputs: [dsRef(n.srcDs, { schema_name: cfg.src.schema || 'dbo', table_name: cfg.src.table || ph('TABLE') })] };
      if (sql) {
        addDs(tableDs(n.tgtDs, n.tgtLs, tgtSys));
        const sink = { type: tgtSys.sink };
        if (staged) sink.preCopyScript = 'TRUNCATE TABLE ' + stgT;
        else if (write === 'overwrite') sink.preCopyScript = 'TRUNCATE TABLE ' + tgtT;
        if (cfg.tgt.system === 'synapse') { sink.allowCopyCommand = true; } else { sink.writeBehavior = 'insert'; sink.sqlWriterUseTableLock = false; }
        sink.disableMetricsCollection = false;
        cp.typeProperties.sink = sink;
        cp.outputs = [dsRef(n.tgtDs, staged ? { schema_name: std.stgSchema, table_name: n.stgTable } : { schema_name: cfg.tgt.schema || 'dbo', table_name: cfg.tgt.table || ph('TARGET_TABLE') })];
      } else {
        addDs({ name: n.tgtDs, properties: { linkedServiceName: lsRef(n.tgtLs), parameters: { container: { type: 'string' }, folder_path: { type: 'string' }, file_name: { type: 'string' } }, annotations: [], type: 'Parquet',
          typeProperties: { location: { type: 'AzureBlobFSLocation', fileName: X('@dataset().file_name'), folderPath: X('@dataset().folder_path'), fileSystem: X('@dataset().container') }, compressionCodec: 'snappy' }, schema: [] } });
        const folder = pathExpr(std.rawPath, n);
        const file = inc ? n.obj + "_@{replace(replace(replace(activity('lkp_new_watermark').output.firstRow.new_watermark, ':', ''), '-', ''), '.', '')}.parquet" : n.obj + '.parquet';
        cp.typeProperties.sink = { type: 'ParquetSink', storeSettings: { type: 'AzureBlobFSWriteSettings' }, formatSettings: { type: 'ParquetWriteSettings' } };
        cp.outputs = [dsRef(n.tgtDs, { container, folder_path: X(folder), file_name: /@\{/.test(file) ? X(file) : file })];
        nbPath = 'abfss://' + container + '@' + storage + '.dfs.core.windows.net/' + folder + '/' + file;
      }
      push(cp);
      rowsRead = "@activity('" + cpName + "').output.rowsRead"; rowsWritten = "@activity('" + cpName + "').output.rowsCopied";
      if (staged) push(sp(write === 'merge' ? 'sp_merge_' + n.tobj : 'sp_scd2_' + n.tobj, q(std.ctlSchema) + '.' + q(write === 'merge' ? n.mergeProc : n.scdProc), {}, dep(last), n.tgtLs));
    } else {
      /* file landing */
      const lc = cfg.src.container.trim() || ph('LANDING_CONTAINER');
      const landing = cfg.src.folder.trim().replace(/^\/+|\/+$/g, '');
      addDs({ name: n.srcDs, properties: { linkedServiceName: lsRef(n.srcLs), parameters: { container: { type: 'string' }, folder_path: { type: 'string' }, file_name: { type: 'string' } }, annotations: [], type: 'Binary',
        typeProperties: { location: { type: 'AzureBlobFSLocation', fileName: X('@dataset().file_name'), folderPath: X('@dataset().folder_path'), fileSystem: X('@dataset().container') } } } });
      variables.v_quarantined = { type: 'Array' };
      const read = { type: 'AzureBlobFSReadSettings', recursive: false };
      push({ name: 'gm_list_landing_files', type: 'GetMetadata', dependsOn: [], policy: policy(true), userProperties: [], typeProperties: { dataset: dsRef(n.srcDs, { container: lc, folder_path: landing, file_name: '' }), fieldList: ['childItems'], storeSettings: read, formatSettings: { type: 'BinaryReadSettings' } } });
      const conds = ["equals(item().type, 'File')"];
      if (cfg.src.starts.trim()) conds.push("startswith(toLower(item().name), '" + cfg.src.starts.trim().toLowerCase().replace(/'/g, "''") + "')");
      if (cfg.src.ends.trim()) conds.push("endswith(toLower(item().name), '" + cfg.src.ends.trim().toLowerCase().replace(/'/g, "''") + "')");
      const andAll = list => list.length === 1 ? list[0] : 'and(' + andAll(list.slice(0, -1)) + ', ' + list[list.length - 1] + ')';
      push({ name: 'flt_' + n.obj + '_files', type: 'Filter', dependsOn: dep('gm_list_landing_files'), userProperties: [], typeProperties: { items: X("@activity('gm_list_landing_files').output.childItems"), condition: X('@' + andAll(conds)) } });
      const flt = last, raw = pathExpr(std.rawPath, n) + '/@{pipeline().RunId}', arch = pathExpr(std.archivePath, n), quar = pathExpr(std.quarantinePath, n);
      const bin = (folder, c) => dsRef(n.srcDs, { container: c, folder_path: /@\{/.test(folder) ? X(folder) : folder, file_name: X('@item().name') });
      const bcp = (name, after, toFolder) => ({ name, type: 'Copy', dependsOn: after, policy: policy(true), userProperties: [], typeProperties: { source: { type: 'BinarySource', storeSettings: read, formatSettings: { type: 'BinaryReadSettings' } }, sink: { type: 'BinarySink', storeSettings: { type: 'AzureBlobFSWriteSettings' } }, enableStaging: false }, inputs: [bin(landing, lc)], outputs: [bin(toFolder, container)] });
      const del = (name, after) => ({ name, type: 'Delete', dependsOn: after, policy: policy(true), userProperties: [], typeProperties: { dataset: bin(landing, lc), enableLogging: false, storeSettings: read } });
      push({ name: 'fe_land_files', type: 'ForEach', dependsOn: dep(flt), userProperties: [], typeProperties: { items: X("@activity('" + flt + "').output.value"), isSequential: false, batchCount: 4, activities: [
        bcp('cp_file_to_raw', [], raw), bcp('cp_file_to_archive', dep('cp_file_to_raw'), arch), del('del_landed_file', dep('cp_file_to_archive')),
        bcp('cp_file_to_quarantine', dep('cp_file_to_raw', 'Failed'), quar), del('del_quarantined_file', dep('cp_file_to_quarantine')),
        { name: 'av_quarantined_file', type: 'AppendVariable', dependsOn: dep('cp_file_to_quarantine'), userProperties: [], typeProperties: { variableName: 'v_quarantined', value: X('@item().name') } }] } });
      rowsRead = "@activity('" + flt + "').output.FilteredItemsCount"; rowsWritten = "@sub(activity('" + flt + "').output.FilteredItemsCount, length(variables('v_quarantined')))";
      nbPath = 'abfss://' + container + '@' + storage + '.dfs.core.windows.net/' + raw;
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
      if (files) push({ name: 'if_files_landed', type: 'IfCondition', dependsOn: dep(last), userProperties: [], typeProperties: { expression: X("@greater(sub(activity('flt_" + n.obj + "_files').output.FilteredItemsCount, length(variables('v_quarantined'))), 0)"), ifTrueActivities: chain } });
      else { chain[0].dependsOn = dep(last); chain.forEach(push); }
    }
    if (inc) push(sp('sp_update_watermark', ctl + '.' + q('usp_update_watermark'), { table_name: P(n.wmKey), watermark_value: P(winEnd) }, dep(last)));

    /* log, failure path */
    const logP = (status, err) => ({ pipeline_name: P('@pipeline().Pipeline'), run_id: P('@pipeline().RunId'), status: P(status), rows_read: P(status === 'Succeeded' ? rowsRead : '0', 'Int64'), rows_written: P(status === 'Succeeded' ? rowsWritten : '0', 'Int64'),
      window_start: P(winStart && status === 'Succeeded' ? winStart : ''), window_end: P(winEnd && status === 'Succeeded' ? winEnd : ''), error_message: P(err || '') });
    push(sp('sp_log_success', ctl + '.' + q('usp_log_pipeline_run'), logP('Succeeded'), dep(last)));
    if (files) push({ name: 'if_any_quarantined', type: 'IfCondition', dependsOn: dep('sp_log_success'), userProperties: [], typeProperties: { expression: X("@greater(length(variables('v_quarantined')), 0)"),
      ifTrueActivities: [{ name: 'fail_files_quarantined', type: 'Fail', dependsOn: [], userProperties: [], typeProperties: { message: X("@concat(string(length(variables('v_quarantined'))), ' file(s) could not be landed and were moved to quarantine: ', join(variables('v_quarantined'), ', '))"), errorCode: 'FILES_QUARANTINED' } }] } });
    const errExpr = '@coalesce(' + mainNames.concat(files ? ['if_any_quarantined'] : []).map(a => "activity('" + a + "').error?.message").join(', ') + ", 'See the failed activity in Monitor')";
    acts.push(sp('sp_log_failure', ctl + '.' + q('usp_log_pipeline_run'), logP('Failed', errExpr), dep(last, ['Failed', 'Skipped'])));
    let tail = 'sp_log_failure';
    if (cfg.alert === 'web') {
      acts.push({ name: 'web_alert_failure', type: 'WebActivity', dependsOn: dep(tail, 'Completed'), policy: Object.assign(policy(false), { retry: 1 }), userProperties: [], typeProperties: { url: X('@pipeline().globalParameters.' + std.alertParam), method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: X('{"title":"Pipeline failed","pipeline":"@{pipeline().Pipeline}","runId":"@{pipeline().RunId}","dataFactory":"@{pipeline().DataFactory}","message":"See ' + std.ctlSchema + '.' + std.logTable + ' or Monitor for the error."}') } });
      tail = 'web_alert_failure';
    }
    acts.push({ name: 'fail_pipeline', type: 'Fail', dependsOn: dep(tail, 'Completed'), userProperties: [], typeProperties: { message: X("@concat('Pipeline ', pipeline().Pipeline, ' failed. Run ', pipeline().RunId)"), errorCode: 'PIPELINE_FAILED' } });

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

    const sqlText = A.buildSql({ cfg, std, n, cols, write, staged, inc, dt, wm, files, sql, tgtT, stgT, wmT, logT });
    const out = { names: n, pipeline, datasets, trigger, sql: sqlText, write, staged, cols, notes };
    out.json = JSON.stringify(pipeline, null, 4);
    out.placeholders = A.placeholders(out.json + '\n' + JSON.stringify(datasets) + '\n' + sqlText);
    out.steps = A.buildSteps(out, cfg, std);
    out.objects = A.objects(out, cfg, std);
    return out;
  };

  A.placeholders = text => Array.from(new Set(String(text).match(/<[A-Z][A-Z0-9_]{2,}>/g) || []));

  /* ---------- supporting SQL ---------- */
  A.buildSql = function (o) {
    const { cfg, std, n, cols, write, staged, inc, dt, wm, files, sql, tgtT, stgT, wmT, logT } = o;
    const synapse = sql && cfg.tgt.system === 'synapse' && n.ctlLs === n.tgtLs;
    const L = [], ctl = q(std.ctlSchema), GO = 'GO';
    const proc = (name, body) => synapse
      ? ["IF OBJECT_ID('" + name.replace(/'/g, "''") + "', 'P') IS NOT NULL DROP PROCEDURE " + name + ';', GO, 'CREATE PROCEDURE ' + name].concat(body, GO)
      : ['CREATE OR ALTER PROCEDURE ' + name].concat(body, GO);
    const schema = s => ["IF SCHEMA_ID('" + s + "') IS NULL EXEC('CREATE SCHEMA " + q(s) + "');", GO];
    L.push('/* Supporting SQL for ' + n.pipeline + '. Safe to run more than once.', '   Run it in the ' + (sql ? 'target' : 'control') + ' database (linked service ' + n.ctlLs + ')' + (sql && n.ctlLs !== n.tgtLs ? '; the table and merge scripts at the end go in the target database (' + n.tgtLs + ')' : '') + '. */', '');
    L.push.apply(L, schema(std.ctlSchema)); L.push('');
    L.push("IF OBJECT_ID('" + std.ctlSchema + '.' + std.logTable + "', 'U') IS NULL", 'CREATE TABLE ' + logT + ' (', '    log_id         bigint IDENTITY(1,1) NOT NULL,', '    pipeline_name  nvarchar(200)  NOT NULL,', '    run_id         nvarchar(100)  NOT NULL,',
      '    status         nvarchar(20)   NOT NULL,', '    rows_read      bigint         NULL,', '    rows_written   bigint         NULL,', '    window_start   nvarchar(50)   NULL,', '    window_end     nvarchar(50)   NULL,',
      '    error_message  nvarchar(4000) NULL,', '    logged_at_utc  datetime2(3)   NOT NULL DEFAULT SYSUTCDATETIME()', ');', GO, '');
    L.push.apply(L, proc(ctl + '.' + q('usp_log_pipeline_run'), ['    @pipeline_name nvarchar(200), @run_id nvarchar(100), @status nvarchar(20),', '    @rows_read bigint = NULL, @rows_written bigint = NULL,', '    @window_start nvarchar(50) = NULL, @window_end nvarchar(50) = NULL, @error_message nvarchar(4000) = NULL',
      'AS', 'BEGIN', '    SET NOCOUNT ON;', '    INSERT INTO ' + logT + ' (pipeline_name, run_id, status, rows_read, rows_written, window_start, window_end, error_message)',
      "    VALUES (@pipeline_name, @run_id, @status, @rows_read, @rows_written, NULLIF(@window_start, ''), NULLIF(@window_end, ''), NULLIF(LEFT(@error_message, 4000), ''));", 'END'])); L.push('');
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
    if (n.ctlLs !== n.tgtLs && (n.inc || !n.sql || n.files)) add('Linked service', n.ctlLs, 'Reuse', 'Control database (watermark and log tables)');
    o.datasets.forEach(d => add('Dataset', d.name, 'New', d.properties.type + ', parameterized, on ' + d.properties.linkedServiceName.referenceName));
    add('Table', std.ctlSchema + '.' + std.logTable, 'New', 'One row per pipeline run');
    if (n.inc) add('Table', std.ctlSchema + '.' + std.wmTable, 'New', 'Last value loaded per source table');
    if (o.staged) add('Table', std.stgSchema + '.' + n.stgTable, 'New', 'Staging, emptied before each load');
    if (n.sql) add('Table', (cfg.tgt.schema || 'dbo') + '.' + (cfg.tgt.table || ph('TARGET_TABLE')), 'New or reuse', 'Target');
    add('Stored procedure', std.ctlSchema + '.usp_log_pipeline_run', 'New', 'Writes the run log');
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
    L.push('1. Open the ' + (n.sql ? 'target' : 'control') + ' database in SSMS or the Azure portal query editor.', '2. Run the Supporting SQL script. It creates ' + ['the log table'].concat(n.inc ? ['the watermark table with its first row'] : [], o.staged ? ['the staging table'] : [], n.sql ? ['the target table if it is missing'] : []).join(', ') + ' and the stored procedures. It can be run again safely.',
      '3. If the target table already exists, the script leaves it alone: compare its columns with the script’s.');
    sec('PART B - Datasets');
    o.datasets.forEach((d, i) => L.push((i + 1) + '. Author > Datasets > New dataset. Choose ' + ({ SqlServerTable: 'SQL Server', AzureSqlTable: 'Azure SQL Database', AzureSqlDWTable: 'Azure Synapse Analytics', Parquet: 'Azure Data Lake Storage Gen2, then Parquet', Binary: 'Azure Data Lake Storage Gen2, then Binary' }[d.properties.type]) + ', name it ' + d.name + ', pick linked service ' + d.properties.linkedServiceName.referenceName + ' and select OK without choosing a table or file. Then select the code view button {} and replace everything with the JSON for ' + d.name + '.'));
    L.push((o.datasets.length + 1) + '. Skip a dataset that already exists with the same name and parameters.');
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
    if (n.files) T.push('Put two small files in the landing folder and select Debug. Both should appear under the raw path, then in archive, and the landing folder should be empty.', 'Run it again with an empty landing folder: it should succeed and log 0 files.');
    else {
      T.push('Select Debug' + (n.inc ? ' with p_full_reload = false. The first run loads everything after the seeded watermark; for a large table, set the watermark row to a recent value first to load a small window.' : '.'));
      T.push('Compare counts: rows_read and rows_written in ' + std.ctlSchema + '.' + std.logTable + ' against SELECT COUNT(*) on the source for the same window' + (n.sql ? ', and against the ' + (o.staged ? 'staging' : 'target') + ' table.' : '.'));
      if (n.inc) T.push('Check the watermark moved: SELECT * FROM ' + std.ctlSchema + '.' + std.wmTable + ' WHERE table_name = ' + sq(n.wmKey) + ';');
      if (n.inc) T.push('Force a failure (rename the ' + (o.staged ? 'staging' : 'target') + ' table for one run, or cancel the Copy) and confirm the watermark did not move.');
      if (o.staged) T.push('Run the same window twice (set the watermark row back to its earlier value): the target row count must not change.');
    }
    T.push('Failure path: after the forced failure, confirm a Failed row in the log' + (cfg.alert === 'web' ? ', the alert arriving,' : '') + ' and the pipeline run showing Failed in Monitor.');
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
  A.check = function (pipeline, std) {
    std = Object.assign(A.defaultStandards(), std || {});
    const F = [], add = (sev, rule, msg, activity) => F.push({ sev, rule, msg, activity: activity || '' });
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
          if (!byName[m[1]]) add('high', 'Expressions', 'An expression reads activity(\'' + m[1] + '\'), which doesn’t exist.', f.name);
          else if (m[1] !== f.name && !mine.has(m[1])) add('medium', 'Expressions', 'An expression reads the output of ' + m[1] + ', but this activity doesn’t run after it, so the output may not be there.', f.name);
        }
        const rp = /pipeline\(\)\.parameters\.([A-Za-z_][A-Za-z0-9_]*)/g; while ((m = rp.exec(s))) if (!(m[1] in pdef)) add('high', 'Expressions', 'It uses the parameter ' + m[1] + ', which the pipeline doesn’t define.', f.name);
        const rv = /variables\('([^']+)'\)/g; while ((m = rv.exec(s))) if (!(m[1] in vdef)) add('high', 'Expressions', 'It uses the variable ' + m[1] + ', which the pipeline doesn’t define.', f.name);
        if (secrets.test(s)) add('high', 'Secrets', 'A setting looks like it holds a secret (a key, password or token). Keep secrets in Azure Key Vault through the linked service, never in pipeline JSON.', f.name);
      });
      if ((f.type === 'SetVariable' || f.type === 'AppendVariable') && tp.variableName && !(tp.variableName in vdef)) add('high', 'Expressions', 'It sets the variable ' + tp.variableName + ', which the pipeline doesn’t define.', f.name);
      if (PREFIX[f.type] && f.name && f.name.indexOf(PREFIX[f.type]) !== 0) add('low', 'Standards', 'A ' + f.type + ' activity is named ' + PREFIX[f.type] + '<object> under the team standards.', f.name);
      if (/^(Copy|Lookup|GetMetadata)$/.test(f.type)) {
        const pol = f.a.policy || {};
        if (!pol.retry) add('low', 'Standards', 'No retry. The team standard is ' + std.retry + ' retries, ' + std.retrySec + ' seconds apart, for Copy, Lookup and Get Metadata.', f.name);
        if (!pol.timeout || /^[1-9]\d*\./.test(pol.timeout)) add('low', 'Standards', 'The timeout is ' + (pol.timeout ? pol.timeout.split('.')[0] + ' day(s)' : 'the default') + '. A stuck activity holds the run that long; the team standard is ' + std.timeoutHrs + ' hours.', f.name);
      }
      if (f.type === 'Lookup' && tp.firstRowOnly === false) add('low', 'Correctness', 'This Lookup returns many rows. A Lookup stops at 5,000 rows or 4 MB without an error, so a longer list is cut short.', f.name);
      if (f.type === 'Copy') {
        const sink = tp.sink || {}, src = tp.source || {};
        const qy = src.sqlReaderQuery && (src.sqlReaderQuery.value || src.sqlReaderQuery);
        if (typeof qy === 'string' && /select\s+\*/i.test(qy)) add('low', 'Correctness', 'The source query uses SELECT *. A new source column changes what is copied without anyone deciding it; list the columns.', f.name);
        if (/Sql|DW/.test(String(sink.type || '')) && !sink.preCopyScript && sink.writeBehavior !== 'upsert' && !sink.sqlWriterStoredProcedureName && !flat.some(x => x.type === 'SqlServerStoredProcedure' || x.type === 'Script'))
          add('medium', 'Rerun safety', 'The copy inserts into a SQL table with no pre-copy script, upsert or merge step, so rerunning the same window adds the rows again.', f.name);
      }
    });
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
        if (!all.has(l.name)) add('high', 'Correctness', 'The watermark is updated without waiting for ' + l.name + '. If that load fails, the watermark has already moved and those rows are never picked up.', w.name);
        else if (!s.has(l.name)) add('high', 'Correctness', 'The watermark update runs after ' + l.name + ' on a path that isn’t Succeeded only, so it can move after a failed load.', w.name);
      });
      if (!loads.some(l => l.siblings === w.siblings)) add('medium', 'Correctness', 'The watermark is updated but no load (Copy, data flow or merge) runs before it in the same place.', w.name);
    });
    if (usesWm && !wmUpd.length && flat.some(f => f.type === 'Copy')) add('medium', 'Correctness', 'The pipeline reads a watermark but nothing updates it after the load, so every run reloads the same window. (If another pipeline or the merge procedure updates it, ignore this.)');
    /* failure path */
    const hasFail = flat.some(f => (f.a.dependsOn || []).some(d => (d.dependencyConditions || []).some(c => c === 'Failed' || c === 'Completed')));
    if (flat.length && !hasFail) add('medium', 'Failure path', 'Nothing runs when an activity fails: no log row and no alert. Add a failure path from the last activity (conditions Failed and Skipped).');
    const handlers = top.filter(f => (f.a.dependsOn || []).some(d => (d.dependencyConditions || []).indexOf('Failed') >= 0));
    if (handlers.length && !flat.some(f => f.type === 'Fail')) add('medium', 'Failure path', 'A failure path that succeeds can make the whole run show Succeeded in Monitor. End the failure path with a Fail activity so triggers and dependent pipelines see the failure.');
    handlers.forEach(h => { const ds = h.a.dependsOn || []; if (ds.length > 1 && ds.every(d => (d.dependencyConditions || []).length === 1 && d.dependencyConditions[0] === 'Failed')) add('high', 'Failure path', 'It waits for ' + ds.length + ' activities to all fail. Dependencies are combined with AND, so it only runs if every one of them fails. Depend on the last activity with Failed and Skipped instead.', h.name); });
    const order = { high: 0, medium: 1, low: 2 };
    return F.sort((a, b) => order[a.sev] - order[b.sev]);
  };
  A.flow = function (pipeline) {
    return A.flatten(pipeline).map(f => ({ name: f.name, type: f.type, depth: f.depth, inside: f.parent ? f.parent.name + (f.branch && f.branch !== 'activities' ? ' (' + f.branch.replace('ifTrueActivities', 'when true').replace('ifFalseActivities', 'when false').replace('defaultActivities', 'default') + ')' : '') : '',
      after: (f.a.dependsOn || []).map(d => ({ activity: d.activity, conds: d.dependencyConditions || [] })) }));
  };
  A.placeholdersIn = A.placeholders;

  root.ADF = A;
  if (typeof module !== 'undefined') module.exports = A;
})(typeof window !== 'undefined' ? window : globalThis);

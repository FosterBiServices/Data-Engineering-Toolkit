/* Python Notebook Generator: bronze, silver and gold PySpark notebooks for Databricks. No DOM in this file. */
(function (root) {
  'use strict';
  const P = {};
  const py = s => JSON.stringify(String(s));
  const snake = s => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  const col = n => 'F.col(' + py(/[^A-Za-z0-9_]/.test(n) ? '`' + n.replace(/`/g, '``') + '`' : n) + ')';
  const CELL = '\n# COMMAND ----------\n';
  const md = t => CELL + '\n# MAGIC %md ## ' + t + '\n' + CELL + '\n';
  P.snake = snake;

  P.TYPES = ['string', 'int', 'bigint', 'decimal(18,2)', 'double', 'boolean', 'date', 'timestamp'];
  P.CLEAN = { string: [['trim', 'Trim spaces'], ['trim_null', 'Trim, empty to null'], ['trim_upper', 'Trim, upper case'], ['none', 'As is']], timestamp: [['none', 'As is'], ['utc', 'Local time to UTC']] };
  P.AGGS = [['sum', 'Sum'], ['count', 'Count rows'], ['countDistinct', 'Count distinct'], ['avg', 'Average'], ['min', 'Minimum'], ['max', 'Maximum']];
  P.RULES = [['min', 'is at least', 'number'], ['max', 'is at most', 'number'], ['inlist', 'is one of', 'A, B, C'], ['regex', 'matches pattern', '^[A-Z]{2}$'], ['notfuture', 'is not in the future', ''], ['expr', 'fails when (Spark SQL)', 'ship_date < order_date']];

  P.blank = () => ({
    layer: 'silver', entity: '', subject: '', folder: '/Shared/medallion',
    cat: { bronze: 'bronze', silver: 'silver', gold: 'gold' },
    bronze: { format: 'parquet', path: '' },
    silver: { schemaText: '', cols: [], orderCol: '', tz: 'America/New_York', rules: [], softDelete: '', cluster: '', aiReq: '', aiReply: '' },
    gold: { name: '', schemaText: '', cols: [], grain: [], mode: 'dates', rebuildCol: '', metrics: [], derived: [], softDelete: '', aiReq: '', aiReply: '' }
  });

  /* ---------- names ---------- */
  P.names = function (cfg) {
    const e = snake(cfg.entity) || '<entity>', s = snake(cfg.subject) || '<subject>', c = cfg.cat, g = snake(cfg.gold.name) || 'fact_' + e;
    const n = { entity: e, subject: s,
      bronze: c.bronze + '.' + s + '.' + e + '_raw', silver: c.silver + '.' + s + '.' + e, gold: c.gold + '.' + s + '.' + g,
      nbBronze: 'nb_bronze_' + e, nbSilver: 'nb_silver_' + e, nbGold: 'nb_gold_' + g.replace(/^(fact|dim|agg)_/, '') };
    n.quarantine = n.silver + '_quarantine';
    n.nb = { bronze: n.nbBronze, silver: n.nbSilver, gold: n.nbGold }[cfg.layer];
    n.path = (cfg.folder || '').replace(/\/+$/, '') + '/' + n.nb;
    return n;
  };

  /* ---------- reading a pasted schema ---------- */
  const SQL2SPARK = { int: 'int', integer: 'int', smallint: 'int', tinyint: 'int', bigint: 'bigint', long: 'bigint', short: 'int', byte: 'int', bit: 'boolean', boolean: 'boolean', float: 'double', real: 'double', double: 'double', money: 'decimal(19,4)', smallmoney: 'decimal(10,4)',
    date: 'date', datetime: 'timestamp', datetime2: 'timestamp', smalldatetime: 'timestamp', datetimeoffset: 'timestamp', timestamp: 'timestamp', timestamp_ntz: 'timestamp', time: 'string',
    varchar: 'string', nvarchar: 'string', char: 'string', nchar: 'string', text: 'string', ntext: 'string', string: 'string', uniqueidentifier: 'string', xml: 'string', binary: 'string', varbinary: 'string' };
  P.sparkType = function (t, prec, scale) {
    t = String(t || '').toLowerCase().trim();
    const m = /^(decimal|numeric)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+))?\s*\))?$/.exec(t);
    if (m) return 'decimal(' + (m[2] || prec || 18) + ',' + (m[3] != null ? m[3] : (scale != null ? scale : (m[2] ? 0 : 2))) + ')';
    return SQL2SPARK[t.replace(/\(.*$/, '')] || 'string';
  };
  P.parseSchema = function (text) {
    const out = { cols: [], errors: [], kind: '' }, seen = new Set();
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const add = (name, type, extra) => { if (!name || seen.has(name.toLowerCase())) return; seen.add(name.toLowerCase()); out.cols.push(Object.assign({ name, type }, extra || {})); };
    const tree = lines.filter(l => /^\s*\|--\s/.test(l));
    if (tree.length) {                       // df.printSchema()
      out.kind = 'printSchema';
      tree.forEach(l => { const m = /^\s*\|--\s+(.+?):\s+([a-z_]+(?:\([^)]*\))?)/i.exec(l); if (m && !/^\s*\|\s+\|--/.test(l)) add(m[1].trim(), P.sparkType(m[2])); });
      return out;
    }
    const rows = lines.filter(l => l.trim()).map(l => l.indexOf('\t') >= 0 ? l.split('\t') : l.trim().split(/\s*\|\s*|\s{2,}/)).map(r => r.map(s => s.trim()));
    if (!rows.length) return out;
    const head = rows[0].map(s => s.toUpperCase()), ci = head.indexOf('COLUMN_NAME'), ti = head.indexOf('DATA_TYPE');
    if (ci >= 0 && ti >= 0) {                // the ADF generator's schema query
      out.kind = 'sql'; const pi = head.indexOf('PREC'), si = head.indexOf('SCALE'), ki = head.indexOf('KEY_FLAG');
      rows.slice(1).forEach(r => add(r[ci], P.sparkType(r[ti], parseInt(r[pi], 10) || null, isNaN(parseInt(r[si], 10)) ? null : parseInt(r[si], 10)), { pk: ki >= 0 && /pk/i.test(r[ki] || '') }));
      return out;
    }
    out.kind = 'list';                       // "name type" per line, or DESCRIBE output
    rows.forEach(r => { const parts = r.length > 1 ? r : r[0].split(/\s+/); const name = parts[0].replace(/[:,]$/, ''), type = parts.slice(1).join('').replace(/,$/, '') || 'string';
      if (/^(col_name$|#)/i.test(name) || !/^[A-Za-z_][\w .]*$/.test(name)) return; add(name, P.sparkType(type)); });
    if (!out.cols.length) out.errors.push('No columns were read. Paste the SCHEMA part of the context cell’s output, or one “name type” per line.');
    return out;
  };
  /* turn pasted bronze columns into a silver mapping, keeping any edits already made */
  P.mapCols = function (parsed, old) {
    const prev = {}; (old || []).forEach(c => { prev[c.src.toLowerCase()] = c; });
    return parsed.cols.filter(c => !/^_/.test(c.name)).map(c => {
      const p = prev[c.name.toLowerCase()]; if (p) return Object.assign({}, p, { src: c.name });
      const type = c.type;
      return { src: c.name, name: snake(c.name), type, clean: type === 'string' ? 'trim' : 'none', on: true, key: !!c.pk, notnull: !!c.pk };
    });
  };
  P.suggestOrder = cols => { const c = cols.filter(x => x.on && x.type === 'timestamp'); return ((c.find(x => /modif|updat|chang/.test(x.name)) || c[0] || {}).name) || ''; };

  /* ---------- context cell ---------- */
  P.contextCell = function (cfg) {
    const n = P.names(cfg), L = cfg.layer;
    const table = L === 'silver' ? n.bronze : (L === 'gold' ? n.silver : null);
    const keys = L === 'gold' ? cfg.silver.cols.filter(c => c.key && c.on).map(c => c.name) : [];
    return ['# ---- Context cell: run it, then paste the printed output into the page ----', 'from pyspark.sql import functions as F', '',
      'INPUT_TABLE = ' + (table ? py(table) : 'None'), 'INPUT_PATH  = ' + (table ? 'None' : py(cfg.bronze.path || 'abfss://<container>@<account>.dfs.core.windows.net/<folder>/')), 'INPUT_FMT   = ' + py(cfg.bronze.format),
      'KEY_COLS    = ' + JSON.stringify(keys) + '          # business key(s), if known', 'MASK_COLS   = ["email", "phone"]   # columns to hide in the sample', '',
      'df = spark.table(INPUT_TABLE) if INPUT_TABLE else spark.read.format(INPUT_FMT).option("header", "true").load(INPUT_PATH)', '',
      'print("=== SCHEMA ===")', 'df.printSchema()', '', 'print("=== ROW COUNT ===", df.count())', '',
      'if KEY_COLS:', '    dupes = df.groupBy(*KEY_COLS).count().filter("count > 1").count()', '    print("=== KEYS WITH DUPLICATES ===", dupes)', '',
      'print("=== NULL COUNTS ===")', 'df.select([F.sum(F.col(f"`{c}`").isNull().cast("int")).alias(c) for c in df.columns]).show(vertical=True, truncate=False)', '',
      'print("=== SAMPLE (masked) ===")', 'sample = df.limit(5)', 'for c in MASK_COLS:', '    if c in sample.columns:', '        sample = sample.withColumn(c, F.lit("***"))', 'sample.show(truncate=40, vertical=True)'].join('\n');
  };

  /* ---------- Copilot: extra columns, rules and metrics in plain words ---------- */
  const SPARK_TYPE = /^(string|int|bigint|double|float|boolean|date|timestamp|decimal\(\s*\d+\s*,\s*\d+\s*\))$/i;
  const FORBID = /\b(import|lambda|eval|exec|open|udf|pandas_udf|spark|dbutils|collect|toPandas|display|os|sys|subprocess|__\w+__|globals|locals|getattr|setattr)\b/;
  const strip = e => e.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  P.vetExpr = function (what, e, known) {
    const f = [], bare = strip(e);
    if (!e) return [what + ' is empty.'];
    if (/[;\n]/.test(bare)) f.push(what + ' has more than one statement.');
    const bad = FORBID.exec(bare); if (bad) f.push(what + ' uses ' + bad[1] + ', which isn’t allowed here.');
    let d = 0; for (const ch of bare) { if ('([{'.indexOf(ch) >= 0) d++; if (')]}'.indexOf(ch) >= 0) d--; if (d < 0) break; }
    if (d !== 0) f.push(what + ' has brackets that don’t balance.');
    const refs = []; const re = /F\.col\(\s*(["'])(.*?)\1\s*\)/g; let m; while ((m = re.exec(e))) refs.push(m[2].replace(/`/g, ''));
    refs.filter(r => !known.has(r.toLowerCase())).forEach(r => f.push(what + ' uses the column ' + r + ', which doesn’t exist at that point.'));
    const ids = bare.match(/(^|[^.\w])([A-Za-z_]\w*)\s*\(/g) || [];
    ids.map(s => s.replace(/^[^A-Za-z_]+/, '').replace(/\s*\($/, '')).filter(s => !/^(F|Window|int|float|str|bool)$/.test(s)).forEach(s => f.push(what + ' calls ' + s + '(), which isn’t a pyspark.sql.functions call. Write it as F.' + s + '(...) if it is one.'));
    return f;
  };
  P.aiPrompt = function (cfg) {
    const L = cfg.layer, n = P.names(cfg), gold = L === 'gold', req = gold ? cfg.gold.aiReq : cfg.silver.aiReq, T = [];
    const cols = gold ? cfg.gold.cols : cfg.silver.cols.filter(c => c.on);
    T.push('You are writing PySpark column expressions for a Databricks ' + L + ' notebook in a medallion architecture. You cannot see the data: use only the columns listed under CONTEXT.');
    T.push('', 'TASK (the user’s request: all the expressions have to do)', (req || '(not given)').trim());
    T.push('', 'CONTEXT', gold ? 'Input: the silver table ' + n.silver + '. Output: ' + n.gold + ', one row per ' + (cfg.gold.grain.join(', ') || '(grain not set)') + '.' : 'Input: one batch of ' + n.bronze + ', already renamed, typed and cleaned into the columns below. Output: ' + n.silver + '.',
      'Columns available (name | type):');
    cols.forEach(c => T.push('- ' + c.name + ' | ' + c.type));
    if (gold && cfg.gold.metrics.length) T.push('Metrics already defined (use them by name in a DERIVED block; do not define them again): ' + cfg.gold.metrics.map(m => m.name).filter(Boolean).join(', '));
    T.push('', 'STARTING POINT', gold ? 'The notebook groups by the grain and computes the metrics already defined. You only add METRIC and DERIVED blocks.' : 'The notebook already selects, casts, cleans and dedupes the columns above, and checks the rules set on the page. You only add COLUMN and RULE blocks.');
    T.push('', 'RULES', '- Use only pyspark.sql.functions through the alias F, and columns as F.col("name") with the exact names listed. No Python UDFs, no spark.sql, no collect, no imports.',
      '- One expression per EXPR line: no assignments, no semicolons, no line breaks.');
    if (gold) T.push('- METRIC: an aggregate expression evaluated per grain row, for example F.sum(F.when(F.col("status") == "CANCELLED", F.col("amount")).otherwise(0)).', '- DERIVED: an expression over metric names (as F.col("metric_name")), evaluated after the aggregation.');
    else T.push('- COLUMN: a new silver column, or a replacement for a listed one (same NAME). Give its Spark SQL type: string, int, bigint, double, decimal(p,s), boolean, date or timestamp.', '- RULE: FAILS_WHEN is a boolean column expression that is true for a bad row. Bad rows go to the quarantine table; they are never dropped.', '- Do not change the business key' + (cfg.silver.orderCol ? ' or ' + cfg.silver.orderCol : '') + '.');
    T.push('- Names in snake_case.', '- If the TASK can’t be done with the listed columns, write a SKIPPED block that says why instead of guessing.');
    T.push('', 'REPLY FORMAT (a template: replace the placeholder lines with your answer)', 'Reply inside one code block, with these labelled blocks and nothing else:');
    if (gold) T.push('@@@ METRIC @@@', 'NAME: metric_name', 'EXPR: pyspark aggregate expression', '@@@ DERIVED @@@', 'NAME: metric_name', 'EXPR: pyspark expression over metrics');
    else T.push('@@@ COLUMN @@@', 'NAME: column_name', 'TYPE: spark type', 'EXPR: pyspark expression', '@@@ RULE @@@', 'NAME: rule_name', 'FAILS_WHEN: pyspark boolean expression');
    T.push('@@@ SKIPPED @@@', 'what could not be done and why', '@@@ NOTES @@@', 'assumptions to confirm, one per line');
    return T.join('\n');
  };
  P.aiParse = function (reply, cfg, parseBlocks, fields) {
    const gold = cfg.layer === 'gold', res = { items: [], notes: [], skipped: [], any: false };
    const blocks = parseBlocks(reply); if (!blocks.length) return res;
    const base = gold ? cfg.gold.cols.map(c => c.name) : cfg.silver.cols.filter(c => c.on).map(c => c.name);
    const known = new Set(base.map(s => s.toLowerCase())), metricNames = new Set(cfg.gold.metrics.map(m => (m.name || '').toLowerCase()).filter(Boolean));
    const taken = new Set(), keys = new Set(cfg.silver.cols.filter(c => c.key).map(c => c.name.toLowerCase()).concat(cfg.silver.orderCol ? [cfg.silver.orderCol.toLowerCase()] : []));
    const one = s => (s || '').replace(/\s*\n\s*/g, ' ').trim();
    blocks.forEach(b => {
      const kind = b.tag;
      if (kind === 'NOTES') { b.body.split('\n').map(s => s.replace(/^[-*]\s*/, '').trim()).filter(s => s && !/^assumptions to confirm/i.test(s)).forEach(s => res.notes.push(s)); if (res.notes.length) res.any = true; return; }
      if (kind === 'SKIPPED') { if (b.body && !/^what could not be done/i.test(b.body)) { res.skipped.push(b.body); res.any = true; } return; }
      if (!/^(COLUMN|RULE|METRIC|DERIVED)$/.test(kind)) return;
      const f = fields(b.body, ['NAME', 'TYPE', 'EXPR', 'FAILS_WHEN']);
      const name = one(f.NAME), expr = one(kind === 'RULE' ? f.FAILS_WHEN : f.EXPR), type = one(f.TYPE).toLowerCase().replace(/\s+/g, '');
      if (/^(column_name|metric_name|rule_name)$/.test(name) && /^pyspark /.test(expr)) return;     // the template repeated back
      res.any = true;
      const it = { kind, name, type, expr, problems: [] };
      if ((kind === 'COLUMN' || kind === 'RULE') === gold) it.problems.push('A ' + kind + ' block doesn’t belong in a ' + cfg.layer + ' notebook.');
      if (!/^[a-z][a-z0-9_]*$/.test(name)) it.problems.push('The name must be snake_case: lower-case letters, digits and underscores.');
      if (taken.has(kind + ':' + name)) it.problems.push('The name is used twice.'); taken.add(kind + ':' + name);
      if (kind === 'COLUMN' && !SPARK_TYPE.test(type)) it.problems.push('TYPE “' + type + '” isn’t one of the Spark types asked for.');
      if (kind === 'COLUMN' && keys.has(name)) it.problems.push('It replaces the key or ordering column ' + name + '.');
      if (kind === 'METRIC' && metricNames.has(name)) it.problems.push('A metric with this name is already set on the page.');
      const scope = kind === 'DERIVED' ? new Set(Array.from(metricNames).concat(cfg.gold.grain.map(g => g.toLowerCase()), res.items.filter(x => (x.kind === 'METRIC' || x.kind === 'DERIVED') && !x.problems.length).map(x => x.name))) : known;
      P.vetExpr('The expression', expr, scope).forEach(p => it.problems.push(p));
      if (kind === 'METRIC' && !/F\.(sum|count|countDistinct|count_distinct|avg|mean|min|max|first|last|approx_count_distinct|sum_distinct|stddev|collect_set|collect_list|max_by|min_by|median|percentile_approx)\s*\(/.test(expr)) it.problems.push('A metric must be an aggregate (F.sum, F.count, F.avg ...).');
      if (kind === 'COLUMN' && !it.problems.length) { it.replaces = known.has(name); known.add(name); }
      res.items.push(it);
    });
    res.ok = res.items.filter(i => !i.problems.length);
    return res;
  };

  /* ---------- checks on the setup ---------- */
  P.problems = function (cfg) {
    const R = [], add = (sev, msg) => R.push({ sev, msg }), L = cfg.layer;
    if (!cfg.entity.trim()) add('err', 'Name the entity (for example orders). It names the notebook and the tables.');
    if (!cfg.subject.trim()) add('warn', 'No subject area: table names use the placeholder <subject>.');
    if (L === 'silver') {
      const on = cfg.silver.cols.filter(c => c.on), names = on.map(c => c.name);
      if (!cfg.silver.cols.length) { add('err', 'Paste the bronze table’s schema in Step 2 so the page knows the columns.'); return R; }
      if (!on.some(c => c.key)) add('err', 'Tick the business key: the column or columns that identify one row. Silver merges on it.');
      names.filter((n, i) => names.indexOf(n) !== i).forEach(n => add('err', 'Two columns are both named ' + n + ' in silver. Rename one.'));
      on.filter(c => !/^[a-z][a-z0-9_]*$/.test(c.name)).forEach(c => add('err', 'The silver name “' + c.name + '” isn’t snake_case.'));
      if (!cfg.silver.orderCol) add('warn', 'No ordering column: when a key arrives twice, the row kept is the one ingested last, and a late-arriving older version can overwrite a newer one.');
      else if (names.indexOf(cfg.silver.orderCol) < 0) add('err', 'The ordering column ' + cfg.silver.orderCol + ' isn’t one of the silver columns.');
      if (on.some(c => c.clean === 'utc') && !cfg.silver.tz.trim()) add('err', 'Give the time zone the source writes timestamps in.');
      cfg.silver.rules.forEach((r, i) => { if (!r.col && r.kind !== 'expr') add('err', 'Quality rule ' + (i + 1) + ' has no column.'); else if (r.kind !== 'expr' && names.indexOf(r.col) < 0) add('err', 'Quality rule ' + (i + 1) + ' uses ' + r.col + ', which isn’t a silver column.'); if (/^(min|max|inlist|regex|expr)$/.test(r.kind) && !String(r.val || '').trim()) add('err', 'Quality rule ' + (i + 1) + ' needs a value.'); if (/^(min|max)$/.test(r.kind) && String(r.val || '').trim() && isNaN(Number(r.val))) add('err', 'Quality rule ' + (i + 1) + ': “' + r.val + '” isn’t a number.'); });
      if (cfg.silver.softDelete && names.indexOf(cfg.silver.softDelete) < 0) add('err', 'The deleted flag ' + cfg.silver.softDelete + ' isn’t one of the silver columns.');
    }
    if (L === 'gold') {
      const g = cfg.gold, names = g.cols.map(c => c.name);
      if (!g.cols.length) { add('err', 'Give the silver table’s columns in Step 2.'); return R; }
      if (!g.grain.length) add('err', 'Choose the grain: the columns that make one row of the gold table (for example order_date and store_id).');
      g.grain.filter(x => names.indexOf(x) < 0).forEach(x => add('err', 'The grain column ' + x + ' isn’t in the silver columns.'));
      if (!g.metrics.length) add('err', 'Add at least one metric.');
      const mn = g.metrics.map(m => m.name);
      g.metrics.forEach((m, i) => { if (!/^[a-z][a-z0-9_]*$/.test(m.name || '')) add('err', 'Metric ' + (i + 1) + ' needs a snake_case name.'); if (m.agg !== 'count' && names.indexOf(m.col) < 0) add('err', 'Metric ' + (m.name || i + 1) + ' needs a column.'); if (mn.indexOf(m.name) !== i) add('err', 'Two metrics are named ' + m.name + '.'); if (g.grain.indexOf(m.name) >= 0) add('err', 'The metric ' + m.name + ' has the same name as a grain column.'); });
      g.derived.forEach((d, i) => { if (!/^[a-z][a-z0-9_]*$/.test(d.name || '')) add('err', 'Calculated metric ' + (i + 1) + ' needs a snake_case name.'); if (!String(d.expr || '').trim()) add('err', 'Calculated metric ' + (d.name || i + 1) + ' needs a formula.'); });
      if (g.mode === 'dates') {
        if (!g.rebuildCol) add('err', 'Choose the date column to rebuild by, or switch to rebuilding the whole table.');
        else if (g.grain.indexOf(g.rebuildCol) < 0) add('err', 'The rebuild column ' + g.rebuildCol + ' must be part of the grain, so replacing its dates replaces whole rows.');
        else if ((g.cols.find(c => c.name === g.rebuildCol) || {}).type !== 'date') add('warn', g.rebuildCol + ' isn’t a date column. Rebuilding by a timestamp rebuilds almost nothing each run; add a date column in silver and use that.');
      }
      if (!g.metrics.some(m => m.agg === 'sum' && !String(m.filter || '').trim())) add('info', 'No plain Sum metric to reconcile on, so the notebook reconciles row counts only. Add an unfiltered Sum to check totals against silver.');
      if (g.softDelete && names.indexOf(g.softDelete) < 0) add('err', 'The deleted flag ' + g.softDelete + ' isn’t in the silver columns.');
    }
    return R;
  };

  /* ---------- notebook pieces ---------- */
  const head = (name, lines) => '# Databricks notebook source\n# MAGIC %md\n# MAGIC # ' + name + '\n' + lines.map(l => '# MAGIC ' + l).join('\n') + '\n';
  const widgets = (list) => {
    const pad = Math.max.apply(null, list.map(w => w[0].length));
    const L = list.map(w => 'dbutils.widgets.text(' + py(w[0]) + ', ' + py(w[1]) + ')');
    L.push(''); list.forEach(w => L.push(w[0].padEnd(pad) + ' = dbutils.widgets.get(' + py(w[0]) + ')' + (w[3] || '')));
    const req = list.filter(w => w[2]).map(w => w[0]);
    L.push('', 'missing = [k for k, v in {' + req.map(k => py(k) + ': ' + k).join(', ') + '}.items() if not v]', 'if missing:', '    raise ValueError(f"Missing required parameters: {missing}")');
    return L.join('\n');
  };
  const EXIT = (pairs) => 'dbutils.notebook.exit(json.dumps({\n    ' + pairs.join(',\n    ') + ',\n}))';

  P.bronze = function (cfg) {
    const n = P.names(cfg), fmt = cfg.bronze.format;
    let s = head(n.nbBronze, ['Lands one batch of ' + n.entity + ' files into bronze exactly as received. Called by ADF.', 'Rerunning the same batch_id replaces that batch; it never duplicates.']);
    s += md('1. Parameters') + widgets([['source_path', '', true], ['file_format', fmt, false, '.lower()'], ['target_table', n.bronze, true], ['batch_id', '', true]]) + '\n';
    s += md('2. Imports') + 'import json\nfrom pyspark.sql import functions as F\n';
    s += md('3. Read') + ['reader = spark.read.format(file_format)', 'if file_format in ("csv", "json"):', '    # Keep every row: anything that doesn\'t fit the schema lands in _rescued_data instead of being dropped',
      '    reader = reader.option("mode", "PERMISSIVE").option("rescuedDataColumn", "_rescued_data")', '    if file_format == "csv":', '        reader = reader.option("header", "true")', '', 'raw = reader.load(source_path)'].join('\n') + '\n';
    s += md('4. Add metadata (no business logic in bronze)') + ['bronze = (', '    raw.withColumn("_source_file", F.col("_metadata.file_path"))', '       .withColumn("_ingest_ts", F.current_timestamp())', '       .withColumn("_batch_id", F.lit(batch_id))', ')'].join('\n') + '\n';
    s += md('6. Write: idempotent per batch') + ['if spark.catalog.tableExists(target_table):', '    # A rerun of the same batch replaces its rows instead of adding them again', '    (bronze.write.format("delta").mode("overwrite")',
      '        .option("replaceWhere", f"_batch_id = \'{batch_id}\'")', '        .option("mergeSchema", "true")', '        .saveAsTable(target_table))', 'else:', '    bronze.write.format("delta").saveAsTable(target_table)',
      '    spark.sql(f"COMMENT ON TABLE {target_table} IS \'Bronze: ' + n.entity + ' as received, one batch per ADF run\'")'].join('\n') + '\n';
    s += md('7. Metrics and exit') + ['rows_written = spark.table(target_table).filter(F.col("_batch_id") == batch_id).count()',
      EXIT(['"status": "succeeded"', '"batch_id": batch_id', '"rows_read": rows_written', '"rows_written": rows_written', '"rows_quarantined": 0'])].join('\n') + '\n';
    return s;
  };

  const cleanExpr = function (c, softDelete) {
    const s = col(c.src);
    if (c.name === softDelete) return 'F.coalesce(' + s + '.cast("boolean"), F.lit(False))';
    if (c.type === 'string') return c.clean === 'trim' ? 'F.trim(' + s + '.cast("string"))' : c.clean === 'trim_upper' ? 'F.upper(F.trim(' + s + '.cast("string")))' : c.clean === 'trim_null' ? 'F.when(F.trim(' + s + '.cast("string")) != "", F.trim(' + s + '.cast("string")))' : s + '.cast("string")';
    if (c.type === 'date') return 'F.to_date(' + s + ')';
    if (c.type === 'timestamp') return c.clean === 'utc' ? 'F.to_utc_timestamp(' + s + '.cast("timestamp"), SOURCE_TZ)' : s + '.cast("timestamp")';
    return s + '.cast(' + py(c.type) + ')';
  };
  const ruleExpr = function (r) {
    const c = col(r.col), v = String(r.val || '').trim();
    if (r.kind === 'min') return [r.col + '_below_' + v.replace(/[^0-9a-z]+/gi, '_').replace(/^_|_$/g, ''), c + ' < ' + Number(v)];
    if (r.kind === 'max') return [r.col + '_above_' + v.replace(/[^0-9a-z]+/gi, '_').replace(/^_|_$/g, ''), c + ' > ' + Number(v)];
    if (r.kind === 'inlist') return [r.col + '_invalid', c + '.isNull() | ~' + c + '.isin(' + v.split(',').map(x => x.trim()).filter(Boolean).map(py).join(', ') + ')'];
    if (r.kind === 'regex') return [r.col + '_bad_format', c + '.isNotNull() & ~' + c + '.rlike(' + py(v) + ')'];
    if (r.kind === 'notfuture') return [r.col + '_in_future', c + ' > F.current_timestamp()'];
    return [(snake(r.name) || 'custom_rule'), 'F.expr(' + py(v) + ')'];
  };

  P.silver = function (cfg, ai) {
    const n = P.names(cfg), sv = cfg.silver, cols = sv.cols.filter(c => c.on), keys = cols.filter(c => c.key).map(c => c.name);
    const extra = ((ai && ai.ok) || []).filter(i => i.kind === 'COLUMN'), aiRules = ((ai && ai.ok) || []).filter(i => i.kind === 'RULE');
    const outCols = cols.map(c => ({ name: c.name, type: c.type })); extra.forEach(e => { const i = outCols.findIndex(c => c.name === e.name); if (i >= 0) outCols[i].type = e.type; else outCols.push({ name: e.name, type: e.type }); });
    const utc = cols.some(c => c.clean === 'utc' && c.type === 'timestamp' && c.name !== sv.softDelete);
    let s = head(n.nbSilver, ['Cleans one bronze batch of ' + n.entity + ' and merges it into silver on ' + (keys.join(', ') || '<key>') + '. Called by ADF.', 'Bad rows go to the quarantine table with the reason; nothing is dropped silently.']);
    s += md('1. Parameters') + widgets([['source_table', n.bronze, true], ['target_table', n.silver, true], ['quarantine_table', n.quarantine, true], ['batch_id', '', true]]) + '\n';
    const pad = Math.max.apply(null, outCols.map(c => c.name.length).concat([11]));
    const conf = ['import json', 'from pyspark.sql import functions as F', 'from pyspark.sql.window import Window', 'from delta.tables import DeltaTable', '',
      'KEY_COLS  = ' + JSON.stringify(keys), 'ORDER_COL = ' + (sv.orderCol ? py(sv.orderCol) : 'None') + (sv.orderCol ? '' : '   # no ordering column: the row ingested last wins')];
    if (utc) conf.push('SOURCE_TZ = ' + py(sv.tz) + '   # time zone the source writes timestamps in');
    conf.push('', '# Explicit silver schema: a new source column never reaches silver by accident', 'TARGET_COLUMNS = """', outCols.map(c => '    ' + c.name.padEnd(pad) + ' ' + c.type.toUpperCase()).concat(['    ' + '_batch_id'.padEnd(pad) + ' STRING', '    ' + '_updated_ts'.padEnd(pad) + ' TIMESTAMP']).join(',\n'), '"""');
    s += md('2. Imports and config') + conf.join('\n') + '\n';
    s += md('3. Read this batch only') + 'src = spark.table(source_table).filter(F.col("_batch_id") == batch_id)\nrows_read = src.count()\n';
    const T = ['def standardize(df):', '    """Every silver column is named, typed and cleaned here."""', '    return df.select('];
    cols.forEach(c => T.push('        ' + cleanExpr(c, sv.softDelete) + '.alias(' + py(c.name) + '),'));
    T.push('        F.col("_ingest_ts"),', '    )', '');
    if (extra.length) { T.push('def add_columns(df):', '    """Derived columns (written with Copilot, checked on the page)."""', '    return (df'); extra.forEach(e => T.push('        .withColumn(' + py(e.name) + ', (' + e.expr + ').cast(' + py(e.type) + '))')); T.push('    )', ''); }
    T.push('def dedupe(df):', '    """Keep the latest version of each key within the batch."""',
      '    order = ([F.col(ORDER_COL).desc_nulls_last()] if ORDER_COL else []) + [F.col("_ingest_ts").desc()]', '    w = Window.partitionBy(*KEY_COLS).orderBy(*order)', '    return df.withColumn("_rn", F.row_number().over(w)).filter("_rn = 1").drop("_rn")', '',
      'clean = dedupe(' + (extra.length ? 'add_columns(standardize(src))' : 'standardize(src)') + ')');
    s += md('4. Transform') + T.join('\n') + '\n';
    const rules = [];
    cols.filter(c => c.notnull || c.key).forEach(c => rules.push([c.name + '_null', col(c.name) + '.isNull()']));
    sv.rules.forEach(r => rules.push(ruleExpr(r)));
    aiRules.forEach(r => rules.push([r.name, r.expr]));
    const seen = {}; rules.forEach(r => { seen[r[0]] = (seen[r[0]] || 0) + 1; if (seen[r[0]] > 1) r[0] += '_' + seen[r[0]]; });
    const rp = Math.max.apply(null, rules.map(r => py(r[0]).length).concat([4]));
    const Q = ['# A rule is true for a BAD row. Add rules here; never filter rows out anywhere else.', 'DQ_RULES = {'].concat(rules.map(r => '    ' + (py(r[0]) + ':').padEnd(rp + 1) + ' ' + r[1] + ','), ['}', '',
      'checked = clean.withColumn(', '    "_dq_failures",', '    F.concat_ws(",", *[F.when(F.coalesce(cond, F.lit(False)), F.lit(name)) for name, cond in DQ_RULES.items()]),', ').cache()',
      'valid   = checked.filter(F.col("_dq_failures") == "")', 'invalid = checked.filter(F.col("_dq_failures") != "")', '',
      'quarantine = (invalid.withColumn("_batch_id", F.lit(batch_id))', '                     .withColumn("_quarantine_ts", F.current_timestamp()))', 'if spark.catalog.tableExists(quarantine_table):', '    # A rerun replaces this batch\'s quarantined rows',
      '    (quarantine.write.format("delta").mode("overwrite")', '        .option("replaceWhere", f"_batch_id = \'{batch_id}\'")', '        .option("mergeSchema", "true")', '        .saveAsTable(quarantine_table))', 'else:', '    quarantine.write.format("delta").saveAsTable(quarantine_table)',
      'rows_quarantined = invalid.count()', 'rows_deduped     = rows_read - checked.count()']);
    s += md('5. Data quality: quarantine, never drop') + Q.join('\n') + '\n';
    const W = ['spark.sql(f"""', '    CREATE TABLE IF NOT EXISTS {target_table} ({TARGET_COLUMNS})', '    USING DELTA' + (sv.cluster ? '\n    CLUSTER BY (' + sv.cluster + ')' : ''), "    COMMENT 'Silver: one clean, current row per " + n.entity.replace(/'/g, '') + " key'", '""")', '',
      'out = (valid.select(' + outCols.map(c => py(c.name)).join(', ') + ')', '            .withColumn("_batch_id", F.lit(batch_id))', '            .withColumn("_updated_ts", F.current_timestamp()))', '',
      'on = " AND ".join(f"t.{k} = s.{k}" for k in KEY_COLS)', '(DeltaTable.forName(spark, target_table).alias("t")', '    .merge(out.alias("s"), on)',
      '    # >= so an older version never overwrites a newer one, and a rerun re-stamps _batch_id for gold', '    .whenMatchedUpdateAll(condition=(f"s.{ORDER_COL} >= t.{ORDER_COL} OR t.{ORDER_COL} IS NULL" if ORDER_COL else None))', '    .whenNotMatchedInsertAll()', '    .execute())'];
    s += md('6. Merge into silver') + W.join('\n') + '\n';
    s += md('7. Metrics and exit') + ['rows_written = out.count()', 'checked.unpersist()',
      EXIT(['"status": "succeeded"', '"batch_id": batch_id', '"rows_read": rows_read', '"rows_written": rows_written', '"rows_quarantined": rows_quarantined', '"rows_deduped": rows_deduped'])].join('\n') + '\n';
    return { code: s, outCols, rules: rules.map(r => r[0]), keys };
  };

  const aggExpr = function (m) {
    const f = String(m.filter || '').trim(), c = m.agg === 'count' && !m.col ? null : col(m.col);
    const inner = f ? (c ? 'F.when(F.expr(' + py(f) + '), ' + c + ')' : 'F.when(F.expr(' + py(f) + '), F.lit(1))') : (c || 'F.lit(1)');
    if (m.agg === 'count') return 'F.count(' + inner + ')';
    if (m.agg === 'sum' && f) return 'F.coalesce(F.sum(' + inner + '), F.lit(0))';
    return 'F.' + m.agg + '(' + inner + ')';
  };
  P.gold = function (cfg, ai) {
    const n = P.names(cfg), g = cfg.gold, dates = g.mode === 'dates', rc = g.rebuildCol;
    const aiM = ((ai && ai.ok) || []).filter(i => i.kind === 'METRIC'), aiD = ((ai && ai.ok) || []).filter(i => i.kind === 'DERIVED');
    const recon = g.metrics.find(m => m.agg === 'sum' && !String(m.filter || '').trim());
    let s = head(n.nbGold, ['Grain: one row per ' + g.grain.join(', ') + '. ' + (dates ? 'Rebuilds only the ' + rc + ' values this batch touched.' : 'Rebuilds the whole table each run.') + ' Called by ADF.', 'Reads silver only, and reconciles to it before finishing.']);
    s += md('1. Parameters') + widgets([['source_table', n.silver, true], ['target_table', n.gold, true], ['batch_id', '', true]]) + '\n';
    s += md('2. Imports and config') + ['import json', 'from pyspark.sql import functions as F', '', 'GRAIN = ' + JSON.stringify(g.grain)].join('\n') + '\n';
    const live = g.softDelete ? '\n               .filter(~F.coalesce(' + col(g.softDelete) + ', F.lit(False)))' : '';
    if (dates) s += md('3. Find what changed, then read only those dates from silver') + ['# Distinct dates only, so collect() stays small', 'dates = [r[0] for r in (', '    spark.table(source_table).filter(F.col("_batch_id") == batch_id)', '         .select(' + py(rc) + ').distinct().collect()', ') if r[0] is not None]', '',
      'if not dates:', '    dbutils.notebook.exit(json.dumps({"status": "succeeded", "batch_id": batch_id,', '                                      "rows_read": 0, "rows_written": 0, "rows_quarantined": 0, "dates_rebuilt": 0}))', '',
      'silver = (spark.table(source_table)', '               .filter(' + col(rc) + '.isin(dates))' + live + ')', 'rows_read = silver.count()'].join('\n') + '\n';
    else s += md('3. Read silver') + ['silver = (spark.table(source_table)' + live + ')', 'rows_read = silver.count()'].join('\n') + '\n';
    const M = g.metrics.map(m => aggExpr(m) + '.alias(' + py(m.name) + ')').concat(aiM.map(m => '(' + m.expr + ').alias(' + py(m.name) + ')'));
    const B = ['gold = (', '    silver.groupBy(*GRAIN)', '          .agg('].concat(M.map(x => '              ' + x + ','), ['              F.count(F.lit(1)).alias("_silver_rows"),', '          )']);
    g.derived.forEach(d => B.push('          .withColumn(' + py(d.name) + ', F.expr(' + py(String(d.expr).trim()) + '))'));
    aiD.forEach(d => B.push('          .withColumn(' + py(d.name) + ', ' + d.expr + ')'));
    B.push('          .withColumn("_updated_ts", F.current_timestamp())', ')');
    s += md('4. Business logic') + B.join('\n') + '\n';
    const W = [];
    if (dates) W.push('# replaceWhere (not merge), so a date whose rows were all deleted disappears from gold too', 'date_list = ", ".join(f"DATE\'{d}\'" for d in dates)', 'if spark.catalog.tableExists(target_table):', '    (gold.write.format("delta").mode("overwrite")', '        .option("replaceWhere", f"' + rc + ' IN ({date_list})")', '        .saveAsTable(target_table))', 'else:', '    gold.write.format("delta").saveAsTable(target_table)');
    else W.push('# Small table: rebuilt in full, so a rerun always gives the same result', 'gold.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(target_table)');
    s += md('6. Write' + (dates ? ': replace the affected dates' : ': replace the table')) + W.join('\n') + '\n';
    const R = ['written = spark.table(target_table)' + (dates ? '.filter(' + col(rc) + '.isin(dates))' : ''), 'rows_written = written.count()', '',
      '# Every silver row must be counted exactly once', 'gold_rows = written.agg(F.sum("_silver_rows")).first()[0] or 0', 'if gold_rows != rows_read:', '    raise ValueError(f"Reconciliation failed: {rows_read} silver rows, {gold_rows} counted in gold")'];
    if (recon) R.push('', '# Totals must match silver', 'silver_total = silver.agg(F.sum(' + py(recon.col) + ')).first()[0] or 0', 'gold_total   = written.agg(F.sum(' + py(recon.name) + ')).first()[0] or 0', 'if silver_total != gold_total:', '    raise ValueError(f"Reconciliation failed on ' + recon.name + ': silver {silver_total} vs gold {gold_total}")');
    R.push('', EXIT(['"status": "succeeded"', '"batch_id": batch_id', '"rows_read": rows_read', '"rows_written": rows_written', '"rows_quarantined": 0'].concat(dates ? ['"dates_rebuilt": len(dates)'] : [])));
    s += md('7. Reconcile, metrics and exit') + R.join('\n') + '\n';
    return { code: s, recon };
  };

  /* ---------- everything for the current layer ---------- */
  P.build = function (cfg, ai) {
    const n = P.names(cfg), L = cfg.layer, o = { names: n, layer: L };
    if (L === 'bronze') o.code = P.bronze(cfg);
    else if (L === 'silver') { const r = P.silver(cfg, ai); o.code = r.code; o.silver = r; }
    else { const r = P.gold(cfg, ai); o.code = r.code; o.gold = r; }
    /* ADF */
    const bp = { batch_id: { value: '@pipeline().RunId', type: 'Expression' } };
    if (L === 'bronze') bp.source_path = { value: "abfss://<container>@<storage_account>.dfs.core.windows.net/<folder landed by this run>", type: 'Expression' };
    o.activity = { name: n.nb, type: 'DatabricksNotebook', dependsOn: [], policy: { timeout: '0.02:00:00', retry: 0, retryIntervalInSeconds: 60, secureOutput: false, secureInput: false }, userProperties: [], typeProperties: { notebookPath: n.path, baseParameters: bp }, linkedServiceName: { referenceName: '<LS_DATABRICKS>', type: 'LinkedServiceReference' } };
    const exits = ['status', 'rows_read', 'rows_written', 'rows_quarantined'].concat(L === 'silver' ? ['rows_deduped'] : [], L === 'gold' && cfg.gold.mode === 'dates' ? ['dates_rebuilt'] : []);
    o.adf = ['Databricks Notebook activity', '  Name:            ' + n.nb, '  Notebook path:   ' + n.path, '  Base parameters:', '    batch_id     = @pipeline().RunId'].concat(L === 'bronze' ? ['    source_path  = the folder or file this run landed (the ADF Pipeline Generator fills this in)'] : [],
      ['', 'Reading what the notebook returns, in a later activity:'], exits.map(e => "  @activity('" + n.nb + "').output.runOutput." + e), ['', 'Run the layers in order in one pipeline so they share the same batch_id: ' + n.nbBronze + ', then ' + n.nbSilver + ', then ' + n.nbGold + '.',
        'The other parameters (table names' + (L === 'bronze' ? ', file_format' : '') + ') have defaults in the notebook. Pass them from ADF only to point a run at another environment.']).join('\n');
    /* checks */
    const C = [], k = (o.silver && o.silver.keys) || [];
    if (L === 'bronze') C.push('-- Rows per batch: should equal the rows in the files ADF landed', 'SELECT _batch_id, COUNT(*) AS row_count, COUNT(DISTINCT _source_file) AS files, MIN(_ingest_ts) AS loaded_at', 'FROM ' + n.bronze, 'GROUP BY _batch_id ORDER BY loaded_at DESC LIMIT 20;', '', '-- Metadata filled on every row: expect 0', 'SELECT COUNT(*) AS missing_metadata FROM ' + n.bronze, 'WHERE _batch_id IS NULL OR _ingest_ts IS NULL OR _source_file IS NULL;');
    if (L === 'silver') C.push('-- Duplicate keys: expect no rows', 'SELECT ' + k.join(', ') + ', COUNT(*) AS n', 'FROM ' + n.silver, 'GROUP BY ' + k.join(', ') + ' HAVING COUNT(*) > 1;', '', '-- What was quarantined, and why', 'SELECT _batch_id, _dq_failures, COUNT(*) AS row_count', 'FROM ' + n.quarantine, 'GROUP BY _batch_id, _dq_failures ORDER BY _batch_id DESC, row_count DESC;', '',
      '-- Rows per batch in silver (rows last touched by each batch)', 'SELECT _batch_id, COUNT(*) AS row_count, MAX(_updated_ts) AS updated_at', 'FROM ' + n.silver, 'GROUP BY _batch_id ORDER BY updated_at DESC LIMIT 20;');
    if (L === 'gold') { const g = cfg.gold; C.push('-- Grain holds: expect no rows', 'SELECT ' + g.grain.join(', ') + ', COUNT(*) AS n', 'FROM ' + n.gold, 'GROUP BY ' + g.grain.join(', ') + ' HAVING COUNT(*) > 1;');
      if (o.gold.recon) C.push('', '-- Totals against silver: expect difference = 0', 'SELECT (SELECT SUM(' + o.gold.recon.name + ') FROM ' + n.gold + ') - (SELECT SUM(' + o.gold.recon.col + ') FROM ' + n.silver + (g.softDelete ? ' WHERE NOT COALESCE(' + g.softDelete + ', false)' : '') + ') AS difference;'); }
    o.checks = C.join('\n');
    o.placeholders = Array.from(new Set((o.code.match(/<[a-z_]+>/g) || [])));
    return o;
  };
  P.CHECKLIST = {
    all: ['The notebook runs interactively with the widget defaults, and from ADF with base parameters', 'Running the same batch_id twice leaves the same row counts', 'A forced error makes the ADF activity fail', 'ADF can read the exit values through output.runOutput', 'No hard-coded paths, secrets or environment names were added'],
    bronze: ['Row count equals the source files’ row count; nothing filtered or changed', '_source_file, _ingest_ts and _batch_id are filled on every row', 'A file with an extra column loads without failing'],
    silver: ['No duplicate business keys', 'rows_read = rows_written + rows_quarantined + rows_deduped', 'An older version of a record doesn’t overwrite a newer one', 'Timestamps convert to UTC correctly, including on a daylight saving date'],
    gold: ['Totals reconcile to silver for the rebuilt dates', 'One row per grain key', 'A deleted or cancelled record changes the numbers the way the business expects', 'Power BI numbers match a hand-checked sample']
  };

  root.PYG = P;
  if (typeof module !== 'undefined') module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);

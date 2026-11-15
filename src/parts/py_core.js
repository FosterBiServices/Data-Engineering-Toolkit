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
    layer: 'silver', scope: 'entity', any: P.anyDefaults(), entity: '', subject: '', folder: '/Shared/medallion',
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
    if (cfg.scope === 'any') Object.assign(n, { entity: '<object>', silver: c.silver + '.' + s + '.<object>', gold: c.gold + '.' + s + '.<object>', nbSilver: 'nb_silver_' + s + '_any_object', nbGold: 'nb_gold_' + s + '_any_object' });
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
  /* ---------- notebooks for any object: the pipeline passes the object, nothing about its columns is known here ---------- */
  P.anyDefaults = () => ({ keys: '', trim: true, emptyNull: true, dropDupRows: true, storage: '', store: 'table', joins: [] });
  P.anyJoin = () => ({ obj: '', lookup: '', key: 'id', lookupKey: '', cols: '', folder: '' });
  /* a lookup is usable when it names the object, the lookup object and both keys */
  P.anyJoins = cfg => ((cfg.any && cfg.any.joins) || []).filter(j => j && String(j.obj || '').trim() && String(j.lookup || '').trim() && String(j.key || '').trim() && String(j.lookupKey || '').trim());
  const CLEAN_NAMES = ['def clean_name(name):',
    '    """Lower case, underscores, no spaces or special characters: safe for Delta and for SQL."""',
    '    n = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()',
    '    n = re.sub(r"([a-z0-9])([A-Z])", r"\\1_\\2", n.strip())        # OrderDate -> Order_Date',
    '    n = re.sub(r"[^0-9A-Za-z]+", "_", n).strip("_").lower()        # spaces and symbols -> _',
    '    if not n:',
    '        n = "col"',
    '    if n[0].isdigit():',
    '        n = "c_" + n                                               # a name can\'t start with a digit',
    '    return n', '',
    'def clean_names(columns):',
    '    """Clean every name; when two clean to the same name, number the later ones (_2, _3)."""',
    '    out, seen = [], {}',
    '    for c in columns:',
    '        n = clean_name(c)',
    '        if n in seen:',
    '            seen[n] += 1',
    '            n = f"{n}_{seen[n]}"',
    '        seen.setdefault(n, 1)',
    '        out.append(n)',
    '    return out'].join('\n');
  /* where the Delta data lives: tables in a schema, or folders in the lake (Delta files at a path) */
  const IO = path => path ? {
    exists: v => 'DeltaTable.isDeltaTable(spark, ' + v + ')', read: v => 'spark.read.format("delta").load(' + v + ')',
    save: v => '.save(' + v + ')', dt: v => 'DeltaTable.forPath(spark, ' + v + ')'
  } : {
    exists: v => 'spark.catalog.tableExists(' + v + ')', read: v => 'spark.table(' + v + ')',
    save: v => '.saveAsTable(' + v + ')', dt: v => 'DeltaTable.forName(spark, ' + v + ')'
  };
  const ABFSS = (c, f) => 'f"abfss://{' + c + '}@{storage_account}.dfs.core.windows.net/{' + f + '.strip(\'/\')}"';
  /* path mode: optionally register the folder as a table, so SQL and Power BI see the new data */
  const REGISTER = ['if table_name:', '    # Optional: a catalog table over the Delta folder, refreshed so SQL and Power BI see this load',
    '    spark.sql(f"CREATE TABLE IF NOT EXISTS {table_name} USING DELTA LOCATION \'{target}\'")', '    spark.sql(f"REFRESH TABLE {table_name}")'].join('\n');
  P.anySilver = function (cfg) {
    const n = P.names(cfg), a = cfg.any, path = a.store === 'path', io = IO(path);
    let s = head(n.nbSilver, ['Cleans one bronze file for ANY object and writes it to ' + (path ? 'a Delta folder in the lake' : 'a Delta table') + ' named after the object. Called by ADF once per object.',
      'Column names become lower case with underscores, no spaces or special characters. Rerunning the same batch replaces its rows; it never duplicates.']);
    const W = [['obj_name', '', true], ['storage_account', a.storage, true], ['source_container', '', true], ['source_folder', '', true], ['source_file', '', true]]
      .concat(path ? [['target_container', '', true], ['target_folder', '', true], ['table_name', '', false]] : [['target_schema', cfg.cat.silver + '.' + n.subject, true]], [['key_columns', a.keys, false], ['batch_id', '', true]]);
    s += md('1. Parameters') + widgets(W) + '\n';
    s += md('2. Imports and helpers') + ['import json, re, unicodedata', 'from pyspark.sql import functions as F', 'from delta.tables import DeltaTable', '', CLEAN_NAMES].join('\n') + '\n';
    s += md('3. Read the bronze file') + ['source_path = f"abfss://{source_container}@{storage_account}.dfs.core.windows.net/{source_folder.strip(\'/\')}/{source_file}"',
      path ? 'target = ' + ABFSS('target_container', 'target_folder') + '    # the Delta folder for this object' : 'target = f"{target_schema}.{clean_name(obj_name)}"', 'raw = spark.read.parquet(source_path)', 'rows_read = raw.count()'].join('\n') + '\n';
    const C = ['new_names = clean_names(raw.columns)', 'renamed = {old: new for old, new in zip(raw.columns, new_names) if old != new}', 'df = raw.toDF(*new_names)'];
    if (a.trim || a.emptyNull) C.push('', '# Text columns: ' + [a.trim ? 'trim spaces' : '', a.emptyNull ? 'empty text becomes null' : ''].filter(Boolean).join(', '),
      'for c, t in df.dtypes:', '    if t == "string":', '        v = ' + (a.trim ? 'F.trim(F.col(c))' : 'F.col(c)'), '        df = df.withColumn(c, ' + (a.emptyNull ? 'F.when(v != "", v)' : 'v') + ')');
    if (a.dropDupRows) C.push('', '# Rows that are exact copies of another row are kept once', 'before = df.count()', 'df = df.dropDuplicates()', 'rows_deduped = before - df.count()'); else C.push('rows_deduped = 0');
    C.push('', 'keys = [clean_name(k) for k in key_columns.split(",") if k.strip()]', 'missing_keys = [k for k in keys if k not in df.columns]', 'if missing_keys:', '    raise ValueError(f"key_columns not in {obj_name}: {missing_keys}. Columns: {df.columns}")');
    C.push('', 'df = (df.withColumn("_source_file", F.lit(source_path))', '        .withColumn("_batch_id", F.lit(batch_id))', '        .withColumn("_ingest_ts", F.current_timestamp()))');
    s += md('4. Clean') + C.join('\n') + '\n';
    s += md('5. Write to Delta') + (path ? [] : ['spark.sql(f"CREATE SCHEMA IF NOT EXISTS {target_schema}")']).concat(['if not ' + io.exists('target') + ':', '    df.write.format("delta")' + io.save('target'),
      'elif keys:', '    # One row per key: the incoming row replaces the stored one', '    incoming = df.dropDuplicates(keys)', '    spark.conf.set("spark.databricks.delta.schema.autoMerge.enabled", "true")   # new columns are added',
      '    (' + io.dt('target') + '.alias("t")', '        .merge(incoming.alias("s"), " AND ".join(f"t.`{k}` <=> s.`{k}`" for k in keys))', '        .whenMatchedUpdateAll()', '        .whenNotMatchedInsertAll()', '        .execute())',
      'else:', '    # No key: this file\'s rows for this batch are replaced, so a rerun never duplicates', '    (df.write.format("delta").mode("overwrite")', '        .option("replaceWhere", f"_batch_id = \'{batch_id}\' AND _source_file = \'{source_path}\'")', '        .option("mergeSchema", "true")', '        ' + io.save('target') + ')'], path ? ['', REGISTER] : []).join('\n') + '\n';
    s += md('6. Metrics and exit') + ['rows_written = df.count()', EXIT(['"status": "succeeded"', '"batch_id": batch_id', '"table": target', '"rows_read": rows_read', '"rows_written": rows_written', '"rows_deduped": rows_deduped', '"rows_quarantined": 0', '"columns_renamed": len(renamed)'])].join('\n') + '\n';
    return s;
  };
  /* the lookups as Python: one entry per join set on the page */
  const pyJoins = js => 'JOINS = [\n' + js.map(j => '    {"object": ' + py(j.obj.trim()) + ', "lookup": ' + py(j.lookup.trim()) + ', "key": ' + py(j.key.trim()) + ', "lookup_key": ' + py(j.lookupKey.trim()) + ',\n     "columns": [' + String(j.cols || '').split(',').map(c => c.trim()).filter(Boolean).map(py).join(', ') + '], "folder": ' + py(String(j.folder || '').trim()) + '},').join('\n') + '\n]';
  P.anyGold = function (cfg) {
    const n = P.names(cfg), a = cfg.any, path = a.store === 'path', io = IO(path), js = P.anyJoins(cfg);
    let s = head(n.nbGold, ['Copies new silver rows for ANY object to gold, incrementally' + (js.length ? ', adding columns from lookup objects where the page set a join' : ', with no transformations') + '. Called by ADF once per object.',
      'Only rows silver wrote since the last gold load are read (by _ingest_ts). With key_columns the rows are merged on the key; without, each batch is replaced, so a rerun never duplicates.']);
    const W = [['obj_name', '', true]].concat(path ? [['storage_account', a.storage, true], ['source_container', '', true], ['source_folder', '', true], ['target_container', '', true], ['target_folder', '', true], ['table_name', '', false]]
      : [['source_schema', cfg.cat.silver + '.' + n.subject, true], ['target_schema', cfg.cat.gold + '.' + n.subject, true]], [['key_columns', a.keys, false], ['batch_id', '', true]]);
    s += md('1. Parameters') + widgets(W) + '\n';
    const H = ['import json, re, unicodedata', 'from pyspark.sql import functions as F', 'from pyspark.sql.window import Window', 'from delta.tables import DeltaTable', '', CLEAN_NAMES];
    if (js.length) H.push('', '# Lookups: columns joined in from another silver object. A left join, so no row is lost; the lookup keeps one row per key, so none is added.', pyJoins(js), '',
      'def lookup_source(j):',
      path ? '    # The lookup\'s silver folder: the one set on the page, else next to this object\'s silver folder\n    folder = j["folder"] or source_folder.strip("/").rsplit("/", 1)[0] + "/" + j["lookup"]\n    return ' + ABFSS('source_container', 'folder')
        : '    return f"{source_schema}.{clean_name(j[\'lookup\'])}"', '',
      'def add_lookups(df):',
      '    for j in [j for j in JOINS if clean_name(j["object"]) == clean_name(obj_name)]:',
      '        key, lkey, src = clean_name(j["key"]), clean_name(j["lookup_key"]), lookup_source(j)',
      '        lk = ' + io.read('src'),
      '        cols = [clean_name(c) for c in j["columns"]] or [c for c in lk.columns if c != lkey and not c.startswith("_")]',
      '        missing = ([key] if key not in df.columns else []) + [c for c in [lkey] + cols if c not in lk.columns]',
      '        if missing:',
      '            raise ValueError(f"Lookup {j[\'lookup\']} for {obj_name}: columns not found: {missing}. {obj_name} has {df.columns}; {j[\'lookup\']} has {lk.columns}")',
      '        if "_ingest_ts" in lk.columns:   # the newest row per key',
      '            lk = lk.withColumn("_rn", F.row_number().over(Window.partitionBy(lkey).orderBy(F.col("_ingest_ts").desc()))).filter("_rn = 1")',
      '        # A name the object already has gets the lookup\'s name in front: name -> member_names_name',
      '        lk = lk.select(F.col(lkey).cast("string").alias("_lookup_key"), *[F.col(c).alias(c if c not in df.columns else f"{clean_name(j[\'lookup\'])}_{c}") for c in cols]).dropDuplicates(["_lookup_key"])',
      '        df = df.join(lk, F.col(key).cast("string") == F.col("_lookup_key"), "left").drop("_lookup_key")   # compared as text, so 12 and "12" match',
      '    return df');
    s += md('2. Imports and helpers') + H.join('\n') + '\n';
    const add = js.length ? '.transform(add_lookups)' : '';
    s += md('3. Find what is new in silver') + (path ? ['source = ' + ABFSS('source_container', 'source_folder') + '    # this object\'s silver folder', 'target = ' + ABFSS('target_container', 'target_folder')]
      : ['source = f"{source_schema}.{clean_name(obj_name)}"', 'target = f"{target_schema}.{clean_name(obj_name)}"']).concat(['silver = ' + io.read('source'), '',
      '# The watermark is the newest silver row gold already has', 'last = ' + io.read('target') + '.agg(F.max("_ingest_ts")).first()[0] if ' + io.exists('target') + ' else None',
      'new = silver if last is None else silver.filter(F.col("_ingest_ts") > F.lit(last))', 'rows_read = new.count()', '',
      'if rows_read == 0:', '    dbutils.notebook.exit(json.dumps({"status": "succeeded", "batch_id": batch_id, "table": target,', '                                      "rows_read": 0, "rows_written": 0, "rows_quarantined": 0}))']).join('\n') + '\n';
    s += md('4. Write: ' + (js.length ? 'lookups joined in, ' : 'no transformations, ') + 'and a load time') + ['keys = [clean_name(k) for k in key_columns.split(",") if k.strip()]'].concat(path ? [] : ['spark.sql(f"CREATE SCHEMA IF NOT EXISTS {target_schema}")'], ['spark.conf.set("spark.databricks.delta.schema.autoMerge.enabled", "true")   # new silver columns reach gold', '',
      'if keys:', '    # Newest row per key wins', '    w = Window.partitionBy(*keys).orderBy(F.col("_ingest_ts").desc())', '    rows = new.withColumn("_rn", F.row_number().over(w)).filter("_rn = 1").drop("_rn")' + add + '.withColumn("_gold_loaded_ts", F.current_timestamp())',
      '    if not ' + io.exists('target') + ':', '        rows.write.format("delta")' + io.save('target'), '    else:', '        (' + io.dt('target') + '.alias("t")', '            .merge(rows.alias("s"), " AND ".join(f"t.`{k}` <=> s.`{k}`" for k in keys))',
      '            .whenMatchedUpdateAll(condition="s._ingest_ts > t._ingest_ts")', '            .whenNotMatchedInsertAll()', '            .execute())',
      'else:', '    # Whole batches: every silver row of a batch that has new rows, so a rerun replaces instead of adding', '    batches = [r[0] for r in new.select("_batch_id").distinct().collect()]',
      '    rows = silver.filter(F.col("_batch_id").isin(batches))' + add + '.withColumn("_gold_loaded_ts", F.current_timestamp())', '    if not ' + io.exists('target') + ':', '        rows.write.format("delta")' + io.save('target'), '    else:',
      '        in_list = ", ".join("\'" + b.replace("\'", "\'\'") + "\'" for b in batches)', '        (rows.write.format("delta").mode("overwrite")', '            .option("replaceWhere", f"_batch_id IN ({in_list})")', '            .option("mergeSchema", "true")', '            ' + io.save('target') + ')'], path ? ['', REGISTER] : []).join('\n') + '\n';
    s += md('5. Metrics and exit') + ['rows_written = rows.count()', EXIT(['"status": "succeeded"', '"batch_id": batch_id', '"table": target', '"rows_read": rows_read', '"rows_written": rows_written', '"rows_quarantined": 0'])].join('\n') + '\n';
    return s;
  };

  P.problems = function (cfg) {
    const R = [], add = (sev, msg) => R.push({ sev, msg }), L = cfg.layer;
    if (cfg.scope === 'any') {
      if (L === 'bronze') add('err', 'For any object, bronze is loaded by the ADF pipeline (Files through bronze, silver and gold). Choose Silver or Gold.');
      if (!cfg.subject.trim()) add('err', 'Name the subject area (for example sales). It is the schema the tables go in.');
      if (cfg.any.keys.trim() && cfg.any.keys.split(',').some(k => !k.trim())) add('warn', 'The key columns have an empty name between commas.');
      if (L === 'gold') {
        const all = (cfg.any.joins || []).filter(j => j && Object.keys(P.anyJoin()).some(k => String(j[k] || '').trim() && !(k === 'key' && j[k] === 'id')));
        all.forEach((j, i) => { const miss = [['obj', 'the object'], ['lookup', 'the lookup object'], ['key', 'the object column'], ['lookupKey', 'the lookup column']].filter(f => !String(j[f[0]] || '').trim()).map(f => f[1]);
          if (miss.length) add('warn', 'Lookup ' + (i + 1) + ' is left out of the notebook until it has ' + miss.join(', ') + '.'); });
        const js = P.anyJoins(cfg);
        js.forEach(j => { if (js.some(o => o !== j && o.lookup.trim().toLowerCase() === j.obj.trim().toLowerCase())) add('info', j.obj.trim() + ' is itself a lookup for another object: that object gets ' + j.obj.trim() + '’s silver columns, not the ones joined into its gold.'); });
        if (js.length) add('info', 'Lookups are read from silver when an object’s new rows load. A name changed later in a lookup reaches gold rows loaded after the change, not the ones already there.' + (cfg.any.store === 'path' ? ' Without a folder, a lookup is read from the folder next to the object’s silver folder (silver/' + js[0].obj.trim() + ' > silver/' + js[0].lookup.trim() + ').' : ''));
        if (js.length) add('info', 'In the pipeline, run silver for every file before gold, so a lookup that arrived in the same run is already in silver.');
      }
      return R;
    }
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

  /* ---------- logging from inside the notebook, through the team's shared utility ---------- */
  P.LOG_TOKENS = [['notebook', 'the notebook’s name'], ['layer', 'bronze, silver or gold'], ['entity', 'the entity'], ['batch_id', 'the batch id from ADF'], ['status', 'started, succeeded or failed'], ['error', 'the error message (None unless it failed)'],
    ['rows_read', 'rows read (None until known)'], ['rows_written', 'rows written'], ['rows_quarantined', 'rows quarantined'], ['source', 'the source table or path'], ['target_table', 'the target table']];
  P.LOG_LOADS = [['nbrun', 'Run my logging notebook with parameters (dbutils.notebook.run)'], ['run', 'Call a function from a notebook I %run'], ['import', 'Call a function I import'], ['none', 'Call a function that is already available']];
  P.defaultLogParams = () => [['notebook_name', 'notebook'], ['batch_id', 'batch_id'], ['status', 'status'], ['rows_read', 'rows_read'], ['rows_written', 'rows_written'], ['error_message', 'error']].map(a => ({ name: a[0], use: a[1], value: '' }));
  P.defaultLog = () => ({ on: false, load: 'nbrun', line: '', call: '', nbPath: '', timeout: 600, params: P.defaultLogParams(), start: false, ok: true, fail: true });
  P.LOG_EXAMPLE = 'log_run(notebook={notebook}, batch_id={batch_id}, status={status}, rows_read={rows_read}, rows_written={rows_written}, message={error})';
  P.logProblems = function (log) {
    const R = [], add = (sev, msg) => R.push({ sev, msg }); if (!log || !log.on) return R;
    if (log.load === 'nbrun') {
      if (!/^\/|^\.{1,2}\//.test(String(log.nbPath || '').trim())) add('err', 'Logging: give the path of your logging notebook, starting with / (or ./ for one next to this notebook).');
      const ps = (Array.isArray(log.params) ? log.params : []).filter(r => String(r.name || '').trim()), names = ps.map(r => r.name.trim());
      if (!ps.length) add('err', 'Logging: add the parameters your logging notebook reads with dbutils.widgets.get.');
      names.filter((x, i) => names.indexOf(x) !== i).forEach(x => add('err', 'Logging: the parameter ' + x + ' is listed twice.'));
      if (!log.start && !log.ok && !log.fail) add('warn', 'Logging is on but no moment is ticked, so the notebook is never run.');
      return R;
    }
    const call = String(log.call || '').trim(), line = String(log.line || '').trim();
    if (!call) { add('err', 'Logging: write the call to your logging utility, for example ' + P.LOG_EXAMPLE); return R; }
    if (/\n/.test(call)) add('err', 'Logging: write the call on one line.');
    (call.match(/\{[A-Za-z_]\w*\}/g) || []).map(s => s.slice(1, -1)).filter(k => !P.LOG_TOKENS.some(x => x[0] === k)).forEach(k => add('err', 'Logging: {' + k + '} isn’t a value the notebook has. Use one of: ' + P.LOG_TOKENS.map(x => '{' + x[0] + '}').join(' ') + '.'));
    const bare = call.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""'); let d = 0; for (const ch of bare) { if ('([{'.indexOf(ch) >= 0) d++; if (')]}'.indexOf(ch) >= 0) d--; if (d < 0) break; }
    if (d !== 0) add('err', 'Logging: the brackets in the call don’t balance.');
    if (!/^[A-Za-z_][\w.]*\s*\(/.test(call)) add('err', 'Logging: the call should start with the function’s name, like log_run(...).');
    if (log.load === 'run' && !/^\/|^\.{1,2}\//.test(line)) add('err', 'Logging: give the path of the notebook to %run, starting with / (or ./ for one next to this notebook).');
    if (log.load === 'import' && !/^(from\s+[\w.]+\s+import\s+.+|import\s+[\w., ]+)$/.test(line)) add('err', 'Logging: the import line should look like  from shared.logging import log_run');
    if (!log.start && !log.ok && !log.fail) add('warn', 'Logging is on but no moment is ticked, so the utility is never called.');
    return R;
  };
  const SPLIT = /\n# COMMAND ----------\n\n# MAGIC %md ## (.+)\n\n# COMMAND ----------\n\n/;
  P.applyLog = function (code, cfg, log, n) {
    if (!log || !log.on || P.logProblems(log).some(p => p.sev === 'err')) return code;
    const parts = code.split(SPLIT), headTxt = parts[0], secs = []; for (let i = 1; i < parts.length; i += 2) secs.push({ title: parts[i], code: parts[i + 1].replace(/\n$/, '') });
    const L = cfg.layer, val = { notebook: py(n.nb), layer: py(L), entity: py(n.entity), batch_id: 'batch_id', status: 'status', error: 'error', rows_read: 'known("rows_read")', rows_written: 'known("rows_written")', rows_quarantined: 'known("rows_quarantined")', source: L === 'bronze' ? 'source_path' : 'source_table', target_table: 'target_table' };
    const call = String(log.call || '').trim().replace(/\{([A-Za-z_]\w*)\}/g, (m, k) => val[k] || m), line = String(log.line || '').trim();
    const nbrun = log.load === 'nbrun', rows = (Array.isArray(log.params) ? log.params : []).filter(r => String(r.name || '').trim());
    const pv = r => (r.use === 'fixed' ? py(r.value || '') : val[r.use] || 'None'), pw = Math.max.apply(null, rows.map(r => py(r.name.trim()).length).concat([4]));
    const helper = nbrun
      ? ['LOG_NOTEBOOK = ' + py(String(log.nbPath).trim()), 'LOG_TIMEOUT  = ' + (Math.max(0, parseInt(log.timeout, 10) || 0)) + '   # seconds; 0 = no limit', '',
        'def _log_run_status(status, error=None):', '    """Runs the team\'s logging notebook. It reads each value with dbutils.widgets.get, always as text."""', '    known = globals().get', '    values = {']
        .concat(rows.map(r => '        ' + (py(r.name.trim()) + ':').padEnd(pw + 1) + ' ' + pv(r) + ','), ['    }', '    dbutils.notebook.run(LOG_NOTEBOOK, LOG_TIMEOUT, {k: "" if v is None else str(v) for k, v in values.items()})'])
      : ['def _log_run_status(status, error=None):', '    """Calls the team\'s shared logging utility. Counts are None until the notebook has them."""', '    known = globals().get', '    ' + call];
    const out = [], cell = (title, body) => out.push({ title, code: body });
    secs.forEach(s => {
      const num = parseInt(s.title, 10);
      if (num === 7 && log.ok) { const i = s.code.lastIndexOf('dbutils.notebook.exit('); s.code = s.code.slice(0, i) + '_log_run_status("succeeded")\n' + s.code.slice(i); }
      out.push(s);
      if (num === 2) {
        if (log.load === 'run') cell('Shared logging utility', '# MAGIC %run ' + line);
        cell('Logging', (log.load === 'import' ? [line, ''] : []).concat(helper, log.start ? ['', '_log_run_status("started")'] : []).join('\n'));
      }
    });
    let res = out;
    if (log.fail) {
      /* a failure can only be caught inside one cell, so the working sections become one cell inside try/except */
      const s7 = out.find(s => parseInt(s.title, 10) === 7), cut = s7 ? s7.code.lastIndexOf(log.ok ? '_log_run_status("succeeded")\ndbutils.notebook.exit(' : 'dbutils.notebook.exit(') : -1;
      const checks = cut > 0 ? s7.code.slice(0, cut).replace(/\n+$/, '') : '';     // counts and reconciliation can fail too: they go inside try, the exit stays out
      if (checks) { out.splice(out.indexOf(s7), 0, { title: '6b. ' + (/reconcile/i.test(s7.title) ? 'Reconcile and count' : 'Counts'), code: checks }); s7.code = s7.code.slice(cut); s7.title = '7. Exit'; }
      const work = out.filter(s => { const k = parseInt(s.title, 10); return k >= 3 && k <= 6; }), first = out.indexOf(work[0]);
      let pre = '';
      if (L === 'gold' && cfg.gold.mode === 'dates') {        // the early exit stays outside try: exiting a notebook must not be caught
        const c = work[0].code, i = c.indexOf('\nsilver = (spark.table'); if (i > 0) { pre = c.slice(0, i).replace(/\n+$/, ''); work[0].code = c.slice(i + 1); if (log.ok) pre = pre.replace('    dbutils.notebook.exit(', '    _log_run_status("succeeded")\n    dbutils.notebook.exit('); }
      }
      const body = work.map(s => '# ---- ' + s.title + ' ----\n' + s.code).join('\n\n').split('\n').map(l => (l.trim() ? '    ' + l : '')).join('\n');
      const wrapped = { title: work[0].title.split('.')[0] + ' to 6. ' + (L === 'bronze' ? 'Read, add metadata and write' : L === 'silver' ? 'Read, transform, check and merge' : 'Read, aggregate and write') + ' (one cell, so a failure can be logged)',
        code: 'try:\n' + body + '\nexcept Exception as error:\n    try:\n        _log_run_status("failed", str(error)[:4000])\n    except Exception as log_error:\n        print(f"Logging the failure also failed: {log_error}")\n    raise   # ADF must still see the activity fail' };
      res = out.slice(0, first).concat(pre ? [{ title: '3. Find what changed', code: pre }] : [], [wrapped], out.slice(first + work.length));
    } else if (log.ok && L === 'gold' && cfg.gold.mode === 'dates') { const s3 = out.find(s => parseInt(s.title, 10) === 3); s3.code = s3.code.replace('    dbutils.notebook.exit(', '    _log_run_status("succeeded")\n    dbutils.notebook.exit('); }
    return headTxt + res.map(s => (s.title === 'Shared logging utility' ? CELL + '\n' + s.code + '\n' : md(s.title) + s.code + '\n')).join('');
  };

  /* ---------- everything for the current layer ---------- */
  P.build = function (cfg, ai, log) {
    const n = P.names(cfg), L = cfg.layer, o = { names: n, layer: L };
    if (cfg.scope === 'any') return P.buildAny(cfg, log);
    if (L === 'bronze') o.code = P.bronze(cfg);
    else if (L === 'silver') { const r = P.silver(cfg, ai); o.code = r.code; o.silver = r; }
    else { const r = P.gold(cfg, ai); o.code = r.code; o.gold = r; }
    o.logged = !!(log && log.on && !P.logProblems(log).some(p => p.sev === 'err'));
    if (o.logged) o.code = P.applyLog(o.code, cfg, log, n);
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
  /* the ADF side of a notebook for any object: the parameters the pipeline must send */
  P.buildAny = function (cfg, log) {
    const n = P.names(cfg), L = cfg.layer, o = { names: n, layer: L, any: true };
    o.code = L === 'gold' ? P.anyGold(cfg) : P.anySilver(cfg);
    o.logged = !!(log && log.on && !P.logProblems(log).some(p => p.sev === 'err'));
    if (o.logged) o.code = P.applyLog(o.code, cfg, log, n);
    const path = cfg.any.store === 'path', on = ['obj_name', 'Object name', '(nothing to type)'], acct = ['storage_account', 'Global parameter', 'StorageAccountName (your storage account name)'], run = ['batch_id', 'Run ID', '(nothing to type)'];
    const tgt = lay => [['target_container', 'Text', 'the ' + lay + ' container, for example lake'], ['target_folder', 'Text', 'the ' + lay + ' folder pattern, for example ' + lay + '/{object}'], ['table_name', 'Text (optional)', 'a catalog table to create over the folder and refresh; empty = none']];
    const prm = L === 'gold'
      ? [on].concat(path ? [acct, ['source_container', 'Text', 'the silver container, for example lake'], ['source_folder', 'Text', 'the silver folder pattern, the same as silver’s target_folder, for example silver/{object}']].concat(tgt('gold')) : [], [['key_columns', 'Text (optional)', 'the business key, for example order_id; empty = whole batches'], run])
      : [on, acct, ['source_container', 'Text', 'the bronze container, for example lake'], ['source_folder', 'Text', 'the bronze folder pattern, for example bronze/sales/{object}'], ['source_file', 'Text', 'the bronze file name pattern, for example {object}.parquet']].concat(path ? tgt('silver') : [], [['key_columns', 'Text (optional)', 'the business key; empty = no merge'], run]);
    o.params = prm;
    o.activity = { name: 'nb_' + L, type: 'DatabricksNotebook', dependsOn: [], policy: { timeout: '0.02:00:00', retry: 0, retryIntervalInSeconds: 60, secureOutput: false, secureInput: false }, userProperties: [], typeProperties: { notebookPath: n.path, baseParameters: Object.fromEntries(prm.map(p => [p[0], p[0] === 'batch_id' ? { value: '@pipeline().RunId', type: 'Expression' } : '<' + p[0] + '>'])) }, linkedServiceName: { referenceName: '<LS_DATABRICKS>', type: 'LinkedServiceReference' } };
    o.adf = ['In the ADF Pipeline Generator: Files through bronze, silver and gold > Layers after bronze > Add a layer', '  Name:            ' + L, '  Runs:            Once per file (only objects that got a new file this run)', '  Notebook path:   ' + n.path, '  Parameters it reads (name | value | what to type):']
      .concat(prm.map(p => '    ' + p[0].padEnd(16) + ' | ' + p[1].padEnd(16) + ' | ' + p[2]), ['', 'Run silver before gold in the same pipeline, so they share the batch_id.', 'For logging, tick "Log this layer" and use "Rows written by the step being logged": it reads this notebook’s exit value rows_written.',
        '', 'Reading what the notebook returns, in a later activity:'], ['status', 'table', 'rows_read', 'rows_written'].concat(L === 'silver' ? ['rows_deduped', 'columns_renamed'] : []).map(e => "  @activity('nb_" + L + "').output.runOutput." + e)).join('\n');
    const ref = lay => path ? 'delta.`abfss://<container>@<storage_account>.dfs.core.windows.net/' + lay + '/<object_name>`' : n[lay].replace('<object>', '<object_name>');
    const C = L === 'silver' ? ['-- Column names after cleaning: every name lower case, digits and underscores', 'DESCRIBE TABLE ' + ref('silver') + ';', '', '-- Rows per batch and file: one group per file ADF sent', 'SELECT _batch_id, _source_file, COUNT(*) AS row_count, MAX(_ingest_ts) AS loaded_at', 'FROM ' + ref('silver'), 'GROUP BY _batch_id, _source_file ORDER BY loaded_at DESC LIMIT 20;']
      : ['-- Gold has every silver batch, with the same row counts (no key) ', 'SELECT s._batch_id, s.n AS silver_rows, g.n AS gold_rows', 'FROM (SELECT _batch_id, COUNT(*) n FROM ' + ref('silver') + ' GROUP BY _batch_id) s', 'LEFT JOIN (SELECT _batch_id, COUNT(*) n FROM ' + ref('gold') + ' GROUP BY _batch_id) g ON g._batch_id = s._batch_id', 'ORDER BY s._batch_id DESC LIMIT 20;'];
    if (L === 'gold') P.anyJoins(cfg).forEach(j => { const c = String(j.cols || '').split(',').map(x => x.trim()).filter(Boolean)[0], g = ref('gold').replace('<object_name>', j.obj.trim());
      C.push('', '-- ' + j.obj.trim() + ' rows with no match in ' + j.lookup.trim() + ': expect few or none', 'SELECT COUNT(*) AS no_match FROM ' + g, 'WHERE `' + j.key.trim() + '` IS NOT NULL' + (c ? ' AND `' + c + '` IS NULL' : '') + ';'); });
    o.checks = C.join('\n');
    o.placeholders = [];
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

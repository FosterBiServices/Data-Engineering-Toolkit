/* Python Script Generator: pandas scripts and Jupyter notebooks for files. No DOM in this file. */
(function (root) {
  'use strict';
  const K = {};
  const py = s => JSON.stringify(String(s));
  const pyList = a => '[' + a.map(py).join(', ') + ']';
  const snake = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  K.snake = snake;

  K.TYPES = [['text', 'Text'], ['whole', 'Whole number'], ['decimal', 'Decimal number'], ['date', 'Date'], ['datetime', 'Date and time'], ['bool', 'True / false']];
  K.KINDS = [['csv', 'CSV or text file', '.csv'], ['excel', 'Excel workbook', '.xlsx'], ['parquet', 'Parquet', '.parquet']];
  K.RULES = [['min', 'is at least', 'number'], ['max', 'is at most', 'number'], ['inlist', 'is one of', 'A, B, C'], ['regex', 'matches pattern', '^[A-Z]{2}\\d{4}$'], ['notfuture', 'is not in the future', '']];
  K.AGGS = [['sum', 'Sum'], ['size', 'Count rows'], ['nunique', 'Count distinct'], ['mean', 'Average'], ['min', 'Minimum'], ['max', 'Maximum']];
  K.BAD = [['report', 'List them in the issues report and keep them'], ['split', 'Move them to a rejected-rows file or sheet'], ['stop', 'Stop the script']];

  /* filters: each keeps rows where its condition holds; from the second on, joined to the ones before with and / or, left to right */
  K.activeFilters = cfg => (Array.isArray(cfg.filters) ? cfg.filters : []).filter(x => x && String(x.when || '').trim());
  K.filterLogic = function (list) {
    let s = '';
    list.forEach((x, i) => { const term = String(x.label || '').trim() ? x.label.trim() : x.when.trim();
      s = i === 0 ? term : (i > 1 ? '(' + s + ')' : s) + ' ' + (x.join === 'or' ? 'OR' : 'AND') + ' ' + term; });
    return s;
  };
  K.blank = () => ({
    name: '',
    input: { kind: 'csv', path: '', sheet: '', sep: ',', encoding: 'utf-8', skip: 0 },
    cols: [], opts: { trim: true, emptyNa: true, dropBlank: true, dayFirst: false },
    filters: [], keepRemoved: false, dedupe: { on: false, order: '', keep: 'last' },
    join: { on: false, kind: 'csv', path: '', sheet: '', leftKey: '', rightKey: '', cols: '', how: 'left' },
    summary: { on: false, group: [], metrics: [] },
    rules: [], bad: 'report', output: { kind: 'csv', path: '' }, aiReq: '', aiReply: ''
  });

  /* ---------- reading a pasted sample: the header row and a few rows ---------- */
  const splitLine = function (line, d) {
    const out = []; let cur = '', inq = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inq) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += ch; }
      else if (ch === '"' && cur === '') inq = true; else if (ch === d) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out.map(s => s.trim());
  };
  const RX = {
    bool: /^(true|false|yes|no|y|n)$/i, whole: /^-?(\d{1,3}(,\d{3})+|\d+)$/, decimal: /^\(?-?[$€£]?\s?(\d{1,3}(,\d{3})+|\d*)(\.\d+)?\)?$/,
    date: /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}[ -][A-Za-z]{3,9}[ -]\d{2,4}|[A-Za-z]{3,9} \d{1,2},? \d{4})$/,
    datetime: /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?( ?[AP]M)?(Z|[+-]\d{2}:?\d{2})?$/i
  };
  /* a column whose name says it identifies something (order_id, Customer No, product code) is kept as text: it is never added up */
  const ID_NAME = /(^|[^a-z])(id|ids|no|nbr|num|number|code|key|zip|postal|phone|sku|account|acct)($|[^a-z])|(id|code|key|number)$/i;
  K.inferType = function (values, name) {
    const v = values.map(s => String(s == null ? '' : s).trim()).filter(s => s !== '' && !/^(null|nan|n\/a|na)$/i.test(s));
    if (!v.length) return 'text';
    const all = re => v.every(s => re.test(s));
    if (all(RX.bool)) return 'bool';
    /* numbers are Decimal unless you choose Whole: a sample of whole numbers says nothing about the rest of the file (owner: "users need a float / decimal") */
    if (all(RX.whole)) return v.some(s => /^-?0\d/.test(s)) || ID_NAME.test(String(name || '').replace(/([a-z])([A-Z])/g, '$1 $2')) ? 'text' : 'decimal';      // leading zeros or an id-like name: a code, not a number
    if (all(RX.decimal) && v.some(s => /\d/.test(s))) return 'decimal';
    if (all(RX.datetime)) return v.every(s => /[ T]0?0:00(:00)?$/.test(s)) ? 'date' : 'datetime';
    if (all(RX.date)) return 'date';
    return 'text';
  };
  K.parseSample = function (text) {
    const out = { cols: [], delim: '', rows: 0, errors: [] };
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
    if (!lines.length) return out;
    const head = lines[0], count = d => splitLine(head, d).length;
    const d = ['\t', ';', '|', ','].map(c => [c, count(c)]).sort((a, b) => b[1] - a[1])[0];
    out.delim = d[1] > 1 ? d[0] : ',';
    const names = splitLine(head, out.delim), rows = lines.slice(1, 201).map(l => splitLine(l, out.delim));
    out.rows = rows.length;
    const seen = new Set();
    names.forEach((n, i) => {
      if (!n) { out.errors.push('Column ' + (i + 1) + ' has no header, so it was left out.'); return; }
      if (seen.has(n)) { out.errors.push('The header “' + n + '” appears twice; only the first is used. Rename one in the file.'); return; }
      seen.add(n); const type = K.inferType(rows.map(r => r[i]), n); out.cols.push({ src: n, type });
      if (/^date/.test(type) && rows.some(r => { const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-]\d{2,4}/.exec(String(r[i] || '').trim()); return m && Number(m[1]) > 12; })) out.dayFirst = true;
    });
    if (out.cols.length === 1 && lines.length > 1 && /\s{2,}/.test(head)) out.errors.push('Only one column was found. Paste the rows as they are in the file, or copy the cells from Excel.');
    return out;
  };
  K.mapCols = function (parsed, old) {
    const prev = {}; (old || []).forEach(c => { prev[c.src] = c; });
    const used = new Set();
    return parsed.cols.map(c => {
      if (prev[c.src]) { used.add(prev[c.src].name); return Object.assign({}, prev[c.src]); }
      let name = snake(c.src) || 'column'; if (/^\d/.test(name)) name = 'c_' + name;
      let n = name, i = 2; while (used.has(n)) n = name + '_' + (i++); used.add(n);
      return { src: c.src, name: n, type: c.type, on: true, key: false, req: false };
    });
  };

  /* ---------- names ---------- */
  const stem = p => String(p || '').split(/[\\/]/).pop().replace(/\.[^.]*$/, '');
  const ext = k => (K.KINDS.find(x => x[0] === k) || K.KINDS[0])[2];
  /* extensions each kind of file may have; a path typed without one gets the first (owner: "my paths do not include the file extension") */
  K.EXTS = { csv: ['.csv', '.txt', '.tsv'], excel: ['.xlsx', '.xlsm', '.xls'], parquet: ['.parquet', '.pq'] };
  K.hasExt = p => { const m = /\.[^.\\/]+$/.exec(String(p || '').trim()); return !!m && Object.keys(K.EXTS).some(k => K.EXTS[k].indexOf(m[0].toLowerCase()) >= 0); };
  K.withExt = (p, kind) => (K.hasExt(p) ? String(p).trim() : String(p).trim() + K.EXTS[kind][0]);
  K.names = function (cfg) {
    const inPath = cfg.input.path.trim() || 'input' + ext(cfg.input.kind);
    const base = snake(cfg.name) || (snake(stem(cfg.input.path)) ? snake(stem(cfg.input.path)) + '_prep' : 'data_prep');
    const dir = inPath.replace(/[^\\/]*$/, '');
    const outPath = cfg.output.path.trim() || dir + (stem(inPath) || 'output') + '_clean' + ext(cfg.output.kind);
    return { script: base, inPath, outPath };
  };
  /* column names available after each stage */
  K.known = function (cfg, ai) {
    const base = cfg.cols.filter(c => c.on).map(c => c.name);
    const extra = ((ai && ai.ok) || []).filter(i => i.kind === 'COLUMN').map(i => i.name);
    const look = cfg.join.on ? cfg.join.cols.split(',').map(s => s.trim()).filter(Boolean) : [];
    return { base, all: Array.from(new Set(base.concat(extra, look))), open: cfg.join.on && !look.length };
  };
  const typeOf = (cfg, name) => (cfg.cols.find(c => c.on && c.name === name) || {}).type || '';

  /* ---------- checks on the setup ---------- */
  K.problems = function (cfg, ai) {
    const R = [], add = (sev, msg) => R.push({ sev, msg });
    const on = cfg.cols.filter(c => c.on), names = on.map(c => c.name), kn = K.known(cfg, ai), has = n => kn.open || kn.all.indexOf(n) >= 0;
    if (!cfg.cols.length) { add('err', 'Paste the header row and a few rows of the file in Step 1, so the page knows the columns.'); return R; }
    if (!on.length) add('err', 'Every column is turned off. Tick the columns to keep.');
    if (!cfg.input.path.trim()) add('warn', 'No input path: the script uses ' + K.names(cfg).inPath + '. Set INPUT_PATH at the top of the script before running it.');
    names.filter((n, i) => names.indexOf(n) !== i).forEach(n => add('err', 'Two columns are both named ' + n + '. Rename one.'));
    on.filter(c => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)).forEach(c => add('err', 'The name “' + c.name + '” needs to be letters, digits and underscores, starting with a letter. That keeps filters and formulas simple.'));
    const keys = on.filter(c => c.key).map(c => c.name);
    if (cfg.dedupe.on && !keys.length) add('err', 'Removing duplicates needs a key. Tick Key for the column or columns that identify one row.');
    if (cfg.dedupe.on && cfg.dedupe.order && names.indexOf(cfg.dedupe.order) < 0) add('err', 'The column to pick the latest row by, ' + cfg.dedupe.order + ', isn’t a kept column.');
    K.activeFilters(cfg).forEach((x, i) => { const f = x.when.trim(), n = 'Filter ' + (i + 1);
      if (/@|__|`|;|\bimport\b/.test(f)) add('err', n + ' can only compare columns with values, for example amount > 0 and status != "TEST".');
      if (/(^|[^=!<>])=([^=]|$)/.test(f.replace(/"[^"]*"|'[^']*'/g, '""'))) add('err', n + ': write == to compare (a single = doesn’t work in pandas).'); });
    if (cfg.keepRemoved && !K.activeFilters(cfg).length && !(ai && ai.ok && ai.ok.some(i => i.kind === 'FILTER'))) add('info', 'Keeping what the filters remove does nothing until there is a filter.');
    if (cfg.join.on) {
      const j = cfg.join;
      if (!j.path.trim()) add('warn', 'No lookup file path: set LOOKUP_PATH in the script.');
      if (names.indexOf(j.leftKey) < 0) add('err', 'Lookup: choose the column in your data to match on.');
      if (!j.rightKey.trim()) add('err', 'Lookup: give the header of the matching column in the lookup file.');
      j.cols.split(',').map(s => s.trim()).filter(Boolean).forEach(c => { if (names.indexOf(c) >= 0) add('err', 'Lookup: the column ' + c + ' already exists in your data. Rename one of them.'); });
    }
    cfg.rules.forEach((r, i) => {
      if (!r.col) add('err', 'Check ' + (i + 1) + ' has no column.'); else if (!has(r.col)) add('err', 'Check ' + (i + 1) + ' uses ' + r.col + ', which isn’t a column at that point.');
      if (/^(min|max|inlist|regex)$/.test(r.kind) && !String(r.val || '').trim()) add('err', 'Check ' + (i + 1) + ' needs a value.');
      if (/^(min|max)$/.test(r.kind) && String(r.val || '').trim() && isNaN(Number(r.val))) add('err', 'Check ' + (i + 1) + ': “' + r.val + '” isn’t a number.');
      if (/^(min|max)$/.test(r.kind) && r.col && typeOf(cfg, r.col) && !/^(whole|decimal)$/.test(typeOf(cfg, r.col))) add('err', 'Check ' + (i + 1) + ': ' + r.col + ' isn’t a number column. Set its type in Step 2.');
      if (r.kind === 'notfuture' && r.col && typeOf(cfg, r.col) && !/^date/.test(typeOf(cfg, r.col))) add('err', 'Check ' + (i + 1) + ': ' + r.col + ' isn’t a date column. Set its type in Step 2.');
      if (r.kind === 'regex') { try { new RegExp(r.val); } catch (e) { add('err', 'Check ' + (i + 1) + ': the pattern isn’t valid.'); } }
    });
    if (cfg.summary.on) {
      const s = cfg.summary, mn = s.metrics.map(m => m.name);
      if (!s.group.length) add('err', 'Summary: choose the columns to group by.');
      s.group.filter(g => !has(g)).forEach(g => add('err', 'Summary: ' + g + ' isn’t a column.'));
      if (!s.metrics.length) add('err', 'Summary: add at least one measure.');
      s.metrics.forEach((m, i) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.name || '')) add('err', 'Summary measure ' + (i + 1) + ' needs a name (letters, digits, underscores).');
        if (m.agg !== 'size' && !has(m.col)) add('err', 'Summary measure ' + (m.name || i + 1) + ' needs a column.');
        if (/^(sum|mean)$/.test(m.agg) && m.col && typeOf(cfg, m.col) && !/^(whole|decimal)$/.test(typeOf(cfg, m.col))) add('err', 'Summary measure ' + m.name + ': ' + m.col + ' isn’t a number column.');
        if (mn.indexOf(m.name) !== i) add('err', 'Two summary measures are named ' + m.name + '.'); if (s.group.indexOf(m.name) >= 0) add('err', 'The summary measure ' + m.name + ' has the same name as a group column.');
      });
    }
    const n = K.names(cfg), oe = (n.outPath.match(/\.[^.\\/]+$/) || [''])[0].toLowerCase();
    if (cfg.output.path.trim() && oe && { csv: ['.csv', '.txt', '.tsv'], excel: ['.xlsx'], parquet: ['.parquet', '.pq'] }[cfg.output.kind].indexOf(oe) < 0) add('warn', 'The output path ends in ' + oe + ' but the format is ' + cfg.output.kind + '.');
    [['input', cfg.input.path, cfg.input.kind], ['output', cfg.output.path, cfg.output.kind]].concat(cfg.join.on ? [['lookup', cfg.join.path, cfg.join.kind]] : []).forEach(([w, p, k]) => {
      if (String(p || '').trim() && !K.hasExt(p)) add('info', 'The ' + w + ' path has no file extension. ' + (w === 'output' ? 'The script adds ' + K.EXTS[k][0] + '.' : 'If no file has exactly that name, the script uses the one ending in ' + K.EXTS[k].join(', ') + '.')); });
    if (K.withExt(n.outPath, cfg.output.kind).toLowerCase() === K.withExt(n.inPath, cfg.input.kind).toLowerCase()) add('err', 'The output path is the same as the input. The script never overwrites its source: choose another name.');
    if (keys.length && !cfg.dedupe.on) add('info', 'A key is ticked and duplicates aren’t removed, so the script checks that the key is unique and reports rows that share one.');
    return R;
  };

  /* ---------- Copilot: new columns and a row filter in plain words ---------- */
  const strip = e => e.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const ALLOWED = /^(df|pd|np|True|False|None|and|or|not|in|is|if|else|len|int|float|str|round|abs|min|max)$/;
  const FORBID = /\b(import|lambda|eval|exec|open|compile|globals|locals|getattr|setattr|delattr|os|sys|subprocess|pickle|read_\w+|to_(?:csv|excel|parquet|pickle|sql|clipboard|json|feather|hdf)|__\w+__)\b/;
  K.vetExpr = function (what, e, known, open) {
    const f = [], bare = strip(e);
    if (!e) return [what + ' is empty.'];
    if (/[;\n]/.test(bare)) f.push(what + ' has more than one statement.');
    const bad = FORBID.exec(bare); if (bad) f.push(what + ' uses ' + bad[1] + ', which isn’t allowed here.');
    let d = 0; for (const ch of bare) { if ('([{'.indexOf(ch) >= 0) d++; if (')]}'.indexOf(ch) >= 0) d--; if (d < 0) break; }
    if (d !== 0) f.push(what + ' has brackets that don’t balance.');
    const re = /df\[\s*(["'])(.*?)\1\s*\]/g; let m;
    while ((m = re.exec(e))) if (!open && !known.has(m[2])) f.push(what + ' uses the column ' + m[2] + ', which doesn’t exist at that point.');
    const idr = /(^|[^.\w])([A-Za-z_]\w*)(?!\w)(\s*=(?!=))?/g; const odd = new Set();
    while ((m = idr.exec(bare))) if (!m[3] && !ALLOWED.test(m[2])) odd.add(m[2]);
    odd.forEach(x => f.push(what + ' uses the name ' + x + '. Only df, pd and np are available; write columns as df["name"].'));
    return f;
  };
  K.aiPrompt = function (cfg) {
    const T = [], on = cfg.cols.filter(c => c.on), label = t => (K.TYPES.find(x => x[0] === t) || ['', t])[1].toLowerCase();
    T.push('You are writing pandas expressions for a data-preparation script. You cannot see the data: use only the columns listed under CONTEXT.');
    T.push('', 'TASK (the user’s request: all the expressions have to do)', (cfg.aiReq || '(not given)').trim());
    T.push('', 'CONTEXT', 'A pandas DataFrame named df, already read from the file, renamed, trimmed and converted to these types:');
    on.forEach(c => T.push('- ' + c.name + ' | ' + label(c.type)));
    T.push('Text columns use the pandas string dtype; whole numbers are Int64 (missing values allowed); dates are datetime64; true/false is the boolean dtype. Missing values are pd.NA or NaT.');
    T.push('', 'STARTING POINT', 'The script already cleans and types the columns above and applies the checks set on the page. You only add COLUMN and FILTER blocks.');
    T.push('', 'RULES',
      '- Write columns as df["name"] with the exact names listed. Use only df, pd (pandas) and np (numpy).',
      '- One expression per EXPR or KEEP_WHEN line: no assignments, no semicolons, no line breaks, no lambda, no apply with Python functions, no imports, no reading or writing files.',
      '- Vectorized pandas only: np.where, np.select, pd.cut, .str and .dt methods, arithmetic and comparisons.',
      '- COLUMN: a new column, or a replacement for a listed one (same NAME). A later COLUMN may use an earlier one.',
      '- FILTER: at most one. KEEP_WHEN is a boolean expression that is True for the rows to keep.',
      '- Say in NOTES what happens to rows with missing values.',
      '- Names: letters, digits and underscores.',
      '- If the TASK can’t be done with the listed columns, write a SKIPPED block that says why instead of guessing.');
    T.push('', 'REPLY FORMAT (a template: replace the placeholder lines with your answer)', 'Reply inside one code block, with these labelled blocks and nothing else:',
      '@@@ COLUMN @@@', 'NAME: column_name', 'EXPR: pandas expression', '@@@ FILTER @@@', 'KEEP_WHEN: pandas boolean expression', '@@@ SKIPPED @@@', 'what could not be done and why', '@@@ NOTES @@@', 'assumptions to confirm, one per line');
    return T.join('\n');
  };
  K.aiParse = function (reply, cfg, parseBlocks, fields) {
    const res = { items: [], notes: [], skipped: [], any: false };
    const blocks = parseBlocks(reply); if (!blocks.length) { res.ok = []; return res; }
    const base = cfg.cols.filter(c => c.on).map(c => c.name), known = new Set(base), keys = new Set(cfg.cols.filter(c => c.on && c.key).map(c => c.name));
    const one = s => (s || '').replace(/\s*\n\s*/g, ' ').trim(); let filters = 0; const taken = new Set();
    blocks.forEach(b => {
      if (b.tag === 'NOTES') { b.body.split('\n').map(s => s.replace(/^[-*]\s*/, '').trim()).filter(s => s && !/^assumptions to confirm/i.test(s)).forEach(s => res.notes.push(s)); if (res.notes.length) res.any = true; return; }
      if (b.tag === 'SKIPPED') { if (b.body && !/^what could not be done/i.test(b.body)) { res.skipped.push(b.body); res.any = true; } return; }
      if (b.tag !== 'COLUMN' && b.tag !== 'FILTER') return;
      const f = fields(b.body, ['NAME', 'EXPR', 'KEEP_WHEN']), isF = b.tag === 'FILTER';
      const name = isF ? 'Row filter' : one(f.NAME), expr = one(isF ? (f.KEEP_WHEN || b.body) : f.EXPR).replace(/^KEEP_WHEN:\s*/i, '');
      if (/^pandas (boolean )?expression$/i.test(expr)) return;                 // the template repeated back
      res.any = true;
      const it = { kind: b.tag, name, expr, problems: [] };
      if (!isF) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) it.problems.push('The name must be letters, digits and underscores.');
        if (taken.has(name)) it.problems.push('The name is used twice.'); taken.add(name);
        if (keys.has(name)) it.problems.push('It replaces the key column ' + name + '.');
      } else if (++filters > 1) it.problems.push('Only one FILTER block is used.');
      K.vetExpr('The expression', expr, known, false).forEach(p => it.problems.push(p));
      if (!isF && !it.problems.length) { it.replaces = base.indexOf(name) >= 0; known.add(name); }
      res.items.push(it);
    });
    res.ok = res.items.filter(i => !i.problems.length);
    return res;
  };

  /* ---------- the script, as sections: [title, markdown, code] ---------- */
  const reader = function (kind, pathVar, o, lookup) {
    if (kind === 'excel') return 'pd.read_excel(' + pathVar + ', sheet_name=' + (o.sheet && o.sheet.trim() ? py(o.sheet.trim()) : '0') + ', dtype="string"' + (!lookup && Number(o.skip) ? ', skiprows=' + Number(o.skip) : '') + ')';
    if (kind === 'parquet') return 'pd.read_parquet(' + pathVar + ')';
    return 'pd.read_csv(' + pathVar + ', dtype="string", sep=' + py(lookup ? ',' : (o.sep === 'tab' ? '\t' : o.sep || ',')) + ', encoding=' + py((!lookup && o.encoding) || 'utf-8') + (!lookup && Number(o.skip) ? ', skiprows=' + Number(o.skip) : '') + ',\n                  keep_default_na=False, na_values=[""])';
  };
  const ruleExpr = function (cfg, r) {
    const c = 'df[' + py(r.col) + ']', v = String(r.val || '').trim(), num = /^(whole|decimal)$/.test(typeOf(cfg, r.col));
    const tag = s => r.col + '_' + s;
    if (r.kind === 'min') return [tag('below_' + v.replace(/[^0-9a-z]+/gi, '_').replace(/^_|_$/g, '')), c + ' < ' + Number(v)];
    if (r.kind === 'max') return [tag('above_' + v.replace(/[^0-9a-z]+/gi, '_').replace(/^_|_$/g, '')), c + ' > ' + Number(v)];
    if (r.kind === 'inlist') { const items = v.split(',').map(x => x.trim()).filter(Boolean); return [tag('not_allowed'), c + '.notna() & ~' + c + '.isin([' + (num && items.every(x => !isNaN(Number(x))) ? items.map(Number).join(', ') : items.map(py).join(', ')) + '])']; }
    if (r.kind === 'regex') return [tag('bad_format'), c + '.notna() & ~' + c + '.astype("string").str.contains(' + py(v) + ', regex=True, na=False)'];
    return [tag('in_future'), c + ' > pd.Timestamp.now()'];
  };

  K.build = function (cfg, ai) {
    const n = K.names(cfg), on = cfg.cols.filter(c => c.on), keys = on.filter(c => c.key).map(c => c.name);
    const aiCols = ((ai && ai.ok) || []).filter(i => i.kind === 'COLUMN'), aiFilter = ((ai && ai.ok) || []).find(i => i.kind === 'FILTER');
    const S = [], add = (title, md, code) => S.push({ title, md, code: code.join('\n') });
    const j = cfg.join, sm = cfg.summary, xl = cfg.output.kind === 'excel', needs = ['pandas'];
    if (cfg.input.kind === 'excel' || xl || (j.on && j.kind === 'excel')) needs.push('openpyxl');
    if (cfg.input.kind === 'parquet' || cfg.output.kind === 'parquet' || (j.on && j.kind === 'parquet')) needs.push('pyarrow');
    const usesNp = aiCols.concat(aiFilter ? [aiFilter] : []).some(i => /\bnp\./.test(i.expr));

    /* 1 settings */
    const pad = Math.max.apply(null, on.map(c => py(c.src).length).concat([4]));
    const C = ['from pathlib import Path', '', 'import pandas as pd'].concat(usesNp ? ['import numpy as np'] : [], ['',
      'def with_extension(path, extensions):', '    """A path typed without its extension: use the file that has one (for the output, add the first)."""',
      '    if path.suffix.lower() in extensions or path.exists():', '        return path', '    for e in extensions:', '        if path.with_name(path.name + e).exists():', '            return path.with_name(path.name + e)',
      '    return path.with_name(path.name + extensions[0])', '',
      'INPUT_PATH  = with_extension(Path(' + py(n.inPath) + '), ' + pyList(K.EXTS[cfg.input.kind]) + ')', 'OUTPUT_PATH = with_extension(Path(' + py(n.outPath) + '), ' + pyList(K.EXTS[cfg.output.kind]) + ')'], j.on ? ['LOOKUP_PATH = with_extension(Path(' + py(j.path.trim() || 'lookup' + ext(j.kind)) + '), ' + pyList(K.EXTS[j.kind]) + ')'] : [], ['',
      '# Column in the file -> name in the output. Only these columns are kept.', 'COLUMNS = {'], on.map(c => '    ' + (py(c.src) + ':').padEnd(pad + 1) + ' ' + py(c.name) + ','), ['}'],
      keys.length ? ['KEY_COLS = ' + pyList(keys) + '   # identify one row'] : [], ['',
      'issues = []   # one entry per problem found; shown as you go and written out at the end', '', 'def note(check, rows, detail=""):', '    """Record a problem and show it."""',
      '    issues.append({"check": check, "rows": int(rows), "detail": detail})', '    print(f"  ! {check}: {int(rows):,} row(s) {detail}".rstrip())']);
    add('1. Settings', 'Paths and column names. Change these, not the code below.', C);

    /* 2 read */
    const R = ['if not INPUT_PATH.exists():', '    raise FileNotFoundError(f"Input file not found: {INPUT_PATH.resolve()}")', ''];
    if (cfg.input.kind !== 'parquet') R.push('# Read every column as text so nothing is guessed: leading zeros, codes and dates stay as typed');
    R.push('raw = ' + reader(cfg.input.kind, 'INPUT_PATH', cfg.input, false), 'raw.columns = [str(c).strip() for c in raw.columns]', 'rows_read = len(raw)', '',
      'missing = [c for c in COLUMNS if c not in raw.columns]', 'if missing:', '    raise ValueError(f"The file is missing expected column(s): {missing}. It has: {list(raw.columns)}")', '',
      'df = raw[list(COLUMNS)].rename(columns=COLUMNS)', 'print(f"Read {rows_read:,} rows and {len(raw.columns)} columns; keeping {len(df.columns)} columns")');
    add('2. Read the file', 'Stops with a clear message if the file or an expected column is missing.', R);

    /* 3 clean text */
    const o = cfg.opts, T = [];
    if (o.trim || o.emptyNa) { T.push('for col in df.columns:', '    if not (pd.api.types.is_string_dtype(df[col]) or df[col].dtype == object):', '        continue', '    df[col] = df[col].astype("string")' + (o.trim ? '.str.strip()' : '')); if (o.emptyNa) T.push('    df[col] = df[col].mask(df[col] == "", pd.NA)   # empty text counts as missing'); }
    if (o.dropBlank) T.push(T.length ? '' : '# nothing to trim', 'blank = df.isna().all(axis=1)', 'df = df[~blank]', 'print(f"Dropped {int(blank.sum()):,} completely blank row(s)")');
    if (T.length) add('3. Clean the text', (o.trim ? 'Trims spaces around text. ' : '') + (o.emptyNa ? 'Empty text becomes a missing value. ' : '') + (o.dropBlank ? 'Rows with nothing in them are dropped.' : ''), T.filter(l => l !== '# nothing to trim'));

    /* 4 types */
    const conv = on.filter(c => c.type !== 'text'), kinds = new Set(conv.map(c => c.type)), V = [];
    if (conv.length) {
      if (kinds.has('whole') || kinds.has('decimal')) V.push('def to_number(s):', '    """Text to number. Drops thousands separators and currency signs; (12.50) becomes -12.50."""',
        '    t = s.astype("string").str.strip().str.replace(r"[,$\u20ac\u00a3\s]", "", regex=True)', '    t = t.str.replace(r"^\\((.*)\\)$", r"-\\1", regex=True)', '    return pd.to_numeric(t, errors="coerce").astype("Float64")', '');
      if (kinds.has('whole')) V.push('def to_whole(s):', '    """Whole numbers only: 12.5 is not converted, so it shows up as a problem."""', '    n = to_number(s)', '    return n.where(n % 1 == 0).astype("Int64")', '');
      if (kinds.has('date') || kinds.has('datetime')) V.push('def to_datetime(s):', '    """Text to date and time. The first value sets the expected format; values that don\'t fit become missing."""', '    if pd.api.types.is_datetime64_any_dtype(s):', '        return s',
        '    return pd.to_datetime(s.astype("string").str.strip(), errors="coerce"' + (o.dayFirst ? ', dayfirst=True' : '') + ')', '');
      if (kinds.has('date')) V.push('def to_date(s):', '    """A date with no time of day."""', '    return to_datetime(s).dt.normalize()', '');
      if (kinds.has('bool')) V.push('BOOL_WORDS = {"true": True, "t": True, "yes": True, "y": True, "1": True, "false": False, "f": False, "no": False, "n": False, "0": False}', '', 'def to_bool(s):', '    """Yes/no, true/false, y/n and 1/0 in any letter case."""',
        '    return s.astype("string").str.strip().str.lower().map(BOOL_WORDS).astype("boolean")', '');
      const fn = { whole: 'to_whole', decimal: 'to_number', date: 'to_date', datetime: 'to_datetime', bool: 'to_bool' }, cp = Math.max.apply(null, conv.map(c => py(c.name).length));
      V.push('CONVERT = {'); conv.forEach(c => V.push('    ' + (py(c.name) + ':').padEnd(cp + 1) + ' ' + fn[c.type] + ','));
      V.push('}', '', 'for col, convert in CONVERT.items():', '    original = df[col]', '    df[col] = convert(original)', '    failed = original.notna() & df[col].isna()', '    if failed.any():',
        '        examples = ", ".join(original[failed].astype(str).unique()[:3])', '        note(f"{col}: could not convert", failed.sum(), f"for example: {examples}")');
      add('4. Set the types', 'A value that can’t be converted becomes missing and is listed as a problem. It is never guessed.', V);
    }
    if (aiCols.length) add('Added columns', 'Written with Copilot and checked on the page. Read each one.', aiCols.map(c => 'df[' + py(c.name) + '] = ' + c.expr));

    /* lookup */
    if (j.on) {
      const want = j.cols.split(',').map(s => s.trim()).filter(Boolean), L = ['RIGHT_KEY = ' + py(j.rightKey.trim()), 'LEFT_KEY  = ' + py(j.leftKey), 'LOOKUP_COLS = ' + (want.length ? pyList(want) : 'None') + '   # None = every column', '',
        'lookup = ' + reader(j.kind, 'LOOKUP_PATH', j, true), 'lookup.columns = [str(c).strip() for c in lookup.columns]', 'if LOOKUP_COLS is None:', '    LOOKUP_COLS = [c for c in lookup.columns if c != RIGHT_KEY]',
        'missing = [c for c in [RIGHT_KEY] + LOOKUP_COLS if c not in lookup.columns]', 'if missing:', '    raise ValueError(f"The lookup file is missing column(s): {missing}. It has: {list(lookup.columns)}")',
        'clash = [c for c in LOOKUP_COLS if c in df.columns]', 'if clash:', '    raise ValueError(f"The lookup would add column(s) that already exist: {clash}. Set LOOKUP_COLS or rename them.")', '',
        '# Keys are matched as trimmed text, so 00123 and 123 are different', 'lookup = lookup[[RIGHT_KEY] + LOOKUP_COLS].copy()', 'lookup["_key"] = lookup[RIGHT_KEY].astype("string").str.strip()', 'lookup = lookup[lookup["_key"].notna()]',
        'if lookup["_key"].duplicated().any():', '    dupes = lookup.loc[lookup["_key"].duplicated(), "_key"].unique()[:5].tolist()', '    raise ValueError(f"The lookup file has more than one row for some keys, which would multiply your rows. For example: {dupes}")', '',
        'df["_key"] = df[LEFT_KEY].astype("string").str.strip()', 'df = df.merge(lookup.drop(columns=[RIGHT_KEY]), how="left", on="_key", indicator=True)', 'unmatched = (df["_merge"] == "left_only") & df[LEFT_KEY].notna()', 'if unmatched.any():',
        '    examples = ", ".join(df.loc[unmatched, "_key"].astype(str).unique()[:3])', '    note(f"{LEFT_KEY}: no match in the lookup file", unmatched.sum(), f"for example: {examples}")'];
      if (j.how === 'inner') L.push('df = df[df["_merge"] == "both"]   # keep only the rows that matched');
      L.push('df = df.drop(columns=["_key", "_merge"])');
      add('Look up columns from a second file', 'Adds columns by matching ' + j.leftKey + ' to ' + (j.rightKey.trim() || 'the key') + '. The row count can’t grow: a lookup file with repeated keys stops the script.', L);
    }

    /* filter */
    const FL = K.activeFilters(cfg).map((x, i) => ({ name: String(x.label || '').trim() || x.when.trim(), test: 'df.eval(' + py(x.when.trim()) + ', engine="python")', join: i ? (x.join === 'or' ? 'or' : 'and') : '' }));
    if (aiFilter) FL.push({ name: 'Copilot filter', test: '(' + aiFilter.expr + ')', join: FL.length ? 'and' : '' });
    const keepOut = !!cfg.keepRemoved && FL.length > 0;
    if (FL.length) {
      const fp = Math.max.apply(null, FL.map(f => py(f.name).length));
      const F = ['# True for the rows each filter keeps. A missing value never passes a filter.', 'PASSES = {'].concat(FL.map(f => '    ' + (py(f.name) + ':').padEnd(fp + 1) + ' ' + f.test + ','), ['}',
        'PASSES = {name: pd.Series(p, index=df.index).fillna(False).astype(bool) for name, p in PASSES.items()}', '']);
      if (FL.length > 1) F.push('# Combined left to right: ' + K.filterLogic(K.activeFilters(cfg).concat(aiFilter ? [{ when: 'Copilot filter', join: 'and' }] : [])));
      FL.forEach((f, i) => F.push(i === 0 ? 'keep = PASSES[' + py(f.name) + ']' : 'keep = keep ' + (f.join === 'or' ? '|' : '&') + ' PASSES[' + py(f.name) + ']   # ' + f.join));
      if (keepOut) F.push('', '# Every row before filtering, and the rows the filters take out with the filters each one failed', 'original = df.copy()', 'filtered_out = df[~keep].copy()',
        'filtered_out["failed_filters"] = [", ".join(n for n, p in PASSES.items() if not p.loc[i]) for i in filtered_out.index]');
      F.push('', 'before = len(df)', 'df = df[keep]', 'rows_filtered = before - len(df)', 'print(f"Filters removed {rows_filtered:,} row(s)")');
      if (keepOut) F.push('assert len(original) == len(df) + len(filtered_out), "Rows kept + rows filtered out must equal the rows before filtering"');
      add('Keep only the rows you want', (FL.length > 1 ? 'Rows are kept when they pass: ' + K.filterLogic(K.activeFilters(cfg).concat(aiFilter ? [{ when: 'Copilot filter', join: 'and' }] : [])) + '. ' : '') + (keepOut ? 'All rows before filtering and the rows taken out are kept for the output.' : 'Rows that don’t pass are removed and counted.'), F);
    }

    /* dedupe */
    let dd = false;
    if (cfg.dedupe.on && keys.length) {
      dd = true; const D = ['before = len(df)'];
      if (cfg.dedupe.order) D.push('# Latest row per key: sort by ' + cfg.dedupe.order + ', keep the last, then put the rows back in file order', 'df = (df.sort_values(' + py(cfg.dedupe.order) + ', kind="stable", na_position="first")', '        .drop_duplicates(subset=KEY_COLS, keep="last")', '        .sort_index())');
      else D.push('df = df.drop_duplicates(subset=KEY_COLS, keep=' + py(cfg.dedupe.keep === 'first' ? 'first' : 'last') + ')');
      D.push('rows_deduped = before - len(df)', 'print(f"Removed {rows_deduped:,} duplicate row(s) on {KEY_COLS}")');
      add('Remove duplicates', 'One row per key' + (cfg.dedupe.order ? ', keeping the one with the latest ' + cfg.dedupe.order : ', keeping the ' + (cfg.dedupe.keep === 'first' ? 'first' : 'last') + ' in the file') + '.', D);
    }

    /* checks */
    const rules = [];
    on.filter(c => c.req || c.key).forEach(c => rules.push([c.name + '_missing', 'df[' + py(c.name) + '].isna()']));
    if (keys.length && !dd) rules.push(['duplicate_key', 'df.duplicated(subset=KEY_COLS, keep=False)']);
    cfg.rules.forEach(r => rules.push(ruleExpr(cfg, r)));
    const seen = {}; rules.forEach(r => { seen[r[0]] = (seen[r[0]] || 0) + 1; if (seen[r[0]] > 1) r[0] += '_' + seen[r[0]]; });
    const hasRules = rules.length > 0, split = cfg.bad === 'split', stop = cfg.bad === 'stop';
    if (hasRules) {
      const rp = Math.max.apply(null, rules.map(r => py(r[0]).length));
      const Q = ['# Each check is True for a row with a problem', 'CHECKS = {'].concat(rules.map(r => '    ' + (py(r[0]) + ':').padEnd(rp + 1) + ' ' + r[1] + ','), ['}', '',
        'failed_checks = pd.Series("", index=df.index, dtype="object")', 'for name, bad in CHECKS.items():', '    bad = bad.fillna(False).astype(bool)', '    if bad.any():', '        note(name, bad.sum())', '        failed_checks[bad] = failed_checks[bad] + name + "; "', '',
        'rejected = df[failed_checks != ""].copy()', 'rejected["failed_checks"] = failed_checks[failed_checks != ""].str.rstrip("; ")']);
      if (stop) Q.push('', 'if len(rejected):', '    print(rejected.head(20).to_string())', '    raise ValueError(f"{len(rejected):,} row(s) failed a check. Nothing was written. See the list above.")');
      if (split) Q.push('', '# Rows with a problem leave the main output and go to their own file or sheet', 'df = df[failed_checks == ""]');
      Q.push('print(f"{len(rejected):,} row(s) failed at least one check")');
      add('Check the data', stop ? 'Any row that fails a check stops the script before anything is written.' : split ? 'Rows that fail a check are moved out of the main output and written separately, with the reason.' : 'Rows that fail a check stay in the output and are also listed separately, with the reason.', Q);
    }

    /* summary */
    if (sm.on && sm.group.length && sm.metrics.length) {
      const first = sm.group[0];
      add('Summarize', 'One row per ' + sm.group.join(', ') + '.', ['summary = (', '    df.groupby(' + pyList(sm.group) + ', dropna=False)', '      .agg('].concat(sm.metrics.map(m => '          ' + m.name + '=(' + py(m.agg === 'size' ? first : m.col) + ', ' + py(m.agg) + '),'), ['      )', '      .reset_index()', ')', 'print(summary.head(20).to_string(index=False))']));
    }

    /* write */
    const W = ['if OUTPUT_PATH.resolve() == INPUT_PATH.resolve():', '    raise ValueError("The output would overwrite the input file. Change OUTPUT_PATH.")', 'OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)', 'issues_table = pd.DataFrame(issues, columns=["check", "rows", "detail"])', ''];
    const sumOn = sm.on && sm.group.length && sm.metrics.length;
    if (xl) {
      W.push('with pd.ExcelWriter(OUTPUT_PATH) as book:', '    df.to_excel(book, sheet_name="Data", index=False)');
      if (keepOut) W.push('    filtered_out.to_excel(book, sheet_name="Filtered out", index=False)', '    original.to_excel(book, sheet_name="Original", index=False)');
      if (sumOn) W.push('    summary.to_excel(book, sheet_name="Summary", index=False)');
      if (hasRules && !stop) W.push('    if len(rejected):', '        rejected.to_excel(book, sheet_name="' + (split ? 'Rejected rows' : 'Rows to review') + '", index=False)');
      W.push('    if len(issues_table):', '        issues_table.to_excel(book, sheet_name="Issues", index=False)');
    } else {
      const wr = cfg.output.kind === 'parquet' ? (v, p) => v + '.to_parquet(' + p + ', index=False)' : (v, p) => v + '.to_csv(' + p + ', index=False, encoding="utf-8-sig")   # utf-8-sig opens cleanly in Excel';
      W.push('def beside(tag):', '    """A file next to the output: orders_clean.csv -> orders_clean_<tag>.csv"""', '    return OUTPUT_PATH.with_name(f"{OUTPUT_PATH.stem}_{tag}{OUTPUT_PATH.suffix}")', '', wr('df', 'OUTPUT_PATH'));
      if (keepOut) W.push(wr('filtered_out', 'beside("filtered_out")').replace(/   #.*$/, ''), wr('original', 'beside("original")').replace(/   #.*$/, ''));
      if (sumOn) W.push(wr('summary', 'beside("summary")').replace(/   #.*$/, ''));
      if (hasRules && !stop) W.push('if len(rejected):', '    ' + wr('rejected', 'beside("' + (split ? 'rejected' : 'review') + '")').replace(/   #.*$/, ''));
      W.push('if len(issues_table):', '    issues_table.to_csv(beside("issues").with_suffix(".csv"), index=False, encoding="utf-8-sig")');
    }
    W.push('', 'print()', 'print(f"Rows read:     {rows_read:,}")', 'print(f"Rows written:  {len(df):,}")');
    if (keepOut) W.push('print(f"Filtered out:  {len(filtered_out):,} (kept ' + (xl ? 'on the Filtered out sheet' : 'in the _filtered_out file') + ')")');
    if (hasRules && !stop) W.push('print(f"Rows ' + (split ? 'rejected:' : 'to review:') + ' {len(rejected):,}")');
    W.push('print(f"Problems:      {len(issues):,} kind(s)")', 'print(f"Output:        {OUTPUT_PATH.resolve()}")');
    add('Write the output', xl ? 'One workbook: the data' + (keepOut ? ', the rows the filters took out, all rows before filtering' : '') + (sumOn ? ', the summary' : '') + ', and sheets for rows with problems and the issues list when there are any.' : 'The data, plus files beside it for ' + (sumOn ? 'the summary, ' : '') + 'rows with problems and the issues list when there are any.', W);

    S.forEach((s, i) => { if (!/^\d/.test(s.title)) s.title = (i + 1) + '. ' + s.title; else s.title = (i + 1) + '. ' + s.title.replace(/^\d+\.\s*/, ''); });
    const intro = ['# ' + n.script, '', 'Reads `' + stem(n.inPath) + (n.inPath.match(/\.[^.\\/]+$/) || [''])[0] + '`, cleans and checks it, and writes `' + n.outPath.split(/[\\/]/).pop() + '`. The source file is never changed.', '', 'Needs: `pip install ' + needs.join(' ') + '`'];
    const out = { names: n, sections: S, needs, intro };
    out.py = '# %% [markdown]\n' + intro.map(l => ('# ' + l).trimEnd()).join('\n') + '\n\n' + S.map(s => '# %% [markdown]\n# ## ' + s.title + '\n# ' + s.md + '\n\n# %%\n' + s.code + '\n').join('\n');
    const lines = t => t.split('\n').map((l, i, a) => (i < a.length - 1 ? l + '\n' : l));
    const cells = [{ cell_type: 'markdown', metadata: {}, source: lines(intro.join('\n')) }];
    S.forEach(s => { cells.push({ cell_type: 'markdown', metadata: {}, source: lines('## ' + s.title + '\n' + s.md) }); cells.push({ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: lines(s.code) }); });
    out.ipynb = JSON.stringify({ cells, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' } }, nbformat: 4, nbformat_minor: 4 }, null, 1);
    out.stats = { rules: rules.length, converted: conv.length, kept: on.length, ai: (ai && ai.ok ? ai.ok.length : 0) };
    out.howto = ['Jupyter (notebook or lab)', '  1. Download ' + n.script + '.ipynb and open it.', '  2. Check INPUT_PATH and OUTPUT_PATH in the first code cell.', '  3. Run all cells. Read the lines starting with ! : each is a problem found in the data.', '',
      'VS Code', '  Open ' + n.script + '.py. Each "# %%" line starts a cell: Run Cell, or Run All in the Interactive Window.', '', 'Command line', '  python ' + n.script + '.py', '',
      'First time on this computer', '  pip install ' + needs.join(' '), '', 'Paths', '  A path without a folder is looked for where the script runs. Windows paths work as typed: the page escapes the backslashes.'].join('\n');
    return out;
  };
  K.CHECKLIST = ['Rows read matches the row count of the source file', 'Rows written + rows rejected + duplicates removed + rows filtered out = rows read', 'Every line starting with ! was read and explained', 'A few rows were compared by hand with the source file', 'Dates came through the right way round (day and month)', 'Leading zeros in codes (ZIP, account numbers) are still there', 'Running the script twice gives the same output', 'The output folder isn’t the folder a report reads from until this has been checked'];

  root.PSG = K;
  if (typeof module !== 'undefined') module.exports = K;
})(typeof window !== 'undefined' ? window : globalThis);

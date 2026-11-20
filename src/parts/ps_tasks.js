/* Python Script Generator: Common tasks (owner, Nov 2026: "common scenarios that many data engineers and data analysts
   would use... the user can choose one and then the form expands"). Each task is { kind, open, ...fields } in cfg.tasks,
   run in list order after the Copilot columns. A task kind says its fields (the page draws them), how it reads in one
   line when folded, what it checks, which columns it leaves behind, and the code it writes. No DOM in this file. */
(function (root) {
  'use strict';
  const K = root.PSG;
  const py = s => JSON.stringify(String(s));
  const pyList = a => '[' + a.map(py).join(', ') + ']';
  const snake = K.snake;
  const isNum = t => /^(whole|decimal)$/.test(t), isDate = t => /^date/.test(t);
  const ident = s => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s || '');
  const words = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const nameOr = (t, d) => String(t.name || '').trim() || d;
  const list = a => (a.length > 3 ? a.slice(0, 3).join(', ') + ' and ' + (a.length - 3) + ' more' : a.join(', '));
  const fmt = n => Number(n).toLocaleString('en-US');

  K.TASK_GROUPS = [['fix', 'Fix values'], ['reshape', 'Reshape'], ['add', 'Add columns'], ['find', 'Find problems'], ['rows', 'Rows']];
  K.DATE_PARTS = [['year', 'Year'], ['quarter', 'Quarter'], ['month', 'Month number'], ['month_name', 'Month name'], ['week', 'Week of year'], ['weekday', 'Day name'], ['day', 'Day of month']];
  const RUN_CALCS = [['cumsum', 'Running total'], ['prev', 'Previous value'], ['change', 'Change from previous'], ['pct', '% change from previous']];
  const RUN_SUFFIX = { cumsum: 'running_total', prev: 'previous', change: 'change', pct: 'pct_change' };
  /* "old => new" or old<TAB>new (two cells pasted from Excel), one per line */
  K.replacePairs = t => String(t.pairs || '').split('\n').map(l => { const m = /^(.*?)(?:\s*=>\s*|\t)(.*)$/.exec(l); return m ? [m[1].trim(), m[2].trim()] : null; }).filter(p => p && p[0] !== '');
  K.bandEdges = t => words(t.edges).map(Number);
  K.bandLabels = function (t) {
    const e = K.bandEdges(t), given = words(t.labels);
    if (given.length) return given;
    return e.map((x, i) => (i === 0 ? 'under ' + fmt(x) : fmt(e[i - 1]) + ' to under ' + fmt(x))).concat(e.length ? [fmt(e[e.length - 1]) + ' and over'] : []);
  };

  /* field types: col (one column), cols (chips, several), pick (chips from a fixed list), text, textarea, select, check, filter */
  const D = {};
  D.filter = {
    label: 'Filter rows', group: 'rows', once: true, title: () => 'Keep only the rows you want',
    hint: 'Each filter is a pandas condition with your column names, for example amount > 0, status != "TEST" or order_date >= "2026-06-01". From the second one on, choose AND (both must pass) or OR (either can pass). A row with a missing value never passes that filter.',
    blank: () => ({}), fields: [{ type: 'filter' }],
    summary: (t, x) => { const a = K.activeFilters(x.cfg); return a.length ? 'Keep if ' + K.filterLogic(a) : 'No filter yet'; }
  };
  D.dedupe = {
    label: 'Remove duplicates', group: 'rows', title: () => 'Remove duplicates',
    hint: 'One row per value of the chosen columns. With no columns chosen, the Key columns from Step 2 are used.',
    blank: () => ({ cols: [], order: '', keep: 'last' }),
    fields: [{ k: 'cols', type: 'cols', label: 'Rows are duplicates when these match', hint: 'none chosen = the Key columns' },
      { k: 'order', type: 'col', label: 'Which row to keep', types: ['number', 'date'], empty: 'By position in the file', optLabel: c => 'The one with the latest ' + c },
      { k: 'keep', type: 'select', label: 'In file order, keep', opts: [['last', 'The last one'], ['first', 'The first one']], show: t => !t.order }],
    summary: (t, x) => 'One row per ' + (t.cols.length ? list(t.cols) : x.keys.length ? list(x.keys) : 'key (none ticked)') + (t.order ? ', latest ' + t.order : ', ' + t.keep + ' in the file'),
    problems: (t, x, add) => { if (!t.cols.length && !x.keys.length) add('err', 'choose the columns that make rows duplicates, or tick Key in Step 2.'); }
  };
  D.lookup = {
    label: 'Look up columns from a second file', group: 'add', title: () => 'Look up columns from a second file',
    hint: 'Adds columns by matching a column of yours to a column in another file. Your row count can’t grow: if the lookup file has two rows for one key, the script stops and says so. Rows with no match are reported.',
    blank: () => ({ fileKind: 'csv', path: '', sheet: '', leftKey: '', rightKey: '', cols: '', how: 'left' }),
    fields: [{ k: 'fileKind', type: 'select', label: 'Lookup file type', opts: [['csv', 'CSV (comma)'], ['excel', 'Excel workbook'], ['parquet', 'Parquet']] },
      { k: 'path', type: 'text', label: 'Path to the lookup file', ph: 'C:\\Data\\regions.csv', wide: true },
      { k: 'sheet', type: 'text', label: 'Sheet name', hint: 'empty = the first', show: t => t.fileKind === 'excel' },
      { k: 'leftKey', type: 'col', label: 'Match your column', req: true, need: 'the column of yours to match' },
      { k: 'rightKey', type: 'text', label: 'To this header in the lookup file', ph: 'Region' },
      { k: 'cols', type: 'text', label: 'Columns to bring in', hint: 'headers, comma-separated; empty = all', ph: 'Manager, Target' },
      { k: 'how', type: 'select', label: 'Rows with no match', opts: [['left', 'Keep them (new columns empty)'], ['inner', 'Remove them']] }],
    summary: t => (t.leftKey || '?') + ' → ' + (t.rightKey || '?') + ' in ' + (String(t.path).split(/[\\/]/).pop() || 'the lookup file') + (words(t.cols).length ? ': ' + list(words(t.cols)) : ': every column'),
    problems: (t, x, add) => {
      if (!t.path.trim()) add('warn', 'no file path: set ' + x.lookupVar + ' in the script.');
      if (!t.rightKey.trim()) add('err', 'give the header of the matching column in the lookup file.');
      words(t.cols).forEach(c => { if (x.has(c)) add('err', 'the column ' + c + ' already exists. Rename one of them.'); });
      if (t.path.trim() && !K.hasExt(t.path)) add('info', 'the path has no file extension. If no file has exactly that name, the script uses the one ending in ' + K.EXTS[t.fileKind].join(', ') + '.');
    },
    opens: t => !words(t.cols).length,
    flow: (t, cols) => cols.concat(words(t.cols).map(n => ({ name: n, type: 'text' })))
  };
  D.rownum = {
    label: 'Number the rows', group: 'rows', once: true, title: () => 'Row numbers',
    hint: 'A column with the row each line came from, so any row can be found in the source. Fills, duplicate flags and comparisons use it to say which row a value came from.',
    blank: () => ({ name: 'row_number', from: 'file' }),
    fields: [{ k: 'name', type: 'text', label: 'Column name', ph: 'row_number' },
      { k: 'from', type: 'select', label: 'Number each row by', opts: [['file', 'Its row in the file (as Excel shows it)'], ['clean', '1, 2, 3… at this point']] }],
    summary: t => (snake(t.name) || 'row_number') + (t.from === 'clean' ? ': 1, 2, 3…' : ': the row in the file'),
    problems: (t, x, add) => {
      const n = snake(t.name) || 'row_number';
      if (x.has(n)) add('err', n + ' is already a column. Choose another name.');
      if (t.from === 'file' && x.reshaped) add('err', 'rows were turned into new rows by an earlier task, so they no longer match the file. Move this task up, or number 1, 2, 3.');
    },
    flow: (t, cols) => [{ name: snake(t.name) || 'row_number', type: 'whole' }].concat(cols)
  };
  D.filldown = {
    label: 'Fill blanks from the row above', group: 'fix', title: t => 'Fill blanks in ' + list(t.cols) + ' from the row above',
    hint: 'For files where a value is written once and the rows below it are left empty (a report export, a merged cell). Each blank takes the last value above it.',
    blank: () => ({ cols: [], within: '' }),
    fields: [{ k: 'cols', type: 'cols', label: 'Columns to fill', req: true, need: 'the columns to fill' },
      { k: 'within', type: 'col', label: 'Only within the same', empty: 'Whole file', hint: 'optional: never carry a value into another group' }],
    summary: t => (t.cols.length ? list(t.cols) : 'no columns yet') + (t.within ? ', within each ' + t.within : '')
  };
  D.fillmatch = {
    label: 'Fill a missing value from matching rows', group: 'fix', needsRow: true, title: t => 'Fill a missing ' + (t.col || 'value') + ' from matching rows',
    hint: 'A row missing the value takes it from another row that matches it, trying each line in order. Matching ignores capitals and extra spaces. A match is used only when every matching row has the same value; otherwise the row stays empty and a note lists the candidates. New columns say which row it came from and how it matched.',
    blank: () => ({ col: '', passes: '', swapA: '', swapB: '' }),
    fields: [{ k: 'col', type: 'col', label: 'Column to fill', req: true, need: 'the column to fill' },
      { k: 'passes', type: 'textarea', label: 'Match on, one try per line', hint: 'columns separated by commas; tried in order, first line first', ph: 'first_name, last_name, date_of_birth\nfirst_name, last_name', wide: true },
      { k: 'swapA', type: 'col', label: 'Also try with these swapped', hint: 'optional: names entered the wrong way round', empty: '—' },
      { k: 'swapB', type: 'col', label: 'and', empty: '—' }],
    summary: t => (t.col || '?') + ' from rows matching ' + (K.fillPasses(t).map(p => p.join(' + ')).join(', then ') || '?') + (t.swapA && t.swapB ? ' (also ' + t.swapA + '/' + t.swapB + ' swapped)' : ''),
    problems: (t, x, add) => {
      const ps = K.fillPasses(t);
      if (!ps.length) add('err', 'give at least one set of columns to match on.');
      ps.forEach((p, j) => { p.filter(c => !x.has(c)).forEach(c => add('err', 'match ' + (j + 1) + ': ' + c + ' isn’t a column at this point.')); if (p.indexOf(t.col) >= 0) add('err', 'match ' + (j + 1) + ' uses the column it fills.'); });
      if ((t.swapA || t.swapB) && (!t.swapA || !t.swapB || t.swapA === t.swapB)) add('err', 'choose two different columns to swap, or neither.');
      if (t.swapA && t.swapB && !ps.some(p => p.indexOf(t.swapA) >= 0 && p.indexOf(t.swapB) >= 0)) add('warn', 'no match uses both ' + t.swapA + ' and ' + t.swapB + ', so the swapped try never runs.');
      [t.col + '_filled_from_row', t.col + '_fill_note'].forEach(c => { if (t.col && x.has(c)) add('err', c + ' already exists: is this column filled twice?'); });
    },
    flow: (t, cols) => cols.concat([{ name: t.col + '_filled_from_row', type: 'whole' }, { name: t.col + '_fill_note', type: 'text' }])
  };
  D.replace = {
    label: 'Replace values', group: 'fix', title: t => 'Replace values in ' + list(t.cols),
    hint: 'One replacement per line: old => new. Leave the new value empty to make it missing (whole values) or to delete the text (part of the text). Two columns copied from Excel work too.',
    blank: () => ({ cols: [], pairs: '', part: false, caseSens: false }),
    fields: [{ k: 'cols', type: 'cols', label: 'In these columns', req: true, types: ['text'], need: 'the columns to replace values in' },
      { k: 'pairs', type: 'textarea', label: 'Replacements, one per line', ph: 'N/A =>\nCalif. => CA\nUnited States => US', wide: true },
      { k: 'part', type: 'check', label: 'Replace part of the text (otherwise only the whole value)' },
      { k: 'caseSens', type: 'check', label: 'Capitals must match' }],
    summary: t => { const p = K.replacePairs(t); return (p.length ? p.length + ' replacement' + (p.length > 1 ? 's' : '') + ' (' + p.slice(0, 2).map(x => x[0] + ' → ' + (x[1] || (t.part ? '(removed)' : '(missing)'))).join(', ') + (p.length > 2 ? ', …' : '') + ')' : 'no replacements yet') + (t.cols.length ? ' in ' + list(t.cols) : ''); },
    problems: (t, x, add) => { if (!K.replacePairs(t).length) add('err', 'write at least one replacement: old => new.'); }
  };
  D.split = {
    label: 'Split a column', group: 'reshape', title: t => 'Split ' + (t.col || 'a column'),
    hint: 'One text column into several at a separator: "Lee, Avery" into last and first name. When there are more pieces than names, the last column gets the rest.',
    blank: () => ({ col: '', sep: ',', into: '', keep: false }),
    fields: [{ k: 'col', type: 'col', label: 'Column to split', req: true, types: ['text'], need: 'the column to split' },
      { k: 'sep', type: 'text', label: 'Split at', hint: 'the exact text, for example , or - or a space', ph: ',' },
      { k: 'into', type: 'text', label: 'New column names', hint: 'comma-separated, in order', ph: 'last_name, first_name' },
      { k: 'keep', type: 'check', label: 'Keep the original column' }],
    summary: t => (t.col || '?') + ' at “' + (t.sep === ' ' ? 'a space' : t.sep) + '” into ' + (words(t.into).join(', ') || '?'),
    problems: (t, x, add) => {
      if (t.sep === '') add('err', 'give the text to split at.');
      const into = words(t.into);
      if (into.length < 2) add('err', 'give at least two new column names.');
      into.forEach(n => { if (!ident(n)) add('err', '“' + n + '” needs to be letters, digits and underscores.'); else if (x.has(n) && !(n === t.col && !t.keep)) add('err', n + ' is already a column.'); });
    },
    flow: (t, cols) => { const i = cols.findIndex(c => c.name === t.col), add = words(t.into).map(n => ({ name: n, type: 'text' })); const out = cols.slice(); out.splice(i < 0 ? out.length : i + 1, 0, ...add); return t.keep ? out : out.filter((c, j) => !(c.name === t.col && j === i)); }
  };
  D.combine = {
    label: 'Combine columns', group: 'reshape', title: t => 'Combine ' + list(t.cols) + ' into ' + (t.name || 'one column'),
    hint: 'Joins columns into one, in the order you click them. Missing values are skipped, so no doubled separators.',
    blank: () => ({ cols: [], sep: ' ', name: '' }),
    fields: [{ k: 'cols', type: 'cols', label: 'Columns, in order', ordered: true },
      { k: 'sep', type: 'text', label: 'Put between them', hint: 'a space, ", " or nothing', ph: ' ' },
      { k: 'name', type: 'text', label: 'New column name', ph: 'full_name' }],
    summary: t => (t.cols.join(' + ') || '?') + ' → ' + (t.name || '?'),
    problems: (t, x, add) => {
      if (t.cols.length < 2) add('err', 'choose at least two columns.');
      if (!ident(t.name)) add('err', 'give the new column a name (letters, digits, underscores).'); else if (x.has(t.name)) add('err', t.name + ' is already a column.');
    },
    flow: (t, cols) => cols.concat([{ name: t.name, type: 'text' }])
  };
  D.unpivot = {
    label: 'Columns to rows (unpivot)', group: 'reshape', reshapes: true, title: () => 'Columns to rows',
    hint: 'A wide table (one column per month or per question) becomes a long one: one row per original row and column, with the column’s header in one new column and its value in another.',
    blank: () => ({ vals: [], ids: [], nameCol: 'attribute', valueCol: 'value', dropEmpty: true }),
    fields: [{ k: 'vals', type: 'cols', label: 'Columns to turn into rows', req: true, need: 'the columns to turn into rows' },
      { k: 'ids', type: 'cols', label: 'Columns to keep on every row', hint: 'none chosen = every other column' },
      { k: 'nameCol', type: 'text', label: 'Column for the old header', ph: 'month' },
      { k: 'valueCol', type: 'text', label: 'Column for the value', ph: 'amount' },
      { k: 'dropEmpty', type: 'check', label: 'Leave out rows where the value is missing' }],
    summary: t => (t.vals.length ? list(t.vals) : '?') + ' → ' + (t.nameCol || '?') + ' / ' + (t.valueCol || '?'),
    problems: (t, x, add) => {
      [['nameCol', 'the old header'], ['valueCol', 'the value']].forEach(([k, w]) => { if (!ident(t[k])) add('err', 'give the column for ' + w + ' a name (letters, digits, underscores).'); });
      if (t.nameCol && t.nameCol === t.valueCol) add('err', 'the two new columns need different names.');
      const keep = t.ids.length ? t.ids : x.avail.map(c => c.name).filter(n => t.vals.indexOf(n) < 0);
      [t.nameCol, t.valueCol].forEach(n => { if (n && keep.indexOf(n) >= 0) add('err', n + ' is already a column kept on every row.'); });
      t.ids.filter(c => t.vals.indexOf(c) >= 0).forEach(c => add('err', c + ' is chosen both to keep and to turn into rows.'));
      const ty = new Set(t.vals.map(v => x.typeOf(v))); if (ty.size > 1) add('info', 'the columns turned into rows have different types, so ' + (t.valueCol || 'the value') + ' is text.');
    },
    flow: (t, cols, x) => {
      const ids = t.ids.length ? cols.filter(c => t.ids.indexOf(c.name) >= 0 || c.name === x.rowCol) : cols.filter(c => t.vals.indexOf(c.name) < 0);
      const ty = Array.from(new Set(t.vals.map(v => (cols.find(c => c.name === v) || {}).type || '')));
      return ids.concat([{ name: t.nameCol, type: 'text' }, { name: t.valueCol, type: ty.length === 1 ? ty[0] : 'text' }]);
    }
  };
  D.bands = {
    label: 'Group numbers into bands', group: 'add', title: t => 'Bands of ' + (t.col || 'a number'),
    hint: 'Puts each number in a band: with edges 100, 1000 the bands are under 100, 100 to under 1,000, and 1,000 and over. Name the bands yourself, or leave the names empty.',
    blank: () => ({ col: '', edges: '', labels: '', name: '' }),
    fields: [{ k: 'col', type: 'col', label: 'Number column', req: true, types: ['number'], need: 'the number column' },
      { k: 'edges', type: 'text', label: 'Band edges', hint: 'numbers, smallest first', ph: '100, 1000' },
      { k: 'labels', type: 'text', label: 'Band names', hint: 'optional: one more than the edges', ph: 'Small, Medium, Large' },
      { k: 'name', type: 'text', label: 'New column name', hint: 'empty = <column>_band', ph: 'amount_band' }],
    summary: t => (t.col || '?') + ': ' + (K.bandEdges(t).length && K.bandEdges(t).every(n => !isNaN(n)) ? K.bandLabels(t).join(' | ') : 'no edges yet') + ' → ' + nameOr(t, (t.col || 'column') + '_band'),
    problems: (t, x, add) => {
      const e = K.bandEdges(t);
      if (!e.length) add('err', 'give at least one edge, for example 100, 1000.');
      else if (e.some(isNaN)) add('err', 'the edges have to be numbers, for example 100, 1000.');
      else if (e.some((v, i) => i && v <= e[i - 1])) add('err', 'the edges have to go up, smallest first.');
      if (words(t.labels).length && words(t.labels).length !== e.length + 1) add('err', e.length + ' edge' + (e.length === 1 ? '' : 's') + ' make ' + (e.length + 1) + ' bands, so give ' + (e.length + 1) + ' names (or none).');
      const n = nameOr(t, t.col + '_band'); if (!ident(n)) add('err', '“' + n + '” needs to be letters, digits and underscores.'); else if (t.col && x.has(n)) add('err', n + ' is already a column.');
    },
    flow: (t, cols) => cols.concat([{ name: nameOr(t, t.col + '_band'), type: 'text' }])
  };
  const daysName = t => nameOr(t, 'days_' + (t.until === 'today' ? 'to_today' : t.col + '_to_' + t.until));
  D.dates = {
    label: 'Date parts and days between', group: 'add', title: t => 'Date parts of ' + (t.col || 'a date'),
    hint: 'Year, month, week and so on as their own columns, for grouping. Days between counts whole days from this date to another date column or to today.',
    blank: () => ({ col: '', parts: [], until: '', name: '' }),
    fields: [{ k: 'col', type: 'col', label: 'Date column', req: true, types: ['date'], need: 'the date column' },
      { k: 'parts', type: 'pick', label: 'Add', opts: K.DATE_PARTS },
      { k: 'until', type: 'col', label: 'Days from it until', types: ['date'], empty: 'No days between', extra: [['today', 'Today (when the script runs)']] },
      { k: 'name', type: 'text', label: 'Name for the days', hint: 'empty = days_…', show: t => !!t.until }],
    summary: t => (t.col || '?') + ': ' + ((t.parts.map(p => (K.DATE_PARTS.find(d => d[0] === p) || ['', p])[1].toLowerCase()).join(', ')) || 'no parts') + (t.until ? '; days until ' + t.until : ''),
    problems: (t, x, add) => {
      if (!t.parts.length && !t.until) add('err', 'choose the parts to add, or a date for days between.');
      const made = t.parts.map(p => t.col + '_' + p).concat(t.until ? [daysName(t)] : []);
      made.forEach(n => { if (t.col && x.has(n)) add('err', n + ' is already a column.'); });
      if (t.until && !ident(daysName(t))) add('err', 'the name for the days needs to be letters, digits and underscores.');
      if (t.until && t.until === t.col) add('err', 'days between needs a different date column.');
    },
    flow: (t, cols) => cols.concat(t.parts.map(p => ({ name: t.col + '_' + p, type: /name$/.test(p) ? 'text' : 'whole' })), t.until ? [{ name: daysName(t), type: 'whole' }] : [])
  };
  D.rank = {
    label: 'Rank within a group', group: 'add', title: t => 'Rank by ' + (t.by || 'a column'),
    hint: 'Numbers the rows 1, 2, 3 by a column, starting again in each group: the top 3 orders per customer, the latest visit per person.',
    blank: () => ({ by: '', group: [], order: 'desc', ties: 'min', name: 'rank' }),
    fields: [{ k: 'by', type: 'col', label: 'Rank by', req: true, need: 'the column to rank by' },
      { k: 'order', type: 'select', label: 'Number 1 is', opts: [['desc', 'The highest or latest'], ['asc', 'The lowest or earliest']] },
      { k: 'group', type: 'cols', label: 'Start again for each', hint: 'none chosen = rank the whole file' },
      { k: 'ties', type: 'select', label: 'Equal values', opts: [['min', 'Share a rank: 1, 1, 3'], ['dense', 'Share a rank: 1, 1, 2'], ['first', 'Never share: 1, 2, 3 in file order']] },
      { k: 'name', type: 'text', label: 'New column name', ph: 'rank' }],
    summary: t => (nameOr(t, 'rank')) + ': ' + (t.order === 'asc' ? 'lowest ' : 'highest ') + (t.by || '?') + ' = 1' + (t.group.length ? ', per ' + list(t.group) : ''),
    problems: (t, x, add) => {
      const n = nameOr(t, 'rank'); if (!ident(n)) add('err', '“' + n + '” needs to be letters, digits and underscores.'); else if (x.has(n)) add('err', n + ' is already a column.');
      if (t.group.indexOf(t.by) >= 0) add('err', t.by + ' can’t be both what to rank by and a group.');
    },
    flow: (t, cols) => cols.concat([{ name: nameOr(t, 'rank'), type: 'whole' }])
  };
  const runName = t => nameOr(t, (t.col || 'value') + '_' + RUN_SUFFIX[t.calc]);
  D.running = {
    label: 'Running total, previous value, change', group: 'add', title: t => (RUN_CALCS.find(c => c[0] === t.calc) || RUN_CALCS[0])[1] + ' of ' + (t.col || 'a column'),
    hint: 'Each row against the rows before it: a running total, the value on the row before, or the change since then. Sort by a date first so “before” means earlier; start again for each group if you choose one.',
    blank: () => ({ col: '', calc: 'cumsum', group: [], order: '', name: '' }),
    fields: [{ k: 'calc', type: 'select', label: 'Work out', opts: RUN_CALCS },
      { k: 'col', type: 'col', label: 'Of', req: true, need: 'the column to work it out from' },
      { k: 'order', type: 'col', label: 'In the order of', empty: 'The file' },
      { k: 'group', type: 'cols', label: 'Start again for each', hint: 'optional' },
      { k: 'name', type: 'text', label: 'New column name', hint: 'empty = <column>_' + 'running_total…' }],
    summary: t => runName(t) + ': ' + (RUN_CALCS.find(c => c[0] === t.calc) || RUN_CALCS[0])[1].toLowerCase() + ' of ' + (t.col || '?') + (t.order ? ' by ' + t.order : '') + (t.group.length ? ', per ' + list(t.group) : ''),
    problems: (t, x, add) => {
      if (t.calc !== 'prev' && t.col && x.typeOf(t.col) && !isNum(x.typeOf(t.col))) add('err', t.col + ' isn’t a number column. Set its type in Step 2, or choose Previous value.');
      const n = runName(t); if (!ident(n)) add('err', '“' + n + '” needs to be letters, digits and underscores.'); else if (t.col && x.has(n)) add('err', n + ' is already a column.');
    },
    flow: (t, cols, x) => cols.concat([{ name: runName(t), type: t.calc === 'prev' ? x.typeOf(t.col) : 'decimal' }])
  };
  const dupName = t => snake(t.name) || 'possible_duplicate';
  D.dupflag = {
    label: 'Flag possible duplicates', group: 'find', needsRow: true, title: () => 'Flag possible duplicates',
    hint: 'Rows that match on the chosen columns, ignoring capitals and extra spaces, are given the same group number and the list of their row numbers. Nothing is removed: you decide which to keep.',
    blank: () => ({ cols: [], name: 'possible_duplicate' }),
    fields: [{ k: 'cols', type: 'cols', label: 'Match on', req: true, need: 'the columns to match on' },
      { k: 'name', type: 'text', label: 'Start of the new column names', hint: 'gives <name>_group and <name>_rows', ph: 'possible_duplicate' }],
    summary: t => 'same ' + (t.cols.length ? t.cols.join(' + ') : '?') + ' → ' + dupName(t) + '_group, _rows',
    problems: (t, x, add) => { [dupName(t) + '_group', dupName(t) + '_rows'].forEach(n => { if (x.has(n)) add('err', n + ' is already a column.'); }); },
    flow: (t, cols) => cols.concat([{ name: dupName(t) + '_group', type: 'whole' }, { name: dupName(t) + '_rows', type: 'text' }])
  };
  D.conflicts = {
    label: 'Find values that differ within a group', group: 'find', needsRow: true, once: true, title: t => 'Values that differ within a ' + (t.group || 'group'),
    hint: 'Rows that belong together (one person, one order) should agree. For each compared column with more than one value in a group, every row of the group gets the rows involved and the distinct values, and a Conflicts sheet lists them all.',
    blank: () => ({ group: '', cols: [], missing: false }),
    fields: [{ k: 'group', type: 'col', label: 'Rows that belong together share', req: true, need: 'the column that identifies one person or thing' },
      { k: 'cols', type: 'cols', label: 'Compare', req: true, not: 'group', need: 'the columns to compare' },
      { k: 'missing', type: 'check', label: 'Count a missing value as a different value' }],
    summary: t => (t.cols.length ? list(t.cols) : '?') + ' per ' + (t.group || '?'),
    problems: (t, x, add) => {
      if (t.cols.indexOf(t.group) >= 0) add('err', t.group + ' is the group, so it can’t be compared.');
      if (t.group && !x.reqCols.has(t.group) && !x.filled.has(t.group)) add('info', 'rows with no ' + t.group + ' aren’t compared with anything.');
    },
    flow: (t, cols) => cols.concat(...t.cols.map(c => [{ name: c + '_conflict_rows', type: 'text' }, { name: c + '_conflict_values', type: 'text' }]), [{ name: 'conflict_columns', type: 'text' }])
  };
  K.TASK_DEFS = D;
  K.taskBlank = kind => Object.assign({ kind, open: true }, D[kind].blank());

  /* saved data can be anything: keep only the fields a task kind has, of the right type */
  K.taskClean = function (s) {
    if (!s || typeof s !== 'object' || !D[s.kind]) return null;
    const t = K.taskBlank(s.kind); t.open = s.open === true;
    Object.keys(t).forEach(k => {
      if (k === 'kind' || k === 'open') return;
      if (Array.isArray(t[k])) t[k] = (Array.isArray(s[k]) ? s[k] : []).filter(v => typeof v === 'string');
      else if (typeof s[k] === typeof t[k]) t[k] = s[k];
    });
    (D[s.kind].fields || []).forEach(f => { if (f.type === 'select' && !f.opts.some(o => o[0] === t[f.k])) t[f.k] = f.opts[0][0]; });
    return t;
  };

  /* settings saved before Common tasks (Nov 2026): lookup > filter > duplicates > fills > comparison, as they ran then */
  const OLD = c => !Array.isArray(c.tasks) || (c.dedupe && c.dedupe.on) || (c.join && c.join.on) || (c.rowNo && c.rowNo.on) || (Array.isArray(c.fills) && c.fills.some(f => f && f.col)) || (c.conflicts && c.conflicts.on);
  K.migrate = function (c) {
    const T = Array.isArray(c.tasks) ? c.tasks : [], add = [], rn = c.rowNo || {}, fills = (Array.isArray(c.fills) ? c.fills : []).filter(f => f && f.col), cf = c.conflicts || {};
    if (!T.some(t => t.kind === 'rownum') && (rn.on || fills.length || cf.on)) add.push({ kind: 'rownum', name: rn.name || 'row_number', from: rn.from === 'clean' ? 'clean' : 'file' });
    if (c.join && c.join.on) { const j = c.join; add.push({ kind: 'lookup', fileKind: j.kind || 'csv', path: j.path || '', sheet: j.sheet || '', leftKey: j.leftKey || '', rightKey: j.rightKey || '', cols: j.cols || '', how: j.how === 'inner' ? 'inner' : 'left' }); }
    if (K.activeFilters(c).length && !T.some(t => t.kind === 'filter')) add.push({ kind: 'filter' });
    if (c.dedupe && c.dedupe.on) add.push({ kind: 'dedupe', cols: [], order: c.dedupe.order || '', keep: c.dedupe.keep === 'first' ? 'first' : 'last' });
    fills.forEach(f => add.push({ kind: 'fillmatch', col: f.col, passes: f.passes || '', swapA: f.swapA || '', swapB: f.swapB || '' }));
    if (cf.on && !T.some(t => t.kind === 'conflicts')) add.push({ kind: 'conflicts', group: cf.group || '', cols: (cf.cols || []).slice(), missing: !!cf.missing });
    c.tasks = add.map(t => K.taskClean(t)).concat(T.map(t => K.taskClean(t)).filter(Boolean));
    ['dedupe', 'join', 'rowNo', 'fills', 'conflicts'].forEach(k => { delete c[k]; });
    return c;
  };
  K.norm = c => (OLD(c) ? K.migrate(JSON.parse(JSON.stringify(c))) : c);

  /* the tasks as they run: a filter with no task of its own runs first, and row numbers are added first when a task needs them */
  K.runList = function (cfg, ai) {
    const T = cfg.tasks.slice(), aiF = ((ai && ai.ok) || []).some(i => i.kind === 'FILTER');
    if (T.some(t => D[t.kind].needsRow) && !T.some(t => t.kind === 'rownum')) T.unshift({ kind: 'rownum', name: 'row_number', from: 'file', implicit: true });
    if (!T.some(t => t.kind === 'filter') && (K.activeFilters(cfg).length || aiF)) T.unshift({ kind: 'filter', implicit: true });
    return T;
  };
  K.rowTask = cfg => K.runList(K.norm(cfg), null).find(t => t.kind === 'rownum');
  K.rowCol = cfg => { const t = K.rowTask(cfg); return t ? snake(t.name) || 'row_number' : ''; };
  K.rowNumberLines = function (cfg) {
    const t = K.rowTask(cfg);
    if (!t || t.from === 'clean') return [];
    return /^(excel|csv)$/.test(cfg.input.kind)
      ? ['ROW_NUMBERS = pd.Series(raw.index + ' + (Number(cfg.input.skip || 0) + 2) + ', index=raw.index)   # each row as Excel or a text editor numbers it (the header is row ' + (Number(cfg.input.skip || 0) + 1) + ')']
      : ['ROW_NUMBERS = pd.Series(raw.index + 1, index=raw.index)   # 1 = the first row read'];
  };

  /* which columns exist before and after each task */
  K.taskFlow = function (cfg0, ai) {
    const cfg = K.norm(cfg0), rowCol = K.rowCol(cfg);
    let cols = cfg.cols.filter(c => c.on).map(c => ({ name: c.name, type: c.type }));
    ((ai && ai.ok) || []).filter(i => i.kind === 'COLUMN').forEach(a => { if (!cols.some(c => c.name === a.name)) cols.push({ name: a.name, type: '' }); });
    const steps = []; let open = false, reshaped = false;
    K.runList(cfg, ai).forEach(t => {
      const d = D[t.kind], typeOf = n => (cols.find(c => c.name === n) || {}).type || '';
      const before = cols, after = d.flow ? d.flow(t, cols.slice(), { rowCol, typeOf }) : cols;
      steps.push({ t, before, after, open, reshaped });
      if (d.opens && d.opens(t)) open = true;
      if (d.reshapes) reshaped = true;
      cols = after;
    });
    return { steps, cols, open, rowCol, cfg };
  };

  /* checks on the tasks; names: "Task 2 (Split a column)" */
  K.taskProblems = function (cfg0, ai, add) {
    const fl = K.taskFlow(cfg0, ai), cfg = fl.cfg, keys = cfg.cols.filter(c => c.on && c.key).map(c => c.name);
    const reqCols = new Set(cfg.cols.filter(c => c.on && (c.req || c.key)).map(c => c.name)), filled = new Set();
    const seen = {};
    fl.steps.forEach(s => {
      const t = s.t, d = D[t.kind], at = cfg.tasks.indexOf(t);
      const who = t.implicit ? (t.kind === 'rownum' ? 'Row numbers' : 'Filters') : 'Task ' + (at + 1) + ' (' + d.label + ')';
      const say = (sev, msg) => add(sev, who + ': ' + msg);
      const names = s.before.map(c => c.name), has = n => names.indexOf(n) >= 0, typeOf = n => (s.before.find(c => c.name === n) || {}).type || '';
      const known = n => s.open || has(n);
      if (d.once && !t.implicit) { if (seen[t.kind]) say('err', 'only one of these is used. Remove this one.'); seen[t.kind] = true; }
      (d.fields || []).forEach(f => {
        if (f.show && !f.show(t)) return;
        const v = t[f.k], ok = ty => !ty || !f.types || f.types.some(w => (w === 'number' ? isNum(ty) : w === 'date' ? isDate(ty) : ty === w));
        if (f.type === 'col') {
          if (!v) { if (f.req) say('err', 'choose ' + (f.need || f.label.toLowerCase()) + '.'); return; }
          if (f.extra && f.extra.some(e => e[0] === v)) return;
          if (!known(v)) say('err', v + ' isn’t a column at this point.');
          else if (!ok(typeOf(v))) say('err', v + ' isn’t a ' + f.types.join(' or ') + ' column. Set its type in Step 2.');
        }
        if (f.type === 'cols') {
          if (f.req && !v.length) say('err', 'choose ' + (f.need || f.label.toLowerCase()) + '.');
          v.filter(c => !known(c)).forEach(c => say('err', c + ' isn’t a column at this point.'));
          v.filter(c => known(c) && !ok(typeOf(c))).forEach(c => say('err', c + ' isn’t a ' + f.types.join(' or ') + ' column.'));
        }
      });
      if (d.problems) d.problems(t, { cfg, keys, has, typeOf, avail: s.before, open: s.open, reshaped: s.reshaped, reqCols, filled, lookupVar: lookupVar(cfg, t) }, say);
      if (d.needsRow) { const r = fl.steps.findIndex(x => x.t.kind === 'rownum'), me = fl.steps.indexOf(s); if (r > me) say('err', 'it needs row numbers, so put Number the rows above it.'); }
      if (t.kind === 'fillmatch' && t.col) filled.add(t.col);
    });
    return fl;
  };
  const lookupVar = (cfg, t) => { const i = cfg.tasks.filter(x => x.kind === 'lookup').indexOf(t); return 'LOOKUP_PATH' + (i > 0 ? '_' + (i + 1) : ''); };
  K.lookupVar = lookupVar;
  K.taskSummary = (t, x) => D[t.kind].summary(t, x);

  /* ---------- the code each task writes ---------- */
  const HELPERS = {
    match_key: ['def match_key(frame, cols):', '    """The columns as trimmed, lower-case text joined with |. A row with any of them missing gets no key."""', '    parts = []', '    for c in cols:', '        s = frame[c]',
      '        s = s.dt.strftime("%Y-%m-%d") if pd.api.types.is_datetime64_any_dtype(s) else s.astype("string")', '        parts.append(s.astype("string").str.strip().str.casefold().str.replace(r"\\s+", " ", regex=True))',
      '    key = parts[0]', '    for p in parts[1:]:', '        key = key + "|" + p', '    return key.where(~key.isin(["", "nan"]))', ''],
    as_text: ['def as_text(s):', '    """Values as text: dates as yyyy-mm-dd, 12.0 as 12."""', '    if pd.api.types.is_datetime64_any_dtype(s):', '        return s.dt.strftime("%Y-%m-%d").astype("string")',
      '    t = s.astype("string")', '    if pd.api.types.is_numeric_dtype(s):', '        t = t.str.replace(r"\\.0$", "", regex=True)', '    return t', '']
  };
  const C = {};
  C.rownum = (t, x) => ({ title: 'Row numbers', md: (t.from === 'clean' ? 'Numbers the rows 1, 2, 3... at this point.' : 'The row each line came from in the file' + (/^(excel|csv)$/.test(x.cfg.input.kind) ? ', as Excel or a text editor shows it (the header is row ' + (Number(x.cfg.input.skip || 0) + 1) + ')' : '') + ', so any row can be found in the source.') + ' Later steps use it to say which row a value came from.',
    code: ['ROW_COL = ' + py(x.rowCol), t.from === 'clean' ? 'df.insert(0, ROW_COL, pd.array(range(1, len(df) + 1), dtype="Int64"))' : 'df.insert(0, ROW_COL, ROW_NUMBERS.reindex(df.index).astype("Int64"))   # rows dropped earlier keep their gaps'] });
  C.lookup = function (t, x) {
    const want = words(t.cols), v = lookupVar(x.cfg, t), L = ['RIGHT_KEY = ' + py(t.rightKey.trim()), 'LEFT_KEY  = ' + py(t.leftKey), 'LOOKUP_COLS = ' + (want.length ? pyList(want) : 'None') + '   # None = every column', '',
      'lookup = ' + x.reader(t.fileKind, v, t, true), 'lookup.columns = [str(c).strip() for c in lookup.columns]', 'if LOOKUP_COLS is None:', '    LOOKUP_COLS = [c for c in lookup.columns if c != RIGHT_KEY]',
      'missing = [c for c in [RIGHT_KEY] + LOOKUP_COLS if c not in lookup.columns]', 'if missing:', '    raise ValueError(f"The lookup file is missing column(s): {missing}. It has: {list(lookup.columns)}")',
      'clash = [c for c in LOOKUP_COLS if c in df.columns]', 'if clash:', '    raise ValueError(f"The lookup would add column(s) that already exist: {clash}. Set LOOKUP_COLS or rename them.")', '',
      '# Keys are matched as trimmed text, so 00123 and 123 are different', 'lookup = lookup[[RIGHT_KEY] + LOOKUP_COLS].copy()', 'lookup["_key"] = lookup[RIGHT_KEY].astype("string").str.strip()', 'lookup = lookup[lookup["_key"].notna()]',
      'if lookup["_key"].duplicated().any():', '    dupes = lookup.loc[lookup["_key"].duplicated(), "_key"].unique()[:5].tolist()', '    raise ValueError(f"The lookup file has more than one row for some keys, which would multiply your rows. For example: {dupes}")', '',
      'df["_key"] = df[LEFT_KEY].astype("string").str.strip()', 'merged = df.merge(lookup.drop(columns=[RIGHT_KEY]), how="left", on="_key", indicator=True)', 'merged.index = df.index   # same rows in the same order: keep their labels', 'df = merged',
      'unmatched = (df["_merge"] == "left_only") & df[LEFT_KEY].notna()', 'if unmatched.any():',
      '    examples = ", ".join(df.loc[unmatched, "_key"].astype(str).unique()[:3])', '    note(f"{LEFT_KEY}: no match in the lookup file", unmatched.sum(), f"for example: {examples}")'];
    if (t.how === 'inner') L.push('df = df[df["_merge"] == "both"]   # keep only the rows that matched');
    L.push('df = df.drop(columns=["_key", "_merge"])');
    return { title: 'Look up columns from a second file', md: 'Adds columns by matching ' + t.leftKey + ' to ' + (t.rightKey.trim() || 'the key') + '. The row count can’t grow: a lookup file with repeated keys stops the script.', code: L };
  };
  C.filter = function (t, x) {
    const cfg = x.cfg, aiFilter = x.aiFilter;
    const FL = K.activeFilters(cfg).map((f, i) => ({ name: String(f.label || '').trim() || f.when.trim(), test: 'df.eval(' + py(f.when.trim()) + ', engine="python")', join: i ? (f.join === 'or' ? 'or' : 'and') : '' }));
    if (aiFilter) FL.push({ name: 'Copilot filter', test: '(' + aiFilter.expr + ')', join: FL.length ? 'and' : '' });
    if (!FL.length) return null;
    const keepOut = x.state.keepOut = !!cfg.keepRemoved;
    const logic = K.filterLogic(K.activeFilters(cfg).concat(aiFilter ? [{ when: 'Copilot filter', join: 'and' }] : []));
    const fp = Math.max.apply(null, FL.map(f => py(f.name).length));
    const F = ['# True for the rows each filter keeps. A missing value never passes a filter.', 'PASSES = {'].concat(FL.map(f => '    ' + (py(f.name) + ':').padEnd(fp + 1) + ' ' + f.test + ','), ['}',
      'PASSES = {name: pd.Series(p, index=df.index).fillna(False).astype(bool) for name, p in PASSES.items()}', '']);
    if (FL.length > 1) F.push('# Combined left to right: ' + logic);
    FL.forEach((f, i) => F.push(i === 0 ? 'keep = PASSES[' + py(f.name) + ']' : 'keep = keep ' + (f.join === 'or' ? '|' : '&') + ' PASSES[' + py(f.name) + ']   # ' + f.join));
    if (keepOut) F.push('', '# Every row before filtering, and the rows the filters take out with the filters each one failed', 'original = df.copy()', 'filtered_out = df[~keep].copy()',
      'filtered_out["failed_filters"] = [", ".join(n for n, p in PASSES.items() if not p.loc[i]) for i in filtered_out.index]');
    F.push('', 'before = len(df)', 'df = df[keep]', 'rows_filtered = before - len(df)', 'print(f"Filters removed {rows_filtered:,} row(s)")');
    if (keepOut) F.push('assert len(original) == len(df) + len(filtered_out), "Rows kept + rows filtered out must equal the rows before filtering"');
    return { title: 'Keep only the rows you want', md: (FL.length > 1 ? 'Rows are kept when they pass: ' + logic + '. ' : '') + (keepOut ? 'All rows before filtering and the rows taken out are kept for the output.' : 'Rows that don’t pass are removed and counted.'), code: F };
  };
  C.dedupe = function (t, x) {
    const cols = t.cols.length ? t.cols : x.keys; if (!cols.length) return null;
    const onKeys = !t.cols.length || (cols.length === x.keys.length && cols.every(c => x.keys.indexOf(c) >= 0));
    if (onKeys) x.state.dd = true;
    const v = onKeys && x.keys.length ? 'KEY_COLS' : 'DEDUPE_COLS', Dd = v === 'DEDUPE_COLS' ? ['DEDUPE_COLS = ' + pyList(cols), 'before = len(df)'] : ['before = len(df)'];
    if (t.order) Dd.push('# Latest row per key: sort by ' + t.order + ', keep the last, then put the rows back in file order', 'df = (df.sort_values(' + py(t.order) + ', kind="stable", na_position="first")', '        .drop_duplicates(subset=' + v + ', keep="last")', '        .sort_index())');
    else Dd.push('df = df.drop_duplicates(subset=' + v + ', keep=' + py(t.keep === 'first' ? 'first' : 'last') + ')');
    Dd.push('rows_deduped = before - len(df)', 'print(f"Removed {rows_deduped:,} duplicate row(s) on {' + v + '}")');
    return { title: 'Remove duplicates', md: 'One row per ' + cols.join(', ') + (t.order ? ', keeping the one with the latest ' + t.order : ', keeping the ' + (t.keep === 'first' ? 'first' : 'last') + ' in the file') + '.', code: Dd };
  };
  C.filldown = function (t) {
    if (!t.cols.length) return null;
    const L = ['FILL_DOWN = ' + pyList(t.cols), 'before = df[FILL_DOWN].isna().sum()'];
    L.push(t.within ? 'df[FILL_DOWN] = df.groupby(' + py(t.within) + ', dropna=False)[FILL_DOWN].ffill()   # never across two ' + t.within + ' values' : 'df[FILL_DOWN] = df[FILL_DOWN].ffill()');
    L.push('for col in FILL_DOWN:', '    print(f"{col}: {int(before[col] - df[col].isna().sum()):,} blank(s) filled from the row above")');
    return { title: 'Fill blanks from the row above', md: 'A blank in ' + t.cols.join(', ') + ' takes the last value above it' + (t.within ? ', only within the same ' + t.within : '') + '. Blanks before the first value stay blank.', code: L };
  };
  C.fillmatch = function (t, x) {
    const ps = K.fillPasses(t); if (!t.col || !ps.length) return null;
    const F = ['# The column, then the matches to try in order. A match is used only when it points to ONE value.', 'FILL = {"fill": ' + py(t.col) + ', "passes": [' + ps.map(pyList).join(', ') + '], "swap": ' + (t.swapA && t.swapB ? pyList([t.swapA, t.swapB]) : 'None') + '}', ''].concat(x.helper('match_key'), [
      'col = FILL["fill"]', 'from_col, note_col = f"{col}_filled_from_row", f"{col}_fill_note"', 'df[from_col] = pd.Series(pd.NA, index=df.index, dtype="Int64")', 'df[note_col] = pd.Series(pd.NA, index=df.index, dtype="string")',
      'donors = df[df[col].notna()]                       # only rows that had the value give it', 'was_missing = int(df[col].isna().sum())', 'for cols in FILL["passes"]:', '    tries = [(cols, " + ".join(cols))]',
      '    if FILL["swap"] and all(c in cols for c in FILL["swap"]):', '        a, b = FILL["swap"]', '        tries.append(([b if c == a else a if c == b else c for c in cols], " + ".join(cols) + f" with {a} and {b} swapped"))',
      '    for row_cols, label in tries:', '        need = df[col].isna() & df[note_col].isna()', '        if not need.any():', '            break',
      '        table = pd.DataFrame({"key": match_key(donors, cols), "value": donors[col], "row": donors[ROW_COL]}).dropna(subset=["key"]).sort_values("row")',
      '        grouped = table.groupby("key")', '        n_values = grouped["value"].nunique()', '        first_value, first_row = grouped["value"].first(), grouped["row"].first()',
      '        listed = grouped["value"].agg(lambda s: "; ".join(dict.fromkeys(s.astype(str))))', '        key = match_key(df.loc[need], row_cols)', '        n = key.map(n_values)',
      '        one = key[n.eq(1).fillna(False).astype(bool)]', '        many = key[n.gt(1).fillna(False).astype(bool)]', '        df.loc[one.index, col] = one.map(first_value).astype(df[col].dtype)',
      '        df.loc[one.index, from_col] = one.map(first_row).astype("Int64")', '        df.loc[one.index, note_col] = "matched on " + label',
      '        df.loc[many.index, note_col] = ("not filled: " + label + " matches " + many.map(listed)).astype("string")',
      '        print(f"{col}: {len(one):,} filled by {label}" + (f", {len(many):,} with more than one match" if len(many) else ""))',
      'df.loc[df[col].isna() & df[note_col].isna(), note_col] = "not filled: no match"', 'filled = int(df[from_col].notna().sum())', 'print(f"{col}: {filled:,} of {was_missing:,} missing value(s) filled")',
      'still = df[col].isna()', 'if still.any():', '    note(f"{col} still missing after matching", still.sum(), "see " + note_col)']);
    return { title: 'Fill a missing ' + t.col + ' from matching rows', md: 'A row missing ' + t.col + ' takes the value from another row that matches it, trying each match in order. A match counts only when every matching row has the same value; when they disagree the row is left empty and the note lists the candidates. Only rows that had the value give it. The row it came from and how it matched are written in ' + t.col + '_filled_from_row and ' + t.col + '_fill_note.', code: F };
  };
  C.replace = function (t) {
    const pairs = K.replacePairs(t); if (!t.cols.length || !pairs.length) return null;
    const cs = t.caseSens ? 'True' : 'False', pp = Math.max.apply(null, pairs.map(p => py(p[0]).length));
    const L = ['REPLACE_IN = ' + pyList(t.cols), 'REPLACEMENTS = {   # old: new' + (t.part ? '' : ' (None = missing)')].concat(pairs.map(p => '    ' + (py(p[0]) + ':').padEnd(pp + 1) + ' ' + (p[1] === '' && !t.part ? 'None' : py(p[1])) + ','), ['}', 'CAPITALS_MATTER = ' + cs, '']);
    if (t.part) L.push('import re', '', 'for col in REPLACE_IN:', '    s = df[col].astype("string")', '    changed = pd.Series(False, index=df.index)', '    for old, new in REPLACEMENTS.items():',
      '        changed |= s.str.contains(old, case=CAPITALS_MATTER, regex=False, na=False)', '        s = s.str.replace(re.escape(old), lambda m, new=new: new, regex=True, case=CAPITALS_MATTER)',
      '    df[col] = s.str.strip().replace("", pd.NA)', '    print(f"{col}: {int(changed.sum()):,} value(s) changed")');
    else L.push('for col in REPLACE_IN:', '    original = df[col].astype("string")', '    compare = original if CAPITALS_MATTER else original.str.casefold()', '    s = original.copy()', '    changed = pd.Series(False, index=df.index)',
      '    for old, new in REPLACEMENTS.items():', '        hit = (compare == (old if CAPITALS_MATTER else old.casefold())).fillna(False).astype(bool)', '        s = s.mask(hit, pd.NA if new is None else new)', '        changed |= hit',
      '    df[col] = s', '    print(f"{col}: {int(changed.sum()):,} value(s) replaced")');
    return { title: 'Replace values', md: (t.part ? 'Replaces text inside ' : 'Replaces whole values of ') + t.cols.join(', ') + (t.caseSens ? ' (capitals must match)' : ', ignoring capitals') + '. Each column prints how many values changed.', code: L };
  };
  C.split = function (t) {
    const into = words(t.into); if (!t.col || into.length < 2 || t.sep === '') return null;
    const L = ['SPLIT_COL = ' + py(t.col), 'SEPARATOR = ' + py(t.sep), 'NEW_COLS = ' + pyList(into), '',
      'parts = df[SPLIT_COL].astype("string").str.split(SEPARATOR, n=len(NEW_COLS) - 1, expand=True, regex=False)', 'parts = parts.reindex(columns=range(len(NEW_COLS)))',
      'at = df.columns.get_loc(SPLIT_COL) + 1'];
    if (!t.keep) L.push('original = df[SPLIT_COL]');
    L.push('for i, name in enumerate(NEW_COLS):', '    df.insert(at + i, name, parts[i].astype("string").str.strip().replace("", pd.NA))');
    if (!t.keep) L.push('df = df.drop(columns=[SPLIT_COL])' + (into.indexOf(t.col) >= 0 ? '   # never happens: a new column has the same name' : ''));
    L.push('fewer = df[NEW_COLS[-1]].isna() & ' + (t.keep ? 'df[SPLIT_COL]' : 'original') + '.notna()', 'if fewer.any():', '    note(f"{SPLIT_COL}: fewer pieces than columns", fewer.sum(), "the last column(s) are empty")');
    return { title: 'Split ' + t.col, md: 'Splits ' + t.col + ' at “' + t.sep + '” into ' + into.join(', ') + '. Spaces around each piece are trimmed. Rows with fewer pieces are listed.' + (t.keep ? '' : ' The original column is removed.'), code: L };
  };
  C.combine = function (t, x) {
    if (t.cols.length < 2 || !t.name) return null;
    return { title: 'Combine into ' + t.name, md: 'Joins ' + t.cols.join(', ') + ' into ' + t.name + ' with “' + t.sep + '” between them. A missing value is skipped.', code: x.helper('as_text').concat([
      'COMBINE = ' + pyList(t.cols), 'SEPARATOR = ' + py(t.sep), '', 'combined = pd.Series(pd.NA, index=df.index, dtype="string")', 'for c in COMBINE:', '    t = as_text(df[c]).str.strip().replace("", pd.NA)',
      '    combined = (combined + SEPARATOR + t).fillna(combined).fillna(t)   # skip a missing piece', 'df[' + py(t.name) + '] = combined']) };
  };
  C.unpivot = function (t, x) {
    if (!t.vals.length || !t.nameCol || !t.valueCol) return null;
    const ids = t.ids.length ? (x.rowCol && t.ids.indexOf(x.rowCol) < 0 && x.has(x.rowCol) ? [x.rowCol].concat(t.ids) : t.ids) : null;
    const mixed = new Set(t.vals.map(v => x.typeOf(v))).size !== 1;
    const L = ['VALUE_COLS = ' + pyList(t.vals), 'ID_COLS = ' + (ids ? pyList(ids) : '[c for c in df.columns if c not in VALUE_COLS]   # every other column'), '', 'before = len(df)',
      'df = (df.reset_index(names="_row")', '        .melt(id_vars=["_row"] + ID_COLS, value_vars=VALUE_COLS, var_name=' + py(t.nameCol) + ', value_name=' + py(t.valueCol) + ')',
      '        .sort_values("_row", kind="stable")   # each original row\'s values together, in column order', '        .drop(columns="_row")', '        .reset_index(drop=True))'];
    if (mixed) L.push('df[' + py(t.valueCol) + '] = df[' + py(t.valueCol) + '].astype("string")   # the columns had different types');
    if (t.dropEmpty) L.push('df = df[df[' + py(t.valueCol) + '].notna()].reset_index(drop=True)');
    L.push('print(f"Columns to rows: {before:,} row(s) became {len(df):,}")');
    return { title: 'Columns to rows', md: 'Turns ' + t.vals.join(', ') + ' into rows: the header goes in ' + t.nameCol + ' and the value in ' + t.valueCol + '.' + (t.dropEmpty ? ' Rows with no value are left out.' : ''), code: L };
  };
  C.bands = function (t) {
    const e = K.bandEdges(t); if (!t.col || !e.length || e.some(isNaN)) return null;
    const name = nameOr(t, t.col + '_band');
    return { title: 'Bands of ' + t.col, md: K.bandLabels(t).join(', ') + '. Each band includes its lower edge. A missing number gives a missing band.', code: [
      'EDGES = [' + e.join(', ') + ']', 'BANDS = ' + pyList(K.bandLabels(t)), 'numbers = pd.to_numeric(df[' + py(t.col) + '], errors="coerce").astype("Float64").to_numpy(dtype="float64", na_value=float("nan"))',
      'df[' + py(name) + '] = pd.Series(pd.cut(numbers, bins=[float("-inf")] + EDGES + [float("inf")], labels=BANDS, right=False), index=df.index).astype("string")',
      'print(df[' + py(name) + '].value_counts(dropna=False).to_string())'] };
  };
  C.dates = function (t) {
    if (!t.col) return null;
    const P = { year: 'd.dt.year.astype("Int64")', quarter: 'd.dt.quarter.astype("Int64")', month: 'd.dt.month.astype("Int64")', month_name: 'd.dt.month_name().astype("string")', week: 'd.dt.isocalendar().week.astype("Int64")', weekday: 'd.dt.day_name().astype("string")', day: 'd.dt.day.astype("Int64")' };
    const L = ['d = df[' + py(t.col) + '] if pd.api.types.is_datetime64_any_dtype(df[' + py(t.col) + ']) else pd.to_datetime(df[' + py(t.col) + '].astype("string").str.strip(), errors="coerce", **({"format": "mixed"} if int(pd.__version__.split(".")[0]) >= 2 else {}))   # any mix of formats'];
    t.parts.forEach(p => L.push('df[' + py(t.col + '_' + p) + '] = ' + P[p]));
    if (t.until) L.push('df[' + py(daysName(t)) + '] = ((' + (t.until === 'today' ? 'pd.Timestamp.today().normalize()' : '(df[' + py(t.until) + '] if pd.api.types.is_datetime64_any_dtype(df[' + py(t.until) + ']) else pd.to_datetime(df[' + py(t.until) + '].astype("string").str.strip(), errors="coerce", **({"format": "mixed"} if int(pd.__version__.split(".")[0]) >= 2 else {}))).dt.normalize()') + ' - d.dt.normalize()).dt.days).astype("Int64")   # whole days; negative = before ' + t.col);
    return { title: 'Date parts of ' + t.col, md: 'New columns from ' + t.col + '. A missing date gives missing parts.' + (t.until === 'today' ? ' Days to today change each day the script runs.' : ''), code: L };
  };
  C.rank = function (t) {
    if (!t.by) return null;
    const name = nameOr(t, 'rank'), how = 'rank(method=' + py(t.ties) + ', ascending=' + (t.order === 'asc' ? 'True' : 'False') + ')';
    return { title: 'Rank by ' + t.by, md: '1 = the ' + (t.order === 'asc' ? 'lowest' : 'highest') + ' ' + t.by + (t.group.length ? ' within each ' + t.group.join(' and ') : '') + '. A missing ' + t.by + ' gets no rank.', code: [
      'df[' + py(name) + '] = ' + (t.group.length ? 'df.groupby(' + pyList(t.group) + ', dropna=False)[' + py(t.by) + '].' + how : 'df[' + py(t.by) + '].' + how) + '.astype("Int64")'] };
  };
  C.running = function (t) {
    if (!t.col) return null;
    const name = runName(t), L = [t.order ? 'ordered = df.sort_values(' + py(t.order) + ', kind="stable", na_position="first")' : 'ordered = df'];
    L.push(t.calc === 'prev' ? 'values = ordered[' + py(t.col) + ']' : 'values = pd.to_numeric(ordered[' + py(t.col) + '], errors="coerce").astype("Float64")');
    const g = t.group.length ? 'values.groupby([' + t.group.map(c => 'ordered[' + py(c) + ']').join(', ') + '], dropna=False)' : 'values';
    if (t.calc === 'cumsum') L.push('result = ' + g + '.cumsum()   # a missing value adds nothing');
    else L.push('previous = ' + g + '.shift(1)', t.calc === 'prev' ? 'result = previous' : t.calc === 'change' ? 'result = values - previous' : 'result = ((values - previous) / previous.where(previous != 0)).round(4)   # 0.25 = up 25%');
    L.push('df[' + py(name) + '] = result.reindex(df.index)');
    return { title: (RUN_CALCS.find(c => c[0] === t.calc) || RUN_CALCS[0])[1] + ' of ' + t.col, md: 'Rows are taken in the order of ' + (t.order || 'the file') + (t.group.length ? ', starting again for each ' + t.group.join(' and ') : '') + '. The rows stay in file order.' + (t.calc === 'cumsum' ? '' : ' The first row has no previous value.'), code: L };
  };
  C.dupflag = function (t, x) {
    if (!t.cols.length) return null;
    const n = dupName(t);
    return { title: 'Flag possible duplicates', md: 'Rows with the same ' + t.cols.join(' + ') + ' (ignoring capitals and extra spaces) get the same ' + n + '_group, and ' + n + '_rows lists their row numbers. A row with any of these missing isn’t matched. Nothing is removed.', code: x.helper('match_key').concat([
      'DUP_COLS = ' + pyList(t.cols), 'key = match_key(df, DUP_COLS)', 'hit = key.map(key.value_counts()).gt(1).fillna(False).astype(bool)', 'group_no = {k: i + 1 for i, k in enumerate(pd.unique(key[hit]))}',
      'df[' + py(n + '_group') + '] = key.where(hit).map(group_no).astype("Int64")', 'rows = df.loc[hit, ROW_COL].groupby(key[hit]).agg(lambda s: "; ".join(str(v) for v in s))',
      'df[' + py(n + '_rows') + '] = key.where(hit).map(rows).astype("string")', 'if hit.any():', '    note("possible duplicates on " + " + ".join(DUP_COLS), hit.sum(), f"in {len(group_no):,} group(s), see ' + n + '_group")', 'else:', '    print("No possible duplicates on " + " + ".join(DUP_COLS))']) };
  };
  C.conflicts = function (t, x) {
    if (!t.group || !t.cols.length) return null;
    x.state.cfOn = true;
    return { title: 'Values that differ within a ' + t.group, md: 'Rows with the same ' + t.group + ' should agree on ' + t.cols.join(', ') + '. For each column that has more than one value in a group, every row of the group gets the rows involved (<column>_conflict_rows) and the distinct values (<column>_conflict_values), and conflict_columns lists the columns that differ. ' + (t.missing ? 'A missing value counts as a different value.' : 'Missing values are ignored.') + ' The full list is written to a Conflicts ' + (x.xl ? 'sheet.' : 'file.'),
      code: x.helper('as_text').concat(['CONFLICT_GROUP = ' + py(t.group) + '   # rows with the same value here are one person or thing', 'CONFLICT_COLUMNS = ' + pyList(t.cols), 'COUNT_MISSING = ' + (t.missing ? 'True' : 'False') + '   # True: a missing value counts as a different value', 'SEP = "; "', '',
        'conflict_list = []', 'in_group = df[df[CONFLICT_GROUP].notna()]', 'differs = pd.Series("", index=df.index, dtype="object")', 'for c in CONFLICT_COLUMNS:',
        '    t = pd.DataFrame({"group": in_group[CONFLICT_GROUP], "value": as_text(in_group[c]), "row": in_group[ROW_COL]})', '    t["value"] = t["value"].fillna("(missing)") if COUNT_MISSING else t["value"]',
        '    t = t.dropna(subset=["value"]).sort_values("row")', '    agg = t.groupby("group").agg(n=("value", "nunique"), rows=("row", lambda s: SEP.join(str(x) for x in s)), values=("value", lambda s: SEP.join(dict.fromkeys(s))))',
        '    agg = agg[agg["n"] > 1]', '    df[f"{c}_conflict_rows"] = df[CONFLICT_GROUP].map(agg["rows"]).astype("string")', '    df[f"{c}_conflict_values"] = df[CONFLICT_GROUP].map(agg["values"]).astype("string")',
        '    hit = df[CONFLICT_GROUP].isin(agg.index) & df[CONFLICT_GROUP].notna()', '    differs[hit] = differs[hit] + c + SEP', '    if len(agg):', '        note(f"{c} differs within {CONFLICT_GROUP}", hit.sum(), f"in {len(agg):,} group(s)")',
        '        conflict_list.append(agg.reset_index().assign(column=c)[["group", "column", "rows", "values"]])', 'df["conflict_columns"] = differs.str.rstrip(SEP).replace("", pd.NA).astype("string")',
        'conflicts = pd.concat(conflict_list, ignore_index=True) if conflict_list else pd.DataFrame(columns=["group", "column", "rows", "values"])', 'conflicts = conflicts.rename(columns={"group": CONFLICT_GROUP})',
        'print(f"{len(conflicts):,} value(s) differ within a " + CONFLICT_GROUP + "; " + f"{int(df[\'conflict_columns\'].notna().sum()):,} row(s) affected")']) };
  };
  K.TASK_CODE = C;

  /* the sections every task writes, in order; state collects what the write step needs (filtered-out rows, conflicts) */
  K.taskSections = function (cfg0, ai, x) {
    const fl = K.taskFlow(cfg0, ai), cfg = fl.cfg, done = new Set(), out = [];
    x.state = x.state || {};
    fl.steps.forEach(s => {
      const names = s.before.map(c => c.name);
      const ctx = Object.assign({}, x, { cfg, rowCol: fl.rowCol, has: n => names.indexOf(n) >= 0, typeOf: n => (s.before.find(c => c.name === n) || {}).type || '',
        helper: h => (done.has(h) ? [] : (done.add(h), HELPERS[h].slice())) });
      const sec = C[s.t.kind](s.t, ctx);
      if (sec) out.push(sec);
    });
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);

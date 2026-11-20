/* Example for the Python Script Generator: generic customers-and-sales data only. */
(function (root) {
  const SAMPLE = ['Order ID,Customer Name,Order Date,Status,Amount,Sales Region,Postal Code,Is Gift',
    '1001,Avery Stone,2026-01-05,Shipped,"1,250.00",East,02134,no', '1002,Jordan Lee,2026-01-05,open,89.50,West,94105,yes',
    '1003,Riley Chen,2026-01-06,Cancelled,430.00,East,10001,no', '1004,Morgan Diaz,2026-01-07,Shipped,15.75,South,73301,no'].join('\n');
  root.PSG_EX = function (K) {
    const c = K.blank();
    c.input.path = 'orders.csv';
    c.cols = K.mapCols(K.parseSample(SAMPLE), []);
    c.cols.forEach(x => { if (x.name === 'order_id') { x.key = true; x.req = true; } if (x.name === 'order_date' || x.name === 'amount') x.req = true; });
    c.filters = [{ when: 'status != "TEST"', label: '', join: 'and' }];
    c.tasks = [Object.assign(K.taskBlank('filter'), { open: false }), Object.assign(K.taskBlank('dedupe'), { order: 'order_date', open: false })];
    c.rules = [{ kind: 'min', col: 'amount', val: '0' }, { kind: 'inlist', col: 'status', val: 'OPEN, SHIPPED, CANCELLED' }];
    c.bad = 'split';
    c.summary = { on: true, group: ['sales_region'], metrics: [{ name: 'orders', agg: 'size', col: '' }, { name: 'total_amount', agg: 'sum', col: 'amount' }] };
    c.output = { kind: 'excel', path: 'orders_clean.xlsx' };
    c.aiReq = 'Make status upper case. Add a column order_size: Small when the amount is under 100, Medium under 1000, otherwise Large.';
    c.aiReply = ['```', '@@@ COLUMN @@@', 'NAME: status', 'EXPR: df["status"].str.upper()', '@@@ COLUMN @@@', 'NAME: order_size', 'EXPR: pd.cut(df["amount"], bins=[-np.inf, 100, 1000, np.inf], labels=["Small", "Medium", "Large"], right=False).astype("string")', '@@@ NOTES @@@', 'A missing amount gives a missing order_size.', '```'].join('\n');
    return c;
  };
  root.PSG_EX_SAMPLE = SAMPLE;
  if (typeof module !== 'undefined') module.exports = root.PSG_EX;
})(typeof window !== 'undefined' ? window : globalThis);

/* Example for the Python Notebook Generator: generic customers-and-sales data only. */
(function (root) {
  const BRONZE = ['=== SCHEMA ===', 'root', ' |-- OrderID: integer (nullable = true)', ' |-- CustomerID: integer (nullable = true)', ' |-- OrderDate: timestamp (nullable = true)', ' |-- Status: string (nullable = true)',
    ' |-- Amount: decimal(18,2) (nullable = true)', ' |-- SalesRegion: string (nullable = true)', ' |-- IsDeleted: boolean (nullable = true)', ' |-- ModifiedDate: timestamp (nullable = true)',
    ' |-- _source_file: string (nullable = true)', ' |-- _ingest_ts: timestamp (nullable = true)', ' |-- _batch_id: string (nullable = true)', '', '=== ROW COUNT === 61250'].join('\n');
  root.PYG_EX = function (P) {
    const c = P.blank();
    c.layer = 'silver'; c.entity = 'orders'; c.subject = 'sales';
    c.bronze.path = 'abfss://datalake@<account>.dfs.core.windows.net/raw/salesdb/orders/';
    const s = c.silver; s.schemaText = BRONZE; s.cols = P.mapCols(P.parseSchema(BRONZE), []);
    s.cols.forEach(x => { if (x.name === 'order_id') { x.key = true; x.notnull = true; x.type = 'bigint'; } if (x.name === 'customer_id') { x.type = 'bigint'; x.notnull = true; } if (x.name === 'order_date') { x.type = 'date'; x.notnull = true; } if (x.name === 'status') x.clean = 'trim_upper'; if (x.name === 'modified_date') { x.name = 'modified_ts'; x.clean = 'utc'; } });
    s.orderCol = 'modified_ts'; s.softDelete = 'is_deleted'; s.cluster = 'order_date';
    s.rules = [{ kind: 'min', col: 'amount', val: '0', name: '' }, { kind: 'inlist', col: 'status', val: 'OPEN, SHIPPED, CANCELLED', name: '' }];
    s.aiReq = 'Add a column order_size: Small when the amount is under 100, Medium under 1000, otherwise Large.';
    s.aiReply = ['```', '@@@ COLUMN @@@', 'NAME: order_size', 'TYPE: string', 'EXPR: F.when(F.col("amount") < 100, "Small").when(F.col("amount") < 1000, "Medium").otherwise("Large")', '@@@ NOTES @@@', 'A null amount gives Large; the amount rule sends negative amounts to quarantine first.', '```'].join('\n');
    const g = c.gold; g.name = 'fact_daily_sales';
    g.cols = [['order_id', 'bigint'], ['customer_id', 'bigint'], ['order_date', 'date'], ['status', 'string'], ['amount', 'decimal(18,2)'], ['sales_region', 'string'], ['is_deleted', 'boolean'], ['modified_ts', 'timestamp'], ['order_size', 'string']].map(a => ({ name: a[0], type: a[1] }));
    g.grain = ['order_date', 'sales_region']; g.mode = 'dates'; g.rebuildCol = 'order_date'; g.softDelete = 'is_deleted';
    g.metrics = [{ name: 'order_count', agg: 'countDistinct', col: 'order_id', filter: '' }, { name: 'gross_sales_amount', agg: 'sum', col: 'amount', filter: '' }, { name: 'cancelled_amount', agg: 'sum', col: 'amount', filter: "status = 'CANCELLED'" }];
    g.derived = [{ name: 'net_sales_amount', expr: 'gross_sales_amount - cancelled_amount' }];
    return c;
  };
  if (typeof module !== 'undefined') module.exports = root.PYG_EX;
})(typeof window !== 'undefined' ? window : globalThis);

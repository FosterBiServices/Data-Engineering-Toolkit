/* Example for the ADF Pipeline Generator: generic customers-and-sales data only. */
(function (root) {
  const SCHEMA = ['TABLE_SCHEMA\tTABLE_NAME\tCOLUMN_NAME\tDATA_TYPE\tMAX_LEN\tPREC\tSCALE\tIS_NULLABLE\tKEY_FLAG',
    'dbo\tOrders\tOrderID\tint\tNULL\t10\t0\tNO\tPK', 'dbo\tOrders\tCustomerID\tint\tNULL\t10\t0\tNO\t', 'dbo\tOrders\tOrderDate\tdatetime2\tNULL\t7\tNULL\tNO\t',
    'dbo\tOrders\tStatus\tvarchar\t20\tNULL\tNULL\tNO\t', 'dbo\tOrders\tAmount\tdecimal\tNULL\t18\t2\tNO\t', 'dbo\tOrders\tSalesRegion\tnvarchar\t50\tNULL\tNULL\tYES\t',
    'dbo\tOrders\tIsDeleted\tbit\tNULL\t1\t0\tNO\t', 'dbo\tOrders\tModifiedDate\tdatetime2\tNULL\t7\tNULL\tNO\t'].join('\n');
  root.ADF_EX = function (blank) {
    const c = blank();
    c.domain = 'sales'; c.goal = 'Load new and changed orders nightly so the sales dashboard shows yesterday’s orders by 6 AM.';
    Object.assign(c.src, { kind: 'sql', system: 'sqlserver', ls: 'ls_sqlserver_salesdb_prod', ir: 'shir-onprem-01', onprem: true, schema: 'dbo', table: 'Orders', container: 'landing', folder: 'sales/orders' });
    c.schemaText = SCHEMA;
    Object.assign(c.tgt, { kind: 'sql', system: 'azuresql', ls: 'ls_azuresql_dw_prod', schema: 'dw', table: 'fact_orders', write: 'merge', container: 'datalake', storage: '' });
    Object.assign(c.load, { type: 'incremental', wmCol: 'ModifiedDate', wmType: 'datetime', keys: ['OrderID'], overlap: 120 });
    c.filter = 'CustomerID <> 999999';
    c.alert = 'web'; c.src.after = 'archive'; c.sched.freq = 'daily';
    c.ai.request = 'Convert OrderDate from US Eastern time to UTC.';
    c.ai.reply = ['```', '@@@ COLUMN @@@', 'NAME: OrderDate', 'TYPE: datetime2(7)', "EXPR: CAST([OrderDate] AT TIME ZONE 'Eastern Standard Time' AT TIME ZONE 'UTC' AS datetime2(7))", '@@@ NOTES @@@', 'OrderDate is assumed to be stored in US Eastern local time, with no offset.', '```'].join('\n');
    return c;
  };
  /* a small pipeline with the usual mistakes, for Check a pipeline */
  root.ADF_EX_CHECK = JSON.stringify({ name: 'customer_load', properties: { activities: [
    { name: 'lkp_old_watermark', type: 'Lookup', dependsOn: [], policy: { timeout: '7.00:00:00', retry: 0 }, typeProperties: { source: { type: 'AzureSqlSource', sqlReaderQuery: "SELECT watermark_value FROM etl.watermark WHERE table_name = 'dbo.Customer'" }, dataset: { referenceName: 'ds_azuresql_dw_table', type: 'DatasetReference' } } },
    { name: 'sp_update_watermark', type: 'SqlServerStoredProcedure', dependsOn: [{ activity: 'lkp_old_watermark', dependencyConditions: ['Succeeded'] }], typeProperties: { storedProcedureName: '[etl].[usp_update_watermark]', storedProcedureParameters: { table_name: { value: 'dbo.Customer', type: 'String' }, watermark_value: { value: { value: '@utcnow()', type: 'Expression' }, type: 'String' } } }, linkedServiceName: { referenceName: 'ls_azuresql_dw_prod', type: 'LinkedServiceReference' } },
    { name: 'Copy customers', type: 'Copy', dependsOn: [{ activity: 'lkp_old_watermark', dependencyConditions: ['Succeeded'] }], policy: { timeout: '7.00:00:00', retry: 0 }, typeProperties: { source: { type: 'SqlServerSource', sqlReaderQuery: { value: "SELECT * FROM dbo.Customer WHERE ModifiedDate > '@{activity('lkp_watermark').output.firstRow.watermark_value}' AND Region = '@{pipeline().parameters.p_region}'", type: 'Expression' } }, sink: { type: 'AzureSqlSink' } }, inputs: [{ referenceName: 'ds_sqlserver_salesdb_table', type: 'DatasetReference' }], outputs: [{ referenceName: 'ds_azuresql_dw_table', type: 'DatasetReference' }] }
  ], annotations: [] } }, null, 2);
  root.ADF_EX_SCHEMA = SCHEMA;
  if (typeof module !== 'undefined') module.exports = root.ADF_EX;
})(typeof window !== 'undefined' ? window : globalThis);

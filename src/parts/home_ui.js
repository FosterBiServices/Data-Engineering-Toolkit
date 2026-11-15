/* Home page: the tool cards and Clear all pages. */
(function () {
  const S = window.DE_SUITE;
  const TOOLS = [
    { file: 'adf-pipeline-generator.html', name: 'ADF Pipeline Generator', text: 'Describe a load and get the pipeline JSON, datasets, supporting SQL, trigger and build steps: full, watermark incremental, merge, SCD Type 2 or file landing. Or paste any pipeline’s JSON to get it checked, or to change it and review every change.', tags: [['No AI needed', ''], ['Copilot optional', 'ai']] },
    { file: 'python-notebook-generator.html', name: 'Python Notebook Generator', text: 'For Databricks: bronze, silver and gold PySpark notebooks, from your columns, key, quality rules and metrics, with the ADF activity settings and SQL checks to run afterwards.', tags: [['No AI needed', ''], ['Copilot optional', 'ai']] }
    , { file: 'python-script-generator.html', name: 'Python Script Generator', text: 'A pandas script for one file: read CSV, Excel or Parquet, rename and type the columns, filter, remove duplicates, look up from a second file, check the values, summarize and write the result. As a Jupyter notebook or a .py script that runs on your own computer.', tags: [['No AI needed', ''], ['Copilot optional', 'ai']] }
  ];
  S.$('tools').innerHTML = TOOLS.map(t => '<a class="card" href="' + t.file + '"><h3>' + S.esc(t.name) + '</h3><p>' + S.esc(t.text) + '</p><span class="tags">' + t.tags.map(g => '<span class="tag ' + g[1] + '">' + S.esc(g[0]) + '</span>').join('') + '</span></a>').join('');
  let armed = false;
  S.$('clearAllHome').addEventListener('click', e => {
    if (!armed) { armed = true; e.target.textContent = 'Select again to clear every tool'; return; }
    S.clearAll(); armed = false; e.target.textContent = 'Clear all pages'; S.$('homeMsg').innerHTML = S.msg('ok', 'Every tool was cleared.');
  });
})();

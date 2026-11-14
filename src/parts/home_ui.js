/* Home page: the tool cards and Clear all pages. */
(function () {
  const S = window.DE_SUITE;
  const TOOLS = [
    { file: 'adf-pipeline-generator.html', name: 'ADF Pipeline Generator', text: 'Describe a load and get the pipeline JSON, datasets, supporting SQL, trigger and build steps: full, watermark incremental, merge, SCD Type 2 or file landing. Or paste any pipeline’s JSON and get it checked.', tags: [['No AI needed', ''], ['Copilot optional', 'ai']] },
    { file: 'python-notebook-generator.html', name: 'Python Notebook Generator', text: 'Bronze, silver and gold PySpark notebooks for Databricks, from your columns, key, quality rules and metrics, with the ADF activity settings and SQL checks to run afterwards.', tags: [['No AI needed', ''], ['Copilot optional', 'ai']] }
  ];
  S.$('tools').innerHTML = TOOLS.map(t => '<a class="card" href="' + t.file + '"><h3>' + S.esc(t.name) + '</h3><p>' + S.esc(t.text) + '</p><span class="tags">' + t.tags.map(g => '<span class="tag ' + g[1] + '">' + S.esc(g[0]) + '</span>').join('') + '</span></a>').join('');
  let armed = false;
  S.$('clearAllHome').addEventListener('click', e => {
    if (!armed) { armed = true; e.target.textContent = 'Select again to clear both tools'; return; }
    S.clearAll(); armed = false; e.target.textContent = 'Clear all pages'; S.$('homeMsg').innerHTML = S.msg('ok', 'Both tools were cleared.');
  });
})();

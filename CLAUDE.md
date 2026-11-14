# Foster BI Data Engineering Toolkit

Single-file HTML tools for data engineers, sister site to the Foster BI Toolkit (Power-BI-Toolkit repo) and built the
same way. Once published, **never rename, move or delete a published page** (`index.html` or a tool `.html` at the root).

The owner works where Microsoft Copilot is the only AI allowed. Nothing calls an AI API. Here the pages write the exact
output themselves (the owner's choice: "page builds, Copilot optional"); Copilot only writes expressions for logic
described in plain words, and the page checks its reply before using it.

## Standing rules (same as the Power BI toolkit)

- Examples use generic customer and sales data (Orders, Customer, sales). Never real client names or data.
- Each page loads with example data. The first entry of the user's own in a main box (`data-own`) replaces the whole
  example (`S.ownEntry`), so no example content reaches a Copilot prompt.
- Copilot prompts use the sections TASK, CONTEXT, STARTING POINT, RULES, REPLY FORMAT (marked as a template).
  `S.fullPrompt` appends READ_RULE, ONE_REPLY and `=== END OF PROMPT ===`. Replies are labelled `@@@ NAME @@@` blocks
  inside one code block (`S.parseBlocks`, `S.fields`); parsers skip a block that only repeats the template.
- Clear entries in the banner with an inline confirm, plus Clear all pages. It removes the page's `localStorage` prefix
  and sets `<prefix>blank` so a reload stays empty.
- Branding: Foster BI Services, navy `#0A2D5A`, gold `#F2A900`, IBM Plex. `src/parts/base.css` is the Power BI toolkit's
  stylesheet as it stood in Nov 2026; site-only additions go in `extra.css`.
- No scripts from other servers. Plain, short UI text. No horizontal scroll at 390px.
- The disclaimer on the home page stays.

## Build

```
src/parts/   base.css, extra.css, suite.js (shared), home_*, adf_*, py_* and ps_* (body.html, core.js, ex.js, ui.js)
src/brand/   logo files
src/build.py builds every page into the repo root:  python src/build.py   (Python 3, no packages)
src/tests/   node run.js  (needs Playwright and Chrome); adfcoretest, pycoretest and pscoretest need only Node and
             Python (pscoretest also runs the scripts when pandas, openpyxl and pyarrow are installed)
```

`*_core.js` has no DOM: all generation and checking lives there, so Node can test it. `*_ui.js` is wiring only.

| Page | Prefix | Copilot |
|---|---|---|
| adf-pipeline-generator | `dea.` | optional |
| python-notebook-generator | `dep.` | optional |
| python-script-generator | `des.` | optional |

Adding a tool: parts in `src/parts/`, an entry in `PAGES` in build.py, `S.TOOLS` and `S.NEXT` in suite.js, a card in
home_ui.js, a row in README.md, checks in `src/tests/` (run it through storagetest.js too).

## ADF Pipeline Generator (`adf_core.js`)

- `A.build(cfg, std, ai, today)` composes one pipeline from the brief: watermark lookups (incremental) > Copy > merge or
  SCD2 procedure (staged) > notebooks > watermark update > log success; failure path = `sp_log_failure` depending on the
  last main activity with Failed + Skipped, then the alert (optional), then a Fail activity so Monitor shows Failed.
- Watermarks are stored as text (ISO date-time or a number) in `<ctl>.watermark`; the new value is read before the copy
  and the copy is bounded above by it. `p_full_reload` restarts from the floor; `p_overlap_minutes` only with a staged
  merge. Literal `@` in SQL inside an expression is doubled (`lit`).
- File landing: Get Metadata > Filter > ForEach (raw, archive, delete; quarantine on failure) > notebooks inside an If
  when files landed > log > If any quarantined then Fail. Raw folder per run: `<raw path>/<RunId>/`.
- Datasets are one parameterized dataset per system (`schema_name`, `table_name`; or `container`, `folder_path`, `file_name`).
- `A.check(pipeline, std)` is the checker, used on pasted JSON and on the page's own output (adfcoretest expects no
  findings for every pattern). `A.flatten` settles the shapes of pasted JSON first.
- Team standards (`dea.std`) can be downloaded and loaded as a file so a team shares one set.

## Python Notebook Generator (`py_core.js`)

- Layer rules come from the Databricks Medallion Copilot Kit: bronze adds only `_source_file`, `_ingest_ts`, `_batch_id`
  and is idempotent per batch (replaceWhere); silver has an explicit select, dedupe, DQ rules into `_dq_failures` with a
  quarantine table, then MERGE on the key where newer wins; gold reads silver only, rebuilds the dates a batch touched
  (replaceWhere) or the whole table, and reconciles row counts (`_silver_rows`) and an unfiltered Sum to silver.
- Every notebook ends with `dbutils.notebook.exit(json.dumps({status, batch_id, rows_read, rows_written, rows_quarantined, ...}))`.
- pycoretest.js generates notebooks for many setups and checks each parses as Python.

## Python Script Generator (`ps_core.js`)

Added Nov 2026 when the owner asked for plain Python outside Databricks ("jupyter notebook or some other tool"). One
pandas script per file, modelled on the owner's own snippet notebooks (read, clean headers, dedupe, validate, write).

- `K.build(cfg, ai)` returns sections (title, markdown, code) and renders them twice: `.py` with `# %%` cells and
  `.ipynb` (nbformat 4.4). Same code in both.
- Order in the script: settings > read (everything as text; only empty is missing) > trim > types (`CONVERT`, failures
  noted, never guessed) > Copilot columns > lookup from a second file > filter > dedupe > checks > summary > write.
- The lookup matches keys as trimmed text and stops on repeated lookup keys, so the row count can't grow.
- Rows that fail a check: report (kept, also listed), split (moved to a rejected file or sheet) or stop.
- The pasted sample rows are never saved (only column names and types are); `st.example` refills the example sample.
- Copilot blocks: COLUMN (NAME, EXPR) and one FILTER (KEEP_WHEN), vetted by `K.vetExpr` (only df/pd/np, known columns,
  no lambda, imports or file access).
- pscoretest.js writes sample files and **runs** each generated script with pandas (3.0 here), then reads the output
  back. Found that way: regex patterns passed to `.str.replace` must hold the real characters, not `\u` escapes
  (pandas' Arrow-backed strings reject them).
- Not checked: pandas 1.x / 2.x, opening the `.ipynb` in Jupyter itself, real Copilot replies.

## Not yet run in a real factory or workspace

- The pipeline JSON pasted into ADF Studio's code view and validated, for each pattern.
- `activity('name').error?.message` across skipped activities in `sp_log_failure`.
- The Fail activity after the handler making the run show Failed; the Web alert body reaching a Teams workflow or Logic App.
- `p_full_reload` reaching the Lookup query as the text True/False.
- The supporting SQL on Azure SQL, SQL Server and a Synapse dedicated pool (MERGE with a derived-table source; SCD2 only
  reviewed for Azure SQL / SQL Server).
- The three notebooks on a Databricks cluster (they parse as Python; they have not been executed), `CLUSTER BY` on the
  runtime in use, and reading exit values through `output.runOutput`.
- Copilot prompts and replies with real Copilot.

## Backlog

Metadata-driven ingestion (control table + ForEach), hard deletes by key comparison, loading files into SQL, SCD2 in
silver, a generated test notebook, a spec/brief export for design review, Fabric Data Factory. Python Script Generator:
several input files (folder of files appended), SQL and API sources, pivot/unpivot, compare two files (Sheet Recon in the
Power BI toolkit already does this in the browser).

# Foster BI Data Engineering Toolkit

Single-file HTML tools for data engineers, sister site to the Foster BI Toolkit (Power-BI-Toolkit repo) and built the
same way. Once published, **never rename, move or delete a published page** (`index.html` or a tool `.html` at the root).

The owner works where Microsoft Copilot is the only AI allowed. Nothing calls an AI API. Here the pages write the exact
output themselves (the owner's choice: "page builds, Copilot optional"); Copilot only writes expressions for logic
described in plain words, and the page checks its reply before using it.

## Standing rules (same as the Power BI toolkit)

- **Nothing that ties back to the owner's company** (owner, Nov 2026): no client, project, pipeline, dataset, notebook,
  linked service, container or folder names from his work in pages, placeholders, examples, tests or these notes. Use
  generic placeholders (yourproject, yourcontainer, ls_yourstorage, sales). Tests that need his private samples read every
  specific value from files in the samples folder, never from the repo.

- Examples use generic customer and sales data (Orders, Customer, sales). Never real client names or data.
- Each page loads with example data. The first entry of the user's own in a main box (`data-own`) replaces the whole
  example (`S.ownEntry`), so no example content reaches a Copilot prompt.
- Copilot prompts use the sections TASK, CONTEXT, STARTING POINT, RULES, REPLY FORMAT (marked as a template).
  `S.fullPrompt` appends READ_RULE, ONE_REPLY and `=== END OF PROMPT ===`. Replies are labelled `@@@ NAME @@@` blocks
  inside one code block (`S.parseBlocks`, `S.fields`); parsers skip a block that only repeats the template.
- Clear entries in the banner with an inline confirm, plus Clear all pages. It removes the page's `localStorage` prefix
  (except `<prefix>jobs`, the saved work) and sets `<prefix>blank` so a reload stays empty.
- Saved work (review, Nov 2026: a second pipeline overwrote the first): `S.jobs` in suite.js puts a bar above Step 1 of each
  tool (ADF: in the Build pane): name + Save, New (empties `<prefix>cfg` only; standards, logging and saved work stay), a
  list to open one, Download (`<name>.<tool>.json` {tool, name, saved, cfg}), Open a file (refused from another tool),
  Delete. `<prefix>jobs` [{name, saved, cfg}], `<prefix>job` = the one on the page. Opening writes `<prefix>cfg` and reloads,
  so each page's own loader checks it. Unsaved changes (page cfg differs from the current job) ask first. Check: `jobstest.js`.
- Branding: Foster BI Services, navy `#0A2D5A`, gold `#F2A900`, IBM Plex. `src/parts/base.css` is the Power BI toolkit's
  stylesheet as it stood in Nov 2026; site-only additions go in `extra.css`.
- No scripts from other servers. Plain, short UI text. No horizontal scroll at 390px.
- The disclaimer on the home page stays.

## Build

```
src/parts/   base.css, extra.css, suite.js (shared), home_*, adf_* (adf_med.js: medallion; adf_change*.js: change a pipeline), py_* and ps_* (body.html, core.js, ex.js, ui.js)
src/brand/   logo files: the F waffle icon on tool pages and as favicon; the home page shows the owner's "foster BI services" white lockup PNG, as the Power BI toolkit does
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
- Files: Get Metadata > Filter > ForEach (copy; in archive mode also archive, delete, and quarantine on failure) >
  notebooks inside an If when files landed > log > (archive mode) If any quarantined then Fail. Destination folder:
  `src.dest` with {yyyy} {MM} {dd} {run}, else `<raw path>/<RunId>/`.
- Datasets are one parameterized dataset per system (`schema_name`, `table_name`; or `container`, `folder_path`, `file_name`).
- `A.check(pipeline, std)` is the checker, used on pasted JSON and on the page's own output (adfcoretest expects no
  findings for every pattern). `A.flatten` settles the shapes of pasted JSON first.
- Team standards (`dea.std`) can be downloaded and loaded as a file so a team shares one set.
- **The user's own setup comes first** (owner feedback after the first real try, Nov 2026: the page assumed its own
  datasets, a logging procedure and a trigger). Nothing about the factory is assumed:
  - Datasets: per role (source, target/destination) "Create one for me" or "Use one I already have". The user pastes the
    dataset's code-view JSON; `A.readDataset` reads name, type, linked service, store and parameters, and works out what
    each parameter is from `typeProperties` (`@dataset().x` in fileSystem/folderPath/fileName/schema/table), then from its
    name. The mapping is editable (`cfg.ds[role].map`), including fixed text. `role()` in `A.build` returns `ref(values)`
    for either kind, and source/sink/store types follow the dataset's type (Binary, DelimitedText, Parquet...).
  - Logging (`std.log`, saved with team standards): the page's procedure (`sp_new`), the user's procedure (`sp_own`),
    the user's Databricks notebook (`notebook`) or none. Own methods take a list of parameter name -> value
    (`A.LOG_VALUES`). The owner logs with a notebook.
  - Alert, schedule and file handling default to the least: no alert, no trigger, plain copy that leaves the originals
    (`src.after`: leave / delete / archive). With no logging and no alert there is no failure path at all.
  - No supporting SQL is written unless something needs it.
- Checker: every finding can carry `fix` (exact ADF Studio steps, naming the activity). "How is this pipeline run?"
  (`st.runBy`) makes the failure-path findings low and optional for a pipeline run by hand; "Checks to run" turns rule
  groups off (`std.off`). `A.fixPrompt` writes a Copilot prompt with the findings and the JSON that asks for the whole
  corrected pipeline, which is pasted back into the same box and checked again.

- **Files through bronze, silver and gold** (`adf_med.js`, `src.kind: 'medallion'`, the default and the example). Built in
  Nov 2026 from three of the owner's real pipelines and datasets (a folder-only CSV dataset, a folder-only Parquet dataset
  and a Parquet file dataset): his main process, kept general.
  - Every folder and file name is a pattern the user types, with `{object} {file} {name} {yyyy} {MM} {dd} {HH}
    {yesterday} {run} {pipeline}` (`A.compilePattern` -> `concat(...)`); a live preview (`A.medPreview`) shows where an
    example file goes. With "Keep paths in pipeline variables" the fixed start of each pattern becomes a variable.
    (Owner: "the naming is too strict... I struggled providing the correct structure to pull data from my bronze".)
  - Object name from the file name (strip extension, `-` to `_`). Optional object list: a notebook returns rows through
    `dbutils.notebook.exit`; per item Set Variable + Filter (item() inside a Filter is the list row, hence the variable,
    hence sequential loops), unknown object fails clearly or loads with an empty id. Ids are read with `coalesce(first(...)?.id, '')`.
  - Bronze: ADF Copy (optionally archive the existing bronze file first: Get Metadata `exists` on the SAME dataset
    values the copy writes, If, Copy to archive) or a notebook per file. Then any number of layers, each a notebook run
    once per object folder (Get Metadata + Filter Folder + ForEach), once per file, or once.
  - Four dataset roles (`cfg.ds.list/read/sink/meta`), each the user's own or created. Logging per file and per layer
    run uses the shared logging setup (`std.log`), with values for object id/name, file, duration, layer, global
    parameter and ADF expression. `med.ls` is the storage linked service for created datasets; `nbLs` for notebooks.
- Folder-only datasets (owner, Nov 2026: his CSV dataset has just a folder parameter; the page refused it because it copied file
  by file): in "Copy or move files", a source dataset with no file name parameter copies the whole folder in ONE Copy
  activity (`wildcardFileName` from starts/ends, sink `copyBehavior: PreserveHierarchy`, a wildcard Delete after it for
  a move). Only archive-and-quarantine still needs a file name parameter. A folder parameter set to fixed text is
  reported as the folder used. Check: `adffoldertest.js`. Not yet run in ADF: wildcard with the folder from the dataset
  parameter and no `wildcardFolderPath`.
- Pipeline variables (owner: "my dataset has a parameter, however there is nowhere to set pipeline variables"): the
  user's own variables (`cfg.vars`: name, type String/Integer/Boolean/Array, plain default; `A.addUserVars`, checked by
  `A.varProblems`), in every pipeline type. Used as `{var:name}` in any folder or file pattern, or as the value
  "Pipeline variable" for a dataset parameter (`A.dsValue`, with Global parameter and ADF expression), a notebook
  parameter or a logging parameter. The user's definition wins over a page-made one of the same name; page-made
  variables nothing reads are dropped. Check: `adfvartest.js`.
- Checker rules from real pipelines: default values that start with @ (never evaluated), wildcards inside a ForEach
  that ignore item(), an existence check pointing at a different file than the copy writes, first item of a Filter with
  no empty-check, notebook parameter names differing only by case, notebooks in /Users folders, typed-in environment
  values. Naming/retry checks ("Standards") are off by default (`std.v = 2` migrates saved standards). "How is this
  pipeline run?" has "By another pipeline" for Execute Pipeline children. Default logging method is none.
- Logging values (owner, Nov 2026: "this list is too long... I need pipeline variable, output from previous step, fixed
  text", then "keep ADF expression"): `A.logChoices(kind)` is the short list; "Output of an earlier step" stores
  `activity|field` (or `activity|=path`) and `A.stepExpr` writes `coalesce(activity('a')?.output?.field, '')`. Outputs per
  type in `A.STEP_FIELDS`. Object values exist only in medallion loops; the error message only fills in the failure log.
- Choosing "My own Databricks notebook" fills the owner's usual rows (`A.notebookLogParams(kind)`, owner: "default the
  selections to my actual selections"): for bronze/silver/gold obj_id, obj_name, error_details ("no error" on success),
  status, number_rows (rows written by the step being logged), duration, layer, storage_name (global parameter
  StorageAccountName); other patterns keep the plain set. Only when the rows are still the untouched defaults; the
  notebook path stays empty. Check: `adflogdefaulttest.js`.
- Expression helper (owner: "assistance in writing the adf expression and what outputs are available from the previous
  step"): an `fx` button beside every "ADF expression" box (logging, dataset parameter, notebook parameter) opens a dialog:
  chips for each step's outputs (`A.exprContext` from the built pipeline), variables, run values and functions
  (`A.EXPR_FUNCS`), a live check (`A.checkExpr`: @, brackets, quotes, double quotes, unknown functions, step/variable/
  parameter names, a step inside a ForEach/If read from elsewhere), and an optional Copilot prompt (`A.exprPrompt`,
  reply `@@@ EXPRESSION @@@`, `A.exprParse`, refused when the check finds errors). "Use" writes back by dispatching an
  input event on the original box. Check: `adfexprtest.js` (no samples needed).
- Rebuild of the owner's first sample pipeline through the page (Nov 2026, owner: "recreate it, document what went well and
  what didn't, fix it"). Fixes from it: `med.container` (bronze, archive and layer folders in another container; pattern,
  `{var:}` allowed); dataset parameter rows say what they get (`fillsWith`); the preview shows containers, the real
  object folder name and each layer notebook's parameter values (folder loop: `{name}`/`{file}` = folder, `{object}` =
  folder with - to _); counts and durations from a step default to 0, not '' (`A.stepExpr`); the Error message log value
  takes optional text for success; checker rule: an archive copy inside an `exists` If must read what the main copy
  writes. `adfrebuildtest.js` drives the whole rebuild from a private recipe (`rebuild.json` beside the samples, never
  committed: every client-specific value lives there) and `adfcompare.py` (with `adfeval.py`, a small ADF expression
  evaluator) compares every dataset, notebook and log value with the original for one file: only the 4 known
  corrections may differ.
- Token bar (owner: "how does a user know to add {var:...} or {object}?"): focusing any medallion folder or file name box
  (`src.folder`, `med.container`, bronze/archive patterns, layer folder, a Text notebook parameter) shows `#tokBar` under
  it: the tokens that box allows for its scope (`A.medTokenHelp(cfg, scope)`: run / file / folder), the user's variables as
  `{var:name}`, each with its value for the example file, click-to-insert at the cursor, and "Becomes:" the resolved
  value. Check: `adftokentest.js`.
- Beginner walkthrough (Nov 2026, owner: "from a complete beginner's perspective... no variables or datasets supplied"):
  `{mm}` `{ss}` tokens, and all date tokens from `pipeline().TriggerTime` (one stamp per run, UTC; previews in UTC);
  `med.after` leave / move (`med.doneFolder`, Copy with a page-made Binary dataset on the landing storage) / delete
  (`del_landing_file`) so only new files load; log values `rows_written` / `duration` "of the step being logged" (each log
  point reads its own step, `coalesce(..., 0)`), because "Output of an earlier step" can't cross loops; obj_id without an
  object list is a warning (sent empty); an info that ADF can't write Parquet column names with spaces or `,;{}()=`
  (no fix in ADF; notebook bronze or rename at source); Build steps start with "BEFORE YOU START" (global parameters,
  notebooks, linked services the JSON uses). Gaps left: a database/ERP source for bronze, a generic bronze notebook.
- Essentials / All settings (review, Nov 2026: 97 fields on the first screen): `st.view`, default essentials. Elements with
  `data-adv` (object list, archive, run options, datasets, variables, logging) are hidden by `body.essentials`; values are
  kept and the pipeline is the same either way. `#advSummary` names the hidden settings that differ from `A.blank()` and
  has Show all settings, as does the "Fix the N items" message. Tests open in All settings (lib.js clicks it) unless
  `open(file, { essentials: true })`. Check: `adfviewtest.js`.
- Checker: a ForEach whose items are a Get Metadata childItems directly (folders reach the copy) is medium.
- `adfmedtest.js` sets up a medallion pipeline through the page with his sample datasets (`/home/claude/samples`,
  not in the repo) and expects no findings; it then runs the checker on his samples.

- **Change a pipeline** (third tab, `adf_change.js` core + `adf_change_ui.js` wiring, saved as `dea.chg`; owner, Nov 2026:
  "enter a pipeline that is working, then say they need to add something", not limited to one example). Paste the pipeline
  and, optionally, the datasets to change with it: one box per dataset the pipeline uses plus "Add another dataset"
  (`g.dsList` [{for, text}]; each box says Not pasted / Pasted / the wrong dataset; `A.readDatasets` reads them). Built-in changes,
  applied in order on copies (`A.applyChanges`; a change that fails leaves the pipeline as before it): find and replace,
  fixed value to parameter / variable / global parameter, parameters and variables (add, rename with every use, default,
  remove only when unused), rename an activity (dependsOn and activity('x')), notebook path and parameters, add a notebook
  step after an activity (optionally in between), swap a dataset, timeout and retries, turn off/on (`state: Inactive`),
  remove (dependents inherit its dependencies; refused while its output is read), schedule trigger. New values take
  `{param:x}` `{var:x}` `{global:x}` (`A.parseRepl`). `A.findValue` searches only values, never names: in a full expression
  only quoted text, in `@{}` text the text parts; each place has a tick box; notebook paths start unticked (`unsure`).
  Writing back: plain text -> text or `@{}` interpolation (`@` doubled); inside an expression a literal becomes
  `concat(...)`; a variable default that needs a reference becomes a Set Variable step at the start of the run
  (`set_<var>`, chained before every root); a pasted dataset with the value typed in gets a dataset parameter (old value as
  default) and every step using it passes the reference. Review (`A.reviewChange`): changes per activity
  (`A.pipelineDiff`, renames recognised), a folded line diff (`A.lineDiff`), references that point at nothing
  (`A.refProblems`), only NEW checker findings, and "Change these too" (`A.changeNotes`: changed datasets, unpasted
  datasets and notebooks that may have the old text typed in, new parameters, globals, trigger). Copilot for anything else
  (`A.changePrompt` from the pipeline after the built-in changes; reply `@@@ PIPELINE/DATASET/ALSO_CHANGE/NOTES @@@`,
  `A.changeParse`); removals Copilot made are flagged against the Step 2 result; a reply older than the Step 2 changes is
  flagged. Checks: `adfchangetest.js` evaluates every value before and after with `adfeval.py` (now with `@{}`,
  pipeline().parameters and dataset()), `adfchangepage.js`. Dark mode: use the colour variables, never #fff; `darktest.js` flags
  text with contrast under 3 on every tab in dark mode (owner, Nov 2026: a white card was unreadable on a dark-mode PC). The region example ran privately on the owner's rebuilt pipeline:
  0 broken references, no new findings, folders resolve with any region.
- Change a pipeline, notebooks (owner, Nov 2026: "if the notebook is going to change, the user knows what to change...
  perhaps they need to be able to paste them"; and the goal is the tool doing it, not hand edits): one box per notebook the
  pipeline runs (paste, or open the .py / .ipynb; `A.readNotebook` turns .ipynb into Python and lists the widgets it reads),
  "Send it to Copilot" per notebook. `A.notebookReview` per notebook: what its steps now send (new, changed, no longer),
  widgets it doesn't read yet (the exact lines, and "Add these lines for me"), and lines that build text a Find and
  replace changed (a line already changed isn't flagged again). Built-in: `nbWidgets` (widget + get lines next to the
  existing ones), `nbReplace` (text, typed as Python). Copilot: the prompt holds the chosen notebooks and asks for
  `@@@ NOTEBOOK @@@` blocks (`PATH:` first line, `A.notebookParse`). Review tab "Notebooks": diff, copy, download, and the
  ADF Studio steps say which notebooks to replace in Databricks. Also `dsParam` (send a value to a dataset parameter, or stop
  sending it). Check: `adfchangenbtest.js`.
- A factory export import (ARM template folder) was built and dropped (owner, Nov 2026: users won't trust giving the page
  the whole export, and a names-only list can't say what a dataset looks like). Pasting a dataset's JSON stays the way.

## Python Notebook Generator (`py_core.js`)

- Layer rules come from the Databricks Medallion Copilot Kit: bronze adds only `_source_file`, `_ingest_ts`, `_batch_id`
  and is idempotent per batch (replaceWhere); silver has an explicit select, dedupe, DQ rules into `_dq_failures` with a
  quarantine table, then MERGE on the key where newer wins; gold reads silver only, rebuilds the dates a batch touched
  (replaceWhere) or the whole table, and reconciles row counts (`_silver_rows`) and an unfiltered Sum to silver.
- Every notebook ends with `dbutils.notebook.exit(json.dumps({status, batch_id, rows_read, rows_written, rows_quarantined, ...}))`.
- Logging from inside the notebook (owner request, Nov 2026: some of his notebooks call a shared logging utility
  themselves, apart from the pipeline-level logging notebook). Optional, off by default, stored as `dep.log` so it
  outlives the entity. The user gives how the utility is loaded (`%run` path, an import line, or already available),
  the call as he writes it with `{tokens}` (`P.LOG_TOKENS`), and when to call it (start, success, failure).
  `P.applyLog` post-processes the notebook text: a `_log_run_status(status, error)` helper after section 2, the success
  call before the final exit, and for failure the working sections (3 to 6, plus counts and reconciliation) in one cell
  inside try/except that logs and re-raises. `dbutils.notebook.exit` always stays outside try (gold's early exit too).
  Not run on a cluster.
- pycoretest.js generates notebooks for many setups and checks each parses as Python.
- **Any object** (`cfg.scope = 'any'`, `cfg.any`): one silver and one gold notebook for every object the pipeline sends
  (`P.anySilver`, `P.anyGold`, `P.buildAny`). Silver reads the bronze Parquet from container/folder/file widgets, cleans
  every column name (ascii, camelCase split, non-alphanumerics to _, lower, leading digit `c_`, repeats numbered), trims,
  empty to null, drops exact duplicates, adds `_source_file` `_batch_id` `_ingest_ts`, writes `<schema>.<object>`: MERGE on
  `key_columns`, else replaceWhere on batch + file. Gold: watermark = max `_ingest_ts` in gold; MERGE on keys (newest wins)
  or replace whole batches. No Copilot step, no bronze. The ADF tab lists the exact layer parameters. Ran on local Spark
  with parquet in place of Delta (Maven blocked): names, trims, dedupe, first load and the 0-row second gold run; MERGE and
  replaceWhere not run. Check: `pyanytest.js`.
- Any object, "Write to" (`cfg.any.store`): Delta tables in a schema (default) or Delta folders in the lake (`path`: ADF sends
  `target_container`/`target_folder`, gold also `source_container`/`source_folder`; optional `table_name` is created over the
  folder and refreshed). Lookups for gold (`cfg.any.joins`: object, lookup object, object column, lookup column, columns,
  folder; owner, Nov 2026: a name joined into two objects from their name lookups): left join compared as text, the lookup
  keeps its newest row per key, a clashing name gets `<lookup>_` in front, missing columns fail with both column lists.
  Without a folder the lookup is read next to the object's silver folder. Ran on local Spark (parquet for Delta): int-to-text
  keys, no rows added, clash prefix, 0-row rerun, missing key error. Check: `pyjointest.js`.
- Any object, "Each file holds" (`cfg.any.load`): new or changed rows (add / merge, the default) or a full copy (`replace`:
  silver overwrites the object, gold is rebuilt from silver when silver has newer rows). Local Spark: the same file on day 2
  leaves the row counts unchanged.

## Python Script Generator (`ps_core.js`)

Added Nov 2026 when the owner asked for plain Python outside Databricks ("jupyter notebook or some other tool"). One
pandas script per file, modelled on the owner's own snippet notebooks (read, clean headers, dedupe, validate, write).

- `K.build(cfg, ai)` returns sections (title, markdown, code) and renders them twice: `.py` with `# %%` cells and
  `.ipynb` (nbformat 4.4). Same code in both.
- Order in the script: settings > read (everything as text; only empty is missing) > trim > types (`CONVERT`, failures
  noted, never guessed) > Copilot columns > lookup from a second file > filter > dedupe > checks > summary > write.
- Filters (owner, Nov 2026: "more than 1 filter... with AND or OR", and keep what is filtered out): `cfg.filters` [{when,
  label, join}], each a pandas condition run with `df.eval(..., engine="python")`; from the second on joined with and / or,
  left to right (`K.filterLogic` shows the grouping, e.g. "(A AND B) OR C"); a missing value never passes. The Copilot
  FILTER is one more, joined with AND. `cfg.keepRemoved`: an "Original" sheet (every row before filtering, after cleaning)
  and a "Filtered out" sheet with `failed_filters` (separate `_original` / `_filtered_out` files for CSV and Parquet); the
  script asserts kept + filtered out = before. The old single `filter` is read into the list. Renaming a column renames it
  inside the filters. Check: `psfiltertest.js`; pscoretest runs the AND and OR cases and reads the sheets back.
- Paths typed without an extension (owner: "my paths do not include the file extension"): the script's `with_extension`
  uses the path as typed if it exists or already ends in a known extension (`K.EXTS`), else the first existing file with
  one of the kind's extensions, else adds the first (always for the output). The page says so (info). Input, output and
  lookup. pscoretest runs csv-in and excel-in cases with bare paths.
- Type inference (owner: "def to_whole should not be auto included... users need a float / decimal"): numbers are inferred
  as Decimal, never Whole; a whole-number column whose name looks like an identifier (id, no, number, code, key, zip,
  postal, phone, sku, account) or has leading zeros is Text. `to_whole` is only written when the user picks Whole.
- Escapes in generated Python: Python regexes are written inside JS strings, so `\s` must be `\\s` in the source (a lone
  `\s` became the letter s, and `to_number` stripped every s instead of spaces; found Nov 2026). pscoretest checks it.
- The lookup matches keys as trimmed text and stops on repeated lookup keys, so the row count can't grow.
- Rows that fail a check: report (kept, also listed), split (moved to a rejected file or sheet) or stop.
- Review fixes (Nov 2026): exact copies are always counted and removed by default (`opts.dropDupRows`); values in a non-key
  text column that differ only in capitals take the most common spelling (`opts.sameCase`, printed), else are listed; `#`
  and a trailing "No." make a column an id (Text) and `#` is named `no` (Order # -> order_no). A list row's text change no
  longer redraws the form (it threw when a measure's column was chosen right after typing its name). Check: `psreviewtest.js`.
- The pasted sample rows are never saved (only column names and types are); `st.example` refills the example sample.
- Copilot blocks: COLUMN (NAME, EXPR) and one FILTER (KEEP_WHEN), vetted by `K.vetExpr` (only df/pd/np, known columns,
  no lambda, imports or file access).
- pscoretest.js writes sample files and **runs** each generated script with pandas (3.0 here), then reads the output
  back. Found that way: regex patterns passed to `.str.replace` must hold the real characters, not `\u` escapes
  (pandas' Arrow-backed strings reject them).
- **PDF input** (owner, Nov 2026: "import from a pdf and output to excel", system-export PDFs, "other PDFs as well"; no sample
  PDF). `input.kind = 'pdf'`, settings in `input.pdf` (`K.pdfBlank`), written by `K.pdfSettings` at the top of the script;
  the reading code is `PDF_READER` (pdfplumber; tested Python kept as a JS string array). Three methods, from the ways his
  own notebooks read PDFs, made general: `table` (ruling lines), `text` (columns found from alignment), `label` (a name then
  numbers, `VALUES_PER_ROW`). One file or a folder (`FILE_PATTERN`), `PAGES`, header row by its first cell (rows above it
  dropped, repeats dropped), `SKIP_ROWS_WITH`, `SECTIONS` (a line starting with a label fills a column for the rows below;
  several labels on one line), month from the file name, source_file/source_page, a per-page log (sheet "PDF pages").
  First run with no columns keeps everything and writes `<output>_sample.csv`; the user pastes that into Step 1 to choose
  columns and types. Check: `pspdftest.js` makes generic PDFs (`pdf_make.py`, reportlab) and runs the scripts. Not run on
  his real exports; scanned PDFs give no rows (said on the page).
- **Across rows** (owner, Nov 2026: a Copilot request to fill a missing id from rows matching on names and birth date, names
  maybe swapped, then list differing demographics per id; Copilot rightly SKIPPED it under the one-expression rules). Step 3
  "Across rows", run after dedupe and lookup, before the checks: `cfg.rowNo` (`from: 'file'` = the row as Excel shows it,
  `ROW_NUMBERS` taken right after reading so cleaning keeps the gaps; `'clean'` = 1..n), forced on by a fill or comparison
  (`K.rowCol`). `cfg.fills` [{col, passes (one match per line), swapA, swapB}]: donors are only rows that had the value in the
  file; keys are trimmed, case-folded text (dates as yyyy-mm-dd); a key used only when every donor agrees, else the note lists
  the candidates and later passes skip the row; writes `<col>_filled_from_row`, `<col>_fill_note`. `cfg.conflicts` {group,
  cols, missing}: per column `<c>_conflict_rows` / `<c>_conflict_values` on every row of the group, `conflict_columns`, and a
  Conflicts sheet (or `_conflicts` file).
- Copilot **STEP** blocks (`NAME`, `WHAT`, `CODE: def step(df): ... return df`) for logic across rows, run in order after the
  options above as `step_<name>`; `K.vetStep` refuses imports, file/network/system names, dunders, class/global/with, tabs,
  no return; columns it reads that nobody makes are shown, not refused. The prompt lists what the page already does
  (fills, comparisons, row numbers) so Copilot doesn't repeat it. A step makes later column lists open (`K.known().open`).
  Check: `pscrosstest.js` (runs the scripts). Also fixed: the saved "Rows that fail a check" choice was never restored (it
  sat inside a comment), and long source column names made the column table push the page sideways at 390px.
- Not checked: pandas 1.x / 2.x, opening the `.ipynb` in Jupyter itself, real Copilot replies.

## Not yet run in a real factory or workspace

- The pipeline JSON pasted into ADF Studio's code view and validated, for each pattern. (The owner ran a first folder
  copy in Nov 2026 and reported the setup assumptions above, not JSON errors.)
- Own datasets of types other than Binary and DelimitedText; a notebook logging activity reading its base parameters.
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

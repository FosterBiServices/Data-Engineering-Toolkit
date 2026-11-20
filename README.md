# Foster BI Data Engineering Toolkit

Single-file HTML tools for building Azure Data Factory pipelines, the Databricks notebooks they run, and pandas scripts for files. Nothing to install: each page runs in the browser, saves only to that browser, and sends nothing anywhere. Save work by name at the top of each page; Download and Open a file move it between computers. Copilot is optional and only used for logic described in plain words; the pages check its reply before using it.

| Page | What it does | AI |
|---|---|---|
| [ADF Pipeline Generator](adf-pipeline-generator.html) | A described load in; pipeline JSON, datasets, supporting SQL, trigger, build steps and test plan out. Patterns: full load, watermark incremental, incremental + merge, SCD Type 2, copying or landing files. Uses your own datasets and your own logging (procedure or notebook) if you have them. Also checks any pipeline JSON you paste and says how to fix each finding, and changes a pipeline that already works (parameters, folders, renames, notebook steps, schedule; anything else with Copilot), with a review of every change. | Not needed; Copilot optional |
| [Python Notebook Generator](python-notebook-generator.html) | For Databricks: bronze, silver and gold PySpark notebooks from your columns, key, quality rules and metrics, with ADF activity settings and SQL checks. | Not needed; Copilot optional |
| [Python Script Generator](python-script-generator.html) | A pandas script for one file (CSV, Excel, Parquet, or a PDF export, one file or a folder of them): rename and type columns, filter, remove duplicates, look up from a second file, fill missing values from matching rows, find values that differ within an ID, check values, summarize, write the result. As a Jupyter notebook or a .py script. | Not needed; Copilot optional |

## Publish with GitHub Pages

1. Put this folder in a repository (public, or private on a plan that allows Pages).
2. Settings > Pages > Deploy from a branch > `main`, `/ (root)`.
3. The site appears at `https://<owner>.github.io/<repo>/`.

## Change a page

Edit the parts in `src/parts/`, then run `python src/build.py`. Don't edit the `.html` files at the root: the next build overwrites them. See `CLAUDE.md`.

## Check everything before you use it

Generated pipelines, SQL and notebooks can be wrong. Test in dev on a small window first. The toolkit is provided as is, without warranty.

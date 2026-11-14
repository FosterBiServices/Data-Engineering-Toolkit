# Foster BI Data Engineering Toolkit

Single-file HTML tools for building Azure Data Factory pipelines and the Databricks notebooks they run. Nothing to install: each page runs in the browser, saves only to that browser, and sends nothing anywhere. Copilot is optional and only used for logic described in plain words; the pages check its reply before using it.

| Page | What it does | AI |
|---|---|---|
| [ADF Pipeline Generator](adf-pipeline-generator.html) | A described load in; pipeline JSON, datasets, supporting SQL, trigger, build steps and test plan out. Patterns: full load, watermark incremental, incremental + merge, SCD Type 2, file landing. Also checks any pipeline JSON you paste. | Not needed; Copilot optional |
| [Python Notebook Generator](python-notebook-generator.html) | Bronze, silver and gold PySpark notebooks from your columns, key, quality rules and metrics, with ADF activity settings and SQL checks. | Not needed; Copilot optional |

## Publish with GitHub Pages

1. Put this folder in a repository (public, or private on a plan that allows Pages).
2. Settings > Pages > Deploy from a branch > `main`, `/ (root)`.
3. The site appears at `https://<owner>.github.io/<repo>/`.

## Change a page

Edit the parts in `src/parts/`, then run `python src/build.py`. Don't edit the `.html` files at the root: the next build overwrites them. See `CLAUDE.md`.

## Check everything before you use it

Generated pipelines, SQL and notebooks can be wrong. Test in dev on a small window first. The toolkit is provided as is, without warranty.

"""Builds every page of the Foster BI Data Engineering Toolkit into the repo root.
Usage: python src/build.py        (Python 3, no packages needed)
Edit the parts in src/parts/, never the published .html files at the repo root."""
import base64, os, re
SRC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SRC)
P = os.path.join(SRC, 'parts')
def rd(*a):
    with open(os.path.join(*a), encoding='utf-8') as f: return f.read()
def b64(path, mime):
    with open(path, 'rb') as f: return 'data:%s;base64,%s' % (mime, base64.b64encode(f.read()).decode())
ICON_SVG = b64(os.path.join(SRC, 'brand', 'foster-bi-icon.svg'), 'image/svg+xml')
ICON_PNG = b64(os.path.join(SRC, 'brand', 'foster-bi-icon-64.png'), 'image/png')
HOME_LOGO = b64(os.path.join(SRC, 'brand', 'foster-bi-logo-services-white.svg'), 'image/svg+xml')
CSS = rd(P, 'base.css') + '\n' + rd(P, 'extra.css')
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">')

# page file -> (title, description, body part, script parts in order)
PAGES = {
    'index.html': ('Foster BI Data Engineering Toolkit', 'Tools for building Azure Data Factory pipelines and Databricks notebooks, with or without Copilot.', 'home_body.html', ['suite.js', 'home_ui.js']),
    'adf-pipeline-generator.html': ('ADF Pipeline Generator', 'Describe a load and get an Azure Data Factory pipeline as JSON, with datasets, supporting SQL and build steps.', 'adf_body.html', ['suite.js', 'adf_core.js', 'adf_ex.js', 'adf_ui.js']),
    'python-notebook-generator.html': ('Python Notebook Generator', 'Bronze, silver and gold PySpark notebooks for Databricks, built from your columns and rules and run by Azure Data Factory.', 'py_body.html', ['suite.js', 'py_core.js', 'py_ex.js', 'py_ui.js']),
}
def page(name):
    title, desc, body, scripts = PAGES[name]
    html = rd(P, body).replace('@@ICON@@', ICON_SVG).replace('@@HOMELOGO@@', HOME_LOGO)
    js = '\n'.join('<script>\n' + rd(P, s).replace('</script', '<\\/script') + '\n</script>' for s in scripts)
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'
            '<title>%s</title>\n<meta name="description" content="%s">\n<link rel="icon" type="image/png" sizes="64x64" href="%s">\n<link rel="icon" type="image/svg+xml" sizes="any" href="%s">\n%s\n<style>\n%s</style>\n</head>\n<body>\n%s\n%s\n</body>\n</html>\n'
            % (title, desc, ICON_PNG, ICON_SVG, FONTS, CSS, html, js))
def main(only=None):
    for name in PAGES:
        if only and only not in name: continue
        if not os.path.exists(os.path.join(P, PAGES[name][2])): print('skipped', name, '(no body part yet)'); continue
        out = page(name)
        with open(os.path.join(ROOT, name), 'w', encoding='utf-8', newline='\n') as f: f.write(out)
        print('built', name, len(out))
    nj = os.path.join(ROOT, '.nojekyll')
    if not os.path.exists(nj): open(nj, 'w').close()
if __name__ == '__main__':
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else None)

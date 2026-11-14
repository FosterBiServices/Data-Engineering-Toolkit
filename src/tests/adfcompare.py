"""Compare the values two pipelines pass, for one example file: a pipeline rebuilt through the page against the original.
What to compare comes from the private recipe (rebuild.json beside the samples), so nothing specific is in the repo."""
import json, sys
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from adfeval import Ctx, value
# usage: adfcompare.py <original pipeline.json> <rebuilt pipeline.json> <recipe.json>
orig=json.load(open(sys.argv[1])); new=json.load(open(sys.argv[2])); CMP=json.load(open(sys.argv[3]))['compare']
def acts(pl):
    out={}
    def w(L):
        for a in L:
            out[a['name']]=a; tp=a.get('typeProperties',{})
            for k in ('activities','ifTrueActivities','ifFalseActivities'): w(tp.get(k,[]))
    w(pl['properties']['activities']); return out
A,B=acts(orig),acts(new)
def defaults(pl): return {k:v.get('defaultValue') for k,v in pl['properties'].get('variables',{}).items()}
glob={'StorageAccountName':'<storage>'}
row=CMP['row']
copyout={'rowsCopied':120,'copyDuration':5}
def ctx(pl, item, vars_extra, failed=False):
    v=defaults(pl); v.update(vars_extra)
    a={n:{'output':{'value':[row],'Value':[row],'FilteredItemsCount':1,'runOutput':[row]}} for n in CMP['mock']['filters']}
    for n in CMP['mock']['copies']: a[n]={'output':copyout} if not failed else {'output':None,'error':{'message':'boom'}}
    return Ctx(item=item, vars=v, acts=a, glob=glob, pipe={'name':pl['name']})
ex=json.load(open(sys.argv[3])).get('example','example-file.csv')
fileItem={'name':ex,'type':'File'}; folderItem={'name':ex.rsplit('.',1)[0],'type':'Folder'}; ITEMS={'file':fileItem,'folder':folderItem,'none':{}}
def params(a, where):
    tp=a.get('typeProperties',{})
    if where=='dataset': return tp['dataset'].get('parameters',{})
    if where=='in': return a['inputs'][0].get('parameters',{})
    if where=='out': return a['outputs'][0].get('parameters',{})
    if where=='nb': return tp.get('baseParameters',{})
pairs=[(o,n,w,ITEMS[it],k) for o,n,w,it,k in CMP['pairs']]
rows=[]
for o,n,where,item,kind in pairs:
    po,pn=params(A[o],where),params(B[n],where)
    co=ctx(orig,item,CMP['origVars'],kind=='fail'); cn=ctx(new,item,CMP['newVars'],kind=='fail')
    for k in sorted(set(po)|set(pn)):
        try: vo=value(po[k],co) if k in po else '(not passed)'
        except Exception as e: vo='ERR '+str(e)
        try: vn=value(pn[k],cn) if k in pn else '(not passed)'
        except Exception as e: vn='ERR '+str(e)
        rows.append((o+' → '+n+' ['+where+']',k,vo,vn,'same' if vo==vn else 'DIFF'))
w=max(len(r[0]) for r in rows)
for r in rows: print(('%-'+str(w)+'s | %-14s | %-45s | %-45s | %s')%r)
print('activities', len(A), len(B))
# expected differences: listed in the recipe, with the reason in the write-up
EXPECTED={tuple(e) for e in CMP['expected']}
bad=[r for r in rows if r[4]=='DIFF' and (r[0].split(' → ')[0],r[1]) not in EXPECTED]
print('unexpected differences (expect none):', bad)

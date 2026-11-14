"""Compare the values two pipelines pass, for one example file. The rebuilt yourproject pipeline against the original."""
import json, sys
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from adfeval import Ctx, value
# usage: adfcompare.py <original pipeline.json> <rebuilt pipeline.json>
orig=json.load(open(sys.argv[1])); new=json.load(open(sys.argv[2]))
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
row={'id':7,'object_name':'Customer_Orders'}
copyout={'rowsCopied':120,'copyDuration':5}
def ctx(pl, item, vars_extra, failed=False):
    v=defaults(pl); v.update(vars_extra)
    a={n:{'output':{'value':[row],'Value':[row],'FilteredItemsCount':1,'runOutput':[row]}} for n in ('Filter1','flt_file_object','flt_silver_obj','flt_silver_object','flt_gold_obj','flt_gold_object','object_list','nb_lookup_objects')}
    for n in ('Copy data1','cp_file_to_bronze'): a[n]={'output':copyout} if not failed else {'output':None,'error':{'message':'boom'}}
    return Ctx(item=item, vars=v, acts=a, glob=glob, pipe={'name':pl['name']})
fileItem={'name':'Customer-Orders.csv','type':'File'}; folderItem={'name':'Customer-Orders','type':'Folder'}
def params(a, where):
    tp=a.get('typeProperties',{})
    if where=='dataset': return tp['dataset'].get('parameters',{})
    if where=='in': return a['inputs'][0].get('parameters',{})
    if where=='out': return a['outputs'][0].get('parameters',{})
    if where=='nb': return tp.get('baseParameters',{})
pairs=[('check_bronze_file','gm_check_bronze_file','dataset',fileItem,'file'),('archive data','cp_archive_bronze_file','in',fileItem,'file'),('archive data','cp_archive_bronze_file','out',fileItem,'file'),
 ('Copy data1','cp_file_to_bronze','in',fileItem,'file'),('Copy data1','cp_file_to_bronze','out',fileItem,'file'),
 ('log_file_success','nb_log_file_success','nb',fileItem,'file'),('log_file_failure','nb_log_file_failure','nb',fileItem,'fail'),
 ('Silver_Folders','gm_list_silver_folders','dataset',{},'top'),('to_silver','nb_silver','nb',folderItem,'folder'),
 ('Gold_Folders','gm_list_gold_folders','dataset',{},'top'),('to_gold','nb_gold','nb',folderItem,'folder')]
rows=[]
for o,n,where,item,kind in pairs:
    po,pn=params(A[o],where),params(B[n],where)
    co=ctx(orig,item,{'file_name':'Customer_Orders.csv','current_object':'Customer_Orders'},kind=='fail'); cn=ctx(new,item,{'object_name':'Customer_Orders'},kind=='fail')
    for k in sorted(set(po)|set(pn)):
        try: vo=value(po[k],co) if k in po else '(not passed)'
        except Exception as e: vo='ERR '+str(e)
        try: vn=value(pn[k],cn) if k in pn else '(not passed)'
        except Exception as e: vn='ERR '+str(e)
        rows.append((o+' → '+n+' ['+where+']',k,vo,vn,'same' if vo==vn else 'DIFF'))
w=max(len(r[0]) for r in rows)
for r in rows: print(('%-'+str(w)+'s | %-14s | %-45s | %-45s | %s')%r)
print('notebook paths:', [(A[o]['typeProperties'].get('notebookPath','').split('/')[-1], B[n]['typeProperties'].get('notebookPath','').split('/')[-1]) for o,n in [('to_silver','nb_silver'),('to_gold','nb_gold'),('log_file_success','nb_log_file_success'),('object_list','nb_lookup_objects')]])
print('activities', len(A), len(B))
# expected differences: the original's existence check and archive copy point at other files (bugs), and its failure log reads output that a failed copy may not have
EXPECTED={('check_bronze_file','file_name'),('archive data','file_name'),('log_file_failure','duration'),('log_file_failure','number_rows')}
bad=[r for r in rows if r[4]=='DIFF' and (r[0].split(' → ')[0],r[1]) not in EXPECTED]
print('unexpected differences (expect none):', bad)

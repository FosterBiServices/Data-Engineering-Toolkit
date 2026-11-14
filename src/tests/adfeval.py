"""A small ADF expression evaluator: enough to compare two pipelines' values for one example file."""
import re, json
class Ctx:
    def __init__(s, item=None, vars=None, acts=None, glob=None, pipe=None): s.item=item or {}; s.vars=vars or {}; s.acts=acts or {}; s.glob=glob or {}; s.pipe=pipe or {}
TOK=re.compile(r"\s*(?:(?P<str>'(?:[^']|'')*')|(?P<num>-?\d+(?:\.\d+)?)|(?P<id>[A-Za-z_]\w*)|(?P<op>\?\.|[().,\[\]]))")
def lex(s):
    out=[]; i=0
    while i<len(s):
        m=TOK.match(s,i)
        if not m:
            if s[i:].strip()=='': break
            raise ValueError('lex at '+s[i:])
        i=m.end(); k=m.lastgroup; out.append((k,m.group(k)))
    return out
class P:
    def __init__(s,t,c): s.t=t; s.i=0; s.c=c
    def peek(s): return s.t[s.i] if s.i<len(s.t) else (None,None)
    def take(s,v=None):
        x=s.t[s.i]; s.i+=1
        if v and x[1]!=v: raise ValueError('want '+v+' got '+str(x))
        return x
    def expr(s):
        k,v=s.take()
        if k=='str': val=v[1:-1].replace("''","'")
        elif k=='num': val=float(v) if '.' in v else int(v)
        elif k=='id':
            args=[]
            if s.peek()[1]=='(':
                s.take('(')
                while s.peek()[1]!=')':
                    args.append(s.expr())
                    if s.peek()[1]==',': s.take(',')
                s.take(')')
            val=call(v,args,s.c)
        else: raise ValueError('bad token '+str((k,v)))
        while s.peek()[1] in ('.','?.','['):
            k2,v2=s.take()
            if v2=='[':
                ix=s.expr(); s.take(']'); val=None if val is None else (val[ix] if isinstance(val,list) else val.get(ix) if isinstance(val,dict) else None)
            else:
                _,name=s.take()
                if val is None:
                    if v2=='?.': continue
                    raise ValueError('null.'+name)
                val=val.get(name) if isinstance(val,dict) else (val.get(name.lower()) if False else None)
                if isinstance(val,type(None)) and v2=='.': pass
        return val
def S(x): 
    if isinstance(x,bool): return 'True' if x else 'False'
    if isinstance(x,(dict,list)): return json.dumps(x)
    return '' if x is None else str(x)
def call(f,a,c):
    f=f.lower()
    if f=='concat': return ''.join(S(x) for x in a)
    if f=='replace': return S(a[0]).replace(S(a[1]),S(a[2]))
    if f=='string': return S(a[0])
    if f=='coalesce':
        for x in a:
            if x is not None: return x
        return None
    if f=='first': return a[0][0] if a[0] else None
    if f=='if': return a[1] if a[0] else a[2]
    if f=='contains': return S(a[1]) in S(a[0])
    if f=='equals': return a[0]==a[1]
    if f=='substring': return S(a[0])[a[1]:a[1]+a[2]]
    if f=='lastindexof': return S(a[0]).rfind(S(a[1]))
    if f=='variables': return c.vars.get(a[0])
    if f=='item': return c.item
    if f=='activity': return c.acts.get(a[0],{})
    if f=='pipeline': return {'globalParameters':c.glob,'Pipeline':c.pipe.get('name'),'RunId':'RUN'}
    if f=='div': return a[0]//a[1]
    if f=='tolower': return S(a[0]).lower()
    if f=='endswith': return S(a[0]).endswith(S(a[1]))
    if f=='and': return a[0] and a[1]
    raise ValueError('function '+f)
def value(v,c):
    """A pipeline value: a plain string (maybe starting with @), or {value, type: Expression}."""
    if isinstance(v,dict) and 'value' in v: v=v['value']
    if not isinstance(v,str): return v
    if v.startswith('@@'): return v[1:]
    if v.startswith('@'):
        p=P(lex(v[1:].replace('\n',' ')),c); r=p.expr(); return S(r) if not isinstance(r,(int,bool)) else S(r)
    return v

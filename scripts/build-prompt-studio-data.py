"""Compile supplied catalogs into offline, role-specific Studio assets.

The input manifest has name/path entries. Uploaded paths and IDs are never saved.
Duplicate copies are audited, while their content is included only once.
"""
import argparse, base64, csv, hashlib, io, json, re
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--manifest',required=True)
parser.add_argument('--output',default='src/lib/prompt-studio/data')
parser.add_argument('--exclude-terms',default='')
args=parser.parse_args()
out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
excluded=[x.casefold() for x in args.exclude_terms.split(',') if x]
def safe(value):
    if isinstance(value,str):
        if re.search(r'https?://|data:image|(?:^|/)files/',value,re.I) or any(x in value.casefold() for x in excluded): return None
        return value
    if isinstance(value,list): return [v for x in value if (v:=safe(x)) is not None]
    if isinstance(value,dict): return {k:v for k,x in value.items() if k not in ['img','preview','blur','_комментарий'] and (v:=safe(x)) is not None}
    return value

def write(name,data):
    (out/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
def ident(*parts): return hashlib.sha256('\0'.join(map(str,parts)).encode()).hexdigest()[:20]
def artist(value):
    # Model prefixes and escaping are formatting, not part of the artist identity.
    return re.sub(r'\\([()\[\]])',r'\1',value.lstrip('@').replace('_',' ')).strip()
manifest=json.loads(Path(args.manifest).read_text())
by_name={}; coverage=[]; signatures={}; objects={}
for i,row in enumerate(manifest):
    raw=Path(row['path']).read_bytes(); text=raw.decode('utf-8-sig')
    name=row['name'].replace('.json.json','.json')
    if name.endswith('.json'): data=json.loads(text)
    elif name.endswith('.csv'): data=list(csv.DictReader(io.StringIO(text)))
    else: data=[x.strip() for x in text.splitlines() if x.strip()]
    digest=hashlib.sha256(raw).hexdigest()
    semantic=hashlib.sha256(json.dumps(data,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    duplicate=signatures.get(semantic)
    signatures.setdefault(semantic,i+1)
    coverage.append({'copy':i+1,'file':row['name'],'sha256':digest,'bytes':len(raw),'duplicateOf':duplicate,'records':len(data) if hasattr(data,'__len__') else 1})
    if name not in by_name: by_name[name]=data
    elif by_name[name]!=data: raise ValueError(f'Conflicting distinct versions of {name}; review before compiling')
    objects[name]=data

collections=[]
def collection(cid,label,rows,kind='tag',**extra):
    unique={}
    for r in rows:
        r=safe(r)
        if not r or not isinstance(r.get('tag'),str) or not r['tag'].strip(): continue
        r['tag']=r['tag'].strip(); r.setdefault('name',r['tag'].replace('_',' '))
        r['id']=ident(cid,r.get('group',''),r['tag']); unique.setdefault((r.get('group',''),r['tag']),r)
    rows=list(unique.values()); file=cid+'.json'; write(file,rows)
    collections.append({'id':cid,'label':label,'kind':kind,'count':len(rows),'files':[file],**extra})

def taxonomy(name):
    rows=by_name[name]; bases={r['tag']:r for r in rows}; result=[]
    for r in rows:
        base=bases.get(r.get('base'),{})
        group=r.get('category') or base.get('category') or 'details'
        context=r.get('adds',[]); context=[context] if isinstance(context,str) else context
        neg=r.get('neg',[]); neg=[neg] if isinstance(neg,str) else neg
        meta={k:v for k,v in r.items() if k not in ['tag','name','category','img','desc','adds','neg','id']}
        result.append({'tag':r['tag'],'name':r.get('name',r['tag']),'group':group,'description':r.get('desc',''),'context':context,'negative':neg,'meta':meta})
    return result
collection('characters','Персонажи',taxonomy('character-db.json'))
collection('wardrobe','Гардероб',taxonomy('wardrobe-db.json'))
collection('composition','Композиция',taxonomy('composition-db.json'))
# CSV and JSON exports are cross-checked, not counted again as extra tags.
tags=by_name['tags.json']; csv_tags=by_name['tags.csv']
assert {(r['source'],r['category'],r['tag']) for r in tags}=={(r['source'],r['category'],r['tag']) for r in csv_tags}
base_tags={r['tag'] for n in ['character-db.json','wardrobe-db.json','composition-db.json'] for r in by_name[n]}
assert {r['tag'] for r in tags}<=base_tags
# Keep export descriptions/labels as a searchable consolidated collection.
collection('all-tags','Все теги', [{'tag':r['tag'],'name':r['name'],'group':r['source']+' / '+r.get('category',''),'description':r.get('description',''),'meta':safe(r.get('metadata',{}))} for r in tags])

lexicon=safe(by_name['pose-lexicon.json']); write('dictionaries.json',lexicon)
source_names={r['source'] for r in by_name['prompt-templates.json']}
for source in source_names:
    txt=by_name[source]
    exported=[r['template'] for r in by_name['prompt-templates.json'] if r['source']==source]
    assert txt==exported, source
assert [(r['source'],int(r['index']),r['template']) for r in by_name['prompt-templates.csv']]==[(r['source'],r['index'],r['template']) for r in by_name['prompt-templates.json']]
recipe_rows=[{'tag':r['template'],'name':r['template'][:100],'group':r['source'].removesuffix('.txt'),'meta':{'number':r['index']}} for r in by_name['prompt-templates.json']]
collection('templates','Образы, позы и фоны',recipe_rows,'template')
collection('generation-styles','Стили генерации',[{'tag':r['prompt'],'name':r['name'],'description':r['description'],'group':'styles','meta':{'examples':r.get('examples',[])}} for r in by_name['generation-styles.json']],'template')
collection('lexicon','Словари для шаблонов',[{'tag':v,'name':v,'group':k} for k,values in lexicon.items() if isinstance(values,list) and not k.startswith('_') for v in values if isinstance(v,str) and v])

artist_names=[name for name in by_name if ('artist' in name.lower() or name=='OpusStyle.txt') and name.endswith('.txt')]
sets=[{'id':Path(name).stem,'label':Path(name).stem.replace('_',' ')} for name in artist_names]
artists={}
for bit,name in enumerate(artist_names):
    for line in by_name[name]:
        count=None
        if name=='choose_your_artist.txt':
            line,number=line.rsplit(';',1); count=int(number)
        tag=artist(line)
        if not tag: continue
        row=artists.setdefault(tag,[tag,None,0]); row[2]|=1<<bit
        if count is not None: row[1]=count
artist_rows=sorted(artists.values(),key=lambda r:r[0].casefold())
files=[]
for offset in range(0,len(artist_rows),10000):
    file=f'artists-{offset//10000:03d}.json'; files.append(file); write(file,artist_rows[offset:offset+10000])
collections.append({'id':'artists','label':'Художники','kind':'artist','count':len(artist_rows),'files':files,'sets':sets})

worlds=by_name['wardrobe-worlds.json']; graph=by_name['wardrobe-graph.json']; veto=by_name['wardrobe-veto.json']; measure=by_name['wardrobe-mera.json']
assert len(graph['near'])==len(graph['odd'])==len(worlds['tags'])
for data,key in [(veto,'биты'),(measure,'карта')]:
    n=len(data['теги']); assert len(base64.b64decode(data[key]))==((n*(n-1)//2+7)//8)
relations={'worlds':safe(worlds),'graph':safe(graph),'veto':{'tags':veto['теги'],'bits':veto['биты'],'threshold':veto['порог']},'measure':{'tags':measure['теги'],'pairs':measure['пары'],'bits':measure['карта'],'precision':measure['точность'],'seen':measure['видели'],'unseen':measure['неВидели'],'threshold':measure['порог']}}
write('wardrobe-relations.json',relations)
# These files describe preview availability, not supplied image binaries.
access=by_name['character-preview-access.json']; previews=by_name['character-previews.json']
preview_info={'open':access['open'],'closed':access['closed'],'extensions':previews['ext'],'blurred':previews['blur'],'restricted':previews['closed0'],'version':previews['v'],'status':safe(by_name['preview-status.json']),'journal':safe(by_name['preview-journal.json']),'poses':safe(by_name['poses-embedded-1.json'])}
write('preview-info.json',preview_info)

roles={
 'character-db.json':'character taxonomy','wardrobe-db.json':'wardrobe taxonomy','composition-db.json':'scene taxonomy',
 'tags.csv':'validated tag export','tags.json':'consolidated tag descriptions','prompt-templates.csv':'validated template export',
 'prompt-templates.json':'template catalog','pose-lexicon.json':'template dictionaries','generation-styles.json':'generation style presets',
 'wardrobe-worlds.json':'world compatibility and axes','wardrobe-graph.json':'item co-occurrence graph','wardrobe-veto.json':'incompatibility bitmap',
 'wardrobe-mera.json':'pair compatibility scores','character-preview-access.json':'preview availability','character-previews.json':'preview metadata',
 'preview-status.json':'preview status','preview-journal.json':'preview history','poses-embedded-1.json':'pose preview inventory',
}
for row in coverage:
    name=row['file'].replace('.json.json','.json')
    row['role']=roles.get(name,'artist dataset membership/counts' if name in artist_names else 'validated outfit/pose/background/texture templates')
    row['included']=True
write('coverage.json',coverage)
write('index.json',{'version':1,'inputFiles':len(manifest),'distinctContent':len(signatures),'collections':collections,'extras':['dictionaries.json','wardrobe-relations.json','preview-info.json']})
print(json.dumps({'files':len(manifest),'distinct':len(signatures),'artists':len(artist_rows),'collections':[(r['id'],r['count']) for r in collections]},ensure_ascii=False))

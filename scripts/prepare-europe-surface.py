# Offline asset preparation only; never used by the application runtime.
import json,math,hashlib,pathlib
from shapely.geometry import shape,box,Polygon,MultiPolygon
from shapely.ops import transform,unary_union
from shapely import set_precision
import argparse
parser=argparse.ArgumentParser(description="Prepare the prototype Europe physical mask (requires Shapely 2.1.2).")
parser.add_argument('--source-dir',type=pathlib.Path,required=True,help='Directory containing land.geojson and lakes.geojson from the pinned URLs')
parser.add_argument('--output-dir',type=pathlib.Path,required=True)
args=parser.parse_args();P=args.source_dir;args.output_dir.mkdir(parents=True,exist_ok=True)
PINNED={'maskId': 'europe-ne10m-surface-v2', 'profileId': 'europe-mercator-fixed-v2', 'bounds': {'width': 944444, 'height': 886082}, 'sha256': '052b866179d2566fd37b2f22301d48c5e5fcec3f97e6e4bd806dcdc78374bfe6', 'inputs': {'land': '1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416', 'lakes': '2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9'}, 'processing': 'Shapely 2.1.2; clip geographic theatre; normalized Web Mercator offset x4e6; dissolve physical polygons; topology-preserving simplify 1 map unit; integer precision grid 1; dissolve and clip; remove duplicate closing and collinear vertices', 'vertices': 110920, 'omittedSlivers': {'land': [], 'lakes': []}, 'landPolygons': 1493, 'lakePolygons': 260, 'sources': {'land': 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ace5fed0eaf3c6c03c951e75b439ba8fffbc218e/geojson/ne_10m_land.geojson', 'lakes': 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ace5fed0eaf3c6c03c951e75b439ba8fffbc218e/geojson/ne_10m_lakes.geojson'}, 'license': 'Public domain', 'licenseUrl': 'https://www.naturalearthdata.com/about/terms-of-use/', 'cartographicScale': '1:10,000,000', 'prototypeOnly': True, 'accuracyAcceptance': 'Reviewed sample points/routes only; Geneva anchor unresolved; not accepted for live orders or production naval chokepoints'}
for name,digest in PINNED['inputs'].items():
 if hashlib.sha256((P/(name+'.geojson')).read_bytes()).hexdigest()!=digest:raise ValueError('Source hash mismatch: '+name)

def merc(lat):return (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2
ox=(-25+180)/360;oy=merc(72);width=round(85/360*4e6);height=round((merc(25)-oy)*4e6)
geo_bounds=box(-25,25,60,72);fixed_bounds=box(0,0,width,height)
def projection(x,y,z=None):
 # shapely supports vectorized tuples and scalar fallback.
 if hasattr(x,'__iter__'):return tuple(((v+180)/360-ox)*4e6 for v in x),tuple((merc(v)-oy)*4e6 for v in y)
 return ((x+180)/360-ox)*4e6,(merc(y)-oy)*4e6
def polygons(g):return [g]if isinstance(g,Polygon)else [p for p in getattr(g,'geoms',[])if isinstance(p,Polygon)]
def prepare(name):
 features=json.loads((P/(name+'.geojson')).read_text())['features']
 parts=[]
 for f in features:
  g=shape(f['geometry'])
  if not g.intersects(geo_bounds):continue
  fixed=transform(projection,g.intersection(geo_bounds)).intersection(fixed_bounds)
  parts.extend(polygons(fixed))
 g=unary_union(parts).simplify(1,preserve_topology=True)
 g=unary_union(set_precision(g,1)).intersection(fixed_bounds)
 assert g.is_valid
 components=polygons(g)
 prepare.omitted[name]=[]
 result=[]
 def ring(coords):
  ps=[{'x':round(x),'y':round(y)}for x,y in list(coords)[:-1]]
  # Remove exact collinear vertices without moving a boundary.
  changed=True
  while changed and len(ps)>3:
   changed=False;out=[]
   for i,b in enumerate(ps):
    a=ps[i-1];c=ps[(i+1)%len(ps)]
    if (b['x']-a['x'])*(c['y']-b['y'])==(b['y']-a['y'])*(c['x']-b['x']):changed=True
    else:out.append(b)
   ps=out
  return ps
 for p in components:
  outer=ring(p.exterior.coords)
  if len(outer)<3:continue
  holes=[ring(h.coords)for h in p.interiors]
  result.append({'outer':outer,'holes':[h for h in holes if len(h)>=3]})
 return result
prepare.omitted={}
mask={'schemaVersion':2,'maskId':'europe-ne10m-surface-v2','bounds':{'width':width,'height':height},'land':prepare('land'),'inlandWater':prepare('lakes')}
b=json.dumps(mask,separators=(',',':')).encode()
path=args.output_dir/'europe-surface-mask.json';path.write_bytes(b)
meta={'maskId':mask['maskId'],'profileId':'europe-mercator-fixed-v2','bounds':mask['bounds'],'sha256':hashlib.sha256(b).hexdigest(),'inputs':{n:hashlib.sha256((P/(n+'.geojson')).read_bytes()).hexdigest()for n in ['land','lakes']},'processing':'Shapely 2.1.2; clip geographic theatre; normalized Web Mercator offset x4e6; dissolve physical polygons; topology-preserving simplify 1 map unit; integer precision grid 1; dissolve and clip; remove duplicate closing and collinear vertices','vertices':sum(len(r)for k in ['land','inlandWater']for p in mask[k]for r in [p['outer'],*p['holes']]),'omittedSlivers':prepare.omitted,'landPolygons':len(mask['land']),'lakePolygons':len(mask['inlandWater'])}
assert meta['sha256']==PINNED['sha256'], 'Prepared output hash mismatch'
meta.update({k:PINNED[k] for k in ['sources','license','licenseUrl','cartographicScale','prototypeOnly','accuracyAcceptance']})
path.with_name('europe-surface-manifest.json').write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta),flush=True)

"""Original MIT illustrative overhung pump / TEFC induction motor. Reproducible GLB.
No manufacturer CAD or dimensions. X shaft axis, metres, +Y up. Every surface
is a closed oriented solid; hollow profiles retain their bores under section.
Run via generate-artifacts.py to rebuild the GLB, BOM, mappings and AASX.
"""
import math, struct, json, hashlib
from pathlib import Path
from uuid import UUID, uuid5
ROOT=Path(__file__).resolve().parents[2]/'fixtures/equipment'
TAU=2*math.pi
NS=UUID('5760d716-6140-47a2-a911-fcb3dc244c85')
def ident(s): return str(uuid5(NS,'reference-3:'+s))
nodes=[{'name':'Assembly','children':[1,2]}, {'name':'Pump','children':[]}, {'name':'Motor','children':[]}]
components=[]; meshes=[]; views=[]; accessors=[]; binary=bytearray()
palette=[('Ceramic blue',[.035,.23,.40,1],.55,.29),('Machined steel',[.55,.62,.69,1],.88,.25),('Cast iron',[.105,.135,.16,1],.7,.46),('Copper',[.67,.255,.075,1],.86,.28),('Elastomer',[.022,.028,.032,1],.05,.72),('Brass cage',[.63,.43,.13,1],.8,.32),('Seal ceramic',[.78,.80,.76,1],.1,.24),('Rotor laminations',[.29,.33,.37,1],.8,.4)]
materials=[{'name':n,'pbrMetallicRoughness':{'baseColorFactor':c,'metallicFactor':m,'roughnessFactor':r}} for n,c,m,r in palette]
rootids=['96dbea7b-a855-5257-9e54-657bf7c6bf62','9eb83ff8-7434-5b9f-b283-7e3be67d7ad7','6d5a0e0f-aa5f-5646-87c9-45748ec2cad5']
for i,n in enumerate(nodes):
 components.append({'templateComponentId':rootids[i],'name':n['name'],'nodeIndex':i,'nodePath':'/Assembly'+('/'+n['name'] if i else ''),'parentTemplateComponentId':rootids[0] if i else None,'designation':'PM-ILL-3' if i==0 else n['name']+' subassembly','quantity':1,'material':'Assembly','role':'group','solid':False,'explode':{'translation':([0,0,0] if i==0 else [-.22,0,0] if i==1 else [.22,0,0]),'rotation':[0,0,0],'pivot':[0,.25,0]}})
def add(name,parent,geo=None,mat=1,move=(0,0,0),qty=1,role='internal',detail='',rot=(0,0,0),pivot=(0,.25,0)):
 idx=len(nodes); p=components[parent]; node={'name':name.replace(' ','_'),'children':[]}
 if geo:
  pos,nor,ind=geo; attrs={}
  for key,vals,fmt,ctype,kind in [('POSITION',pos,'3f',5126,'VEC3'),('NORMAL',nor,'3f',5126,'VEC3'),('indices',ind,'I',5125,'SCALAR')]:
   data=b''.join(struct.pack('<'+fmt,*(v if isinstance(v,(tuple,list)) else (v,))) for v in vals)
   views.append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data)});binary.extend(data);binary.extend(b'\0'*((-len(binary))%4))
   a={'bufferView':len(views)-1,'componentType':ctype,'count':len(vals),'type':kind}
   if key=='POSITION': a.update(min=[min(v[k] for v in vals) for k in range(3)],max=[max(v[k] for v in vals) for k in range(3)])
   attrs[key]=len(accessors);accessors.append(a)
  node['mesh']=len(meshes);meshes.append({'name':name,'primitives':[{'attributes':{k:v for k,v in attrs.items() if k!='indices'},'indices':attrs['indices'],'material':mat}]})
 nodes.append(node);nodes[parent]['children'].append(idx)
 components.append({'templateComponentId':ident(name),'name':name,'nodeIndex':idx,'nodePath':p['nodePath']+'/'+node['name'],'parentTemplateComponentId':p['templateComponentId'],'designation':f'ILL-{idx:03d}','quantity':qty,'material':palette[mat][0] if geo else 'Assembly','role':role if geo else 'group','solid':bool(geo),'description':detail or ('Combined repeated parts; select as one set.' if qty>1 else 'Illustrative reference geometry.'),'explode':{'translation':list(move),'rotation':list(rot),'pivot':list(pivot)}})
 return idx
def combine(*gs):
 p=[];n=[];ix=[]
 for a,b,c in gs:
  ix.extend(i+len(p) for i in c);p.extend(a);n.extend(b)
 return p,n,ix
def transform(g,offset=(0,0,0),axis='x'):
 def orient(v): return v if axis=='x' else (-v[1],v[0],v[2]) if axis=='y' else (-v[2],v[1],v[0])
 return ([tuple(a+b for a,b in zip(orient(v),offset)) for v in g[0]],[orient(v) for v in g[1]],g[2])
def lathe(profile,center=(0,.25,0),n=64,radial=None):
 # Closed polygon in axial/radial plane, counter-clockwise seen from +theta.
 p=[];norm=[];ix=[]
 # Reverse polygon if needed so outer profile faces outward.
 area=sum(profile[i][0]*profile[(i+1)%len(profile)][1]-profile[(i+1)%len(profile)][0]*profile[i][1] for i in range(len(profile)))
 if area>0: profile=list(reversed(profile))
 for j,(x,r) in enumerate(profile):
  xx,rr=profile[(j+1)%len(profile)];dx=xx-x;dr=rr-r;ln=math.hypot(dx,dr) or 1
  for i in range(n+1):
   t=TAU*i/n;c=math.cos(t);s=math.sin(t)
   for ax,ra in [(x,r),(xx,rr)]:
    rad=radial(ra,t) if radial else ra;p.append((center[0]+ax,center[1]+rad*c,center[2]+rad*s));norm.append((-dr/ln,dx*c/ln,dx*s/ln))
  base=j*(n+1)*2
  for i in range(n):
   a=base+i*2;ix.extend([a,a+2,a+1,a+1,a+2,a+3])
 return p,norm,ix
def ring(x,l,ro,ri,mat=None,n=64,bevel=.0015):
 b=min(bevel,l/4,(ro-ri)/4);h=l/2
 return lathe([(-h,ri+b),(-h+b,ri),(h-b,ri),(h,ri+b),(h,ro-b),(h-b,ro),(-h+b,ro),(-h,ro-b)],(x,.25,0),n)
def box(center,size):
 p=[];n=[];ind=[]
 for axis in range(3):
  for sign in [-1,1]:
   a=(axis+1)%3;b=(axis+2)%3;base=len(p)
   for u,v in [(-1,-1),(1,-1),(1,1),(-1,1)]:
    q=list(center);q[axis]+=sign*size[axis]/2;q[a]+=u*size[a]/2;q[b]+=v*size[b]/2;p.append(tuple(q));nn=[0,0,0];nn[axis]=sign;n.append(tuple(nn))
   ind.extend([base,base+1,base+2,base,base+2,base+3] if sign==1 else [base,base+2,base+1,base,base+3,base+2])
 return p,n,ind
def sweep(points,r,sides=8):
 # Parallel-ish frame sufficient for authored smooth planar and helical tubes.
 p=[];norm=[];ix=[]
 for i,c in enumerate(points):
  a=points[max(0,i-1)];b=points[min(len(points)-1,i+1)];d=[b[k]-a[k] for k in range(3)];ln=math.sqrt(sum(x*x for x in d));d=[x/ln for x in d]
  ref=[1,0,0] if abs(d[0])<.9 else [0,1,0]
  v=[d[1]*ref[2]-d[2]*ref[1],d[2]*ref[0]-d[0]*ref[2],d[0]*ref[1]-d[1]*ref[0]];ln=math.sqrt(sum(x*x for x in v));v=[x/ln for x in v];w=[d[1]*v[2]-d[2]*v[1],d[2]*v[0]-d[0]*v[2],d[0]*v[1]-d[1]*v[0]]
  for j in range(sides):
   t=TAU*j/sides;nn=tuple(math.cos(t)*v[k]+math.sin(t)*w[k] for k in range(3));p.append(tuple(c[k]+r*nn[k] for k in range(3)));norm.append(nn)
 for i in range(len(points)-1):
  for j in range(sides):
   a=i*sides+j;b=i*sides+(j+1)%sides;c=a+sides;dd=b+sides;ix.extend([a,b,c,b,dd,c])
 for off,rev in [(0,True),((len(points)-1)*sides,False)]:
  for j in range(1,sides-1): ix.extend([off,off+j+1,off+j] if rev else [off,off+j,off+j+1])
 return p,norm,ix
def orbitboxes(x,r,count,size):
 return combine(*[box((x,.25+r*math.cos(TAU*i/count),r*math.sin(TAU*i/count)),size) for i in range(count)])
def bearing(name,parent,x,move):
 g=add(name,parent,move=move)
 # Grooves remove real annular volume, rather than painting raceways.
 add(name+' inner race',g,lathe([(-.012,.022),(.012,.022),(.012,.035),(.006,.035),(0,.032),(-.006,.035),(-.012,.035)],(x,.25,0)),1,(-.045,0,0))
 add(name+' outer race',g,lathe([(-.012,.047),(-.006,.047),(0,.050),(.006,.047),(.012,.047),(.012,.061),(-.012,.061)],(x,.25,0)),1,(.045,0,0))
 balls=[]
 for i in range(10):
  t=TAU*i/10
  # sphere as a closed swept meridian, no degenerate pole triangles
  profile=[(.008*math.cos(math.pi*j/12),max(.00001,.008*math.sin(math.pi*j/12))) for j in range(13)]
  balls.append(lathe(profile,(x,.25+.041*math.cos(t),.041*math.sin(t)),24))
 add(name+' rolling elements',g,combine(*balls),1,(0,.055,0),10,detail='Ten balls intentionally combined, with individual race and cage selection.')
 cage=combine(ring(x-.006,.003,.045,.038,n=48),ring(x+.006,.003,.045,.038,n=48),orbitboxes(x,.041,10,(.012,.003,.003)))
 add(name+' cage',g,cage,5,(0,-.065,0))
 return g

# Wet end: spiralling annular fluid passage with true inner/outer surfaces.
wet=add('Wet end',1,move=(-.12,0,0))
profile=[(-.085,.105),(-.061,.105),(-.061,.163),(.061,.163),(.061,.033),(.085,.033),(.085,.18),(-.085,.18)]
volute=lathe(profile,(-.58,.25,0),96,lambda r,t:r+(max(0,r-.10)/.08)*(.012*(1+math.sin(t))+.006*math.sin(t/2)**2))
add('Volute casing',wet,volute,0,(0,0,-.42),role='housing',detail='Hollow spiral annular passage; illustrative non-hydraulic profile.')
add('Suction cover',wet,ring(-.68,.027,.184,.058),0,(-.25,0,0),role='cover',rot=(0,0,.18),pivot=(-.68,.25,0))
add('Suction nozzle flange',wet,ring(-.75,.11,.081,.052),0,(-.36,0,0),role='housing')
discharge=transform(ring(0,.13,.058,.038),(-.55,.43,0),'y')
# ring() defaults to Y=.25, compensate before orientation to keep nozzle above casing.
discharge=transform(ring(0,.13,.058,.038),( -.30,.455,0),'y')
add('Discharge neck and flange',wet,discharge,0,(0,.25,0),role='housing')
add('Back plate',wet,ring(-.475,.024,.18,.031),0,(.15,0,0),role='cover')
add('Casing gasket',wet,ring(-.666,.003,.176,.163),4,(-.18,0,0))
imp=add('Impeller',wet,move=(-.12,0,0))
add('Impeller rear shroud',imp,ring(-.535,.008,.145,.027),1,(.035,0,0))
add('Impeller front shroud',imp,ring(-.59,.008,.145,.060),1,(-.07,0,0))
vanes=[]
for i in range(7):
 points=[]
 for j in range(24):
  u=j/23;r=.045+.097*u;t=TAU*i/7-.85*u;points.append((-.563,.25+r*math.cos(t),r*math.sin(t)))
 # wide axial dimension via closed swept blade sections
 geo=sweep(points,.004,8);pp=[(-.563+(v[0]+.563)*5,v[1],v[2]) for v in geo[0]];vanes.append((pp,geo[1],geo[2]))
add('Backward swept impeller vanes',imp,combine(*vanes),1,(0,0,.16),7,detail='Seven shaped vanes, grouped; illustrative impeller passages.')
add('Impeller hub and lock nut',imp,combine(ring(-.55,.075,.045,.022),ring(-.614,.018,.034,.022,n=6)),1,(-.1,0,0))
train=add('Pump rotating train',1,move=(.07,0,.19))
add('Pump stepped shaft',train,lathe([(-.29,.001),(-.29,.021),(-.20,.021),(-.20,.025),(.04,.025),(.04,.022),(.17,.022),(.17,.001)],(-.29,.25,0)),1,(.14,0,0))
add('Shaft sleeve',train,ring(-.46,.085,.029,.0255),1,(.06,.11,0))
seal=add('Mechanical seal',1,move=(0,.23,.10))
add('Seal gland',seal,ring(-.434,.014,.066,.034),1,(.08,0,0))
add('Stationary ceramic seat',seal,ring(-.45,.009,.043,.030),6,(-.03,0,0))
add('Rotating carbon face',seal,ring(-.459,.009,.041,.0295),4,(-.07,0,0))
add('Seal elastomer bellows',seal,lathe([(-.018,.029),(.018,.029),(.018,.035),(.013,.037),(.008,.034),(.003,.037),(-.003,.034),(-.008,.037),(-.013,.034),(-.018,.037)],(-.406,.25,0)),4,(.1,0,0))
add('Seal compression spring',seal,sweep([(-.424+.037*i/180,.25+.04*math.cos(TAU*5*i/180),.04*math.sin(TAU*5*i/180)) for i in range(181)],.0015,8),1,(.16,0,0))
add('Seal O rings',seal,combine(ring(-.443,.004,.046,.042),ring(-.465,.004,.032,.029)),4,(0,.075,0),2)
carrier=add('Pump bearing carrier',1,ring(-.295,.22,.082,.062),0,(0,0,-.28),role='housing')
bearing('Pump DE bearing',1,-.365,(.02,.17,.18));bearing('Pump NDE bearing',1,-.218,(.13,.17,.18))
add('Pump bearing spacers',1,combine(ring(-.325,.045,.032,.025),ring(-.25,.025,.033,.025)),1,(.15,-.08,.05),2)
add('Pump bearing end covers',1,combine(ring(-.415,.014,.083,.03),ring(-.176,.014,.083,.024)),0,(.10,-.16,0),2,'cover')
add('Pump casing bolt and washer set',wet,combine(orbitboxes(-.704,.153,8,(.025,.014,.014)),orbitboxes(-.69,.153,8,(.003,.023,.023))),1,(-.38,0,0),16,detail='Eight hex-size bolts and eight washers represented as one selectable set; threads omitted.')
coupling=add('Flexible coupling',0,move=(0,0,.34))
add('Pump coupling hub',coupling,ring(-.087,.075,.067,.022),1,(-.09,0,0))
add('Motor coupling hub',coupling,ring(.018,.075,.067,.022),1,(.09,0,0))
add('Elastomer coupling spider',coupling,combine(ring(-.034,.023,.041,.023),orbitboxes(-.034,.046,6,(.023,.026,.026))),4,(0,.12,0))
add('Coupling safety guard',coupling,lathe([(-.12,.096),(.12,.096),(.12,.100),(-.12,.100)],(-.035,.25,0)),5,(0,0,-.40),role='cover')
# Motor actual internals; the windings are solid copper bundles, not a texture.
housing=add('Motor finned housing',2,combine(ring(.42,.43,.145,.127),*[ring(.42+(i-7)*.027,.005,.162,.143) for i in range(15)]),0,(0,0,-.38),role='housing')
stator=add('Stator assembly',2,move=(0,.24,0))
add('Stator laminated core',stator,ring(.42,.36,.125,.095),7,(0,.1,0))
teeth=[]
for i in range(24):
 t=TAU*i/24;teeth.append(sweep([(.245,.25+.088*math.cos(t),.088*math.sin(t)),(.595,.25+.088*math.cos(t),.088*math.sin(t))],.007,6))
add('Stator teeth',stator,combine(*teeth),7,(0,.16,0),24)
for phase in range(3):
 coils=[]
 for j in range(8):
  t=TAU*(j*3+phase)/24;dt=.085
  for strand in range(3):
   r=.104+strand*.0037;points=[]
   for k in range(65):
    a=TAU*k/64;x=.42+.205*math.cos(a);ang=t+dt*math.sin(a);points.append((x,.25+r*math.cos(ang),r*math.sin(ang)))
   coils.append(sweep(points,.00165,6))
 add('Winding phase '+str(phase+1),stator,combine(*coils),3,(0,.22+phase*.055,0),8,detail='Eight coil bundles with three visible conductor paths each; illustrative insulation omitted.')
rotor=add('Rotor assembly',2,move=(.1,0,.2))
add('Motor shaft',rotor,lathe([(-.40,.001),(-.40,.022),(-.20,.022),(-.20,.025),(.20,.025),(.20,.022),(.35,.022),(.35,.001)],(.42,.25,0)),1,(.22,0,0))
add('Rotor laminated core',rotor,ring(.42,.345,.075,.0255),7,(0,0,.11))
bars=[]
for i in range(28):
 bars.append(sweep([(.25+.34*j/12,.25+.076*math.cos(TAU*i/28+.10*j/12),.076*math.sin(TAU*i/28+.10*j/12)) for j in range(13)],.003,8))
add('Squirrel cage rotor bars',rotor,combine(*bars),1,(0,0,.17),28)
add('Rotor end rings',rotor,combine(ring(.244,.012,.080,.063),ring(.596,.012,.080,.063)),1,(.06,0,.17),2)
bearing('Motor DE bearing',2,.19,(-.12,.12,.14));bearing('Motor NDE bearing',2,.66,(.17,.12,.14))
add('Motor DE end shield',2,lathe([(-.027,.023),(.027,.023),(.027,.063),(.012,.063),(.012,.144),(-.002,.15),(-.014,.144),(-.014,.07),(-.027,.065)],(.19,.25,0)),0,(-.24,0,0),role='cover')
add('Motor NDE end shield',2,ring(.66,.03,.145,.023),0,(.24,0,0),role='cover')
fan=add('Cooling fan',2,combine(ring(.725,.018,.047,.022),orbitboxes(.724,.074,12,(.018,.04,.014))),4,(.33,0,0),13,detail='Hub and twelve fan paddles grouped.')
add('Fan cover',2,combine(ring(.752,.075,.16,.153),ring(.795,.005,.153,.03),orbitboxes(.80,.094,16,(.005,.105,.003))),0,(.44,0,0),role='cover',detail='Illustrative closed annular cover and radial grille members; ventilation opening represented by central bore.')
add('Motor tie bolts',2,orbitboxes(.43,.133,4,(.52,.009,.009)),1,(.32,-.14,0),4)
add('Motor terminal box',2,combine(box((.43,.435,0),(.19,.09,.17)),box((.43,.484,0),(.205,.008,.185))),0,(0,.34,0),2,'cover')
add('Motor mounting feet',2,combine(box((.29,.079,.12),(.12,.065,.07)),box((.55,.079,.12),(.12,.065,.07)),box((.29,.079,-.12),(.12,.065,.07)),box((.55,.079,-.12),(.12,.065,.07))),0,(0,-.08,0),4)
add('Pump support pedestal',1,combine(box((-.295,.09,0),(.19,.11,.18)),box((-.58,.08,0),(.10,.10,.19))),0,(0,-.09,0),2)
add('Machined baseplate',0,box((0,.025,0),(1.88,.04,.51)),2,(0,-.19,0),role='structural')
add('Mounting fasteners',0,combine(*[box((x,.060,z),(.026,.025,.026)) for x in [-.6,-.29,.29,.55] for z in [-.15,.15]]),1,(0,-.10,.1),8)

gltf={'asset':{'version':'2.0','generator':'Smart Factory original reference 3; MIT'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':nodes,'meshes':meshes,'materials':materials,'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
js=json.dumps(gltf,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
glb=struct.pack('<4sII',b'glTF',2,28+len(js)+len(binary))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(binary),b'BIN\0')+binary
(ROOT/'pump-motor.glb').write_bytes(glb)
local=json.loads((ROOT/'local-template.json').read_text());local.update(revision='smart-factory-illustrative-pump-motor-3',name='Detailed illustrative overhung pump and TEFC motor',components=components,sha256=hashlib.sha256(glb).hexdigest(),status='Detailed illustrative reference; no manufacturer or service-sequence claim',provenance='Original parametric Smart Factory geometry; scripts/equipment/reference_geometry.py; MIT. General construction references in docs/equipment-reference.md.');(ROOT/'local-template.json').write_text(json.dumps(local,indent=2)+'\n')
bom={'design':'Illustrative single-stage overhung end-suction pump, flexible coupling, TEFC squirrel-cage induction motor','rights':'Original geometry MIT; reference articles not redistributed','parts':components,'unavailable':['Manufacturer-specific tolerances, fits, fastener threads, insulation films, lubrication channels and electrical connection detail.'], 'inapplicable':['No gearbox, reciprocating parts, packed gland or external seal-flush system in this illustrative design.']}
(ROOT/'reference-bom.json').write_text(json.dumps(bom,indent=2)+'\n')
print(f'Reference 3: {len(components)} selectable BOM entries, {sum(a["count"]//3 for a in accessors if a["type"]=="SCALAR")} triangles, {len(glb)} bytes')

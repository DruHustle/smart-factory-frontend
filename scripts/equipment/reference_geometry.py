"""MIT original illustrative PM-ILL-4, metres, X shaft, +Y up.
Constructive solids, connected fluid voids, declared running clearances. Not
manufacturer CAD or a pressure/electrical/mechanical certification. Generate via
pinned requirements-geometry.txt and generate-artifacts.py. All v3 IDs retained.
"""
import sys, itertools
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from geometry_export import *
import manifold3d as md
import numpy as np
M=md.Manifold; C=md.CrossSection
solids={}; checks=[]
old_add=add

def unite(*objects): return M.batch_boolean(list(objects),md.OpType.Add)
def cyl(x,l,r,n=64): return M.cylinder(l,r,circular_segments=n,center=True).rotate((0,90,0)).translate((x,.25,0))
def rev(profile,x=0,n=64):
 points=[(r,a) for a,r in profile]
 if sum(points[i][0]*points[(i+1)%len(points)][1]-points[(i+1)%len(points)][0]*points[i][1] for i in range(len(points)))<0:points.reverse()
 return M.revolve(C([points],md.FillRule.NonZero),n).rotate((0,90,0)).translate((x,.25,0))
def ann(x,l,ro,ri,n=64,b=.001):
 b=min(b,l/4,(ro-ri)/4);h=l/2
 return rev([(-h,ri+b),(-h+b,ri),(h-b,ri),(h,ri+b),(h,ro-b),(h-b,ro),(-h+b,ro),(-h,ro-b)],x,n)
def cube(p,s,b=.001):
 # Chamfered box via convex hull of inset corners, no global tessellation inflation.
 h=np.array(s)/2;pts=[]
 for axis in range(3):
  for sign in [-1,1]:
   for a in [-1,1]:
    for c in [-1,1]:
     q=h-np.array([b,b,b]);q[axis]=h[axis];q[(axis+1)%3]*=a;q[(axis+2)%3]*=c;q[axis]*=sign;pts.append((q+np.array(p)).tolist())
 return M.hull_points(pts)
def shift(s,y=0,z=0): return s.translate((0,y,z))
def around(s,count): return [s.translate((0,-.25,0)).rotate((i*360/count,0,0)).translate((0,.25,0)) for i in range(count)]
def holes(s,x,l,pitch,count,r,phase=0):
 for i in range(count):
  t=TAU*i/count+phase;s=s-shift(cyl(x,l,r,24),pitch*math.cos(t),pitch*math.sin(t))
 return s

def rounded(points,radius=.004):
 out=[];count=len(points)
 for i,p in enumerate(points):
  p=np.array(p);a=np.array(points[(i-1)%count])-p;b=np.array(points[(i+1)%count])-p
  la=np.linalg.norm(a);lb=np.linalg.norm(b);a/=la;b/=lb
  if np.dot(a,b)<-.98:out.append(p);continue
  distance=min(radius,la*.4,lb*.4);start=p+a*distance;end=p+b*distance
  for t in np.linspace(0,1,5):out.append((1-t)**2*start+2*(1-t)*t*p+t*t*end)
 return out

def tube(points,r=.002,sides=8,closed=False):
 # Parallel-transport frame, with periodic seam and no duplicate closing caps.
 pts=np.array(points,dtype=float);n=len(pts)
 tang=np.roll(pts,-1,axis=0)-np.roll(pts,1,axis=0)
 if not closed: tang[0]=pts[1]-pts[0];tang[-1]=pts[-1]-pts[-2]
 tang/=np.linalg.norm(tang,axis=1)[:,None];frames=[]
 ref=np.array([1.,0,0]) if abs(tang[0,0])<.9 else np.array([0.,1,0]);v=np.cross(tang[0],ref);v/=np.linalg.norm(v)
 for i,d in enumerate(tang):
  if i:
   a=tang[i-1];axis=np.cross(a,d);sn=np.linalg.norm(axis);co=np.dot(a,d)
   if sn>1e-10:
    axis/=sn;v=v*co+np.cross(axis,v)*sn+axis*np.dot(axis,v)*(1-co)
  v-=d*np.dot(v,d);v/=np.linalg.norm(v);frames.append(v.copy())
 if closed:
  d=tang[0];a=tang[-1];axis=np.cross(a,d);sn=np.linalg.norm(axis);co=np.dot(a,d);v=frames[-1]
  if sn>1e-10:
   axis/=sn;v=v*co+np.cross(axis,v)*sn+axis*np.dot(axis,v)*(1-co)
  correction=math.atan2(np.dot(d,np.cross(v,frames[0])),np.dot(v,frames[0]))
  for i,d in enumerate(tang):
   angle=correction*i/n;v=frames[i];frames[i]=v*math.cos(angle)+np.cross(d,v)*math.sin(angle)
 vertices=[];faces=[]
 for i,p in enumerate(pts):
  v=frames[i];w=np.cross(tang[i],v)
  vertices.extend(p+r*(math.cos(TAU*j/sides)*v+math.sin(TAU*j/sides)*w) for j in range(sides))
 for i in range(n if closed else n-1):
  for j in range(sides):
   a=i*sides+j;b=i*sides+(j+1)%sides;c=((i+1)%n)*sides+j;d=((i+1)%n)*sides+(j+1)%sides
   faces.extend([(a,b,c),(b,d,c)])
 if not closed:
  for j in range(1,sides-1): faces.extend([(0,j+1,j),((n-1)*sides,(n-1)*sides+j,(n-1)*sides+j+1)])
 result=M(md.Mesh(np.asarray(vertices,dtype=np.float32),np.asarray(faces,dtype=np.uint32)))
 if result.status()!=md.Error.NoError: raise ValueError(('invalid tube',result.status()))
 return result

def add(name,parent,geo=None,mat=1,move=(0,0,0),qty=1,role='internal',detail='',**kwargs):
 if geo is not None:
  assert geo.status()==md.Error.NoError and geo.volume()>0,(name,geo.status())
  solids[name]=geo
  m=geo.calculate_normals(0,40).to_mesh();v=m.vert_properties
  geo=(v[:,:3].tolist(),v[:,3:6].tolist(),m.tri_verts.flatten().tolist())
 idx=old_add(name,parent,geo,mat,move,qty,role,detail,**kwargs)
 components[idx]['inventoryKind']='assembly' if geo is None else 'repeated part set' if qty>1 else 'individual part'
 components[idx]['source']='scripts/equipment/reference_geometry.py'
 return idx

def bolt(x,length,r=.004):
 # Shaft, chamfered hex head, socket recess, and separate through-bore washer.
 head=ann(x-length/2-.004,.008,r*1.9,.0004,n=6,b=.0006)-cyl(x-length/2-.006,.007,r*.9,6)
 return unite(cyl(x,length,r,16),head)
def nut(x,length,ro,ri):return ann(x,length,ro,.00001,n=6,b=.0005)-cyl(x,length+.002,ri,48)
def fasteners(x,length,pitch,count,r=.004):
 return unite(*around(shift(bolt(x,length,r),pitch),count),*around(shift(ann(x-length/2+.001,.002,r*2.25,r*1.08,24,b=.0003),pitch),count))
def gap(a,b,minimum,label):
 d=solids[a].min_gap(solids[b],minimum+.002);overlap=(solids[a]^solids[b]).volume()
 checks.append(dict(check=label,minimumMetres=minimum,measuredMetres=d,intersectionCubicMetres=overlap,passed=d>=minimum-1e-6 and overlap<1e-11))

# Pump: a single connected suction/volute/discharge void cut out of a solid casing.
wet=add('Wet end',1,move=(-.16,0,0))
outer=rev([(-.085,0),(.085,0),(.085,.18),(-.085,.18)],-.58,96)
# Spiral radial profile, asymmetry increases the collecting passage toward top outlet.
# The offset outer shell/void preserves >= 10 mm illustrative wall thickness.
fluid_outline=[((.152+.014*i/96)*math.cos(TAU*i/96),(.152+.014*i/96)*math.sin(TAU*i/96)) for i in range(97)]
void=M.extrude(C([fluid_outline],md.FillRule.NonZero),.126).rotate((0,90,0)).translate((-.643,.25,0))
outer=unite(outer,shift(cyl(-.58,.17,.187,96),.009))
neck=M.cylinder(.13,.05,circular_segments=64,center=True).rotate((90,0,0)).translate((-.55,.47,0))
port=M.cylinder(.19,.035,circular_segments=64,center=True).rotate((90,0,0)).translate((-.55,.46,0))
outer=unite(outer,neck)
void=unite(void,port,cyl(-.66,.13,.058),cyl(-.49,.11,.033))
casing=outer-void
casing=holes(casing,-.58,.25,.166,8,.0045,TAU/16)
add('Volute casing',wet,casing,0,(0,0,-.37),role='housing',detail='Connected spiral collecting passage with eccentric shell and discharge cut; 10 mm minimum wall, illustrative volute approximation, not hydraulic design.')
cover=holes(ann(-.681,.03,.19,.058,96),-.681,.08,.166,8,.0045,TAU/16)
add('Suction cover',wet,cover,0,(-.23,0,0),role='cover',rot=(0,0,.12),pivot=(-.68,.25,0))
suction=unite(ann(-.751,.11,.070,.052),ann(-.806,.014,.102,.052))
suction=holes(suction,-.806,.06,.085,4,.006,math.pi/4)
add('Suction nozzle flange',wet,suction,0,(-.35,0,0),role='housing',detail='52 mm bore; drilled 4 x 12 mm on 170 mm bolt circle. Field mating flange not supplied.')
dis=holes(unite(ann(0,.02,.08,.035),ann(-.02,.03,.05,.035)),0,.07,.064,4,.0055,math.pi/4).translate((0,-.25,0)).rotate((0,0,90)).translate((-.55,.57,0))
add('Discharge neck and flange',wet,dis,0,(0,.22,0),role='housing')
back=holes(ann(-.485,.02,.19,.031),-.485,.05,.166,8,.0045,TAU/16)
add('Back plate',wet,back,0,(.12,0,0),role='cover')
add('Casing gasket',wet,holes(ann(-.6655,.001,.183,.157,b=.0001),-.6655,.01,.166,8,.005,TAU/16),4,(-.17,0,0))
imp=add('Impeller',wet,move=(-.1,0,0))
add('Impeller rear shroud',imp,ann(-.535,.008,.145,.045,96),1,(.035,0,0))
add('Impeller front shroud',imp,ann(-.59,.008,.145,.060,96),1,(-.07,0,0))
blades=[]
for i in range(7):
 points=[]
 for side in [1,-1]:
  js=range(25) if side==1 else range(24,-1,-1)
  for j in js:
   u=j/24;r=.0454+.0976*u;t=TAU*i/7-.85*u+side*.0025/r;points.append((r*math.cos(t),r*math.sin(t)))
 blade=M.extrude(C([points],md.FillRule.NonZero),.047).rotate((0,90,0)).translate((-.586,.25,0));blades.append(blade)
add('Backward swept impeller vanes',imp,unite(*blades),1,(0,0,.17),7,detail='Seven 5 mm curved blades bridge shrouds; 11 mm radial collecting clearance.')
add('Impeller hub and lock nut',imp,unite(ann(-.55325,.0675,.045,.0221,n=96),nut(-.596,.018,.034,.0221)),1,(-.1,0,0),2)
train=add('Pump rotating train',1,move=(.07,0,.22))
# Shaft journal radii agree with 44 mm bearing bores; centre shoulder 50 mm.
shaft=rev([(-.614,0),(-.614,.022),(-.512,.022),(-.512,.025),(-.395,.025),(-.395,.022),(-.351,.022),(-.351,.025),(-.232,.025),(-.232,.022),(-.05,.022),(-.05,0)])
shaft=shaft-cube((-.08,.272,0),(.05,.008,.008),.0004)
add('Pump stepped shaft',train,shaft,1,(.14,0,0))
add('Shaft sleeve',train,ann(-.46,.085,.029,.0252),1,(.06,.11,0))
seal=add('Mechanical seal',1,move=(0,.22,.1))
add('Seal gland',seal,holes(ann(-.395,.014,.080,.038),-.395,.025,.053,4,.0035),1,(.08,0,0))
add('Stationary ceramic seat',seal,ann(-.459,.009,.043,.030),6,(-.03,0,0))
add('Rotating carbon face',seal,ann(-.45,.009,.043,.0295)-ann(-.45,.0024,.0318,.0289),4,(-.07,0,0))
add('Seal elastomer bellows',seal,rev([(-.018,.029),(.018,.029),(.018,.035),(.013,.037),(.008,.034),(.003,.037),(-.003,.034),(-.008,.037),(-.013,.034),(-.018,.037)],-.4275),4,(.1,0,0))
add('Seal compression spring',seal,tube([(-.444+.0345*i/100,.25+.04*math.cos(TAU*5*i/100),.04*math.sin(TAU*5*i/100)) for i in range(101)],.0015),1,(.16,0,0))
add('Seal O rings',seal,unite(ann(-.459,.002,.045,.0431),ann(-.45,.002,.0315,.0291)),4,(0,.075,0),2)
carrier=ann(-.285,.20,.082,.06115)
add('Pump bearing carrier',1,carrier,0,(0,0,-.28),role='housing')
def bearing(name,parent,x,move):
 g=add(name,parent,move=move)
 # Circular race grooves, 300 micron ball clearance, never toroidal false balls.
 xs=np.linspace(-.008,.008,17)
 inner=[(-.012,.0221),(.012,.0221),(.012,.037)]+[(float(a),min(.037,.041-math.sqrt(max(0,.0083**2-a*a)))) for a in reversed(xs)]+[(-.012,.037)]
 outer=[(-.012,.045)]+[(float(a),max(.045,.041+math.sqrt(max(0,.0083**2-a*a)))) for a in xs]+[(.012,.045),(.012,.061),(-.012,.061)]
 add(name+' inner race',g,rev(inner,x,64),1,(-.045,0,0))
 add(name+' outer race',g,rev(outer,x,64),1,(.045,0,0))
 balls=unite(*[M.sphere(.008,32).translate((x,.25+.041*math.cos(TAU*i/10),.041*math.sin(TAU*i/10))) for i in range(10)])
 add(name+' rolling elements',g,balls,1,(0,.055,0),10,detail='Ten solid balls; no pole bore. 300 micrometre radial groove allowance.')
 cage=unite(ann(x-.010,.002,.0446,.0374,48,b=.00025),ann(x+.010,.002,.0446,.0374,48,b=.00025),*[cube((x,.25+.041*math.cos(TAU*(i+.5)/10),.041*math.sin(TAU*(i+.5)/10)),(.0195,.003,.003),.0003) for i in range(10)])
 add(name+' cage',g,cage,5,(0,-.065,0),detail='Two bands and ten bridges located between balls, not through their centres.')
 gap(name+' rolling elements',name+' inner race',.00002,name+' ball/inner groove')
 gap(name+' rolling elements',name+' outer race',.00002,name+' ball/outer groove')
 gap(name+' rolling elements',name+' cage',.0001,name+' cage clearance')
 gap(name+' cage',name+' inner race',.00005,name+' cage/inner race clearance')
 gap(name+' cage',name+' outer race',.00005,name+' cage/outer race clearance')
 return g
bearing('Pump DE bearing',1,-.365,(.02,.17,.18));bearing('Pump NDE bearing',1,-.218,(.13,.17,.18))
add('Pump bearing spacers',1,unite(ann(-.325,.045,.032,.0251),ann(-.25,.025,.033,.0251)),1,(.15,-.08,.05),2)
add('Pump bearing end covers',1,unite(ann(-.379,.003,.061,.0495),holes(ann(-.178,.014,.083,.024),-.178,.03,.071,4,.0035)),0,(.1,-.16,0),2,'cover')
# Eight through bolts hold the cover/casing/backplate; head and washer touch the face.
fas=unite(fasteners(-.580,.236,.166,8),*around(shift(nut(-.469,.008,.0075,.0042),.166),8),*around(shift(ann(-.474,.002,.009,.0043,24,b=.0002),.166),8)).translate((0,-.25,0)).rotate((22.5,0,0)).translate((0,.25,0))
add('Pump casing bolt and washer set',wet,fas,1,(-.38,0,0),32,detail='Eight M8 illustrative through bolts, eight nuts and sixteen washers, matched drilled circle; threads omitted.')
coupling=add('Flexible coupling',0,move=(0,0,.34))
def jaw_sector(x,length,ri,ro,angle,width):
 pts=[(r*math.cos(t),r*math.sin(t)) for r,ts in [(ro,np.linspace(angle-width/2,angle+width/2,7)),(ri,np.linspace(angle+width/2,angle-width/2,7))] for t in ts]
 return M.extrude(C([pts],md.FillRule.NonZero),length).rotate((0,90,0)).translate((x-length/2,.25,0))
def hub(x,left):
 body=ann(x,.055,.052,.0221)
 jaws=[jaw_sector(-.0425 if left else -.0275,.065,.0355,.060,TAU*i/3+(0 if left else math.pi/3),math.radians(26)) for i in range(3)]
 body=unite(body,*jaws)-cube((x,.273,0),(.08,.007,.008),.0003)
 bore=M.cylinder(.04,.0031,circular_segments=20,center=True).rotate((90,0,0)).translate((x,.29,0))
 return body-bore
add('Pump coupling hub',coupling,hub(-.097,True),1,(-.09,0,0))
add('Motor coupling hub',coupling,hub(.027,False),1,(.09,0,0))
spider=unite(ann(-.035,.022,.0353,.023),*[jaw_sector(-.035,.022,.0349,.057,TAU*(i+.5)/6,math.radians(33.5)) for i in range(6)])
add('Elastomer coupling spider',coupling,spider,4,(0,.12,0))
# Open bottom guard with integral drilled mounting flanges.
guard=ann(-.035,.24,.100,.096)-cube((-.035,.10,0),(.3,.30,.3),0)
for z in [-.098,.098]:guard=unite(guard,cube((-.035,.2125,z),(.24,.076,.004),.0003))
for z in [-.108,.108]:
 foot=cube((-.035,.172,z),(.26,.006,.027))
 for x in [-.13,.06]:foot=foot-M.cylinder(.03,.0035, circular_segments=20,center=True).rotate((90,0,0)).translate((x,.172,math.copysign(.112,z)))
 guard=unite(guard,foot)
add('Coupling safety guard',coupling,guard,5,(0,0,-.4),role='cover',detail='4 mm open-bottom shell, removable on four drilled flange mounts and brackets.')
add('Shaft keys and retention',coupling,unite(cube((-.08,.273,0),(.045,.006,.008),.0004),cube((.038,.273,0),(.04,.006,.008),.0004),*[M.cylinder(.027,.003,circular_segments=16,center=True).rotate((90,0,0)).translate((x,.2895,0)) for x in [-.097,.027]]),1,(0,.09,0),4,detail='Two fitted keys and two radial set screws in matching hub bores; thread helices omitted.')
# Motor: 0.8 mm minimum rotor/stator running gap, 24 slots, 12 full-pitch equivalent bundles.
housing=unite(ann(.42,.43,.145,.129),*[ann(.42+(i-7)*.027,.005,.162,.143) for i in range(15)])
housing=holes(housing,.42,.8,.136,4,.0048,math.pi/4)-cube((.43,.42,0),(.15,.06,.12),0)-cube((.43,.44,0),(.192,.07,.172),0)
add('Motor finned housing',2,housing,0,(0,0,-.38),role='housing')
stator=add('Stator assembly',2,move=(0,.24,0))
add('Stator laminated core',stator,ann(.42,.34,.127,.108,144,b=.0003),7,(0,.1,0))
def sector(ri,ro,a,width):
 pts=[(r*math.cos(t),r*math.sin(t)) for r,ts in [(ro,np.linspace(a-width/2,a+width/2,7)),(ri,np.linspace(a+width/2,a-width/2,7))] for t in ts]
 return M.extrude(C([pts],md.FillRule.NonZero),.34).rotate((0,90,0)).translate((.25,.25,0))
add('Stator teeth',stator,unite(*[sector(.0813,.10795,TAU*i/24,math.radians(10)) for i in range(24)]),7,(0,.16,0),24)
for phase in range(3):
 coils=[]
 for j in range(4):
  k=j*3+phase;t=TAU*(k+.5)/24;r=.100;re=.114+phase*.002
  left=.243-k*.0054;right=.608+k*.0054
  # Each closed path has two straight slot legs and end turns outside the stack.
  points=[(left,.25+r*math.cos(t),r*math.sin(t)),(right,.25+r*math.cos(t),r*math.sin(t))]
  points.extend((right,.25+rr*math.cos(t),rr*math.sin(t)) for rr in [re])
  points.extend((right,.25+re*math.cos(a),re*math.sin(a)) for a in np.linspace(t,t+math.pi,37)[1:])
  points.extend((right,.25+rr*math.cos(t+math.pi),rr*math.sin(t+math.pi)) for rr in [r])
  points.append((left,.25+r*math.cos(t+math.pi),r*math.sin(t+math.pi)))
  points.extend((left,.25+rr*math.cos(t+math.pi),rr*math.sin(t+math.pi)) for rr in [re])
  points.extend((left,.25+re*math.cos(a),re*math.sin(a)) for a in np.linspace(t+math.pi,t+TAU,37)[1:])
  points.extend((left,.25+rr*math.cos(t),rr*math.sin(t)) for rr in [])
  coils.append(tube(rounded(points),.0023,8,True))
 add('Winding phase '+str(phase+1),stator,unite(*coils),3,(0,.22+phase*.055,0),4,detail='Four closed full-pitch equivalent conductor bundles per phase; 24 occupied slots. End turns lie outside lamination stack on separated axial planes. Individual wire turns and insulating varnish not resolved.')
rotor=add('Rotor assembly',2,move=(.1,0,.2))
ms=rev([(.002,0),(.002,.022),(.20,.022),(.20,.025),(.64,.025),(.64,.022),(.78,.022),(.78,0)])-cube((.038,.272,0),(.045,.008,.008),.0004)
add('Motor shaft',rotor,ms,1,(.22,0,0))
core=ann(.42,.34,.079,.0251,96)
bars=[]
for i in range(28):
 pts=[(.25+.34*j/12,.25+.075*math.cos(TAU*i/28+.10*j/12),.075*math.sin(TAU*i/28+.10*j/12)) for j in range(13)]
 bars.append(tube(pts,.0028,8)^cube((.42,.25,0),(.34,.4,.4),0));core=core-tube(pts,.003,8)
add('Rotor laminated core',rotor,core,7,(0,0,.11))
add('Squirrel cage rotor bars',rotor,unite(*bars),1,(0,0,.17),28,detail='28 skewed conductor bars in matching core openings, joined to two end rings.')
add('Rotor end rings',rotor,unite(ann(.244,.012,.0805,.063),ann(.596,.012,.0805,.063)),1,(.06,0,.17),2)
bearing('Motor DE bearing',2,.158,(-.12,.12,.14));bearing('Motor NDE bearing',2,.711,(.17,.12,.14))
def shield(x,reverse=False):
 shell=ann(x,.010,.145,.023)
 boss=ann(.717 if reverse else x+.022,.038 if reverse else .034,.070,.06115)
 end=.635 if reverse else .205
 cup=ann((x+end)/2,abs(end-x),.145,.129)
 return holes(unite(shell,boss,cup),x,1.6,.136,4,.0048,math.pi/4)
add('Motor DE end shield',2,shield(.132),0,(-.24,0,0),role='cover')
add('Motor NDE end shield',2,shield(.741,True),0,(.24,0,0),role='cover')
fan=unite(ann(.766,.015,.041,.0221),*around(cube((.766,.328,0),(.017,.080,.008)),12))
add('Cooling fan',2,fan,4,(.33,0,0),1,detail='One moulded fan with hub and 12 integral radial paddles, inside ventilated cover.')
fc=unite(ann(.784,.082,.16,.153),ann(.827,.005,.153,.027))
# Sixteen radial through slots leave a ring at centre and outer rim.
for i in range(16):
 slot=cube((.828,.344,0),(.02,.092,.013),.0015).translate((0,-.25,0)).rotate((i*22.5,0,0)).translate((0,.25,0));fc=fc-slot
# Sidewall ventilation around the shell, distinct from front grille.
for i in range(12):
 slot=cube((.785,.405,0),(.037,.03,.018),.002).translate((0,-.25,0)).rotate((i*30,0,0)).translate((0,.25,0));fc=fc-slot
add('Fan cover',2,fc,0,(.44,0,0),role='cover',detail='7 mm shell; sixteen true front grille slots and twelve side ventilation openings.')
ties=unite(fasteners(.4425,.635,.136,4),*around(shift(ann(.747,.002,.009,.0043,24,b=.0002),.136),4),*around(shift(nut(.752,.008,.0075,.0042),.136),4)).translate((0,-.25,0)).rotate((45,0,0)).translate((0,.25,0))
add('Motor tie bolts',2,ties,1,(.32,-.14,0),16,detail='Four through bolts, four nuts and eight washers in matching axial passages; thread helices omitted.')
# Preserve terminal-box ID while separating cover, hollow body and terminal hardware.
terminal=add('Motor terminal box',2,move=(0,.34,0))
body=cube((.43,.448,0),(.19,.086,.17),.003)-cube((.43,.455,0),(.178,.084,.158),.001)
body=unite(body,cube((.43,.398,0),(.15,.016,.12),.0005))
for x in [.346,.514]:
 for z in [-.074,.074]:
  boss=M.cylinder(.02,.006,circular_segments=24,center=True).rotate((90,0,0)).translate((x,.481,z))
  bore=M.cylinder(.03,.0033,circular_segments=20,center=True).rotate((90,0,0)).translate((x,.481,z))
  body=unite(body,boss)-bore
# Cable entry through side wall.
body=body-M.cylinder(.03,.014,circular_segments=32,center=True).translate((.43,.444,.082))
add('Terminal box body',terminal,body,0,(0,.03,0),role='housing')
cover=cube((.43,.495,0),(.204,.008,.184),.002)
for x in [.346,.514]:
 for z in [-.074,.074]:cover=cover-M.cylinder(.02,.0035,circular_segments=20,center=True).rotate((90,0,0)).translate((x,.495,z))
add('Terminal box cover',terminal,cover,0,(0,.13,0),role='cover')
add('Terminal board',terminal,cube((.43,.423,0),(.13,.009,.10)),6,(0,.045,0))
add('Terminal studs and links',terminal,unite(*[M.cylinder(.022,.004,circular_segments=12,center=True).rotate((90,0,0)).translate((x,.4385,z)) for x in [.385,.43,.475] for z in [-.027,.027]],*[cube((x,.444,0),(.013,.003,.061),.0005) for x in [.385,.43,.475]]),5,(0,.075,0),9)
feet=[]
for x in [.29,.55]:
 for z in [-.12,.12]:
  f=cube((x,.077,z),(.12,.064,.078),.003)
  web=cube((x,.132,math.copysign(.093,z)),(.085,.08,.024),.002)-cyl(x,.2,.145)
  f=unite(f,web)
  f=f-M.cylinder(.3,.0065,circular_segments=24,center=True).rotate((90,0,0)).translate((x,.077,z));feet.append(f-solids['Motor finned housing'])
add('Motor mounting feet',2,unite(*feet),0,(0,-.08,0),4)
ped=[]
for x,w,top in [(-.295,.18,.185),(-.58,.10,.090)]:
 p=cube((x,(top+.045)/2,0),(w,top-.045,.31 if x==-.295 else .27),.002)
 p=p-(solids['Pump bearing carrier'] if x==-.295 else outer)
 for z in [-.12,.12]:p=p-M.cylinder(.3,.0065,circular_segments=24,center=True).rotate((90,0,0)).translate((x,.096,z))
 ped.append(p)
add('Pump support pedestal',1,unite(*ped),0,(0,-.09,0),2)
base=cube((0,.025,0),(1.88,.04,.51),.006)
for x in [-.58,-.295,.29,.55]:
 for z in [-.12,.12]:base=base-M.cylinder(.1,.0065,circular_segments=24,center=True).rotate((90,0,0)).translate((x,.025,z))
add('Machined baseplate',0,base,2,(0,-.19,0),role='structural')
mount=[]
for x,top in [(-.58,.090),(-.295,.185),(.29,.109),(.55,.109)]:
 for z in [-.12,.12]:
  # Vertical bolt from plate underside to upper pad; head at upper face.
  b=bolt(0,top-.025,.006).translate((0,-.25,0)).rotate((0,0,-90)).translate((x,(top+.025)/2+.002,z))
  w=M.cylinder(.002,.012,circular_segments=24,center=True).rotate((90,0,0)).translate((x,top+.001,z))-M.cylinder(.01,.0065,circular_segments=24,center=True).rotate((90,0,0)).translate((x,top+.001,z))
  mount.extend([b,w])
add('Mounting fasteners',0,unite(*mount),1,(0,-.10,.1),16)
# Add matching gland/end-cover retention screws and actual guard brackets.
gland_screw=unite(cyl(-.400,.028,.003,16),ann(-.384,.004,.0057,.0004,n=6,b=.0004)-cyl(-.383,.004,.0027,6))
add('Seal gland screws',seal,unite(*around(shift(gland_screw,.053),4)),1,(.18,0,0),4)
brackets=[]
for x in [-.13,.06]:
 for z in [-.112,.112]:brackets.append(cube((x,.107,z),(.03,.124,.03))-M.cylinder(.05,.0033,circular_segments=20,center=True).rotate((90,0,0)).translate((x,.166,z)))
add('Guard mounting brackets',coupling,unite(*brackets),2,(0,-.08,0),4)

add('Seal chamber and seat support',1,holes(unite(ann(-.4385,.073,.080,.047),ann(-.459,.014,.048,.0431)-ann(-.459,.0024,.0453,.0429)),-.404,.04,.053,4,.0033),0,(0,0,-.24),role='housing',detail='Hollow chamber connects the back plate and gland; ceramic seat retained at the bore shoulder.')
add('Seal shaft retaining collar',seal,ann(-.405,.006,.042,.0291),1,(.2,0,0))
add('Coupling guard screws',coupling,unite(*[bolt(0,.021,.003).translate((0,-.25,0)).rotate((0,0,-90)).translate((x,.1645,z)) for x in [-.13,.06] for z in [-.112,.112]]),1,(0,.10,0),4)
add('Terminal cover screws',terminal,unite(*[bolt(0,.02,.003).translate((0,-.25,0)).rotate((0,0,-90)).translate((x,.489,z)) for x in [.346,.514] for z in [-.074,.074]]),1,(0,.16,0),4)
gap('Pump stepped shaft','Pump DE bearing inner race',.00009,'Pump DE journal/bore')
gap('Pump stepped shaft','Pump NDE bearing inner race',.00009,'Pump NDE journal/bore')
gap('Pump support pedestal','Volute casing',0,'Front saddle/casing contact')
gap('Pump support pedestal','Pump bearing carrier',0,'Rear saddle/carrier contact')
gap('Motor mounting feet','Motor finned housing',0,'Motor feet/housing contact')
# Mechanical checks use authored solids, not assertions on labels or triangle count.
for phase in range(1,4):
 for part in ['Motor finned housing','Stator laminated core','Stator teeth','Rotor laminated core','Rotor end rings','Motor DE end shield','Motor NDE end shield']:
  gap('Winding phase '+str(phase),part,.0001,f'Phase {phase} / {part}')
for i in [1,2]:
 for j in range(i+1,4):gap('Winding phase '+str(i),'Winding phase '+str(j),.0001,f'Phase {i}/{j} bundle separation')
gap('Rotor end rings','Stator teeth',.0007,'Minimum end-ring air gap')
gap('Impeller front shroud','Volute casing',.005,'Impeller/casing running clearance')
checks.append(dict(check='Connected wet-end void including discharge',passed=len(void.decompose())==1,connectedVolumes=len(void.decompose())))
# Check mating contact and every inter-part pair, including hidden passages.
for a,b,label in [
 ('Volute casing','Discharge neck and flange','Discharge joint'),
 ('Casing gasket','Suction cover','Suction gasket/cover'),
 ('Casing gasket','Volute casing','Suction gasket/casing'),
 ('Back plate','Seal chamber and seat support','Backplate/chamber joint'),
 ('Seal gland','Seal chamber and seat support','Gland/chamber joint'),
 ('Stationary ceramic seat','Rotating carbon face','Seal mating faces'),
 ('Terminal box body','Motor finned housing','Terminal saddle contact'),
 ('Motor tie bolts','Motor DE end shield','Tie-bolt DE washer contact'),
 ('Motor tie bolts','Motor NDE end shield','Tie-bolt NDE washer contact'),
 ('Guard mounting brackets','Coupling safety guard','Guard bracket contact'),
 ('Coupling guard screws','Coupling safety guard','Guard screw seat'),
 ('Terminal cover screws','Terminal box cover','Terminal screw seat'),
 ('Mounting fasteners','Motor mounting feet','Motor mounting screw seat')]:
 distance=solids[a].min_gap(solids[b],.001)
 checks.append(dict(check=label,measuredMetres=distance,maximumMetres=.00002,passed=distance<=.00002))
for name,expected in [('Volute casing',1),('Discharge neck and flange',1),('Motor finned housing',1),('Cooling fan',1),('Coupling safety guard',1),('Terminal box body',1),('Motor mounting feet',4),('Pump support pedestal',2),('Rotor laminated core',1),('Stator laminated core',1)]+[(n+' cage',1) for n in ['Pump DE bearing','Pump NDE bearing','Motor DE bearing','Motor NDE bearing']]+[('Winding phase '+str(i),4) for i in range(1,4)]:
 actual=len(solids[name].decompose())
 checks.append(dict(check=name+' connected solid count',expected=expected,actual=actual,passed=actual==expected))
interference=[];tested_pairs=0
for (a,one),(b,two) in itertools.combinations(solids.items(),2):
 first=one.bounding_box();second=two.bounding_box()
 if any(min(first[i+3],second[i+3])-max(first[i],second[i])<=1e-9 for i in range(3)):continue
 tested_pairs+=1;overlap=(one^two).volume()
 if overlap>1e-10:interference.append(dict(first=a,second=b,cubicMetres=overlap))
checks.append(dict(check='All authored inter-part solid overlaps',totalPairs=len(solids)*(len(solids)-1)//2,testedPairs=tested_pairs,volumeThresholdCubicMetres=1e-10,unintendedIntersections=interference,passed=not interference))
previous=json.loads((ROOT/'revisions/3/template.json').read_text())
assert {p['templateComponentId'] for p in previous['components']} <= {p['templateComponentId'] for p in components}, 'lost v3 IDs'
for c in components[:3]:c['inventoryKind']='assembly';c['designation']='PM-ILL-4' if c['name']=='Assembly' else c['designation']
assert all(c['passed'] for c in checks),[c for c in checks if not c['passed']]
# Fine geometry is exported once per selectable set; no external URI or texture.
gltf={'asset':{'version':'2.0','generator':'Smart Factory original constructive reference 4; MIT'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':nodes,'meshes':meshes,'materials':materials,'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
js=json.dumps(gltf,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
glb=struct.pack('<4sII',b'glTF',2,28+len(js)+len(binary))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(binary),b'BIN\0')+binary
(ROOT/'pump-motor.glb').write_bytes(glb)
local=json.loads((ROOT/'local-template.json').read_text());local.update(revision='smart-factory-illustrative-pump-motor-4',name='Detailed illustrative overhung pump and TEFC motor',components=components,sha256=hashlib.sha256(glb).hexdigest(),status='Original illustrative constructive reference; no manufacturer verification',provenance='Original Smart Factory parametric constructive solids; MIT; scripts/equipment/reference_geometry.py.');(ROOT/'local-template.json').write_text(json.dumps(local,indent=2)+'\n')
bom={'design':'Illustrative overhung end-suction pump / jaw coupling / TEFC induction motor','rights':'Original MIT geometry; ordinary Manifold3D authoring dependency, no supplier CAD','units':'m','shaftAxis':'+X','upAxis':'+Y','parts':components,'simplifications':['Collecting chamber uses a stepped spiral approximation with eccentric shell; no hydraulic performance claim.','Equivalent 12 closed copper bundles, not turn-by-turn electrical winding; slot liner films and phase lead routing unresolved.','Fastener thread helices omitted; shaft and coupling keys representative, no fit class or torque rating.','No manufacturer dimensional, strength, thermal, electrical or pressure verification.','Seals/bearing interference and preload not certified; numerical checks cover stated illustrative clearances only.']}
(ROOT/'reference-bom.json').write_text(json.dumps(bom,indent=2)+'\n')
audit={'revision':local['revision'],'sha256':local['sha256'],'triangles':sum(a['count']//3 for a in accessors if a['type']=='SCALAR'),'bytes':len(glb),'inventory':{'selectableEntries':len(components),'assemblies':sum(c['inventoryKind']=='assembly' for c in components),'individualParts':sum(c['inventoryKind']=='individual part' for c in components),'repeatedSets':sum(c['inventoryKind']=='repeated part set' for c in components)},'solidValidation':{'method':'Manifold3D status and positive volume for every exported solid','solids':len(solids),'passed':True},'checks':checks,'limitations':bom['simplifications']}
(ROOT/'geometry-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
assert all(c['passed'] for c in checks),[c for c in checks if not c['passed']]
print(f'Reference 4: {audit["inventory"]}, {audit["triangles"]} triangles, {len(glb)} bytes; {sum(c["passed"] for c in checks)}/{len(checks)} clearance/continuity checks')

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

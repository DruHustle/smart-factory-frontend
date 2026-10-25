"""Self-authored illustrative fixtures. No equipment CAD, collision or kinematic claim."""
from pathlib import Path
from uuid import UUID, uuid5
import hashlib
import json
import struct
import io
from basyx.aas import model
from basyx.aas.adapter import json as aas_json, aasx
from aas_core3 import jsonization, verification

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'fixtures/equipment'
NS = UUID('5760d716-6140-47a2-a911-fcb3dc244c85')
def ident(s): return str(uuid5(NS, s))
def dump(name,v): (OUT/name).write_text(json.dumps(v,indent=2)+'\n')
def sha(b): return hashlib.sha256(b).hexdigest()

# Source geometry is entirely local and editable.
import runpy
glb=runpy.run_path(str(Path(__file__).with_name('reference_geometry.py')))['glb']
maintenance='''Smart Factory pump/motor demonstrator — revision 3
Original synthetic reference, authored for integration testing. Not an equipment service manual.
Applicable components: Pump and Motor in model revision illustrative-3.
Illustrative technical properties: pump pressure 5 bar; motor power 1.5 kW; speed 1450 1/min.
Scenario thresholds are test inputs, not approved operating limits.
For a simulated temperature or vibration threshold crossing, inspect the matching component's time, quality and scenario run before comparing recovery samples.
Disconnected/unknown data is not proof of safe operation. Obtain the actual manufacturer's manual and approved isolation procedure before any real maintenance.
The visualization mesh is not dimensional CAD, robot collision geometry or kinematic data.
'''
(OUT/'maintenance.txt').write_text(maintenance)
equipment=[];mappings=[];node_maps=[]
for number in (1,2):
 prefix=f'pump-set-{number:02d}';eid=ident(prefix);assembly=ident(prefix+':assembly');pump=ident(prefix+':pump');motor=ident(prefix+':motor')
 def binding(key,c,meaning,unit): return {'sourceKey':key,'componentId':c,'metric':{'metricId':meaning,'meaning':meaning,'valueType':'number','unit':unit,'expectedIntervalMs':1000},'sourceUnit':unit}
 r={'equipmentId':eid,'externalAssetId':'urn:smart-factory:demo:'+prefix,'deviceId':'onesa-demo-gateway','name':f'Illustrative pump set {number:02d}','assetTypeId':'urn:smart-factory:type:pump-motor-v1','serialNumber':f'SIM-PM-{number:03d}',
 'components':[{'componentId':assembly,'name':'Assembly','parentComponentId':None},{'componentId':pump,'name':'Pump','parentComponentId':assembly},{'componentId':motor,'name':'Motor','parentComponentId':assembly}],
 'bindings':[binding('pressure',pump,'pressure','bar'),binding('temperature',motor,'temperature','Cel'),binding('rpm',motor,'rotational_speed','1/min'),binding('vibration',pump,'vibration_velocity','mm/s')]}
 equipment.append(r)
 mappings.append({'equipmentId':eid,'expectedVersion':1,'retired':False,'targets':[{'componentId':c['componentId'],'equipmentId':f'proposed-{prefix}','targetComponentId':f'proposed-{prefix}-{c["name"].lower()}'} for c in r['components']]})
 node_maps.append({'equipmentId':eid,'modelRevision':'illustrative-3','nodes':[{'componentId':assembly,'scene':0,'nodeIndex':0,'nodePath':'/Assembly'},{'componentId':pump,'scene':0,'nodeIndex':1,'nodePath':'/Assembly/Pump'},{'componentId':motor,'scene':0,'nodeIndex':2,'nodePath':'/Assembly/Motor'}],'documentComponents':[pump,motor]})
dump('equipment.json',equipment);dump('mappings.json',mappings)
dump('model-manifest.json',{'status':'proposed mappings; no consumer model contract','revision':'illustrative-3','file':'pump-motor.glb','sha256':sha(glb),'provenance':'Self-authored by Smart Factory integration fixture generator; repository MIT license','units':'m','handedness':'right','upAxis':'+Y','forwardAxis':'+Z','modelToEquipmentTransform':[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], 'purpose':'Illustration only; not CAD, collision or kinematics','equipment':node_maps,'documents':[{'file':'maintenance.txt','revision':'1','sha256':sha(maintenance.encode()),'rights':'Original synthetic reference; repository MIT license'}], 'modelProvisionReference':'IDTA 02026-1-0 Provision of 3D Models; custom application submodel, no template conformance claimed'})

store=model.DictObjectStore();files=aasx.DictSupplementaryFileContainer()
for name,mime in [('pump-motor.glb','model/gltf-binary'),('maintenance.txt','text/plain'),('model-manifest.json','application/json')]:
 files.add_file('/artifacts/'+name,io.BytesIO((OUT/name).read_bytes()),mime)
def prop(name,value): return model.Property(id_short=name,value_type=str,value=str(value))
for r in equipment:
 sm=model.Submodel(id_='urn:smart-factory:submodel:'+r['equipmentId'],id_short='IntegrationContext',description=model.MultiLanguageTextType({'en':'Application-specific extension. IDTA 02026 informs model provision; not a conforming 02026 template.'}))
 elements=[prop('EquipmentId',r['equipmentId']),prop('ExternalAssetId',r['externalAssetId']),prop('EquipmentTypeId',r['assetTypeId']),prop('SerialNumber',r['serialNumber']),prop('DisplayName',r['name']),prop('Classification','simulated'),prop('IllustrativeRatedPressure','5 bar'),prop('IllustrativeRatedPower','1.5 kW'),prop('IllustrativeRatedSpeed','1450 1/min'),prop('ModelRevision','illustrative-3'),prop('ModelSha256',sha(glb)),prop('CoordinateConvention','metres; right-handed; +Y up; +Z forward')]
 for c in r['components']:
  elements.append(model.SubmodelElementCollection(id_short=c['name'],value=[prop('ComponentId',c['componentId']),prop('ParentComponentId',c['parentComponentId'] or r['equipmentId']),prop('SceneNodePath','/Assembly'+('/'+c['name'] if c['name']!='Assembly' else ''))]))
 elements.extend([model.File(id_short='IllustrativeModel',content_type='model/gltf-binary',value='/artifacts/pump-motor.glb'),model.File(id_short='MaintenanceDocument',content_type='text/plain',value='/artifacts/maintenance.txt'),model.File(id_short='RevisionMapping',content_type='application/json',value='/artifacts/model-manifest.json'),prop('TelemetryBinding',json.dumps(r['bindings'],sort_keys=True))])
 for el in elements: sm.submodel_element.add(el)
 shell=model.AssetAdministrationShell(id_='urn:smart-factory:aas:'+r['equipmentId'],id_short='PumpSet'+r['serialNumber'][-3:],asset_information=model.AssetInformation(asset_kind=model.AssetKind.INSTANCE,global_asset_id=r['externalAssetId'],asset_type=r['assetTypeId']),submodel={model.ModelReference.from_referable(sm)})
 store.add(shell);store.add(sm)
aas_json.write_aas_json_file(OUT/'demonstrator.aas.json',store)
with aasx.AASXWriter(OUT/'demonstrator.aasx') as writer: writer.write_aas(aas_ids=[s.id for s in store if isinstance(s,model.AssetAdministrationShell)],object_store=store,file_store=files,write_json=True)
# Independent generated AAS 3.0 metamodel validation, beyond SDK round trip.
env=jsonization.environment_from_jsonable(json.loads((OUT/'demonstrator.aas.json').read_text()))
errors=list(verification.verify(env));assert not errors, '\n'.join(map(str,errors))
roundtrip=model.DictObjectStore();extracted=aasx.DictSupplementaryFileContainer()
with aasx.AASXReader(OUT/'demonstrator.aasx') as reader: reader.read_into(roundtrip,extracted)
assert len(roundtrip)==4

# Existing real Onesa synthetic-file importer route, kept separate from the proposed twin contract.
r=equipment[0];aid=r['externalAssetId'];text=maintenance[:3500]
signals=[]
for i,(p,t) in enumerate([(2.0,45.0),(7.0,90.0),(2.0,46.0)]):
 for signal,unit,value in [('pressure','bar',p),('temperature','degC',t)]:
  signals.append({'id':f'sim-{signal}-{i}','asset_id':aid,'signal':signal,'unit':unit,'timestamp':f'2026-10-20T09:00:0{i}Z','value':value,'sample_seconds':1,'freshness_seconds':3,'quality':'good','source':'smart-factory-simulated-scenario-v1','version':'1'})
dump('onesa-synthetic-evidence.json',{'format_version':'onesa-industrial-evidence-v1','classification':'synthetic','source_id':ident('synthetic-evidence-source'),'source_timezone':'UTC','asset':{'id':aid,'metadata_version':'1','name':r['name'],'equipment_type':'illustrative pump and motor','provenance':'Original Smart Factory deterministic simulator; no real equipment'},'window':{'start':'2026-10-20T09:00:00Z','end':'2026-10-20T09:00:04Z'},'evidence':{'fixture_version':'onesa-industrial-import-v1','asset_id':aid,'metadata_version':'1','events':[],'signals':signals,'references':[{'id':'maintenance','version':'1','asset_id':aid,'anchor':'pump-motor','title':'Illustrative maintenance reference','text':text,'rights':'Original Smart Factory synthetic reference; MIT','effective_start':'2026-01-01T00:00:00Z','effective_end':'2027-01-01T00:00:00Z','superseded':False,'sha256':sha(text.encode())}]}})
local=json.loads((OUT/'local-template.json').read_text())
local['revision']='smart-factory-illustrative-pump-motor-3';local['sha256']=sha(glb);local['maintenanceText']=maintenance
(OUT/'local-template.json').write_text(json.dumps(local,indent=2)+'\n')
print('Generated two installed instances; AAS 3.0 metamodel verified; BaSyx AASX round trip passed')

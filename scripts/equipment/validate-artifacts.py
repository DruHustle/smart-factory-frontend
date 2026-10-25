"""Validate committed bytes without regenerating or trusting a custom AAS shape."""
from pathlib import Path
import hashlib,json,struct,io
from basyx.aas import model
from basyx.aas.adapter import aasx
from aas_core3 import jsonization,verification
root=Path(__file__).resolve().parents[2]/'fixtures/equipment'
v=json.loads((root/'demonstrator.aas.json').read_text());environment=jsonization.environment_from_jsonable(v)
errors=list(verification.verify(environment));assert not errors,'\n'.join(map(str,errors))
store=model.DictObjectStore();files=aasx.DictSupplementaryFileContainer()
with aasx.AASXReader(root/'demonstrator.aasx') as reader: reader.read_into(store,files)
assert len(store)==4
manifest=json.loads((root/'model-manifest.json').read_text())
for name in ['pump-motor.glb','maintenance.txt']:
 expected=manifest['sha256'] if name.endswith('.glb') else manifest['documents'][0]['sha256']
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==expected
 assert files.get_content_type('/artifacts/'+name)
 content=io.BytesIO();files.write_file('/artifacts/'+name,content);assert content.getvalue()==(root/name).read_bytes()
assert len(v['assetAdministrationShells'])==2
assert all(s['assetInformation']['assetKind']=='Instance' for s in v['assetAdministrationShells'])
print('PASS: independent AAS 3.0 verification, two instance identities, AASX references and embedded artifact bytes')

local=json.loads((root/'local-template.json').read_text())
bom=json.loads((root/'reference-bom.json').read_text())
audit=json.loads((root/'geometry-audit.json').read_text())
assert local['sha256']==audit['sha256']==manifest['sha256']
assert local['components']==bom['parts']
assert all(c['passed'] for c in audit['checks'])
previous=json.loads((root/'revisions/3/template.json').read_text())
assert {p['templateComponentId'] for p in previous['components']} <= {p['templateComponentId'] for p in local['components']}
assert audit['bytes']==(root/'pump-motor.glb').stat().st_size
print(f"PASS: v4 BOM/hash consistency, stable v3 identities, {len(audit['checks'])} authored clearance/continuity checks")

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

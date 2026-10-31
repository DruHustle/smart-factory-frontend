import importlib.util
from pathlib import Path
import struct
import sys
import json
import unittest
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from material_policy import adapt_material
from finalize_materials import revise_glb

class MaterialSafety(unittest.TestCase):
    def test_unsupported_metal_is_not_white_plastic(self):
        c,m,r,reason=adapt_material("Browser_m_opaque__metal__aluminium_brushed_a01",[.8,.8,.8,1],0,.5)
        self.assertLess(max(c[:3]),.6); self.assertGreater(m,.5); self.assertIsNotNone(reason)
    def test_rubber_dark_and_paint_distinct(self):
        rubber=adapt_material("Browser_m_opaque__rubber__black_glossy_a01.003",[.8,.8,.8,1],0,.5)
        rack=adapt_material("Browser_opaque__metal__painted_unique_rack_a",[.8,.8,.8,1],0,.5)
        self.assertLess(max(rubber[0][:3]),.03); self.assertGreater(rack[0][2],rack[0][0])
    def test_imported_authored_values_are_preserved(self):
        for color,metal,rough in [([.01,.03,.3,1],0,.5),([.8,.8,.8,1],.9,.5),([.8,.8,.8,1],0,.2)]:
            self.assertEqual(adapt_material("Browser_opaque__metal__steel_a",color,metal,rough),(color,metal,rough,None))
    def test_binary_geometry_and_ids_unchanged_and_policy_is_idempotent(self):
        doc={"asset":{"version":"2.0"},"nodes":[{"name":"stable_part"}],"meshes":[{"primitives":[]}],"materials":[{"name":"Browser_opaque__rubber__black_a","pbrMetallicRoughness":{"baseColorFactor":[.8,.8,.8,1],"metallicFactor":0,"roughnessFactor":.5}}]}
        j=json.dumps(doc).encode();j+=b' '*(-len(j)%4);binary=b'BIN\x00'+b'geometry-data-00'
        tail=struct.pack('<I',len(binary)-4)+binary
        raw=b'glTF'+struct.pack('<II',2,20+len(j)+len(tail))+struct.pack('<I',len(j))+b'JSON'+j+tail
        changed,records=revise_glb(raw); self.assertEqual(len(records),1);self.assertTrue(changed.endswith(tail))
        length=struct.unpack_from('<I',changed,12)[0];out=json.loads(changed[20:20+length]);self.assertEqual(out['nodes'],doc['nodes']);self.assertEqual(out['meshes'],doc['meshes'])
        self.assertEqual(revise_glb(changed),(changed,[]))
    def test_invalid_envelope_rejected(self):
        for raw in [b'',b'not a GLB']:
            with self.assertRaises(ValueError): revise_glb(raw)
if __name__ == '__main__': unittest.main()

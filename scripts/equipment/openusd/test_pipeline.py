"""Offline regression tests: no Blender installation or network required."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import uuid
import zipfile

HERE = Path(__file__).resolve().parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

fetcher = load("fetcher", HERE / "fetch_sources.py")
converter = load("converter", HERE.parent / "convert_openusd.py")

class SourceSafety(unittest.TestCase):
    def test_path_policy(self):
        self.assertEqual(str(fetcher.safe_relative("asset/simready_usd/model.usd")), "asset/simready_usd/model.usd")
        for path in ["", "../escape", "/etc/passwd", "asset/../../x", "a\\b", "https://example", "a\x00b"]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                fetcher.safe_relative(path)

    def test_git_and_lfs_digests(self):
        data = b"pinned source"
        entry = {"path": "asset/model.usd", "size": len(data), "oid": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()}
        fetcher.verify_git_file(data, entry)
        entry["lfs"] = {"oid": hashlib.sha256(data).hexdigest()}
        fetcher.verify_git_file(data, entry)
        for corrupted in [data+b"!", data[:-1]+b"!"]:
            with self.assertRaises(ValueError): fetcher.verify_git_file(corrupted, entry)

    def test_no_unapproved_source_origin(self):
        with self.assertRaises(ValueError): fetcher.fetch("https://attacker.example/asset", 100)
        with self.assertRaises(ValueError): fetcher.download({"dataset":"other/data", "revision":"main"}, Path("/unused"))

    def test_usdz_safe_and_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "asset.usdz"
            with zipfile.ZipFile(p, "w") as z: z.writestr("asset.usda", "#usda 1.0")
            converter.bounded_usdz(p)
            for name in ["../escape.usd", "/absolute.usd", "x\\evil.usd", "C:/evil.usd"]:
                with zipfile.ZipFile(p, "w") as z: z.writestr(name, "bad")
                with self.subTest(name=name), self.assertRaises(ValueError): converter.bounded_usdz(p)
            with zipfile.ZipFile(p, "w", compression=zipfile.ZIP_DEFLATED) as z: z.writestr("bomb.usda", b"a" * (2*1024*1024))
            with self.assertRaises(ValueError): converter.bounded_usdz(p)
            info=zipfile.ZipInfo("link.usd"); info.create_system=3; info.external_attr=0o120777<<16
            with zipfile.ZipFile(p, "w") as z: z.writestr(info, "/etc/passwd")
            with self.assertRaises(ValueError): converter.bounded_usdz(p)

    def test_glb_rejects_unsupported_or_external_content(self):
        def make(doc):
            content=json.dumps(doc).encode(); content += b" " * (-len(content)%4)
            return b"glTF"+struct.pack("<II",2,28+len(content))+struct.pack("<I",len(content))+b"JSON"+content+struct.pack("<I",0)+b"BIN\0"
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/"model.glb"
            p.write_bytes(make({"asset":{"version":"2.0"}})); converter.read_glb(p)
            for extra in [{"images":[{}]}, {"textures":[{}]}, {"animations":[{}]}, {"skins":[{}]}, {"extensionsUsed":["custom"]}, {"buffers":[{"uri":"https://attacker.example"}]}]:
                p.write_bytes(make({"asset":{"version":"2.0"},**extra}))
                with self.subTest(extra=extra), self.assertRaises(ValueError): converter.read_glb(p)
            p.write_bytes(b"not a model")
            with self.assertRaises(ValueError): converter.read_glb(p)

    def test_component_ids_stable_and_no_fabricated_telemetry(self):
        g={"nodes":[{"name":"root","children":[1]},{"name":"part_a","mesh":0}],"scenes":[{"nodes":[0]}]}
        paths={"part_a":"/authored/Frame"}
        choreography={"part_a":{"translation":[0,1,0],"rotation":[0,0,0],"pivot":[0,0,0]}}
        a=converter.manifest_for(g,{"id":"test_asset","name":"Test"},paths,choreography,"NVIDIA test")
        b=converter.manifest_for(g,{"id":"test_asset","name":"Test"},paths,choreography,"NVIDIA test")
        self.assertEqual(a,b)
        self.assertEqual(a["bindings"],[])
        self.assertEqual(a["components"][0]["nodePath"],"/root/part_a")
        self.assertEqual(uuid.UUID(a["components"][0]["templateComponentId"]).version,5)
        self.assertFalse(a["components"][0]["solid"])

if __name__ == "__main__": unittest.main()

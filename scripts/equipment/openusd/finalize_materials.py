#!/usr/bin/env python3
"""Offline material-only revision of hash-verified GLBs; preserves geometry bytes."""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import struct
from material_policy import adapt_material, POLICY, DESCRIPTION

def revise_glb(raw: bytes):
    if len(raw) < 28 or raw[:4] != b"glTF" or struct.unpack_from("<II", raw, 4) != (2, len(raw)):
        raise ValueError("Invalid GLB envelope")
    length = struct.unpack_from("<I", raw, 12)[0]
    if raw[16:20] != b"JSON" or length > len(raw) - 28:
        raise ValueError("Invalid GLB JSON chunk")
    original = json.loads(raw[20:20 + length])
    doc = copy.deepcopy(original)
    changes = []
    for material in doc.get("materials", []):
        pbr = material.get("pbrMetallicRoughness", {})
        color, metal, rough, reason = adapt_material(material.get("name", ""), pbr.get("baseColorFactor", [1,1,1,1]), pbr.get("metallicFactor", 1), pbr.get("roughnessFactor", 1))
        if reason:
            changes.append({"material": material["name"], "reason": reason, "before": copy.deepcopy(pbr), "after": {"baseColorFactor": color, "metallicFactor": metal, "roughnessFactor": rough}})
            pbr.update(changes[-1]["after"])
    if not changes:
        return raw, changes
    assert {k:v for k,v in original.items() if k != "materials"} == {k:v for k,v in doc.items() if k != "materials"}
    content = json.dumps(doc, separators=(",", ":"), ensure_ascii=True).encode()
    content += b" " * (-len(content) % 4)
    tail = raw[20 + length:]
    output = b"glTF" + struct.pack("<II", 2, 20 + len(content) + len(tail)) + struct.pack("<I", len(content)) + b"JSON" + content + tail
    return output, changes

def preview(glb: Path, output: Path):
    import bpy
    from mathutils import Vector
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.import_scene.gltf(filepath=str(glb))
    bpy.context.view_layer.update()
    points = [o.matrix_world @ Vector(v) for o in bpy.context.scene.objects if o.type == "MESH" for v in o.bound_box]
    low = Vector(tuple(min(v[i] for v in points) for i in range(3)))
    high = Vector(tuple(max(v[i] for v in points) for i in range(3)))
    center, extent = (high + low) / 2, max(high-low)
    if not 0 < extent < 1000:
        raise ValueError("Invalid preview bounds")
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.render.resolution_x, scene.render.resolution_y = 640, 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True
    world = bpy.data.worlds.new("Browser preview world"); scene.world = world; world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.65, 0.7, 0.8, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    camera_data = bpy.data.cameras.new("Preview camera"); camera = bpy.data.objects.new("Preview camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = center + Vector((1.5, -1.8, 1.2)) * extent
    camera.rotation_euler = (center-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.type = "ORTHO"; camera_data.ortho_scale = extent * 1.8; scene.camera = camera
    for name, position, energy in [("Key", (2,-3,4), 800), ("Fill", (-3,-1,2), 450), ("Rim", (1,3,3), 650)]:
        light = bpy.data.lights.new(name, "AREA"); light.energy = energy * extent * extent; light.size = extent * 3
        obj = bpy.data.objects.new(name, light); scene.collection.objects.link(obj)
        obj.location = center + Vector(position) * extent
        obj.rotation_euler = (center-obj.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)

def finalize(root: Path, catalogue: Path, render: bool):
    catalog = json.loads(catalogue.read_text())
    for asset in catalog["assets"]:
        changes_by_quality = {}
        for quality, model in asset["models"].items():
            path = (root / model["url"].lstrip("/")).resolve()
            if not path.is_relative_to(root.resolve()) or path.is_symlink():
                raise ValueError("Model path escaped the public directory")
            raw = path.read_bytes()
            if len(raw) != model["bytes"] or hashlib.sha256(raw).hexdigest() != model["sha256"]:
                raise ValueError("Input model did not match the reviewed catalogue")
            revised, changes = revise_glb(raw)
            if len(revised) > 20 * 1024 * 1024:
                raise ValueError("Material revision exceeds model byte budget")
            digest = hashlib.sha256(revised).hexdigest()
            target = path.with_name(quality + "." + digest[:16] + ".glb")
            target.write_bytes(revised)
            if target != path: path.unlink()
            model.update(url="/"+str(target.relative_to(root.resolve())), sha256=digest, bytes=len(revised), revision="nvidia:"+asset["slug"]+":"+digest)
            changes_by_quality[quality] = changes
        receipt_path = root / asset["sourceReceiptUrl"].lstrip("/")
        receipt = json.loads(receipt_path.read_text())
        if any(changes_by_quality.values()):
            receipt["materialAdaptation"] = {"policy": POLICY, "description": DESCRIPTION, "changes": changes_by_quality}
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
        if render:
            preview(root / asset["models"]["compact"]["url"].lstrip("/"), root / asset["previewUrl"].lstrip("/"))
        print("Material-qualified", asset["slug"], {q:len(c) for q,c in changes_by_quality.items()}, flush=True)
    catalogue.write_text(json.dumps(catalog, indent=2)+"\n")

if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-root", type=Path, required=True)
    parser.add_argument("--catalogue", type=Path, required=True)
    parser.add_argument("--render", action="store_true")
    args=parser.parse_args()
    finalize(args.public_root.resolve(), args.catalogue, args.render)

#!/usr/bin/env python3
"""Offline OpenUSD -> bounded static Smart Factory packages. Run in the supplied sandbox."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import uuid
import zipfile

MAX_GLB = 20 * 1024 * 1024
NAMESPACE = uuid.UUID("ade14251-11f7-5abf-bde1-7867d8625679")
LIMITATIONS = [
    "Static browser visualization; physics, robotics articulation, animation and simulation behavior are not transferred.",
    "Geometry is decimated and native materials/textures are adapted to bounded glTF PBR colors; appearance can differ from the original USD.",
    "Component identifiers describe imported visual objects, not a manufacturer-certified bill of materials.",
    "Exploded spacing is illustrative; sections are visual cuts and are not engineering or maintenance instructions.",
]

def bounded_usdz(path: Path) -> None:
    with zipfile.ZipFile(path) as z:
        if len(z.infolist()) > 2000:
            raise ValueError("USDZ entry budget exceeded")
        total = 0
        seen = set()
        for member in z.infolist():
            name = member.filename
            p = Path(name)
            if not name or p.is_absolute() or ".." in p.parts or "\\" in name or ":" in name or name in seen or ((member.external_attr >> 16) & 0o170000) == 0o120000:
                raise ValueError("Unsafe USDZ member")
            seen.add(name)
            total += member.file_size
            if member.file_size > 96 * 1024 * 1024 or total > 768 * 1024 * 1024 or (member.file_size > 1024 * 1024 and member.file_size > max(1, member.compress_size) * 200):
                raise ValueError("USDZ expansion budget exceeded")

def read_glb(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    if len(raw) > MAX_GLB or len(raw) < 28 or raw[:4] != b"glTF" or struct.unpack_from("<I", raw, 4)[0] != 2 or struct.unpack_from("<I", raw, 8)[0] != len(raw):
        raise ValueError("Invalid or oversized converted GLB")
    length = struct.unpack_from("<I", raw, 12)[0]
    if raw[16:20] != b"JSON" or length > len(raw) - 28:
        raise ValueError("Invalid GLB JSON")
    g = json.loads(raw[20:20+length])
    if g.get("images") or g.get("textures") or g.get("animations") or g.get("skins") or g.get("extensionsRequired") or g.get("extensionsUsed"):
        raise ValueError("Converter emitted unsupported images, animation, skins or extensions")
    if any(item.get("uri") for item in g.get("buffers", [])):
        raise ValueError("Converter emitted an external resource")
    return g, raw

def manifest_for(g: dict, asset: dict, source_paths: dict, choreography: dict, provenance: str) -> dict:
    nodes = g["nodes"]
    paths = {}
    def visit(i: int, parent: str) -> None:
        path = parent + "/" + nodes[i]["name"]
        paths[i] = path
        for child in nodes[i].get("children", []):
            visit(child, path)
    for root in g["scenes"][g.get("scene", 0)]["nodes"]:
        visit(root, "")
    components = []
    for i, node in enumerate(nodes):
        if node["name"] not in source_paths:
            continue
        source = source_paths[node["name"]]
        components.append({
            "templateComponentId": str(uuid.uuid5(NAMESPACE, asset["id"] + ":" + source)),
            "name": source.split("/")[-1].replace("_", " ")[:80],
            "parentTemplateComponentId": None,
            "nodeIndex": i,
            "nodePath": paths[i],
            "role": "structural" if "mesh" in node else "group", "solid": False,
            "description": "Imported visual object; not a certified manufacturer component.",
            "source": ("NVIDIA " + asset["id"])[:160],
            "explode": choreography[node["name"]],
        })
    if not 1 <= len(components) <= 128:
        raise ValueError(f"Component budget exceeded: {len(components)}")
    return {
        "schemaVersion": "smart-factory-model-1",
        "name": "NVIDIA " + asset["name"],
        "provenance": provenance,
        "license": "CC-BY-4.0; NVIDIA. Modified for Smart Factory browser visualization.",
        "units": "m", "handedness": "right", "upAxis": "+Y",
        "components": components, "bindings": [],
        "maintenanceText": "Reference geometry only. Map measured signals explicitly before operational use. " + " ".join(LIMITATIONS),
    }

def convert(asset: dict, config: dict, source_root: Path, public_root: Path) -> dict:
    import bpy
    from mathutils import Vector
    root = (source_root / asset["id"]).resolve()
    metadata_bytes = (root / "com.nvidia.simready.packaging.json").read_bytes()
    if hashlib.sha256(metadata_bytes).hexdigest() != asset["packagingSha256"] or json.loads(metadata_bytes).get("license") != "CC-BY-4.0":
        raise ValueError("Source package license/provenance did not match the reviewed pin")
    entry = (root / asset.get("entrypoint", f"simready_usd/sm_{asset['id']}_01.usd")).resolve()
    if not entry.is_relative_to(root) or entry.suffix.lower() not in {".usd", ".usda", ".usdc", ".usdz"}:
        raise ValueError("Entry point must be a local USD/USDZ file in the source package")
    if any(p.is_symlink() for p in root.rglob("*")):
        raise ValueError("Source package may not contain symlinks")
    if entry.suffix.lower() == ".usdz":
        bounded_usdz(entry)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    result = bpy.ops.wm.usd_import(
        filepath=str(entry), import_cameras=False, import_lights=False,
        import_curves=False, import_volumes=False, import_skeletons=False,
        import_blendshapes=False, import_subdivision=False,
        support_scene_instancing=False, import_guide=False, import_proxy=False,
        import_materials=True, import_usd_preview=True,
        apply_unit_conversion_scale=True, merge_parent_xform=False,
    )
    if "FINISHED" not in result:
        raise ValueError("USD import did not complete")
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and len(o.data.polygons)]
    if not meshes or len(meshes) > 1500:
        raise ValueError(f"Expected 1..1500 visual mesh objects, found {len(meshes)}")
    def source_path(o) -> str:
        return (source_path(o.parent) if o.parent else "") + "/" + o.name
    source_paths = {}
    original_paths = {obj: source_path(obj) for obj in meshes}
    originals = []
    for obj in sorted(meshes, key=lambda o: original_paths[o]):
        path = original_paths[obj]
        stable = "part_" + uuid.uuid5(NAMESPACE, asset["id"] + ":" + path).hex[:16]
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix
        obj.name = stable
        obj.data = obj.data.copy()
        obj.animation_data_clear()
        source_paths[stable] = path
        originals.append(obj)
    for obj in list(bpy.context.scene.objects):
        if obj not in originals:
            bpy.data.objects.remove(obj, do_unlink=True)
    material_map = {}
    for obj in originals:
        for slot in obj.material_slots:
            old = slot.material
            key = old.name if old else "Default"
            if key not in material_map:
                color = list(old.diffuse_color if old else (0.4, 0.46, 0.52, 1.0))
                metallic = float(old.metallic) if old else 0.1
                roughness = float(old.roughness) if old else 0.48
                if old and old.use_nodes:
                    principled = next((n for n in old.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                    if principled:
                        color = list(principled.inputs["Base Color"].default_value)
                        metallic = float(principled.inputs["Metallic"].default_value)
                        roughness = float(principled.inputs["Roughness"].default_value)
                m = bpy.data.materials.new("Browser_" + key)
                m.use_nodes = True
                bsdf = m.node_tree.nodes.get("Principled BSDF")
                bsdf.inputs["Base Color"].default_value = tuple(max(0.0, min(1.0, float(v))) for v in color[:3]) + (1.0,)
                bsdf.inputs["Metallic"].default_value = max(0, min(1, metallic))
                bsdf.inputs["Roughness"].default_value = max(0.15, min(1, roughness))
                material_map[key] = m
            slot.material = material_map[key]
    corners = [o.matrix_world @ Vector(v) for o in originals for v in o.bound_box]
    low = Vector(tuple(min(v[i] for v in corners) for i in range(3)))
    high = Vector(tuple(max(v[i] for v in corners) for i in range(3)))
    extent = max(high - low)
    if not math.isfinite(extent) or extent <= 0 or extent > 1000:
        raise ValueError("Invalid physical extent after meter conversion")
    center = (high + low) / 2
    offset = Vector((center.x, center.y, low.z))
    choreography = {}
    for obj in originals:
        obj.location -= offset
        c = sum((obj.matrix_world @ Vector(v) for v in obj.bound_box), Vector()) / 8 - center
        direction = c.normalized() * min(1.0, extent * 0.18) if c.length > 0.001 else Vector((0, 0, min(1.0, extent * 0.12)))
        choreography[obj.name] = {"translation": [direction.x, direction.z, -direction.y], "rotation": [0,0,0], "pivot": [0,0,0]}
    bpy.context.view_layer.update()
    all_source_paths = dict(source_paths)
    if len(originals) > 120:
        groups = {"/": originals}
        max_depth = max(len(p.split("/")) for p in original_paths.values())
        for depth in range(2, max_depth + 1):
            candidate = {}
            for obj in originals:
                key = "/".join(original_paths[obj].split("/")[:depth]) or "/"
                candidate.setdefault(key, []).append(obj)
            if len(candidate) > 120:
                break
            groups = candidate
        source_paths = {}
        choreography = {}
        for path, members in sorted(groups.items()):
            name = "group_" + uuid.uuid5(NAMESPACE, asset["id"] + ":" + path).hex[:16]
            group = bpy.data.objects.new(name, None)
            bpy.context.scene.collection.objects.link(group)
            source_paths[name] = path if path != "/" else "/Complete assembly"
            all_source_paths[name] = source_paths[name]
            for obj in members:
                matrix = obj.matrix_world.copy()
                obj.parent = group
                obj.matrix_world = matrix
            choreography[name] = {"translation": [0,0,0], "rotation": [0,0,0], "pivot": [0,0,0]}
    bpy.context.view_layer.update()
    output = public_root / asset["slug"]
    output.mkdir(parents=True, exist_ok=True)
    source_url = f"https://huggingface.co/datasets/{config['dataset']}/tree/{config['revision']}/{asset['id']}"
    provenance = f"NVIDIA {asset['id']}; {source_url}; adapted by Smart Factory (Onesa UG)."
    if len(provenance) > 500:
        raise ValueError("Provenance exceeds existing import contract")
    original_triangles = sum(sum(max(0, len(p.vertices) - 2) for p in o.data.polygons) for o in originals)
    models = {}
    for quality, target in [("detail", 110000), ("compact", 30000)]:
        for obj in originals:
            obj.modifiers.clear()
            if original_triangles > target:
                decimate = obj.modifiers.new("Browser triangle budget", "DECIMATE")
                decimate.ratio = target / original_triangles * 0.97
                decimate.use_collapse_triangulate = True
        temporary = output / (quality + ".glb")
        bpy.ops.export_scene.gltf(
            filepath=str(temporary), export_format="GLB", export_yup=True,
            export_apply=True, export_animations=False, export_skins=False,
            export_morph=False, export_cameras=False, export_lights=False,
            export_extras=False, export_draco_mesh_compression_enable=False,
        )
        g, raw = read_glb(temporary)
        triangles = sum(g["accessors"][p["indices"]]["count"] // 3 for m in g["meshes"] for p in m["primitives"])
        if triangles > target * 1.15:
            raise ValueError(f"{quality} triangle budget exceeded: {triangles}")
        manifest = manifest_for(g, asset, source_paths, choreography, provenance)
        digest = hashlib.sha256(raw).hexdigest()
        filename = quality + "." + digest[:16] + ".glb"
        temporary.rename(output / filename)
        models[quality] = {
            "url": "/models/nvidia/" + asset["slug"] + "/" + filename,
            "sha256": digest, "bytes": len(raw), "triangles": triangles,
            "revision": "nvidia:" + asset["slug"] + ":" + digest,
            "manifest": manifest,
        }
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True
    world = bpy.data.worlds.new("Browser preview world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.65, 0.7, 0.8, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    center = Vector((0,0,(high.z-low.z)/2))
    camera_data = bpy.data.cameras.new("Preview camera")
    camera = bpy.data.objects.new("Preview camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = center + Vector((1.5, -1.8, 1.2)) * extent
    camera.rotation_euler = (center-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = extent * 1.8
    scene.camera = camera
    for name, position, energy in [("Key", (2,-3,4), 800), ("Fill", (-3,-1,2), 450), ("Rim", (1,3,3), 650)]:
        light = bpy.data.lights.new(name, "AREA")
        light.energy = energy * extent * extent
        light.size = extent * 3
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.location = center + Vector(position) * extent
        obj.rotation_euler = (center-obj.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath = str(output / "preview.png")
    bpy.ops.render.render(write_still=True)
    shutil.copyfile(root / ".metadata/LICENSE.txt", output / "LICENSE.txt")
    receipt = json.loads((root / "source-receipt.json").read_text())
    (output / "SOURCE.json").write_text(json.dumps({
        **receipt, "assetId": asset["id"], "entrypoint": str(entry.relative_to(root)),
        "author": "NVIDIA", "modifiedBy": "Smart Factory (Onesa UG)",
        "converter": "Blender " + bpy.app.version_string,
        "originalTriangles": original_triangles,
        "limitations": LIMITATIONS, "sourceObjectPaths": all_source_paths,
    }, indent=2) + "\n")
    return {
        "id": asset["id"], "slug": asset["slug"], "name": asset["name"],
        "category": asset["category"], "description": asset["description"],
        "sourceUrl": source_url, "sourceRevision": config["revision"],
        "license": "CC-BY-4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": f"{asset['id']} by NVIDIA, CC BY 4.0. Modified by Smart Factory (Onesa UG).",
        "previewUrl": "/models/nvidia/" + asset["slug"] + "/preview.png",
        "licenseFileUrl": "/models/nvidia/" + asset["slug"] + "/LICENSE.txt",
        "sourceReceiptUrl": "/models/nvidia/" + asset["slug"] + "/SOURCE.json",
        "limitations": LIMITATIONS, "models": models,
    }

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--sources", type=Path, required=True)
    p.add_argument("--public-output", type=Path, required=True)
    p.add_argument("--catalog-output", type=Path, required=True)
    args = p.parse_args()
    config = json.loads(args.config.read_text())
    catalog = {"schemaVersion": 1, "assets": []}
    for asset in config["assets"]:
        catalog["assets"].append(convert(asset, config, args.sources, args.public_output))
        print("Converted", asset["id"], flush=True)
    args.catalog_output.parent.mkdir(parents=True, exist_ok=True)
    args.catalog_output.write_text(json.dumps(catalog, indent=2) + "\n")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Original MIT factory references. Run with Blender 4.5.10 LTS --background --python.

Blender authoring is Z-up/metres; its glTF exporter converts to +Y-up/metres.
No third-party geometry, fonts, images or runtime textures are downloaded.
The source is the editable asset: regenerate compact/detail geometry and previews.
"""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path
import struct
import sys
import uuid

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
NAMESPACE = uuid.UUID("b89f43b7-90ab-52c9-9fea-606c8cb3dedc")
AUTHOR = "Smart Factory (Onesa UG)"
LICENSE = """MIT License

Copyright (c) 2026 Smart Factory (Onesa UG)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""
SPECS = {
    "loading-door": {
        "name": "Sectional loading door", "category": "Building equipment", "assetType": "other",
        "description": "Insulated sectional panels, perimeter seals, guide rails, hinges, roller hardware and a geared overhead shaft.",
    },
    "exit-door": {
        "name": "Industrial personnel door", "category": "Building equipment", "assetType": "other",
        "description": "Steel personnel door with a vision panel, push bar, closer linkage, hinges and threshold.",
    },
    "process-sensor": {
        "name": "Process transmitter", "category": "Instrumentation", "assetType": "sensor",
        "description": "Generic process instrument with a sealed cast housing, blank display, cable gland and threaded stainless process connection.",
    },
}
MATERIALS = {}
PARTS = {}
DETAIL = True
ASSEMBLY = None


def material(name, color, metal, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = roughness
    return m


def reset(slug):
    global ASSEMBLY, MATERIALS, PARTS
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1
    MATERIALS = {
        "paint": material("Deep blue powder coat", (.025, .115, .19), .06, .38),
        "panel": material("Warm gray insulated panel", (.56, .60, .62), .04, .44),
        "steel": material("Brushed stainless steel", (.48, .53, .57), .94, .30),
        "galvanized": material("Satin galvanized steel", (.32, .37, .41), .88, .46),
        "darksteel": material("Dark steel hardware", (.065, .075, .085), .82, .38),
        "rubber": material("EPDM seals", (.014, .018, .022), .0, .79),
        "polymer": material("Black engineering polymer", (.022, .028, .034), .01, .48),
        "glass": material("Smoked inspection glass", (.037, .09, .105), .08, .16),
        "white": material("White marking ink", (.80, .83, .80), .0, .58),
        "green": material("Green identification plate", (.018, .28, .12), .0, .42),
        "brass": material("Machined brass", (.55, .35, .105), .90, .29),
        "lcd": material("Unpowered display", (.12, .18, .16), .0, .36),
    }
    ASSEMBLY = bpy.data.objects.new(slug.replace("-", "_").title(), None)
    bpy.context.collection.objects.link(ASSEMBLY)
    PARTS = {}


def finish(obj, name, mat, bevel=0, description=None):
    # Three.js sanitizes periods in node names; use portable paths at source so
    # exported JSON, runtime selection and semantic UUIDs agree exactly.
    obj.name = re.sub(r"[^A-Za-z0-9_-]", "_", name)
    obj.parent = ASSEMBLY
    obj.data.materials.append(MATERIALS[mat])
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("Manufactured edge radius", "BEVEL")
        mod.width = bevel
        mod.segments = 3 if DETAIL else 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    mod = obj.modifiers.new("Face weighted normals", "WEIGHTED_NORMAL")
    mod.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    PARTS[obj.name] = {"name": name, "description": description or f"Original illustrative {name.lower()}; no installed condition is implied."}
    return obj


def box(name, pos, size, mat="steel", bevel=.003):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.dimensions = size
    return finish(obj, name, mat, min(bevel, min(size) * .2))


def cylinder(name, pos, radius, depth, mat="steel", axis=(0, 0, 1), vertices=None, bevel=.001):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices or (48 if DETAIL else 20), radius=radius, depth=depth, location=pos)
    obj = bpy.context.object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector(axis).to_track_quat("Z", "Y")
    return finish(obj, name, mat, min(bevel, radius * .12, depth * .2))


def rod(name, start, end, radius, mat="steel"):
    a, b = Vector(start), Vector(end)
    return cylinder(name, (a + b) / 2, radius, (b-a).length, mat, b-a)


def torus(name, pos, radius, tube, mat="steel", axis=(0, 0, 1)):
    bpy.ops.mesh.primitive_torus_add(major_segments=48 if DETAIL else 20, minor_segments=10 if DETAIL else 6, major_radius=radius, minor_radius=tube, location=pos)
    obj = bpy.context.object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector(axis).to_track_quat("Z", "Y")
    return finish(obj, name, mat)


def text(name, body, pos, size, mat="white"):
    # Blender's built-in vector font; no host font dependency. Face towards -Y.
    bpy.ops.object.text_add(location=pos, rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.data.body = body
    obj.data.align_x = "CENTER"
    obj.data.size = size
    obj.data.extrude = size * .008
    obj.data.resolution_u = 6 if DETAIL else 3
    bpy.ops.object.convert(target="MESH")
    return finish(bpy.context.object, name, mat)


def loading_door():
    # 3.5m x .35m x 3.2m envelope, clear sectional panel silhouette.
    for side, x in [("Left", -1.66), ("Right", 1.66)]:
        box(f"{side} frame upright", (x, .04, 1.52), (.16, .25, 3.04), "galvanized", .009)
        box(f"{side} perimeter seal", (x - math.copysign(.08, x), -.102, 1.48), (.035, .026, 2.94), "rubber")
        box(f"{side} roller guide", (x, .18, 1.48), (.045, .045, 2.94), "steel")
        for z in [.18, 1.45, 2.78]:
            cylinder(f"{side} frame anchor {z}", (x, -.091, z), .016, .012, "darksteel", (0, 1, 0), 6)
    box("Overhead frame", (0, .04, 3.05), (3.48, .25, .16), "galvanized", .008)
    box("Top weather seal", (0, -.105, 2.96), (3.15, .025, .035), "rubber")
    for n in range(6):
        z = .26 + n * .48
        box(f"Insulated section {n+1}", (0, 0, z), (3.14, .09, .468), "panel", .009)
        for ridge in [-.12, .12]:
            box(f"Section {n+1} pressed rib {ridge}", (0, -.049, z+ridge), (3.06, .007, .012), "panel", .002)
        if n < 5:
            box(f"Panel joint seal {n+1}", (0, 0, z+.24), (3.14, .071, .008), "rubber", .001)
        for side, x in [("Left", -1.48), ("Right", 1.48)]:
            box(f"{side} hinge plate {n+1}", (x, -.058, z+.15), (.075, .012, .085), "steel", .003)
            cylinder(f"{side} hinge pin {n+1}", (x, -.072, z+.14), .011, .085, "steel", (1, 0, 0))
    box("Bottom compression seal", (0, 0, .016), (3.17, .12, .032), "rubber", .007)
    rod("Torsion shaft", (-1.65, .12, 3.16), (1.65, .12, 3.16), .023)
    cylinder("Torsion spring", (0, .12, 3.16), .065, .78, "darksteel", (1, 0, 0))
    for i, x in enumerate([-.65, .65]):
        cylinder(f"Cable drum {i+1}", (x, .12, 3.16), .08, .08, "galvanized", (1, 0, 0))
    box("Manual lift handle", (0, -.10, .70), (.24, .05, .035), "polymer", .008)
    for x in [-.105, .105]:
        box(f"Handle standoff {x}", (x, -.069, .70), (.028, .055, .035), "polymer")
    box("Manufacturer neutral identification plate", (-1.12, -.052, .27), (.31, .005, .09), "paint", .002)
    text("Door identification marking", "SECTIONAL", (-1.12, -.055, .245), .033)


def exit_door():
    # Generic personnel door, not a certified fire/escape assembly.
    for side, x in [("Left", -.49), ("Right", .49)]:
        box(f"{side} steel jamb", (x, 0, 1.06), (.075, .14, 2.12), "galvanized", .006)
        box(f"{side} compression seal", (x-math.copysign(.045, x), -.052, 1.02), (.018, .016, 2.02), "rubber", .002)
    box("Head frame", (0, 0, 2.08), (1.06, .14, .08), "galvanized", .006)
    box("Threshold", (0, -.005, .014), (1.06, .20, .028), "steel", .004)
    # Four independent panels leave a real opening for the vision panel.
    box("Door lower leaf", (0, -.01, .59), (.90, .055, 1.13), "paint", .005)
    box("Door upper leaf", (0, -.01, 1.94), (.90, .055, .24), "paint", .005)
    for side, x in [("Left", -.33), ("Right", .33)]:
        box(f"{side} vision surround leaf", (x, -.01, 1.49), (.24, .055, .66), "paint", .004)
    box("Vision panel gasket", (0, -.018, 1.49), (.443, .042, .677), "rubber", .012)
    box("Vision glazing", (0, -.043, 1.49), (.382, .012, .615), "glass", .008)
    for side, x in [("Left", -.217), ("Right", .217)]:
        box(f"{side} glazing bead", (x, -.052, 1.49), (.026, .015, .66), "steel", .003)
    for side, z in [("Top", 1.82), ("Bottom", 1.16)]:
        box(f"{side} glazing bead", (0, -.052, z), (.456, .015, .026), "steel", .003)
    box("Kick plate", (0, -.042, .18), (.85, .008, .27), "steel", .004)
    for x in [-.39, .39]:
        for z in [.07, .29]:
            cylinder(f"Kick plate fastener {x} {z}", (x, -.048, z), .006, .005, "darksteel", (0, 1, 0), 8)
    for side, x in [("Left", -.34), ("Right", .34)]:
        box(f"{side} push bar bearing", (x, -.071, 1.02), (.10, .09, .12), "darksteel", .014)
    box("Stainless push bar", (0, -.132, 1.02), (.77, .045, .065), "steel", .017)
    for n, z in enumerate([.30, 1.05, 1.83]):
        cylinder(f"Hinge barrel {n+1}", (-.459, -.048, z), .018, .16, "steel")
        box(f"Hinge mounting leaf {n+1}", (-.416, -.043, z), (.06, .014, .14), "steel")
    box("Hydraulic door closer", (.20, -.083, 1.97), (.26, .08, .072), "galvanized", .012)
    rod("Closer linkage inner", (.20, -.13, 1.98), (-.05, -.17, 2.045), .009)
    rod("Closer linkage outer", (-.05, -.17, 2.045), (-.19, -.07, 2.065), .009)
    box("Neutral push instruction plate", (0, -.044, .86), (.20, .008, .07), "green", .004)
    text("Push instruction", "PUSH", (0, -.050, .839), .044)


def process_sensor():
    # Generic 0.19m instrument; no manufacturer identity or fabricated readout.
    cylinder("Process connection", (0, 0, .019), .014, .038, "steel", bevel=.0006)
    for n in range(7):
        torus(f"Process thread crest {n+1}", (0, 0, .006+n*.0037), .014, .0010)
    cylinder("Wrench hex", (0, 0, .043), .024, .019, "steel", vertices=6, bevel=.001)
    cylinder("Isolation neck", (0, 0, .065), .018, .027, "steel")
    cylinder("Cast transmitter housing", (0, 0, .125), .055, .079, "paint", (0, 1, 0), bevel=.004)
    cylinder("Rear cover", (0, .046, .125), .050, .020, "paint", (0, 1, 0), bevel=.002)
    cylinder("Front stainless bezel", (0, -.047, .125), .052, .014, "steel", (0, 1, 0), bevel=.0015)
    cylinder("Display gasket", (0, -.055, .125), .046, .007, "rubber", (0, 1, 0))
    cylinder("Display glass", (0, -.059, .125), .042, .005, "glass", (0, 1, 0), bevel=.0005)
    box("Unpowered LCD", (0, -.062, .132), (.053, .001, .027), "lcd", .001)
    text("Instrument type marking", "PROCESS", (0, -.063, .106), .0065)
    # Blank LCD deliberately contains no live numeric measurement.
    for x in [-.012, 0, .012]:
        cylinder(f"Sealed function button {x}", (x, -.064, .095), .0033, .002, "polymer", (0, 1, 0), bevel=.0003)
    for n in range(4):
        a = math.pi/4+n*math.pi/2
        x, z = .047*math.cos(a), .125+.047*math.sin(a)
        cylinder(f"Captive bezel screw {n+1}", (x, -.056, z), .0033, .003, "darksteel", (0, 1, 0), 8, .0003)
    cylinder("Cable entry boss", (.056, 0, .125), .014, .023, "paint", (1, 0, 0))
    cylinder("Cable gland hex", (.071, 0, .125), .015, .016, "brass", (1, 0, 0), 6)
    cylinder("Cable gland compression nut", (.084, 0, .125), .0125, .014, "polymer", (1, 0, 0))
    cylinder("Sealed cable tail", (.101, 0, .125), .0045, .025, "rubber", (1, 0, 0))
    box("Rear mounting lug", (0, .057, .092), (.033, .016, .024), "galvanized", .003)
    cylinder("Ground terminal", (-.048, 0, .096), .004, .009, "brass", (1, 0, 0), 6, .0004)


BUILDERS = {"loading-door": loading_door, "exit-door": exit_door, "process-sensor": process_sensor}


def glb_json(path):
    data = path.read_bytes()
    length, kind = struct.unpack_from("<II", data, 12)
    assert kind == 0x4E4F534A
    return json.loads(data[20:20+length]), data


def export(slug, quality, destination):
    bpy.ops.object.select_all(action="DESELECT")
    ASSEMBLY.select_set(True)
    for obj in ASSEMBLY.children:
        obj.select_set(True)
    temp = destination / f"{quality}.glb"
    bpy.ops.export_scene.gltf(filepath=str(temp), export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_animations=False, export_cameras=False, export_lights=False,
                              export_texcoords=False, export_normals=True, export_tangents=False, export_materials="EXPORT",
                              export_extras=False)
    gltf, data = glb_json(temp)
    sha = hashlib.sha256(data).hexdigest()
    path = destination / f"{quality}.{sha[:16]}.glb"
    temp.replace(path)
    nodes = gltf["nodes"]
    parents = {child: i for i, n in enumerate(nodes) for child in n.get("children", [])}
    def node_path(index):
        return (node_path(parents[index]) if index in parents else "") + "/" + nodes[index]["name"]
    ids = {i: str(uuid.uuid5(NAMESPACE, slug + node_path(i))) for i in range(len(nodes))}
    points = [o.matrix_world @ Vector(corner) for o in ASSEMBLY.children for corner in o.bound_box]
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    center, span = (lo+hi)/2, max(hi-lo)
    components = []
    for i, n in enumerate(nodes):
        part = PARTS.get(n["name"], {"name": SPECS[slug]["name"], "description": "Original illustrative assembly; no operational state is implied."})
        is_mesh = "mesh" in n
        direction = bpy.data.objects[n["name"]].location-center if is_mesh else Vector((0, 0, 0))
        if direction.length:
            direction.normalize()
        shift = direction * span * .15
        # Blender meshes are independent selectable surfaces. Sectioning deliberately
        # does not assert engineering solidity for exported bevel/normal topology.
        components.append({"templateComponentId": ids[i], "parentTemplateComponentId": ids.get(parents.get(i)),
                           "name": part["name"], "nodeIndex": i, "nodePath": node_path(i),
                           "role": "structural" if is_mesh else "group", "solid": False,
                           "description": part["description"], "source": "Original Blender authoring; MIT",
                           "explode": {"translation": [round(shift.x, 6), round(shift.z, 6), round(-shift.y, 6)],
                                       "rotation": [0, 0, 0], "pivot": [0, 0, 0]}})
    triangles = sum(gltf["accessors"][p["indices"]]["count"]//3 for m in gltf["meshes"] for p in m["primitives"])
    assert 0 < len(components) <= 128
    assert triangles <= (34500 if quality == "compact" else 126500)
    assert len(data) < 20*1024*1024
    return {"url": f"/models/authored/{slug}/{path.name}", "sha256": sha, "bytes": len(data), "triangles": triangles,
            "revision": f"smart-factory-authored-{slug}-{quality}-1",
            "manifest": {"schemaVersion": "smart-factory-model-1", "name": SPECS[slug]["name"],
                         "provenance": "Original Blender 4.5.10 LTS parametric authoring by Smart Factory (Onesa UG)",
                         "license": "MIT", "units": "m", "handedness": "right", "upAxis": "+Y", "components": components,
                         "bindings": [], "maintenanceText": "Illustrative reference only. No installed condition, certified dimensions or live measurements are asserted."}}


def render_preview(path):
    scene = bpy.context.scene
    points = [o.matrix_world @ Vector(corner) for o in ASSEMBLY.children for corner in o.bound_box]
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    center = (lo+hi)/2
    span = max(hi-lo)
    bpy.ops.mesh.primitive_plane_add(size=span*200, location=(0, 0, -.001*span))
    plane = bpy.context.object
    plane.data.materials.append(material("Preview studio floor", (.73, .77, .81), 0, .78))
    bpy.ops.object.camera_add(location=center+Vector((1.0, -2.3, .85))*span)
    camera = bpy.context.object
    camera.rotation_euler = (center-camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = span*1.30
    scene.camera = camera
    for name, offset, power, size in [("Soft key", (-2,-3,4), 500, 3), ("Cool fill", (3,-1,2), 260, 2.5), ("Edge strip", (1,3,3), 650, 2)]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = power*span*span
        data.shape = "DISK"
        data.size = size*span
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = center+Vector(offset)*span
        obj.rotation_euler = (center-obj.location).to_track_quat("-Z", "Y").to_euler()
    scene.world = bpy.data.worlds.new("Neutral studio")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.55,.62,.72,1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .3
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 960
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return {"min": list(lo), "max": list(hi), "authoringUp": "+Z", "exportUp": "+Y"}


def main():
    global DETAIL
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", type=Path, default=ROOT)
    parser.add_argument("--evidence-dir", type=Path)
    parser.add_argument("--models", nargs="+", choices=list(SPECS), default=list(SPECS))
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    if bpy.app.version[:3] != (4, 5, 10):
        raise SystemExit("Use pinned Blender 4.5.10 LTS; export differences require review")
    source_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    assets = []
    for slug in args.models:
        folder = args.output_root / "client/public/models/authored" / slug
        folder.mkdir(parents=True, exist_ok=True)
        models = {}
        for quality in ["compact", "detail"]:
            DETAIL = quality == "detail"
            reset(slug)
            BUILDERS[slug]()
            bpy.context.view_layer.update()
            models[quality] = export(slug, quality, folder)
        # The preview is rendered from the exact detailed source exported above.
        bounds = render_preview(folder / "preview.png")
        if args.evidence_dir:
            args.evidence_dir.mkdir(parents=True, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=str(args.evidence_dir / f"{slug}.blend"))
        (folder / "LICENSE.txt").write_text(LICENSE)
        receipt = {"schemaVersion": 1, "author": AUTHOR, "license": "MIT", "blenderVersion": bpy.app.version_string,
                   "generator": "scripts/equipment/blender_gap_assets.py", "generatorSha256": source_sha,
                   "provenance": "Original parametric geometry, independently authored. No NVIDIA geometry reused.",
                   "units": "m", "bounds": bounds, "models": {q: {k: m[k] for k in ["sha256", "bytes", "triangles"]} for q,m in models.items()},
                   "previewSha256": hashlib.sha256((folder / "preview.png").read_bytes()).hexdigest()}
        (folder / "SOURCE.json").write_text(json.dumps(receipt, indent=2)+"\n")
        assets.append({"id": slug, "slug": slug, **{k: SPECS[slug][k] for k in ["name", "category", "description"]},
                       "assetType": SPECS[slug]["assetType"], "sourceUrl": f"/models/authored/{slug}/SOURCE.json",
                       "sourceRevision": source_sha, "license": "MIT", "licenseUrl": f"/models/authored/{slug}/LICENSE.txt",
                       "attribution": "Original Blender geometry by Smart Factory (Onesa UG). MIT license.",
                       "previewUrl": f"/models/authored/{slug}/preview.png", "licenseFileUrl": f"/models/authored/{slug}/LICENSE.txt",
                       "sourceReceiptUrl": f"/models/authored/{slug}/SOURCE.json", "models": models,
                       "limitations": ["Illustrative geometry, not manufacturer CAD, certified dimensions or an installed-asset attestation.",
                                       "Static visual reference; no articulation, collision, safety certification or SimReady certification is claimed.",
                                       "Display and indicator geometry is unpowered and contains no live measurement.",
                                       "Compact and detailed packages retain the same semantic component identities; visual sections are uncapped surfaces."]})
        print(json.dumps({"slug": slug, "models": receipt["models"], "bounds": bounds}))
    output = args.output_root / "shared/authored-assets.catalog.json"
    output.write_text(json.dumps({"schemaVersion": 1, "assets": assets}, indent=2)+"\n")


if __name__ == "__main__":
    main()

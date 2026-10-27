"""Original MIT Raspberry Pi 4 Model B illustration, not manufacturer CAD.

The 85 x 56 mm outline / 58 x 49 mm mounting pattern follows the official
reference drawing. Connector cavities, routing and packages are simplified.
No Raspberry Pi logo, supplier mesh, photograph or external texture is used.
Author in mm, export metres / +Y up, with stable component identities.
Requires the pinned manifold3d/numpy versions in requirements-geometry.txt.
"""
from pathlib import Path
from uuid import UUID, uuid5
import hashlib
import json
import struct
import manifold3d as md
import numpy as np

ROOT = Path(__file__).resolve().parents[2] / "fixtures/equipment/raspberry-pi-4b"
ROOT.mkdir(parents=True, exist_ok=True)
REVISION = "smart-factory-illustrative-raspberry-pi-4b-1"
NS = UUID("75ebdd45-6412-5c1e-97d1-cd7cc9c0db87")
Y = 15.0
M = md.Manifold
palette = [
    ("Green solder mask", [.012, .12, .025, 1], .05, .55),
    ("Connector shield", [.56, .61, .65, 1], .86, .27),
    ("Black polymer", [.018, .025, .03, 1], .08, .65),
    ("Gold contact plating", [.78, .53, .16, 1], .8, .27),
    ("USB 3 blue insert", [.015, .11, .38, 1], .05, .4),
    ("White silkscreen", [.83, .86, .79, 1], .0, .75),
    ("Dark copper routing", [.11, .35, .19, 1], .35, .6),
    ("Unlit indicator lens", [.2, .28, .18, 1], .0, .35),
    ("Chip heat spreader", [.36, .4, .43, 1], .7, .39),
]
nodes, components, meshes, accessors, views, audits = [], [], [], [], [], []
binary = bytearray()


def box(p, size):
    return M.cube(size, center=True).translate(p)


def cylinder(p, height, radius, axis="y", segments=32):
    result = M.cylinder(height, radius, circular_segments=segments, center=True)
    if axis == "y":
        result = result.rotate((90, 0, 0))
    elif axis == "x":
        result = result.rotate((0, 90, 0))
    return result.translate(p)


def union(*parts):
    return M.batch_boolean(list(parts), md.OpType.Add)


def round_box(p, size, radius):
    x, y, z = p
    w, h, d = size
    return union(box(p, (w - radius * 2, h, d)), box(p, (w, h, d - radius * 2)), *[
        cylinder((x + sx * (w / 2 - radius), y, z + sz * (d / 2 - radius)), h, radius)
        for sx in [-1, 1] for sz in [-1, 1]
    ])


def part(name, parent=None, solid=None, material=2, move=(0, 0, 0), quantity=1,
         role="internal", description="Simplified illustrative component."):
    index = len(nodes)
    path = (components[parent]["nodePath"] if parent is not None else "") + "/" + name.replace(" ", "_")
    node = {"name": path.rsplit("/", 1)[1], "children": []}
    if parent is not None:
        nodes[parent]["children"].append(index)
    if solid is not None:
        assert solid.status() == md.Error.NoError and solid.volume() > 0, name
        mesh = solid.calculate_normals(0, 40).to_mesh()
        p = np.asarray(mesh.vert_properties[:, :3] / 1000, dtype="<f4")
        n = np.asarray(mesh.vert_properties[:, 3:6], dtype="<f4")
        triangles = np.asarray(mesh.tri_verts, dtype="<u4").reshape(-1)
        attrs = {}
        for key, values, kind, component_type in [
            ("POSITION", p, "VEC3", 5126), ("NORMAL", n, "VEC3", 5126),
            ("indices", triangles, "SCALAR", 5125),
        ]:
            data = values.tobytes()
            views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)})
            binary.extend(data)
            binary.extend(b"\0" * (-len(binary) % 4))
            accessor = {"bufferView": len(views) - 1, "componentType": component_type,
                        "count": len(values), "type": kind}
            if key == "POSITION":
                accessor.update(min=p.min(axis=0).tolist(), max=p.max(axis=0).tolist())
            attrs[key] = len(accessors)
            accessors.append(accessor)
        node["mesh"] = len(meshes)
        meshes.append({"name": name, "primitives": [{"attributes": {"POSITION": attrs["POSITION"],
                        "NORMAL": attrs["NORMAL"]}, "indices": attrs["indices"], "material": material}]})
        audits.append({"name": name, "positiveVolumeMm3": solid.volume(), "triangles": len(triangles) // 3,
                       "manifold": True})
    nodes.append(node)
    components.append({
        "templateComponentId": str(uuid5(NS, name)), "name": name, "nodeIndex": index, "nodePath": path,
        "parentTemplateComponentId": components[parent]["templateComponentId"] if parent is not None else None,
        "designation": "RPI4B-ILL" if index == 0 else f"RPI4B-{index:03d}", "quantity": quantity,
        "material": palette[material][0] if solid is not None else "Assembly",
        "role": role if solid is not None else "group", "solid": solid is not None,
        "inventoryKind": "assembly" if solid is None else "repeated part set" if quantity > 1 else "individual part",
        "source": "scripts/equipment/raspberry_pi_geometry.py", "description": description,
        "explode": {"translation": [v / 1000 for v in move], "rotation": [0, 0, 0], "pivot": [0, Y / 1000, 0]},
    })
    return index


root = part("Raspberry Pi 4 Model B", description="Original illustrative reference. No live board or hardware revision is inferred.")
pcb_group = part("Printed circuit board", root)
mounts = [(-39, -24.5), (19, -24.5), (-39, 24.5), (19, 24.5)]
board = round_box((0, Y, 0), (85, 1.6, 56), 3)
for x, z in mounts:
    board = board - cylinder((x, Y, z), 3, 1.35)
part("PCB substrate and mounting holes", pcb_group, board, 0, role="structural",
     description="85 x 56 mm illustrative board with four 2.7 mm holes on a 58 x 49 mm pattern; not manufacturing CAD.")
part("Mounting hole annular pads", pcb_group, union(*[
    cylinder((x, Y + .82, z), .055, 2.25) - cylinder((x, Y + .82, z), .2, 1.35)
    for x, z in mounts]), 3, quantity=4, role="structural")

compute = part("Compute and wireless", root, move=(0, 7, 0))
soc = part("BCM2711 processor package", compute, move=(-3, 8, 0),
           description="Illustrative package exterior; silicon internals are not represented.")
part("Processor package substrate", soc, box((-10, Y + 1.7, -1), (16, 1.8, 16)), 2)
part("Processor heat spreader", soc, box((-10, Y + 2.8, -1), (14, .7, 14)), 8, (0, 4, 0), role="cover")
part("LPDDR4 memory package", compute, box((8, Y + 1.7, -9), (11, 1.8, 13)), 2, (3, 10, -3))
part("Wireless module shield", compute, round_box((-29, Y + 2, -12), (14, 2.3, 11), .6), 1,
     (-6, 7, -4), role="housing")
part("USB controller package", compute, box((12, Y + 1.6, 9), (7, 1.6, 7)), 2, (5, 8, 3))
part("Ethernet PHY package", compute, box((20, Y + 1.5, -8), (5.5, 1.4, 5.5)), 2, (6, 8, -3))
part("Power management package", compute, box((-28, Y + 1.4, 10), (5.5, 1.2, 5.5)), 2, (-6, 8, 3))
part("Power inductors", compute, union(*[box((-34 + i * 4, Y + 1.8, 17), (2.8, 2, 2.8)) for i in range(3)]), 8,
     (-6, 6, 5), quantity=3)
part("Passive component banks", pcb_group, union(*[
    box((x, Y + 1.12, z), (1, .6, .55))
    for x, z in [(-22, -7), (-22, -5), (-22, -3), (-22, -1), (-21, 6), (-19, 6), (-17, 6),
                 (-15, 11), (-13, 11), (-11, 11), (-9, 11), (5, 4), (8, 4), (11, 4), (22, 1), (22, 3)]
]), 2, (0, 3, 0), quantity=16, description="Representative passives, not a complete population or circuit schematic.")

gpio = part("40-pin GPIO header", root, move=(0, 14, -7))
part("GPIO insulating body", gpio, box((-9, Y + 2, -22.8), (50.8, 2.4, 5.1)), 2, role="housing")
part("GPIO contact pins", gpio, union(*[box((-33.13 + i * 2.54, Y + 5.4, -24.07 + j * 2.54), (.64, 9.5, .64))
     for i in range(20) for j in range(2)]), 3, (0, 3, 0), quantity=40,
     description="Two rows of 20 contacts at illustrative 2.54 mm pitch. No pin state or electrical control is implied.")
poe = part("PoE HAT header", root, move=(5, 10, -5))
part("PoE header body", poe, box((24, Y + 2, -16.5), (5.1, 2.4, 5.1)), 2)
part("PoE header contacts", poe, union(*[box((22.73 + i * 2.54, Y + 5.2, -17.77 + j * 2.54), (.64, 9, .64))
     for i in range(2) for j in range(2)]), 3, (0, 2, 0), quantity=4)

ports = part("Network and USB connectors", root, move=(11, 0, 0))
ethernet = part("Gigabit Ethernet connector", ports, move=(7, 0, -5))
part("Ethernet shield", ethernet, box((36.8, Y + 7.8, -18), (18, 14, 16)) -
     box((38.8, Y + 7.5, -18), (17, 10.8, 13.3)), 1, role="housing")
part("Ethernet socket insert", ethernet, box((29.1, Y + 6.5, -18), (1.5, 10, 12.8)), 2)
part("Ethernet contacts", ethernet, union(*[box((34.3, Y + 4, -22 + i * 1.14), (10, .35, .4))
     for i in range(8)]), 3, (2, -1, 0), quantity=8)
part("Ethernet indicator lenses", ethernet, union(box((45.9, Y + 12, -24), (.5, 1.6, 1.5)),
     box((45.9, Y + 12, -12), (.5, 1.6, 1.5))), 7, quantity=2,
     description="Unlit illustrative lenses; no network activity is claimed.")
for name, z, mat in [("USB 2 dual socket", -.5, 2), ("USB 3 dual socket", 17.5, 4)]:
    group = part(name, ports, move=(9, 2, 0 if z < 5 else 5))
    shield = box((37, Y + 8.1, z), (18.2, 14.6, 13.2))
    for y in [Y + 4.7, Y + 11.4]:
        shield = shield - box((39, y, z), (17, 5.3, 11.6))
    part(name + " shield", group, shield, 1, role="housing")
    part(name + " tongues", group, union(*[box((38, y, z), (13, 1.2, 9.8))
         for y in [Y + 4.4, Y + 11.1]]), mat, (2, 1, 0), quantity=2)
    part(name + " contacts", group, union(*[box((39, y, z - 3.5 + i * 2.3), (10, .15, .55))
         for y in [Y + 5.1, Y + 11.8] for i in range(4)]), 3, (4, 1, 0), quantity=8,
         description="Representative contact strips; USB 3 superspeed contacts are simplified.")

edge = part("Power display and camera connectors", root, move=(0, 3, 7))
for name, x, width, height in [("USB-C power", -32, 9, 3.2), ("Micro HDMI 0", -18, 7.4, 2.8),
                               ("Micro HDMI 1", -4.5, 7.4, 2.8)]:
    group = part(name, edge, move=(0, 2, 4))
    outer = round_box((x, Y + 1 + height / 2, 26.8), (width, height, 6.5), .6)
    cavity = box((x, Y + 1 + height / 2, 28), (width - 1.1, height - .9, 7))
    part(name + " shield", group, outer - cavity, 1, role="housing")
    part(name + " insert", group, box((x, Y + 1 + height / 2, 26.8), (width - 2, .6, 4.2)), 2)
audio = part("Audio composite jack", edge, move=(1, 2, 7))
part("Audio jack body", audio, box((13, Y + 4.1, 23), (7.8, 6.6, 11.5)), 2)
part("Audio jack aperture", audio, cylinder((13, Y + 4.1, 29.6), 2, 3.1, "z") -
     cylinder((13, Y + 4.1, 29.6), 3, 1.8, "z"), 2, (0, 0, 2), role="housing")
for name, x, z in [("Camera CSI ribbon connector", 21, 6), ("Display DSI ribbon connector", -37.5, 1)]:
    group = part(name, edge, move=(0, 6, 0))
    part(name + " body", group, box((x, Y + 2.3, z), (3.2, 3, 20.5)), 5, role="housing")
    part(name + " latch", group, box((x + .9, Y + 4, z), (1.4, 1.2, 21)), 2, (1, 3, 0))
    part(name + " contact bank", group, union(*[box((x - .8, Y + 3.1, z - 7 + i), (1, .3, .4))
         for i in range(15)]), 3, quantity=15)

storage = part("MicroSD storage socket", root, move=(-8, -8, 0))
part("MicroSD metal holder", storage, box((-33.5, Y - 2.2, 0), (16, 2.5, 13)) -
     box((-35, Y - 2.2, 0), (18, 1.5, 11.7)), 1, role="housing")
part("MicroSD socket contacts", storage, union(*[box((-31.5, Y - 1, -3.8 + i * 1.1), (8, .25, .45))
     for i in range(8)]), 3, quantity=8, description="Empty socket; no installed card, storage capacity or data is inferred.")

# Shallow routing and silk marks make the reference readable without textures.
part("Illustrative PCB routing", pcb_group, union(*[
    box((x, Y + .83, z), (w, .025, .17)) for x, z, w in
    [(-19, -18, 25), (-17, -17, 21), (-14, -16, 18), (0, 16, 31), (2, 17, 27), (4, 18, 23),
     (-24, 4, 9), (-23, 5, 7), (19, -4, 14), (18, -3, 12)]
]), 6, role="structural", description="Decorative illustrative routing, not a circuit schematic or verified PCB layout.")
font = {"R":["1110","1001","1110","1010","1001"], "P":["1110","1001","1110","1000","1000"],
        "I":["111","010","010","010","111"], "4":["1010","1010","1111","0010","0010"],
        "B":["1110","1001","1110","1001","1110"], " ":["0"] * 5}
pixels = []
x0 = -15
for char in "RPI 4B":
    glyph = font[char]
    for row, line in enumerate(glyph):
        for col, bit in enumerate(line):
            if bit == "1":
                pixels.append(box((x0 + col * .48, Y + .85, 21 + row * .48), (.37, .035, .37)))
    x0 += (len(glyph[0]) + 1) * .48
part("Board reference silkscreen", pcb_group, union(*pixels), 5, role="structural",
     description="Original text-only reference marking; no supplier artwork is reproduced.")

gltf = {"asset": {"version": "2.0", "generator": "Smart Factory original Raspberry Pi reference; MIT"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": nodes, "meshes": meshes,
        "materials": [{"name": name, "pbrMetallicRoughness": {"baseColorFactor": color,
                      "metallicFactor": metal, "roughnessFactor": rough}} for name, color, metal, rough in palette],
        "buffers": [{"byteLength": len(binary)}], "bufferViews": views, "accessors": accessors}
encoded = json.dumps(gltf, separators=(",", ":")).encode()
encoded += b" " * (-len(encoded) % 4)
glb = struct.pack("<4sII", b"glTF", 2, 28 + len(encoded) + len(binary)) + \
      struct.pack("<I4s", len(encoded), b"JSON") + encoded + struct.pack("<I4s", len(binary), b"BIN\0") + binary
digest = hashlib.sha256(glb).hexdigest()
template = {"revision": REVISION, "name": "Raspberry Pi 4 Model B · illustrative", "assetType": "gateway",
            "assetTypeId": "urn:smart-factory:type:raspberry-pi-4b-illustrative", "status": "Original illustrative reference; not manufacturer CAD or an installed-board attestation",
            "sha256": digest, "units": "m", "handedness": "right", "upAxis": "+Y",
            "components": components, "bindings": [], "maintenanceText": None,
            "initialViewDirection": [1.4, 1.2, 1],
            "provenance": "Original MIT parametric geometry; official Raspberry Pi 4 Model B reference outline. No supplier CAD, logo or textures."}
(ROOT / "model.glb").write_bytes(glb)
(ROOT / "template.json").write_text(json.dumps(template, indent=2) + "\n")
(ROOT / "geometry-audit.json").write_text(json.dumps({"revision": REVISION, "sha256": digest,
    "bytes": len(glb), "components": len(components), "triangles": sum(a["triangles"] for a in audits),
    "outlineMm": [85, 56], "mountingPatternMm": [58, 49], "gpioContacts": 40,
    "usbSockets": 4, "solids": audits, "limitations": ["Illustration, not manufacturing CAD.",
    "Connector interiors, package exteriors and routing are simplified.",
    "No silicon internals, circuitry, measured state or installed hardware revision is asserted."]}, indent=2) + "\n")
assert len(components) <= 128
print(json.dumps({"revision": REVISION, "sha256": digest, "bytes": len(glb), "components": len(components),
                  "triangles": sum(a["triangles"] for a in audits)}))

"""Original MIT factory reference models. Metres, +Y up, closed inspectable solids.

Illustrative proportions and internal construction, not supplier CAD or a
commissioned installation. No external textures, animation or live state.
Rebuild using the pinned manifold3d/numpy geometry dependencies.
"""
from pathlib import Path
from uuid import UUID, uuid5
import hashlib
import json
import math
import struct
import manifold3d as md
import numpy as np

M = md.Manifold
ROOT = Path(__file__).resolve().parents[2] / "fixtures/equipment/factory"
NS = UUID("a67c121a-dead-5709-b8a0-8aa39031e122")
PALETTE = [
    ("Industrial blue enamel", [.018, .10, .18, 1], .05, .36),
    ("Safety orange enamel", [.75, .15, .018, 1], .05, .36),
    ("Machined stainless steel", [.46, .51, .56, 1], .95, .25),
    ("Satin steel", [.28, .32, .36, 1], .9, .44),
    ("Rubber", [.012, .015, .02, 1], .01, .82),
    ("Brass", [.7, .45, .12, 1], .9, .26),
    ("Cabinet powder coat", [.50, .54, .58, 1], .04, .43),
    ("Black polymer", [.025, .03, .04, 1], .02, .62),
    ("Copper", [.55, .17, .04, 1], .95, .29),
    ("Light polymer", [.70, .72, .70, 1], .01, .56),
    ("Inspection glass", [.08, .13, .15, .32], .05, .13),
    ("Safety yellow", [.8, .50, .02, 1], .03, .42),
    ("Green polymer", [.02, .17, .07, 1], .03, .55),
]


def union(*solids):
    return M.batch_boolean(list(solids), md.OpType.Add)


def box(p, size):
    return M.cube(size, center=True).translate(p)


def cylinder(p, height, radius, axis="y", segments=40):
    result = M.cylinder(height, radius, circular_segments=segments, center=True)
    if axis == "y":
        result = result.rotate((90, 0, 0))
    if axis == "x":
        result = result.rotate((0, 90, 0))
    return result.translate(p)


def ring(p, height, radius, bore, axis="y", segments=48):
    return cylinder(p, height, radius, axis, segments) - cylinder(p, height + .02, bore, axis, segments)


def strut(a, b, radius, segments=20):
    a, b = np.array(a), np.array(b)
    delta = b - a
    length = float(np.linalg.norm(delta))
    w = delta / length
    u = np.cross(np.array([0, 1, 0]) if abs(w[1]) < .99 else np.array([1, 0, 0]), w)
    u /= np.linalg.norm(u)
    v = np.cross(w, u)
    transform = np.column_stack((u, v, w, (a + b) / 2))
    return M.cylinder(length, radius, circular_segments=segments, center=True).transform(transform)


def rounded_box(p, size, radius=.02):
    x, y, z = p
    w, h, d = size
    return union(box(p, (w - 2 * radius, h, d)), box(p, (w, h, d - 2 * radius)), *[
        cylinder((x + sx * (w / 2 - radius), y, z + sz * (d / 2 - radius)), h, radius, segments=16)
        for sx in [-1, 1] for sz in [-1, 1]
    ])


def fasteners(p, axis, count, pitch, radius=.008):
    parts = []
    for i in range(count):
        a = math.tau * i / count
        q = list(p)
        for k, v in zip([k for k in range(3) if k != {"x": 0, "y": 1, "z": 2}[axis]], [math.cos(a) * pitch, math.sin(a) * pitch]):
            q[k] += v
        parts.extend([cylinder(q, radius * 1.2, radius, axis, 6), ring(q, radius * .25, radius * 1.35, radius * .6, axis, 24)])
    return union(*parts)


class Model:
    def __init__(self, slug, title, asset_type, direction=(1.4, 1, 1.5)):
        self.slug, self.title, self.asset_type, self.direction = slug, title, asset_type, direction
        self.revision = f"smart-factory-illustrative-{slug}-1"
        self.nodes, self.components, self.meshes, self.views, self.accessors, self.audits = [], [], [], [], [], []
        self.binary = bytearray()
        self.add(title, None)

    def add(self, name, parent=0, solid=None, material=2, move=(0, 0, 0), role="internal", quantity=1, rotation=(0, 0, 0), pivot=(0, 0, 0)):
        index = len(self.nodes)
        node_name = name.replace(" ", "_").replace("/", "_")
        path = (self.components[parent]["nodePath"] if parent is not None else "") + "/" + node_name
        node = {"name": node_name, "children": []}
        if parent is not None:
            self.nodes[parent]["children"].append(index)
        if solid is not None:
            assert solid.status() == md.Error.NoError and solid.volume() > 0, name
            mesh = solid.calculate_normals(0, 40).to_mesh()
            position = np.asarray(mesh.vert_properties[:, :3], dtype="<f4")
            normal = np.asarray(mesh.vert_properties[:, 3:6], dtype="<f4")
            short = len(position) < 65536
            indices = np.asarray(mesh.tri_verts, dtype="<u2" if short else "<u4").reshape(-1)
            attributes = {}
            for key, values, kind, component_type in [("POSITION", position, "VEC3", 5126), ("NORMAL", normal, "VEC3", 5126), ("indices", indices, "SCALAR", 5123 if short else 5125)]:
                data = values.tobytes()
                self.views.append({"buffer": 0, "byteOffset": len(self.binary), "byteLength": len(data)})
                self.binary.extend(data)
                self.binary.extend(b"\0" * (-len(self.binary) % 4))
                accessor = {"bufferView": len(self.views) - 1, "componentType": component_type, "count": len(values), "type": kind}
                if key == "POSITION":
                    accessor.update(min=position.min(axis=0).tolist(), max=position.max(axis=0).tolist())
                attributes[key] = len(self.accessors)
                self.accessors.append(accessor)
            node["mesh"] = len(self.meshes)
            self.meshes.append({"name": name, "primitives": [{"attributes": {"POSITION": attributes["POSITION"], "NORMAL": attributes["NORMAL"]}, "indices": attributes["indices"], "material": material}]})
            self.audits.append({"name": name, "positiveVolumeCubicMetres": solid.volume(), "triangles": len(indices) // 3, "manifold": True})
        self.nodes.append(node)
        self.components.append({"templateComponentId": str(uuid5(NS, self.slug + ":" + name)), "name": name,
            "nodeIndex": index, "nodePath": path, "parentTemplateComponentId": self.components[parent]["templateComponentId"] if parent is not None else None,
            "designation": f"REF-{self.slug.upper()}-{index:03d}", "quantity": quantity,
            "material": PALETTE[material][0] if solid is not None else "Assembly", "role": role if solid is not None else "group", "solid": solid is not None,
            "inventoryKind": "assembly" if solid is None else "repeated part set" if quantity > 1 else "individual part",
            "source": "scripts/equipment/factory_geometry.py", "description": "Original illustrative component.",
            "explode": {"translation": list(move), "rotation": list(rotation), "pivot": list(pivot)}})
        return index

    def write(self):
        materials = []
        for name, color, metal, roughness in PALETTE:
            material = {"name": name, "pbrMetallicRoughness": {"baseColorFactor": color, "metallicFactor": metal, "roughnessFactor": roughness}}
            if color[3] < 1:
                material["alphaMode"] = "BLEND"
            materials.append(material)
        gltf = {"asset": {"version": "2.0", "generator": "Smart Factory original factory references; MIT"}, "scene": 0,
            "scenes": [{"nodes": [0]}], "nodes": self.nodes, "meshes": self.meshes, "materials": materials,
            "buffers": [{"byteLength": len(self.binary)}], "bufferViews": self.views, "accessors": self.accessors}
        encoded = json.dumps(gltf, separators=(",", ":")).encode()
        encoded += b" " * (-len(encoded) % 4)
        glb = struct.pack("<4sII", b"glTF", 2, 28 + len(encoded) + len(self.binary)) + struct.pack("<I4s", len(encoded), b"JSON") + encoded + struct.pack("<I4s", len(self.binary), b"BIN\0") + self.binary
        digest = hashlib.sha256(glb).hexdigest()
        template = {"revision": self.revision, "name": self.title + " · illustrative", "assetType": self.asset_type,
            "assetTypeId": "urn:smart-factory:type:" + self.slug + "-illustrative", "status": "Original illustrative reference; not manufacturer CAD or an installed-asset attestation",
            "sha256": digest, "units": "m", "handedness": "right", "upAxis": "+Y", "components": self.components,
            "bindings": [], "maintenanceText": None, "initialViewDirection": list(self.direction),
            "provenance": "Original MIT parametric factory geometry. Illustrative construction; no supplier CAD or external textures."}
        output = ROOT / self.slug
        output.mkdir(parents=True, exist_ok=True)
        (output / "model.glb").write_bytes(glb)
        (output / "template.json").write_text(json.dumps(template, indent=2) + "\n")
        summary = {"revision": self.revision, "sha256": digest, "bytes": len(glb), "components": len(self.components), "triangles": sum(p["triangles"] for p in self.audits)}
        (output / "geometry-audit.json").write_text(json.dumps({**summary, "solids": self.audits, "limitations": ["Illustrative construction and proportions, not manufacturing CAD.", "No live state, connectivity, motion or component readings are asserted."]}, indent=2) + "\n")
        assert len(self.components) <= 128 and len(glb) < 1500000, summary
        print(json.dumps(summary))


def conveyor():
    m = Model("conveyor", "Belt conveyor", "conveyor", (1.5, 1, 2))
    frame = m.add("Support frame")
    for z, side in [(-.34, "Rear"), (.34, "Front")]:
        m.add(side + " chassis rail", frame, box((0, .77, z), (2.2, .18, .045)), 0, (0, 0, -.2 if z < 0 else .2), "housing")
    for x in [-.82, .82]:
        for z in [-.27, .27]:
            prefix = ("Left" if x < 0 else "Right") + (" rear" if z < 0 else " front")
            m.add(prefix + " leg", frame, box((x, .38, z), (.055, .72, .055)), 3, (x * .15, 0, z * .4), "structural")
            m.add(prefix + " adjustable foot", frame, union(cylinder((x, .035, z), .05, .015), cylinder((x, .01, z), .02, .052)), 7, (0, -.03, 0), "structural")
    m.add("Frame cross braces", frame, union(*[box((x, .19, 0), (.045, .055, .58)) for x in [-.82, .82]]), 3, (0, -.08, 0), "structural", 2)
    m.add("Upper frame crossmembers", frame, union(*[box((x, .69, 0), (.055, .055, .7)) for x in [-.82, .82]]), 3, (0, -.08, 0), "structural", 2)
    transport = m.add("Belt and rollers", move=(0, .25, 0))
    outer = union(box((0, .83, 0), (1.98, .18, .55)), cylinder((-.99, .83, 0), .55, .09, "z"), cylinder((.99, .83, 0), .55, .09, "z"))
    inner = union(box((0, .83, 0), (1.98, .16, .58)), cylinder((-.99, .83, 0), .58, .08, "z"), cylinder((.99, .83, 0), .58, .08, "z"))
    m.add("Continuous rubber belt", transport, outer - inner, 4, (0, .2, 0), "cover")
    for i, x in enumerate([-.99, .99]):
        m.add(("Drive" if i == 0 else "Tension") + " drum", transport, cylinder((x, .83, 0), .53, .078, "z"), 2, (0, .1, .25 if i else -.25))
        m.add(("Drive" if i == 0 else "Tension") + " bearing pair", transport, union(*[ring((x, .83, z), .045, .04, .014, "z") for z in [-.315, .315]]), 3, (0, .05, 0), quantity=2)
    for i in range(7):
        m.add(f"Support roller {i + 1}", transport, cylinder((-.75 + i * .25, .875, 0), .53, .026, "z", 32), 2, (0, .04 + .01 * i, 0))
    drive = m.add("Drive motor and reducer", move=(-.2, .05, -.25))
    m.add("Motor finned housing", drive, union(cylinder((-.99, .69, -.47), .24, .075, "z"), *[ring((-.99, .69, -.38 - i * .025), .007, .087, .074, "z", 32) for i in range(8)]), 0, (0, 0, -.15), "housing")
    m.add("Reducer casing", drive, rounded_box((-.99, .78, -.37), (.16, .16, .1), .02), 3, (0, 0, -.08), "housing")
    m.add("Motor shaft", drive, cylinder((-.99, .78, -.28), .3, .014, "z"), 2, (0, 0, -.13))
    m.add("Motor rotor", drive, cylinder((-.99, .69, -.47), .18, .04, "z"), 8, (0, .1, -.05))
    m.add("Drive guard", drive, box((-.99, .85, -.42), (.3, .025, .35)), 11, (0, .18, 0), "cover")
    m.write()


def valve():
    m = Model("valve", "Flanged ball valve", "valve", (1.4, 1, 1.7))
    body = m.add("Pressure body")
    centre = (0, .55, 0)
    shell = union(M.sphere(.19, circular_segments=48).translate(centre), cylinder(centre, .52, .13, "x")) - cylinder(centre, .6, .082, "x") - M.sphere(.137, circular_segments=40).translate(centre)
    m.add("Valve body shell", body, shell, 0, (0, 0, -.28), "housing")
    for sign, name in [(-1, "Inlet"), (1, "Outlet")]:
        flange = ring((sign * .28, .55, 0), .045, .18, .082, "x")
        for i in range(8):
            a = math.tau * i / 8
            flange -= cylinder((sign * .28, .55 + .145 * math.cos(a), .145 * math.sin(a)), .07, .011, "x", 24)
        m.add(name + " bolted flange", body, flange, 2, (sign * .16, 0, 0), "structural")
        m.add(name + " flange fasteners", body, fasteners((sign * .312, .55, 0), "x", 8, .145, .012), 3, (sign * .22, 0, 0), quantity=8)
        m.add(name + " elastomer seat", body, ring((sign * .125, .55, 0), .025, .115, .079, "x"), 4, (sign * .1, 0, 0))
    m.add("Bored stainless ball", body, M.sphere(.135, circular_segments=48).translate(centre) - cylinder(centre, .4, .079, "x"), 2, (0, -.15, .14))
    actuator = m.add("Handwheel actuator", move=(0, .24, 0))
    m.add("Valve spindle", actuator, cylinder((0, .87, 0), .52, .021), 2, (0, .14, 0))
    m.add("Packing gland", actuator, ring((0, .77, 0), .07, .057, .023), 5, (0, .1, 0))
    m.add("Actuator gearbox housing", actuator, rounded_box((0, .96, 0), (.2, .15, .16), .025), 0, (0, .16, 0), "housing")
    wheel = union(ring((0, 1.12, 0), .025, .20, .18), cylinder((0, 1.12, 0), .04, .047), *[box((0, 1.12, 0), (.36, .02, .018)).rotate((0, a, 0)) for a in [0, 60, 120]])
    m.add("Handwheel and spokes", actuator, wheel, 1, (0, .19, 0))
    m.add("Mounting saddles", solid=union(*[box((x, .30, 0), (.07, .25, .18)) for x in [-.17, .17]]), material=3, role="structural", quantity=2)
    m.write()


def robot():
    m = Model("robot-arm", "Six-axis industrial robot", "robot", (1.6, 1, 1.8))
    m.add("Anchored base flange", solid=ring((0, .055, 0), .11, .26, .045), material=3, role="structural")
    m.add("Base anchor bolts", solid=fasteners((0, .12, 0), "y", 8, .21, .015), material=2, quantity=8)
    joints = [("Axis 1 base rotation", (0, .25, 0), "y", .18), ("Axis 2 shoulder", (0, .53, 0), "z", .16), ("Axis 3 elbow", (-.30, 1.23, 0), "z", .135), ("Axis 4 forearm roll", (.13, 1.33, 0), "x", .105), ("Axis 5 wrist pitch", (.57, 1.43, 0), "z", .085), ("Axis 6 tool rotation", (.74, 1.43, 0), "x", .065)]
    for i, (name, p, axis, radius) in enumerate(joints):
        group = m.add(name, move=((i - 2) * .025, .08 * (i + 1), .08 if i % 2 else -.08))
        m.add(name + " housing", group, ring(p, radius * 1.65, radius, radius * .64, axis), 1, (0, 0, .13), "housing")
        m.add(name + " bearing", group, ring(p, radius * .65, radius * .63, radius * .37, axis), 2, (0, .04, 0))
        m.add(name + " geared rotor", group, cylinder(p, radius * .6, radius * .35, axis), 3, (0, -.05, 0))
        cover = list(p)
        cover[{"x": 0, "y": 1, "z": 2}[axis]] += radius * .88
        m.add(name + " service cover", group, cylinder(cover, radius * .16, radius * 1.01, axis), 7, (0, 0, -.2), "cover")
        cover[{"x": 0, "y": 1, "z": 2}[axis]] += radius * .1
        m.add(name + " cover bolts", group, fasteners(cover, axis, 6, radius * .75, radius * .055), 2, (0, 0, -.24), quantity=6)
    for title, a, b, radius in [("Upper arm casting", (0, .53, 0), (-.30, 1.23, 0), .11), ("Forearm casting", (-.30, 1.23, 0), (.57, 1.43, 0), .085)]:
        solid = union(M.sphere(radius, circular_segments=24).translate(a), M.sphere(radius, circular_segments=24).translate(b)).hull()
        m.add(title, solid=solid, material=1, move=(0, .16, -.22), role="housing")
    m.add("Tool mounting flange", solid=ring((.84, 1.43, 0), .035, .085, .026, "x"), material=2, move=(.16, 0, 0))
    m.add("Tool wrist link", solid=cylinder((.66, 1.43, 0), .2, .055, "x"), material=1, move=(0, .1, 0), role="housing")
    m.add("Tool flange bolts", solid=fasteners((.862, 1.43, 0), "x", 6, .064, .007), material=3, move=(.22, 0, 0), quantity=6)
    m.add("Pedestal drive cover", solid=cylinder((0, .28, 0), .29, .18), material=1, move=(0, .1, -.25), role="cover")
    cable = [(-.14, .3, -.18), (-.1, .62, -.18), (-.30, 1.22, -.15), (-.2, 1.32, -.14), (.45, 1.47, -.13)]
    m.add("Service cable loom", solid=union(*[strut(a,b,.018) for a,b in zip(cable,cable[1:])], *[M.sphere(.018, circular_segments=16).translate(p) for p in cable]), material=7, move=(0, .03, -.15))
    m.write()


def cabinet():
    m = Model("control-cabinet", "Industrial control cabinet", "other", (1.2, .7, 1.8))
    housing = box((0, .98, 0), (1, 1.8, .45)) - box((0, .98, .025), (.97, 1.77, .46))
    m.add("Sheet steel enclosure", solid=housing, material=6, move=(0, 0, -.4), role="housing")
    m.add("Raised base plinth", solid=box((0, .06, 0), (1.04, .12, .49)), material=7, role="structural")
    door = m.add("Hinged front door", move=(.4, 0, .5))
    m.add("Front door panel", door, box((0, .98, .245), (.98, 1.78, .018)) - box((-.1, 1.42, .245), (.43, .3, .05)), 0, (0, 0, .12), "cover")
    m.add("Inspection window glazing", door, box((-.1, 1.42, .247), (.42, .29, .012)), 10, (0, 0, .16), "cover")
    m.add("Window bezel", door, box((-.1, 1.42, .26), (.48, .35, .025)) - box((-.1, 1.42, .26), (.43, .3, .05)), 7, (0, 0, .19))
    m.add("Door latch handle", door, rounded_box((.35, 1.04, .275), (.035, .25, .045), .01), 7, (.06, 0, .14))
    m.add("Door hinge set", door, union(*[cylinder((-.485, y, .23), .09, .014) for y in [.4, 1.0, 1.6]]), 2, (-.05, 0, .1), quantity=3)
    back = m.add("Mounting plate and wiring", move=(0, 0, .12))
    m.add("Internal mounting plate", back, box((0, 1.0, -.175), (.89, 1.62, .012)), 3, (0, 0, -.08), "structural")
    for row, y in enumerate([.47, .78, 1.14, 1.52]):
        m.add(f"DIN rail {row + 1}", back, union(box((0, y, -.1), (.8, .035, .015)), box((0, y, -.085), (.8, .01, .025))), 2, (0, .025, .06), "structural")
    plc = m.add("Controller and power supply", back, move=(0, 0, .14))
    m.add("PLC controller modules", plc, union(*[box((-.25 + i * .07, 1.17, -.04), (.06, .2, .10)) for i in range(5)]), 7, (0, .05, .1), quantity=5)
    m.add("Controller terminal connectors", plc, union(*[box((-.25 + i * .07, 1.3, -.02), (.05, .04, .08)) for i in range(5)]), 12, (0, .08, .11), quantity=5)
    m.add("Power supply module", plc, box((.25, 1.5, -.04), (.19, .23, .12)), 9, (.05, .07, .1))
    m.add("Circuit breaker bank", back, union(*[box((-.28 + i * .06, .81, -.04), (.05, .14, .12)) for i in range(10)]), 9, (0, .04, .16), quantity=10)
    m.add("Breaker toggle levers", back, union(*[box((-.28 + i * .06, .82, .035), (.027, .04, .035)) for i in range(10)]), 0, (0, .04, .19), quantity=10)
    m.add("Terminal block bank", back, union(*[box((-.33 + i * .055, .49, -.055), (.045, .085, .09)) for i in range(13)]), 6, (0, .04, .1), quantity=13)
    m.add("Cable duct set", back, union(*[box((x, 1.0, -.06), (.055, 1.5, .065)) for x in [-.415, .415]], *[box((0, y, -.06), (.78, .05, .065)) for y in [.32, .64, .98, 1.36, 1.73]]), 9, (0, 0, .16), "cover", 7)
    for i, mat in enumerate([0, 1, 11, 12]):
        x = -.37 + i * .025
        m.add(f"Wiring loom {i + 1}", back, union(cylinder((x, 1.0, .005), 1.25, .004, segments=12), cylinder((x + .15, .4 + .08 * i, .005), .3, .004, "x", 12)), mat, (0, 0, .2))
    m.add("Cable entry gland row", solid=union(*[ring((-.3 + i * .1, .1, .07), .04, .025, .011) for i in range(7)]), material=7, move=(0, -.07, 0), quantity=7)
    m.write()


def tank():
    m = Model("storage-tank", "Stainless process tank", "tank", (1.4, .8, 1.8))
    centre_bottom, centre_top = (0, .65, 0), (0, 1.75, 0)
    outside = union(cylinder((0, 1.2, 0), 1.1, .43), M.sphere(.43, circular_segments=48).translate(centre_bottom), M.sphere(.43, circular_segments=48).translate(centre_top))
    inside = union(cylinder((0, 1.2, 0), 1.1, .422), M.sphere(.422, circular_segments=48).translate(centre_bottom), M.sphere(.422, circular_segments=48).translate(centre_top))
    shell = outside - inside - cylinder((0, 2.12, 0), .3, .10)
    m.add("Dished stainless vessel shell", solid=shell, material=2, move=(0, .1, -.65), role="housing")
    supports = m.add("Legs and skid")
    for i in range(4):
        a = math.tau * i / 4 + math.pi / 4
        p = (.31 * math.cos(a), .25, .31 * math.sin(a))
        m.add(f"Support leg {i + 1}", supports, cylinder(p, .5, .045), 3, (.1 * math.cos(a), -.05, .1 * math.sin(a)), "structural")
        m.add(f"Anchor foot {i + 1}", supports, box((p[0], .022, p[2]), (.16, .045, .16)), 3, (0, -.02, 0), "structural")
    top = m.add("Agitator and access assembly", move=(0, .35, 0))
    m.add("Top access flange", top, ring((0, 2.15, 0), .035, .15, .1), 2, (0, .09, 0))
    m.add("Access cover", top, cylinder((0, 2.18, 0), .025, .15), 2, (0, .19, 0), "cover")
    m.add("Access flange bolts", top, fasteners((0, 2.205, 0), "y", 8, .127, .009), 3, (0, .25, 0), quantity=8)
    m.add("Agitator motor housing", top, cylinder((0, 2.34, 0), .27, .10), 0, (0, .28, 0), "housing")
    m.add("Motor mounting flange", top, ring((0, 2.21, 0), .035, .10, .022), 3, (0, .22, 0))
    m.add("Agitator shaft", top, cylinder((0, 1.3, 0), 1.65, .018), 2, (.16, .05, .1))
    m.add("Mixing paddle set", top, union(*[box((0, y, 0), (.59, .035, .09)) for y in [.65, 1.08]]), 2, (.16, .05, .1), quantity=2)
    m.add("Side process nozzle", solid=ring((.48, .85, 0), .25, .055, .04, "x"), material=2, move=(.22, 0, 0))
    m.add("Nozzle flange", solid=ring((.61, .85, 0), .025, .095, .04, "x"), material=2, move=(.28, 0, 0))
    m.add("Bottom drain tube", solid=ring((0, .23, 0), .25, .039, .025), material=2, move=(0, -.1, 0))
    ladder = m.add("Access ladder", move=(0, 0, .25))
    m.add("Ladder rails", ladder, union(*[cylinder((x, 1.0, .52), 1.9, .016) for x in [-.18, .18]]), 3, (0, 0, .12), "structural", 2)
    m.add("Ladder rungs", ladder, union(*[cylinder((0, .17 + i * .23, .52), .36, .012, "x", 24) for i in range(8)]), 3, (0, 0, .16), "structural", 8)
    m.add("Ladder standoff brackets", ladder, union(*[box((0, y, .46), (.36, .035, .15)) for y in [.65, 1.65]]), 3, (0, 0, .2), "structural", 2)
    m.write()


if __name__ == "__main__":
    for generate in [conveyor, valve, robot, cabinet, tank]:
        generate()

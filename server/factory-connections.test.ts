import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { FloorLink } from "../shared/factory-floor";
import {
  FactoryConnectionLayer, connectionAnchor, connectionPath,
  connectionKey, defaultConnectionAppearance, readConnectionAppearances,
  validateConnectionAppearance, MAX_ROUTE_POINTS,
  type ConnectionAppearance,
} from "../client/src/components/workspace/factory-connections";
import { floorItemAtRay } from "../client/src/components/workspace/floor-picking";

const link: FloorLink = { from: "asset:1", to: "asset:2", kind: "process", label: "Process link" };
function fixture() {
  const from = new THREE.Group(), to = new THREE.Group();
  from.position.set(-4, 0, -2);
  to.position.set(4, 0, 2);
  from.userData.connectionSize = [2, 3, 2];
  to.userData.connectionSize = [2, 3, 2];
  return { from, to, objects: new Map([[link.from, from], [link.to, to]]) };
}
const meshes = (root: THREE.Object3D) => {
  const result: THREE.Mesh[] = [];
  root.traverse((object) => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
};

describe("factory physical connections", () => {
  for (const type of ["wire", "pipe"] as const)
    for (const shape of ["straight", "elbow", "curve", "custom"] as const)
      it(`renders finite ${type} meshes with ${shape} routing and endpoint couplings`, () => {
        const { objects } = fixture(), layer = new FactoryConnectionLayer(true);
        const appearance: ConnectionAppearance = {
          ...defaultConnectionAppearance(link), type, shape,
          points: shape === "custom" ? [{ x: -2, y: 2, z: 3 }, { x: 2, y: 2, z: 3 }] : [],
        };
        layer.update([link], objects, { [connectionKey(link)]: appearance });
        expect(layer.summary).toHaveLength(1);
        expect(layer.summary[0]).toMatchObject({ type, shape });
        expect(meshes(layer.root)).toHaveLength(3);
        expect(meshes(layer.root)[0].geometry).toBeInstanceOf(THREE.TubeGeometry);
        layer.root.traverse((object) => expect(object).not.toBeInstanceOf(THREE.Line));
        for (const mesh of meshes(layer.root)) {
          expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
          expect(Array.from(mesh.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
          expect(Array.from(mesh.geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
          expect(mesh.position.toArray().every(Number.isFinite)).toBe(true);
          expect(mesh.quaternion.toArray().every(Number.isFinite)).toBe(true);
        }
        expect(layer.root.userData.nonSelectable).toBe(true);
        layer.dispose();
        expect(layer.root.children).toHaveLength(0);
      });

  it("uses stable logical identities and preserves source records", () => {
    const original = JSON.stringify(link);
    const layer = new FactoryConnectionLayer(), { objects } = fixture();
    const renamed = { ...link, label: "New display name" };
    expect(connectionKey(renamed)).toBe(connectionKey(link));
    expect(connectionKey({ ...link, kind: "gateway" })).not.toBe(connectionKey(link));
    layer.update([link, renamed, { ...link, to: "missing" }, { ...link, to: link.from }], objects, {});
    expect(layer.summary).toHaveLength(1);
    expect(JSON.stringify(link)).toBe(original);
    layer.dispose();
  });

  it("reuses unchanged meshes and disposes replaced or removed geometry exactly once", () => {
    const { objects, from } = fixture(), layer = new FactoryConnectionLayer();
    layer.update([link], objects, {});
    const first = layer.root.children[0];
    const body = meshes(first)[0];
    let geometryDisposals = 0, materialDisposals = 0;
    body.geometry.addEventListener("dispose", () => geometryDisposals++);
    (body.material as THREE.Material).addEventListener("dispose", () => materialDisposals++);
    layer.update([link], objects, {});
    expect(layer.root.children[0]).toBe(first);
    const previous = layer.summary[0].from;
    from.position.x -= 2;
    layer.update([link], objects, {});
    expect(layer.summary[0].from).not.toEqual(previous);
    expect(layer.root.children[0]).not.toBe(first);
    expect(geometryDisposals).toBe(1);
    expect(materialDisposals).toBe(1);
    layer.update([], objects, {});
    expect(layer.root.children).toHaveLength(0);
    expect(layer.summary).toEqual([]);
    layer.dispose();
    expect(geometryDisposals).toBe(1);
    expect(materialDisposals).toBe(1);
  });

  it("anchors to the facing equipment surface and follows its rotation and translation", () => {
    const { from, to } = fixture(), appearance = defaultConnectionAppearance(link);
    from.userData.connectionSize = [4, 3, 1];
    const before = connectionAnchor(from, to, appearance);
    expect(before.y).toBe(appearance.height);
    from.rotation.y = Math.PI / 2;
    const rotated = connectionAnchor(from, to, appearance);
    expect(rotated.toArray()).not.toEqual(before.toArray());
    const offset = new THREE.Vector3(3, 0, 1);
    from.position.add(offset); to.position.add(offset);
    expect(connectionAnchor(from, to, appearance).distanceTo(rotated.clone().add(offset))).toBeLessThan(1e-10);
  });

  it("retains custom world points and handles duplicate/zero-length segments", () => {
    const appearance = { ...defaultConnectionAppearance(link), shape: "custom" as const,
      points: [{ x: 0, y: 2, z: 1 }, { x: 0, y: 2, z: 1 }] };
    const from = new THREE.Vector3(-2, 1, 0), to = new THREE.Vector3(2, 1, 0);
    const saved = JSON.stringify(appearance.points);
    const path = connectionPath(from, to, appearance)!;
    expect(path.getPoint(0).distanceTo(from)).toBeLessThan(1e-10);
    expect(path.getPoint(1).distanceTo(to)).toBeLessThan(1e-10);
    expect(path.getPoints(48).every((p) => p.toArray().every(Number.isFinite))).toBe(true);
    expect(JSON.stringify(appearance.points)).toBe(saved);
    expect(connectionPath(from, from.clone(), { ...appearance, shape: "straight" })).toBeNull();
  });

  it("does not steal equipment picking", () => {
    const root = new THREE.Group();
    const equipment = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    equipment.userData.floorItemRef = "asset:1";
    root.add(equipment);
    const layer = new FactoryConnectionLayer();
    const overlay = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    overlay.position.z = 2;
    layer.root.add(overlay); root.add(layer.root);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    expect(floorItemAtRay(root, ray)).toBe("asset:1");
    overlay.geometry.dispose(); (overlay.material as THREE.Material).dispose();
    equipment.geometry.dispose(); (equipment.material as THREE.Material).dispose();
    layer.dispose();
  });
});

describe("bounded routing preferences", () => {
  it("round-trips settings, sanitizes colour, and separates wire/pipe defaults", () => {
    const appearance = validateConnectionAppearance({ ...defaultConnectionAppearance(link), color: "#AABBCC" });
    expect(appearance.color).toBe("#aabbcc");
    const routes = { [connectionKey(link)]: appearance };
    const read = readConnectionAppearances(JSON.stringify({ version: 1, routes }));
    expect(read.error).toBe("");
    expect(read.values).toEqual(routes);
    expect(defaultConnectionAppearance(link).type).toBe("pipe");
    expect(defaultConnectionAppearance({ ...link, kind: "gateway" }).type).toBe("wire");
  });

  it("rejects invalid, unbounded and non-finite geometry input", () => {
    const base = defaultConnectionAppearance(link);
    for (const patch of [
      { type: "unknown" }, { shape: "unknown" }, { diameter: 0 }, { diameter: 2 },
      { height: NaN }, { height: Infinity }, { height: -1 }, { bendRadius: 100 },
      { color: "url(https://invalid.test)" }, { points: [{ x: 1, y: -2, z: 0 }] },
      { points: [{ x: Infinity, y: 1, z: 0 }] },
      { points: Array(MAX_ROUTE_POINTS + 1).fill({ x: 1, y: 1, z: 1 }) },
    ]) expect(() => validateConnectionAppearance({ ...base, ...patch })).toThrow();
  });

  it("returns recoverable errors rather than accepting corrupt saved records", () => {
    expect(readConnectionAppearances(null)).toEqual({ values: {}, error: "" });
    for (const raw of ["broken", "{}", '{"version":2,"routes":{}}', "x".repeat(1_000_001),
      JSON.stringify({ version: 1, routes: { bad: defaultConnectionAppearance(link) } })]) {
      const result = readConnectionAppearances(raw);
      expect(result.error).toContain("retained");
      expect(result.values).toEqual({});
    }
  });
});

describe("illustrative automatic cable trays", () => {
  it("merges overlapping collinear cable runs while keeping both logical links", () => {
    const hub = new THREE.Group(), a = new THREE.Group(), b = new THREE.Group();
    hub.position.set(-4, 0, 0); a.position.set(4, 0, 0); b.position.set(4, 0, 2);
    for (const object of [hub, a, b]) object.userData.connectionSize = [2, 3, 2];
    const objects = new Map([["device:hub", hub], ["device:a", a], ["device:b", b]]);
    const routes: FloorLink[] = [
      { from: "device:hub", to: "device:a", kind: "gateway", label: "A" },
      { from: "device:hub", to: "device:b", kind: "gateway", label: "B" },
    ];
    const layer = new FactoryConnectionLayer(true);
    layer.update(routes, objects, {}, { width: 30, depth: 20 });
    expect(layer.summary).toHaveLength(2);
    expect(layer.trayMetrics).toEqual({ trunks: 1, branches: 2 });
    const branches = layer.root.children.filter((child) => child.name === "illustrative-cable-tray-branch");
    const targetAisle = branches.map((branch) => meshes(branch)[0].geometry as THREE.TubeGeometry)
      .find((geometry) => Math.abs(geometry.parameters.path.getPoint(0).x - 2.985) < 0.0001);
    expect(targetAisle).toBeDefined();
    const endpoints = [targetAisle!.parameters.path.getPoint(0), targetAisle!.parameters.path.getPoint(1)];
    expect(Math.min(...endpoints.map((point) => point.z))).toBe(-9.5);
    expect(Math.max(...endpoints.map((point) => point.z))).toBe(2);
    layer.dispose();
  });

  it("shares a low orthogonal tray without changing logical links or endpoints", () => {
    const source = new THREE.Group(), a = new THREE.Group(), b = new THREE.Group();
    source.position.set(-4, 0, 0); a.position.set(4, 0, 0); b.position.set(6, 0, 2);
    for (const object of [source, a, b]) object.userData.connectionSize = [2, 3, 2];
    const objects = new Map([["device:hub", source], ["device:a", a], ["device:b", b]]);
    const routes: FloorLink[] = [
      { from: "device:hub", to: "device:a", kind: "gateway", label: "A" },
      { from: "device:hub", to: "device:b", kind: "gateway", label: "B" },
    ];
    const before = JSON.stringify(routes), layer = new FactoryConnectionLayer(true);
    layer.update(routes, objects, {}, { width: 30, depth: 20 });
    expect(JSON.stringify(routes)).toBe(before);
    expect(layer.summary).toHaveLength(2);
    for (const [index, target] of [a, b].entries()) {
      const appearance = defaultConnectionAppearance(routes[index]);
      expect(appearance.routing).toBe("tray");
      expect(layer.summary[index].from).toEqual(connectionAnchor(source, target, appearance).toArray());
      expect(layer.summary[index].to).toEqual(connectionAnchor(target, source, appearance).toArray());
    }
    const trunks = layer.root.children.filter((child) => child.name === "illustrative-cable-tray");
    const branches = layer.root.children.filter((child) => child.name === "illustrative-cable-tray-branch");
    layer.update(routes, objects, {}, { width: 30, depth: 20 });
    expect(layer.root.children.filter((child) => child.name === "illustrative-cable-tray")[0]).toBe(trunks[0]);
    expect(layer.root.children.filter((child) => child.name === "illustrative-cable-tray-branch")).toEqual(branches);
    expect(trunks).toHaveLength(1);
    expect(branches).toHaveLength(3); // The shared hub branch is not duplicated.
    expect(layer.trayMetrics).toEqual({ trunks: 1, branches: 3 });
    const trunk = meshes(trunks[0])[0];
    expect(trunk.position.z).toBe(-9.5);
    expect(trunk.position.y).toBeLessThan(0.2);
    for (const branch of branches) {
      const body = meshes(branch)[0];
      const geometry = body.geometry as THREE.TubeGeometry;
      const path = geometry.parameters.path;
      const points = path.getPoints(30);
      expect(new Set(points.map((point) => point.x.toFixed(5))).size).toBe(1);
      expect(body.castShadow).toBe(false);
    }
    let removed = 0;
    const oldTrunk = meshes(trunks[0])[0].geometry;
    oldTrunk.addEventListener("dispose", () => removed++);
    b.position.x += 2;
    layer.update(routes, objects, {}, { width: 30, depth: 20 });
    expect(removed).toBe(1);
    expect(layer.summary).toHaveLength(2);
    layer.update([], objects, {}, { width: 30, depth: 20 });
    expect(layer.root.children).toHaveLength(0);
    expect(layer.trayMetrics).toEqual({ trunks: 0, branches: 0 });
    layer.dispose();
    expect(removed).toBe(1);
  });

  it("retains custom routes and legacy saved wire preferences", () => {
    const oldWire = { ...defaultConnectionAppearance({ ...link, kind: "gateway" }), routing: undefined, shape: "curve" as const };
    const saved = JSON.stringify({ version: 1, routes: { [connectionKey(link)]: oldWire } });
    expect(readConnectionAppearances(saved).values[connectionKey(link)]).toMatchObject({ shape: "curve" });
    const custom = { ...oldWire, shape: "custom" as const, points: [{ x: 0, y: 2, z: 3 }] };
    const { objects } = fixture(), layer = new FactoryConnectionLayer(true);
    layer.update([link], objects, { [connectionKey(link)]: custom }, { width: 30, depth: 20 });
    expect(layer.summary[0].shape).toBe("custom");
    expect(layer.root.children.some((child) => child.name === "illustrative-cable-tray")).toBe(false);
    expect(meshes(layer.root)).toHaveLength(3);
    const normalized = validateConnectionAppearance({ ...custom, routing: "tray" });
    expect(normalized.shape).toBe("custom");
    expect(normalized.routing).toBeUndefined();
    expect(normalized.points).toEqual(custom.points);
    layer.dispose();
  });
});

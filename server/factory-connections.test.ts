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

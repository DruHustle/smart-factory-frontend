import * as THREE from "three";
import type { FloorLink } from "@shared/factory-floor";
import {
  connectionKey, defaultConnectionAppearance, validateConnectionAppearance,
  type ConnectionAppearance, type ConnectionAppearances,
} from "./factory-connection-settings";
export * from "./factory-connection-settings";

const up = new THREE.Vector3(0, 1, 0);
const epsilon = 1e-6;

/** Attach to the visible equipment footprint, not the floor or the label. */
export function connectionAnchor(
  object: THREE.Object3D,
  other: THREE.Object3D,
  appearance: ConnectionAppearance,
): THREE.Vector3 {
  const size: number[] = object.userData.connectionSize ?? [1, 1, 1];
  const width = Math.max(0.05, size[0]), height = Math.max(0.05, size[1]),
    depth = Math.max(0.05, size[2]);
  const direction = other.position.clone().sub(object.position)
    .applyAxisAngle(up, -object.rotation.y);
  const point = new THREE.Vector3(
    0,
    Math.max(appearance.diameter / 2 + 0.025, Math.min(appearance.height, height * 0.65)),
    0,
  );
  if (Math.abs(direction.x) / width >= Math.abs(direction.z) / depth)
    point.x = (direction.x < 0 ? -1 : 1) * (width / 2 + 0.015);
  else point.z = (direction.z < 0 ? -1 : 1) * (depth / 2 + 0.015);
  return point.applyAxisAngle(up, object.rotation.y).add(object.position);
}

function roundedPath(points: THREE.Vector3[], radius: number): THREE.Curve<THREE.Vector3> | null {
  const unique = points.filter((point, i) => !i || point.distanceToSquared(points[i - 1]) > epsilon);
  if (unique.length < 2) return null;
  const path = new THREE.CurvePath<THREE.Vector3>();
  let cursor = unique[0];
  const line = (to: THREE.Vector3) => {
    if (cursor.distanceToSquared(to) > epsilon) path.add(new THREE.LineCurve3(cursor, to));
    cursor = to;
  };
  for (let i = 1; i < unique.length - 1; i++) {
    const corner = unique[i], before = unique[i - 1], after = unique[i + 1];
    const incoming = corner.clone().sub(before), outgoing = after.clone().sub(corner);
    const distance = Math.min(radius, incoming.length() * 0.25, outgoing.length() * 0.25);
    incoming.normalize(); outgoing.normalize();
    if (Math.abs(incoming.dot(outgoing)) > 0.999) { line(corner); continue; }
    const entry = corner.clone().addScaledVector(incoming, -distance);
    const exit = corner.clone().addScaledVector(outgoing, distance);
    line(entry);
    path.add(new THREE.QuadraticBezierCurve3(entry, corner, exit));
    cursor = exit;
  }
  line(unique[unique.length - 1]);
  return path.curves.length ? path : null;
}

export function connectionPath(
  from: THREE.Vector3,
  to: THREE.Vector3,
  appearance: ConnectionAppearance,
): THREE.Curve<THREE.Vector3> | null {
  const radius = appearance.diameter / 2;
  if (appearance.shape === "straight")
    return from.distanceToSquared(to) > epsilon ? new THREE.LineCurve3(from, to) : null;
  if (appearance.shape === "curve") {
    if (from.distanceToSquared(to) <= epsilon) return null;
    const lift = Math.max(appearance.height, from.y, to.y) + appearance.bendRadius;
    const first = from.clone().lerp(to, 0.25), second = from.clone().lerp(to, 0.75);
    first.y = second.y = lift;
    return new THREE.CubicBezierCurve3(from, first, second, to);
  }
  const level = Math.max(appearance.height, from.y, to.y, radius + 0.025);
  const points = appearance.shape === "custom"
    ? [from, ...appearance.points.map((p) => new THREE.Vector3(p.x, Math.max(p.y, radius + 0.025), p.z)), to]
    : [from, new THREE.Vector3(from.x, level, from.z),
        new THREE.Vector3(to.x, level, from.z), new THREE.Vector3(to.x, level, to.z), to];
  return roundedPath(points, Math.max(appearance.bendRadius, radius * 1.5));
}

export function disposeConnectionObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material])
      materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  object.removeFromParent();
}

type Entry = { signature: string; object: THREE.Group; summary: {
  id: string; type: string; shape: string; diameter: number; color: string;
  routing?: "tray";
  from: number[]; to: number[]; midpoint: number[];
} };

/** Real tube meshes. Logical FloorLink objects and the SVG floor plan are untouched. */
export class FactoryConnectionLayer {
  readonly root = new THREE.Group();
  private entries = new Map<string, Entry>();
  private trayBranches = new Map<string, THREE.Group>();
  private trayTrunks = new Map<string, THREE.Group>();
  constructor(private efficient = false) {
    this.root.name = "factory-physical-connections";
    this.root.userData.nonSelectable = true;
  }

  update(links: FloorLink[], objects: Map<string, THREE.Group>, appearances: ConnectionAppearances,
    bounds?: { width: number; depth: number }) {
    const active = new Set<string>();
    // The automatic cable tray is illustrative. Keep it inside the floor rather
    // than drawing high diagonal lines between every pair of devices.
    const minZ = Math.min(0, ...[...objects.values()].map((item) => item.position.z));
    const trayZ = bounds && Number.isFinite(bounds.depth) && bounds.depth > 1
      ? -bounds.depth / 2 + Math.min(0.5, bounds.depth / 4) : minZ - 0.5;
    type Tray = { appearance: ConnectionAppearance; endpoints: Map<string, THREE.Vector3> };
    const trays = new Map<string, Tray>();
    for (const link of links) {
      const id = connectionKey(link), fromObject = objects.get(link.from), toObject = objects.get(link.to);
      if (!fromObject || !toObject || fromObject === toObject || active.has(id)) continue;
      active.add(id);
      let appearance: ConnectionAppearance;
      try { appearance = validateConnectionAppearance(appearances[id] ?? defaultConnectionAppearance(link)); }
      catch { appearance = defaultConnectionAppearance(link); }
      const from = connectionAnchor(fromObject, toObject, appearance);
      const to = connectionAnchor(toObject, fromObject, appearance);
      const autoTray = appearance.type === "wire" && appearance.routing === "tray";
      if (autoTray) {
        const key = JSON.stringify([appearance.color, appearance.diameter, appearance.height, trayZ]);
        const tray = trays.get(key) ?? { appearance, endpoints: new Map<string, THREE.Vector3>() };
        for (const point of [from, to])
          tray.endpoints.set(JSON.stringify(point.toArray()), point);
        trays.set(key, tray);
      }
      const signature = JSON.stringify([from.toArray(), to.toArray(), appearance, autoTray ? trayZ : null]);
      const previous = this.entries.get(id);
      if (previous?.signature === signature) continue;
      if (previous) { disposeConnectionObject(previous.object); this.entries.delete(id); }
      const level = Math.max(appearance.height, appearance.diameter / 2 + 0.025);
      const path = autoTray ? roundedPath([
        from, new THREE.Vector3(from.x, level, from.z), new THREE.Vector3(from.x, level, trayZ),
        new THREE.Vector3(to.x, level, trayZ), new THREE.Vector3(to.x, level, to.z), to,
      ], Math.max(appearance.bendRadius, appearance.diameter * 0.75)) : connectionPath(from, to, appearance);
      if (!path || path.getLength() < 0.001) continue;
      const object = new THREE.Group();
      object.name = `connection:${id}`;
      object.userData.nonSelectable = true;
      if (!autoTray) {
      const material = new THREE.MeshStandardMaterial({
        color: appearance.color,
        metalness: appearance.type === "pipe" ? 0.72 : 0.05,
        roughness: appearance.type === "pipe" ? 0.34 : 0.72,
      });
      const segments = Math.min(128, Math.max(24, Math.ceil(path.getLength() * 3), appearance.points.length * 8));
      const body = new THREE.Mesh(
        new THREE.TubeGeometry(path, this.efficient ? Math.min(64, segments) : segments,
          appearance.diameter / 2, this.efficient ? 8 : 12, false),
        material,
      );
      body.castShadow = body.receiveShadow = true;
      object.add(body);
      // Couplings terminate the route at the equipment rather than as floating strokes.
      for (const t of [0, 1]) {
        const radius = appearance.diameter * (appearance.type === "pipe" ? 0.8 : 0.65);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius,
          appearance.diameter * 0.5, 12), material);
        collar.position.copy(path.getPoint(t));
        const tangent = path.getTangent(t);
        if (tangent.lengthSq() > epsilon) collar.quaternion.setFromUnitVectors(up, tangent.normalize());
        collar.castShadow = collar.receiveShadow = true;
        object.add(collar);
      }
      }
      this.root.add(object);
      this.entries.set(id, { signature, object, summary: {
        id, type: appearance.type, shape: appearance.shape,
        ...(autoTray ? { routing: "tray" as const } : {}),
        diameter: appearance.diameter, color: appearance.color,
        from: from.toArray(), to: to.toArray(), midpoint: path.getPoint(0.5).toArray(),
      } });
    }
    for (const [id, entry] of this.entries) {
      if (active.has(id)) continue;
      disposeConnectionObject(entry.object);
      this.entries.delete(id);
    }
    this.updateTrays(trays, trayZ);
  }

  private updateTrays(
    trays: Map<string, { appearance: ConnectionAppearance; endpoints: Map<string, THREE.Vector3> }>,
    trayZ: number,
  ) {
    const activeBranches = new Set<string>(), activeTrunks = new Set<string>();
    for (const [style, { appearance, endpoints }] of trays) {
      const points = [...endpoints.values()];
      if (!points.length) continue;
      const level = Math.max(appearance.height, appearance.diameter / 2 + 0.025);
      const minX = Math.min(...points.map((point) => point.x));
      const maxX = Math.max(...points.map((point) => point.x));
      const trunkKey = JSON.stringify([style, minX, maxX]);
      activeTrunks.add(trunkKey);
      if (!this.trayTrunks.has(trunkKey) && maxX - minX > 0.001) {
        const group = new THREE.Group();
        group.name = "illustrative-cable-tray";
        group.userData.nonSelectable = true;
        const width = Math.max(0.12, appearance.diameter * 2);
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(maxX - minX, appearance.diameter, width),
          new THREE.MeshStandardMaterial({ color: appearance.color, metalness: 0.35, roughness: 0.7 }),
        );
        mesh.position.set((minX + maxX) / 2, level - appearance.diameter / 2, trayZ);
        group.add(mesh);
        this.root.add(group);
        this.trayTrunks.set(trunkKey, group);
      }
      const aisles = new Map<number, THREE.Vector3[]>();
      for (const point of points) {
        const aisle = aisles.get(point.x) ?? [];
        aisle.push(point);
        aisles.set(point.x, aisle);
      }
      for (const [x, anchors] of aisles) {
        // All branches reach the same trunk. Merge overlapping collinear runs
        // rather than stacking identical translucent-looking tube surfaces.
        const start = Math.min(trayZ, ...anchors.map((point) => point.z));
        const end = Math.max(trayZ, ...anchors.map((point) => point.z));
        const verticals = new Map<number, { min: number; max: number }>();
        for (const point of anchors) {
          const range = verticals.get(point.z) ?? { min: level, max: level };
          range.min = Math.min(range.min, point.y);
          range.max = Math.max(range.max, point.y);
          verticals.set(point.z, range);
        }
        const verticalRanges = [...verticals].sort(([a], [b]) => a - b);
        const branchKey = JSON.stringify([style, x, start, end, verticalRanges]);
        activeBranches.add(branchKey);
        if (this.trayBranches.has(branchKey)) continue;
        const group = new THREE.Group();
        group.name = "illustrative-cable-tray-branch";
        group.userData.nonSelectable = true;
        const material = new THREE.MeshStandardMaterial({ color: appearance.color, metalness: 0.05, roughness: 0.72 });
        const addRun = (from: THREE.Vector3, to: THREE.Vector3) => {
          const length = from.distanceTo(to);
          if (length < 0.001) return;
          const segments = Math.min(64, Math.max(8, Math.ceil(length * 2)));
          const mesh = new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.LineCurve3(from, to), segments, appearance.diameter / 2, this.efficient ? 6 : 8, false),
            material,
          );
          // Low-profile cable routes should not pepper the floor with wire shadows.
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          group.add(mesh);
        };
        addRun(new THREE.Vector3(x, level, start), new THREE.Vector3(x, level, end));
        for (const [z, range] of verticalRanges)
          addRun(new THREE.Vector3(x, range.min, z), new THREE.Vector3(x, range.max, z));
        if (!group.children.length) { material.dispose(); continue; }
        this.root.add(group);
        this.trayBranches.set(branchKey, group);
      }
    }
    for (const [key, group] of this.trayBranches) if (!activeBranches.has(key)) {
      disposeConnectionObject(group); this.trayBranches.delete(key);
    }
    for (const [key, group] of this.trayTrunks) if (!activeTrunks.has(key)) {
      disposeConnectionObject(group); this.trayTrunks.delete(key);
    }
  }

  get summary() { return [...this.entries.values()].map((entry) => entry.summary); }
  get trayMetrics() { return { trunks: this.trayTrunks.size, branches: this.trayBranches.size }; }
  dispose() {
    for (const entry of this.entries.values()) disposeConnectionObject(entry.object);
    for (const group of this.trayBranches.values()) disposeConnectionObject(group);
    for (const group of this.trayTrunks.values()) disposeConnectionObject(group);
    this.entries.clear(); this.trayBranches.clear(); this.trayTrunks.clear();
    this.root.removeFromParent();
  }
}

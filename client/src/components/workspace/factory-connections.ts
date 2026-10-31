import * as THREE from "three";
import type { FloorLink } from "@shared/factory-floor";

export type RoutePoint = { x: number; y: number; z: number };
export type ConnectionAppearance = {
  type: "wire" | "pipe";
  shape: "straight" | "elbow" | "curve" | "custom";
  height: number;
  diameter: number;
  bendRadius: number;
  color: string;
  points: RoutePoint[];
};
export type ConnectionAppearances = Record<string, ConnectionAppearance>;
export const MAX_ROUTE_POINTS = 12;
export const EMPTY_CONNECTION_APPEARANCES: ConnectionAppearances = Object.freeze({});

// Labels may change independently of identity. JSON encoding avoids delimiter collisions.
export const connectionKey = (link: FloorLink) =>
  JSON.stringify([link.kind, link.from, link.to]);

export function defaultConnectionAppearance(link: FloorLink): ConnectionAppearance {
  const pipe = link.kind === "process";
  return {
    type: pipe ? "pipe" : "wire",
    shape: pipe ? "elbow" : "curve",
    height: pipe ? 0.8 : 0.35,
    diameter: pipe ? 0.16 : 0.07,
    bendRadius: 0.25,
    color: pipe ? "#a5b1bf" : "#405d6b",
    points: [],
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function number(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${name} must be between ${min} and ${max}.`);
  return value;
}

/** Browser preferences are untrusted input, not operational connection records. */
export function validateConnectionAppearance(value: unknown): ConnectionAppearance {
  if (!record(value)) throw Error("Invalid connection appearance.");
  const { type, shape, color } = value;
  if (type !== "wire" && type !== "pipe") throw Error("Choose wire or pipe.");
  if (shape !== "straight" && shape !== "elbow" && shape !== "curve" && shape !== "custom")
    throw Error("Choose a supported route shape.");
  if (typeof color !== "string" || !/^#[a-f\d]{6}$/i.test(color))
    throw Error("Choose a six-digit colour.");
  if (!Array.isArray(value.points) || value.points.length > MAX_ROUTE_POINTS)
    throw Error(`Use at most ${MAX_ROUTE_POINTS} route points.`);
  const points = value.points.map((point): RoutePoint => {
    if (!record(point)) throw Error("Invalid route point.");
    return {
      x: number(point.x, -1000, 1000, "Point X"),
      y: number(point.y, 0.05, 100, "Point height"),
      z: number(point.z, -1000, 1000, "Point Z"),
    };
  });
  return {
    type, shape, color: color.toLowerCase(), points,
    height: number(value.height, 0.05, 100, "Route height"),
    diameter: number(value.diameter, 0.02, 1, "Diameter"),
    bendRadius: number(value.bendRadius, 0.01, 10, "Bend radius"),
  };
}

export function readConnectionAppearances(raw: string | null): {
  values: ConnectionAppearances;
  error: string;
} {
  if (!raw) return { values: {}, error: "" };
  try {
    if (raw.length > 1_000_000) throw Error("Stored routing is too large.");
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || !record(value.routes))
      throw Error("Unsupported stored routing.");
    const entries = Object.entries(value.routes);
    if (entries.length > 1000) throw Error("Too many stored routes.");
    const values: ConnectionAppearances = Object.create(null);
    for (const [key, appearance] of entries) {
      const identity: unknown = JSON.parse(key);
      if (!Array.isArray(identity) || identity.length !== 3 ||
          !identity.every((part) => typeof part === "string" && part.length <= 512))
        throw Error("Invalid stored connection identity.");
      values[key] = validateConnectionAppearance(appearance);
    }
    return { values, error: "" };
  } catch {
    return {
      values: {},
      error: "Stored 3D routing could not be read. It has been retained; defaults are shown. Reset stored routing to replace it.",
    };
  }
}

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
  from: number[]; to: number[]; midpoint: number[];
} };

/** Real tube meshes. Logical FloorLink objects and the SVG floor plan are untouched. */
export class FactoryConnectionLayer {
  readonly root = new THREE.Group();
  private entries = new Map<string, Entry>();
  constructor(private efficient = false) {
    this.root.name = "factory-physical-connections";
    this.root.userData.nonSelectable = true;
  }

  update(links: FloorLink[], objects: Map<string, THREE.Group>, appearances: ConnectionAppearances) {
    const active = new Set<string>();
    for (const link of links) {
      const id = connectionKey(link), fromObject = objects.get(link.from), toObject = objects.get(link.to);
      if (!fromObject || !toObject || fromObject === toObject || active.has(id)) continue;
      active.add(id);
      let appearance: ConnectionAppearance;
      try { appearance = validateConnectionAppearance(appearances[id] ?? defaultConnectionAppearance(link)); }
      catch { appearance = defaultConnectionAppearance(link); }
      const from = connectionAnchor(fromObject, toObject, appearance);
      const to = connectionAnchor(toObject, fromObject, appearance);
      const signature = JSON.stringify([from.toArray(), to.toArray(), appearance]);
      const previous = this.entries.get(id);
      if (previous?.signature === signature) continue;
      if (previous) { disposeConnectionObject(previous.object); this.entries.delete(id); }
      const path = connectionPath(from, to, appearance);
      if (!path || path.getLength() < 0.001) continue;
      const object = new THREE.Group();
      object.name = `connection:${id}`;
      object.userData.nonSelectable = true;
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
      this.root.add(object);
      this.entries.set(id, { signature, object, summary: {
        id, type: appearance.type, shape: appearance.shape,
        diameter: appearance.diameter, color: appearance.color,
        from: from.toArray(), to: to.toArray(), midpoint: path.getPoint(0.5).toArray(),
      } });
    }
    for (const [id, entry] of this.entries) {
      if (active.has(id)) continue;
      disposeConnectionObject(entry.object);
      this.entries.delete(id);
    }
  }

  get summary() { return [...this.entries.values()].map((entry) => entry.summary); }
  dispose() {
    for (const entry of this.entries.values()) disposeConnectionObject(entry.object);
    this.entries.clear();
    this.root.removeFromParent();
  }
}

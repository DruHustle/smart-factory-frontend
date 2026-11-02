import type { FloorLink } from "@shared/factory-floor";

export type RoutePoint = { x: number; y: number; z: number };
export type ConnectionAppearance = {
  type: "wire" | "pipe";
  shape: "straight" | "elbow" | "curve" | "custom";
  // Optional for compatibility with saved v1 preferences and older clients.
  routing?: "tray";
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
    shape: "elbow",
    ...(pipe ? {} : { routing: "tray" as const }),
    height: pipe ? 0.8 : 0.12,
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
  if (value.routing !== undefined && value.routing !== "tray")
    throw Error("Choose a supported automatic routing mode.");
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
    type, shape, ...(value.routing === "tray" && type === "wire" && shape === "elbow"
      ? { routing: "tray" as const } : {}),
    color: color.toLowerCase(), points,
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

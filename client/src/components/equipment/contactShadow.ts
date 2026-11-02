import * as T from "three";
import type { InspectionState } from "./inspection";

/** A baked footprint is valid only for the intact, opaque assembly. */
export function contactShadowVisible(
  state: InspectionState,
  appliedExplosion = state.explode,
) {
  return (
    state.explode === 0 &&
    Math.abs(appliedExplosion) < 0.000001 &&
    state.section === "off" &&
    !state.ghost &&
    !state.covers &&
    (state.opacity ?? 1) === 1 &&
    state.hidden.length === 0 &&
    !state.isolated
  );
}

/** A small, model-derived contact footprint, baked once without an extra GPU pass.
 * This is presentation shading, not physical simulation or a geometry change. */
export function contactShadow(model: T.Object3D, bounds: T.Box3) {
  const size = bounds.getSize(new T.Vector3());
  if (bounds.isEmpty() || ![size.x, size.y, size.z].every(Number.isFinite))
    return null;
  const span = Math.max(size.x, size.y, size.z, 0.001);
  const width = Math.max(size.x * 1.3, span * 0.08);
  const depth = Math.max(size.z * 1.3, span * 0.08);
  const height = Math.max(size.y * 0.08, span * 0.015);
  const center = bounds.getCenter(new T.Vector3());
  const resolution = 128;
  const field = new Float32Array(resolution * resolution);
  const points = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
  let work = 0,
    triangles = 0,
    exhausted = false;
  model.updateWorldMatrix(true, true);
  model.traverseVisible((object) => {
    if (!(object instanceof T.Mesh) || exhausted) return;
    const positions = object.geometry.getAttribute("position");
    if (!positions) return;
    const index = object.geometry.index;
    for (let i = 0; i + 2 < (index?.count ?? positions.count); i += 3) {
      if (++triangles > 250000) {
        exhausted = true;
        break;
      }
      for (let j = 0; j < 3; j++)
        points[j]
          .fromBufferAttribute(positions, index ? index.getX(i + j) : i + j)
          .applyMatrix4(object.matrixWorld);
      if (points.every((p) => p.y > bounds.min.y + height)) continue;
      const projected = points.map((p) => ({
        x: ((p.x - center.x) / width + 0.5) * (resolution - 1),
        y: ((p.z - center.z) / depth + 0.5) * (resolution - 1),
        height: (p.y - bounds.min.y) / height,
      }));
      const [a, b, c] = projected;
      const area = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(area) < 0.000001) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
      const x1 = Math.min(resolution - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
      const y1 = Math.min(resolution - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      work += (x1 - x0 + 1) * (y1 - y0 + 1);
      // Admitted user models can contain many overlapping faces. Keep startup
      // bounded and retain the simple ambient patch if this optional bake grows.
      if (work > 1000000) {
        exhausted = true;
        break;
      }
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / area;
          const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / area;
          const w = 1 - u - v;
          if (Math.min(u, v, w) < -0.00001) continue;
          const proximity = Math.max(
            0,
            1 - (u * a.height + v * b.height + w * c.height),
          );
          const offset = y * resolution + x;
          field[offset] = Math.max(
            field[offset],
            Math.min(1, proximity * proximity),
          );
        }
    }
  });
  if (exhausted || !field.some((value) => value > 0)) return null;
  // Separable compact Gaussian: soft edges, firm grounding, one 64 KiB texture.
  const kernel = [1, 4, 6, 4, 1];
  const temporary = new Float32Array(field.length);
  for (let y = 0; y < resolution; y++)
    for (let x = 0; x < resolution; x++)
      for (let k = -2; k <= 2; k++)
        temporary[y * resolution + x] +=
          (field[
            y * resolution + Math.max(0, Math.min(resolution - 1, x + k))
          ] *
            kernel[k + 2]) /
          16;
  const pixels = new Uint8Array(resolution * resolution * 4);
  for (let y = 0; y < resolution; y++)
    for (let x = 0; x < resolution; x++) {
      let value = 0;
      for (let k = -2; k <= 2; k++)
        value +=
          (temporary[
            Math.max(0, Math.min(resolution - 1, y + k)) * resolution + x
          ] *
            kernel[k + 2]) /
          16;
      // Plane UVs invert ground Z. Keep asymmetric contact points under the
      // corresponding wheels/feet instead of mirroring the shadow.
      pixels[((resolution - 1 - y) * resolution + x) * 4 + 3] = Math.round(
        value * 92,
      );
    }
  const texture = new T.DataTexture(
    pixels,
    resolution,
    resolution,
    T.RGBAFormat,
  );
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.name = "Model-derived contact footprint";
  return { texture, center, width, depth, triangles, work };
}

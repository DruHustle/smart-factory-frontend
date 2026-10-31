import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Batch detailed geometry by its original material, retaining physical surfaces. */
export function optimizeFactoryReference(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const originals = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      !object.geometry?.attributes.position
    )
      return;
    const source = object.geometry as THREE.BufferGeometry;
    originals.add(source);
    const expanded = source.index ? source.toNonIndexed() : source.clone();
    if (!expanded.attributes.normal) expanded.computeVertexNormals();
    expanded.applyMatrix4(object.matrixWorld);
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const groups =
      Array.isArray(object.material) && expanded.groups.length
        ? expanded.groups
        : [
            {
              start: 0,
              count: expanded.attributes.position.count,
              materialIndex: 0,
            },
          ];
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0];
      if (!material) continue;
      const count = Math.min(
        group.count,
        expanded.attributes.position.count - group.start,
      );
      const geometry = new THREE.BufferGeometry();
      for (const [name, size] of [
        ["position", 3],
        ["normal", 3],
        ["uv", 2],
        ["color", 3],
      ] as const) {
        const input = expanded.getAttribute(name),
          data = new Float32Array(count * size);
        for (let vertex = 0; vertex < count; vertex++) {
          const i = group.start + vertex;
          if (input) {
            data[vertex * size] = input.getX(i);
            data[vertex * size + 1] = input.getY(i);
            if (size === 3) data[vertex * size + 2] = input.getZ(i);
          } else if (name === "color")
            data.fill(1, vertex * size, (vertex + 1) * size);
          else if (name === "uv") {
            const p = expanded.attributes.position,
              n = expanded.attributes.normal;
            const axis =
              Math.abs(n.getY(i)) > 0.5
                ? "y"
                : Math.abs(n.getX(i)) > 0.5
                  ? "x"
                  : "z";
            data[vertex * 2] = axis === "x" ? p.getZ(i) : p.getX(i);
            data[vertex * 2 + 1] = axis === "y" ? p.getZ(i) : p.getY(i);
          }
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(data, size));
      }
      if (object.matrixWorld.determinant() < 0) {
        for (const attribute of Object.values(geometry.attributes)) {
          for (let i = 0; i + 2 < count; i += 3)
            for (let k = 0; k < attribute.itemSize; k++) {
              const data = attribute.array,
                a = (i + 1) * attribute.itemSize + k,
                b = (i + 2) * attribute.itemSize + k;
              [data[a], data[b]] = [data[b], data[a]];
            }
        }
      }
      const parts = batches.get(material) ?? [];
      parts.push(geometry);
      batches.set(material, parts);
    }
    expanded.dispose();
  });
  const result = new THREE.Group();
  for (const [material, parts] of batches) {
    const geometry = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    if (!geometry) throw Error("Reference material geometry unavailable");
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    result.add(mesh);
  }
  originals.forEach((geometry) => geometry.dispose());
  if (!result.children.length) throw Error("Reference geometry unavailable");
  return result;
}

/** Viewers own materials/textures; cached public reference geometry remains shared. */
export function instantiateFactoryReference(
  source: THREE.Group,
  materials: Map<THREE.Material, THREE.Material>,
  textures: Map<THREE.Texture, THREE.Texture>,
  finish?: (material: THREE.Material) => void,
) {
  const copy = source.clone(true);
  copy.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.userData.sharedReferenceGeometry = true;
    const own = (original: THREE.Material) => {
      let material = materials.get(original);
      if (!material) {
        material = original.clone();
        for (const [key, value] of Object.entries(material))
          if (value instanceof THREE.Texture) {
            let texture = textures.get(value);
            if (!texture) {
              texture = value.clone();
              texture.needsUpdate = true;
              textures.set(value, texture);
            }
            (material as unknown as Record<string, unknown>)[key] = texture;
          }
        finish?.(material);
        materials.set(original, material);
      }
      return material;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(own)
      : own(object.material);
  });
  return copy;
}

/** Tileable fine surface variation; deterministic and independent of remote assets. */
export function createSurfaceGrain(kind: "concrete" | "metal") {
  const size = 128,
    pixels = new Uint8Array(size * size * 4);
  let seed = 73013;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 4294967296;
      const value =
        kind === "metal"
          ? 224 + Math.round(noise * 20 + Math.sin(x * 0.8) * 10)
          : 196 + Math.round(noise * 59);
      const offset = (y * size + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  texture.name = `Factory ${kind} micro-surface`;
  return texture;
}

export function createContactShadow() {
  const size = 64,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(
        (x - size / 2) / (size / 2),
        (y - size / 2) / (size / 2),
      );
      pixels[(y * size + x) * 4 + 3] = Math.round(
        Math.max(0, Math.exp(-r * r * 5) - Math.exp(-5)) * 175,
      );
    }
  const map = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
}

export const factoryModelSize: Record<string, number> = {
  conveyor: 4,
  "robot-arm": 3.2,
  "storage-tank": 3.1,
  "control-cabinet": 2.4,
  "pump-motor": 2.7,
  valve: 1.7,
  "raspberry-pi-4b": 0.8,
};

/** Fit a reference/proxy's actual geometry to a measured physical envelope, in metres. */
export function fitFactoryDimensions(
  object: THREE.Group,
  dimensions: { width: number; depth: number; height: number },
) {
  const wrapper = new THREE.Group();
  wrapper.add(object);
  const bounds = new THREE.Box3().setFromObject(object),
    size = bounds.getSize(new THREE.Vector3()),
    center = bounds.getCenter(new THREE.Vector3());
  object.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  wrapper.scale.set(
    dimensions.width / Math.max(size.x, 0.00001),
    dimensions.height / Math.max(size.y, 0.00001),
    dimensions.depth / Math.max(size.z, 0.00001),
  );
  return wrapper;
}

import type { Material, Intersection, Mesh } from "three";

/** Uniform material discard rules for the supported static, texture-free GLB. */
export function surfaceVisible(material: Material) {
  return (
    material.visible &&
    (!material.transparent || material.opacity > 0) &&
    material.opacity >= material.alphaTest
  );
}

export function hitVisible(hit: Intersection) {
  const mesh = hit.object as Mesh;
  if (!mesh.isMesh) return true;
  const material = Array.isArray(mesh.material)
    ? mesh.material[hit.face?.materialIndex ?? 0]
    : mesh.material;
  return !!material && surfaceVisible(material);
}

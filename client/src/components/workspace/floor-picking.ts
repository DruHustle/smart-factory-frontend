import * as THREE from "three";

/** Pick rendered equipment surfaces, respecting holes, visibility and occlusion. */
export function floorItemAtRay(root: THREE.Object3D, ray: THREE.Raycaster) {
  root.updateMatrixWorld(true);
  const hit = ray.intersectObject(root, true).find(({ object, face }) => {
    if (!(object instanceof THREE.Mesh)) return false;
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (!node.visible || node.userData.nonSelectable) return false;
    }
    const material = Array.isArray(object.material)
      ? object.material[face?.materialIndex ?? 0]
      : object.material;
    return (
      material?.visible &&
      material.colorWrite &&
      (!material.transparent || material.opacity > 0)
    );
  });
  for (let node = hit?.object; node; node = node.parent ?? undefined) {
    if (typeof node.userData.floorItemRef === "string")
      return node.userData.floorItemRef as string;
  }
  // A floor/wall/beam in front of an item blocks picking through to that item.
  return undefined;
}

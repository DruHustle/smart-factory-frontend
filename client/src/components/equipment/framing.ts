import * as T from "three";
import { surfaceVisible } from "./visibility";
/** Bounds of material that remains visible, including edges crossing the cut. */
export function visibleBounds(root: T.Object3D, plane?: T.Plane): T.Box3 {
  const box = new T.Box3(),
    p = new T.Vector3(),
    q = new T.Vector3();
  for (let n: T.Object3D | null = root; n; n = n.parent)
    if (!n.visible) return box;
  root.updateWorldMatrix(true, true);
  root.traverseVisible((o) => {
    const mesh = o as T.Mesh;
    if (!mesh.isMesh) return;
    if (
      !(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(
        surfaceVisible,
      )
    )
      return;
    const a = mesh.geometry.getAttribute("position"),
      ix = mesh.geometry.index;
    if (!plane) {
      mesh.geometry.computeBoundingBox();
      box.union(
        mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld),
      );
      return;
    }
    for (let i = 0; i < a.count; i++) {
      p.fromBufferAttribute(a, i).applyMatrix4(mesh.matrixWorld);
      if (plane.distanceToPoint(p) >= 0) box.expandByPoint(p);
    }
    for (let i = 0; i < (ix?.count ?? a.count); i += 3)
      for (let k = 0; k < 3; k++) {
        p.fromBufferAttribute(a, ix ? ix.getX(i + k) : i + k).applyMatrix4(
          mesh.matrixWorld,
        );
        q.fromBufferAttribute(
          a,
          ix ? ix.getX(i + ((k + 1) % 3)) : i + ((k + 1) % 3),
        ).applyMatrix4(mesh.matrixWorld);
        const d = plane.distanceToPoint(p),
          e = plane.distanceToPoint(q);
        if (d < 0 !== e < 0) box.expandByPoint(p.lerp(q, d / (d - e)));
      }
  });
  return box;
}
export function frameBounds(
  camera: T.PerspectiveCamera,
  target: T.Vector3,
  box: T.Box3,
  direction = new T.Vector3(1, 0.65, 1.4),
) {
  if (box.isEmpty()) return false;
  const center = box.getCenter(new T.Vector3()),
    size = box.getSize(new T.Vector3()).length() || 0.1;
  const forward = direction.clone().normalize(),
    right = new T.Vector3().crossVectors(camera.up, forward).normalize(),
    up = new T.Vector3().crossVectors(forward, right);
  const tanY = Math.tan(T.MathUtils.degToRad(camera.fov / 2)),
    tanX = tanY * camera.aspect;
  let distance = 0;
  for (let x = 0; x < 2; x++)
    for (let y = 0; y < 2; y++)
      for (let z = 0; z < 2; z++) {
        const p = new T.Vector3(
          x ? box.max.x : box.min.x,
          y ? box.max.y : box.min.y,
          z ? box.max.z : box.min.z,
        ).sub(center);
        distance = Math.max(
          distance,
          p.dot(forward) +
            Math.max(
              Math.abs(p.dot(right)) / tanX,
              Math.abs(p.dot(up)) / tanY,
            ) *
              1.12,
        );
      }
  camera.near = Math.max(0.0001, size / 2000);
  camera.far = Math.max(20, size * 100);
  camera.updateProjectionMatrix();
  camera.position.copy(center).addScaledVector(forward, distance);
  target.copy(center);
  return true;
}

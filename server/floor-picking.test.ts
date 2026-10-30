import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { floorItemAtRay } from "../client/src/components/workspace/floor-picking";

const rayAt = (x = 0, y = 0) =>
  new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
function equipment(
  geometry: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1),
) {
  const item = new THREE.Group();
  item.userData.floorItemRef = "asset:1";
  item.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  return item;
}

describe("precise floor equipment picking", () => {
  it("requires an actual surface, including holes and space inside the bounding box", () => {
    const scene = new THREE.Scene();
    scene.add(equipment(new THREE.TorusGeometry(0.7, 0.15, 12, 32)));
    expect(floorItemAtRay(scene, rayAt(0.7))).toBe("asset:1");
    expect(floorItemAtRay(scene, rayAt())).toBeUndefined();
    expect(floorItemAtRay(scene, rayAt(0.7, 0.7))).toBeUndefined();
    expect(floorItemAtRay(scene, rayAt(0.9))).toBeUndefined();
  });
  it("does not grab hidden or fully transparent equipment", () => {
    const scene = new THREE.Scene(),
      item = equipment();
    scene.add(item);
    item.visible = false;
    expect(floorItemAtRay(scene, rayAt())).toBeUndefined();
    item.visible = true;
    const material = (item.children[0] as THREE.Mesh)
      .material as THREE.MeshBasicMaterial;
    material.transparent = true;
    material.opacity = 0;
    expect(floorItemAtRay(scene, rayAt())).toBeUndefined();
    material.opacity = 0.4;
    expect(floorItemAtRay(scene, rayAt())).toBe("asset:1");
  });
  it("does not turn status markers, outlines or shadows into item hit areas", () => {
    const scene = new THREE.Scene(),
      item = equipment();
    const decoration = new THREE.Group();
    decoration.userData.nonSelectable = true;
    const badge = new THREE.Mesh(
      new THREE.SphereGeometry(0.4),
      new THREE.MeshBasicMaterial(),
    );
    badge.position.x = 1.5;
    decoration.add(badge);
    item.add(decoration);
    scene.add(item);
    expect(floorItemAtRay(scene, rayAt(1.5))).toBeUndefined();
    expect(floorItemAtRay(scene, rayAt())).toBe("asset:1");
  });
  it("cannot grab equipment through a visible wall or another foreground surface", () => {
    const scene = new THREE.Scene(),
      item = equipment();
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 0.1),
      new THREE.MeshBasicMaterial(),
    );
    wall.position.z = 2;
    scene.add(item, wall);
    expect(floorItemAtRay(scene, rayAt())).toBeUndefined();
    wall.visible = false;
    expect(floorItemAtRay(scene, rayAt())).toBe("asset:1");
  });
});

import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Mesh, MeshLambertMaterial } from "three";

/** Neutral studio, warm key and cool edge reflections; generated once, not at startup. */
export function studioScene() {
  const room = new RoomEnvironment();
  room.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = object.material as MeshLambertMaterial;
    if (!material.emissive || !material.emissiveIntensity) return;
    if (material.emissiveIntensity === 50) material.emissive.setHex(0xfff2df);
    if (material.emissiveIntensity === 17 || material.emissiveIntensity === 20)
      material.emissive.setHex(0xe1edff);
    if (material.emissiveIntensity === 100) {
      object.scale.set(5, 0.1, 2);
      material.emissiveIntensity = 28;
      material.emissive.setHex(0xfff7ea);
    }
  });
  return room;
}

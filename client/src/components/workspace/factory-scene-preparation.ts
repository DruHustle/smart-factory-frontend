import * as THREE from "three";

type PreparedObject = { object: THREE.Object3D; activate: () => void };

/** Keep cold shader work and reference uploads out of one first-use frame. */
export class FactoryScenePreparation {
  private stopped = false;
  private tail: Promise<unknown> = Promise.resolve();
  private waits = new Set<() => void>();

  constructor(
    private renderer: Pick<THREE.WebGLRenderer, "compileAsync">,
    private camera: THREE.Camera,
    private scene: THREE.Scene,
    private environment: Promise<unknown>,
  ) {}

  private presentationTurn() {
    return new Promise<void>((resolve) => {
      if (this.stopped) return resolve();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        cancelAnimationFrame(frame);
        if (timer !== undefined) clearTimeout(timer);
        this.waits.delete(finish);
        resolve();
      };
      // A microtask alone cannot give input, timers or a submitted draw a turn.
      const frame = requestAnimationFrame(() => {
        timer = setTimeout(finish, 0);
      });
      this.waits.add(finish);
    });
  }

  enqueue(build: () => PreparedObject): Promise<boolean> {
    const task = this.tail.then(async () => {
      await this.presentationTurn();
      if (this.stopped) return false;
      await this.environment;
      if (this.stopped) return false;
      const prepared = build();
      // Target lights/environment must match the eventual visible scene, even
      // when this object is still detached and its labelled proxy is visible.
      await this.renderer.compileAsync(
        prepared.object,
        this.camera,
        this.scene,
      );
      if (this.stopped) return false;
      await this.presentationTurn();
      if (this.stopped) return false;
      prepared.activate();
      // compileAsync prepares programs, not geometry buffers. Give the draw
      // loop a presentation turn before attaching the next detailed reference.
      await this.presentationTurn();
      return !this.stopped;
    });
    // One failed reference retains its proxy without starving later models.
    this.tail = task.catch(() => {});
    return task;
  }

  dispose() {
    this.stopped = true;
    // Also settle a frame wait in a hidden tab, where rAF may never fire.
    for (const finish of this.waits) finish();
  }
}

/** Dispose viewer resources once, including prepared but unattached references. */
export function disposeFactoryScene(
  roots: Iterable<THREE.Object3D>,
  extra: {
    materials?: Iterable<THREE.Material>;
    textures?: Iterable<THREE.Texture>;
    geometries?: Iterable<THREE.BufferGeometry>;
  } = {},
) {
  const geometries = new Set(extra.geometries),
    materials = new Set(extra.materials),
    textures = new Set(extra.textures),
    shadows = new Set<THREE.DirectionalLightShadow>();
  for (const root of roots)
    root.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.Sprite
      ) {
        if ("geometry" in object && !object.userData.sharedReferenceGeometry)
          geometries.add(object.geometry as THREE.BufferGeometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      }
      if (object instanceof THREE.DirectionalLight) shadows.add(object.shadow);
    });
  for (const material of materials)
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  shadows.forEach((shadow) => shadow.dispose());
}

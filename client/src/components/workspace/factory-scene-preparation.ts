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

  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }

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

type SceneDisposalExtras = {
  priorityGeometries?: Iterable<THREE.BufferGeometry>;
  materials?: Iterable<THREE.Material>;
  textures?: Iterable<THREE.Texture>;
  geometries?: Iterable<THREE.BufferGeometry>;
};

const ownedSpriteGeometries = new WeakSet<THREE.BufferGeometry>();

/** Avoid the module-global Sprite geometry retaining renderer listeners. */
export function createFactorySprite(material: THREE.SpriteMaterial) {
  const sprite = new THREE.Sprite(material);
  sprite.geometry = sprite.geometry.clone();
  ownedSpriteGeometries.add(sprite.geometry);
  return sprite;
}

function reportDisposalFailure() {
  // Driver or resource exception messages may contain sensitive implementation data.
  try {
    console.error(
      "Factory viewer cleanup encountered an error; context release will be attempted.",
    );
  } catch {
    // Reporting must not prevent release of the context.
  }
}

function* safeValues<T>(
  values: Iterable<T>,
  failure: () => void,
): Generator<T> {
  let iterator: Iterator<T>;
  try {
    iterator = values[Symbol.iterator]();
  } catch {
    failure();
    return;
  }
  while (true) {
    let next: IteratorResult<T>;
    try {
      next = iterator.next();
    } catch {
      failure();
      return;
    }
    if (next.done) return;
    yield next.value;
  }
}

/** Traverse and release incrementally; shared cached source geometry is never owned. */
function* sceneDisposalSteps(
  roots: Iterable<THREE.Object3D>,
  extra: SceneDisposalExtras,
  failure: () => void,
) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>(),
    shadows = new Set<THREE.DirectionalLightShadow>(),
    disposedGeometries = new Set<THREE.BufferGeometry>(),
    visited = new Set<THREE.Object3D>();
  // Release the stopped viewer's renderer listeners early. These are owned
  // clones, and each driver call remains a separately budgeted step.
  for (const geometry of safeValues(extra.priorityGeometries ?? [], failure)) {
    if (!disposedGeometries.has(geometry)) {
      disposedGeometries.add(geometry);
      try {
        geometry.dispose();
      } catch {
        failure();
      }
    }
    yield;
  }
  for (const geometry of safeValues(extra.geometries ?? [], failure)) {
    if (!disposedGeometries.has(geometry)) geometries.add(geometry);
    yield;
  }
  for (const material of safeValues(extra.materials ?? [], failure)) {
    materials.add(material);
    yield;
  }
  for (const texture of safeValues(extra.textures ?? [], failure)) {
    textures.add(texture);
    yield;
  }
  const iterators = [safeValues(roots, failure)];
  while (iterators.length) {
    const next = iterators[iterators.length - 1].next();
    if (next.done) {
      iterators.pop();
      yield;
      continue;
    }
    const object = next.value;
    if (visited.has(object)) {
      yield;
      continue;
    }
    visited.add(object);
    try {
      iterators.push(safeValues(object.children, failure));
    } catch {
      failure();
    }
    try {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.Sprite
      ) {
        if (
          // Three.js sprites use one module-global geometry across viewers.
          (!(object instanceof THREE.Sprite) ||
            ownedSpriteGeometries.has(object.geometry)) &&
          "geometry" in object &&
          (!object.userData.sharedReferenceGeometry ||
            object.userData.viewerOwnedReferenceGeometry)
        )
          if (!disposedGeometries.has(object.geometry as THREE.BufferGeometry))
            geometries.add(object.geometry as THREE.BufferGeometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      }
      if (object instanceof THREE.DirectionalLight) shadows.add(object.shadow);
    } catch {
      failure();
    }
    yield;
  }
  for (const material of materials) {
    try {
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    } catch {
      failure();
    }
    yield;
  }
  for (const resources of [textures, materials, geometries, shadows])
    for (const resource of resources) {
      // A failed driver/resource cleanup must not prevent the rest from being released.
      try {
        resource.dispose();
      } catch {
        failure();
      }
      yield;
    }
}

/** Dispose small, immediately replaced objects synchronously. */
export function disposeFactoryScene(
  roots: Iterable<THREE.Object3D>,
  extra: SceneDisposalExtras = {},
) {
  for (const _ of sceneDisposalSteps(roots, extra, reportDisposalFailure)) {
    /* drain */
  }
}

type DisposalSchedule = (
  run: () => void,
  first: boolean,
  failure: () => void,
) => void;

/** Wait for a paint before starting; a timer also makes progress in hidden tabs. */
const scheduleDisposal: DisposalSchedule = (run, first, failure) => {
  if (!first) {
    setTimeout(run, 0);
    return;
  }
  let started = false;
  let frame: number | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    if (started) return;
    started = true;
    try {
      if (frame !== undefined) cancelAnimationFrame(frame);
    } catch {
      failure();
    }
    try {
      if (fallback !== undefined) clearTimeout(fallback);
    } catch {
      failure();
    }
    try {
      setTimeout(run, 0);
    } catch {
      failure();
      run();
    }
  };
  frame = requestAnimationFrame(start);
  fallback = setTimeout(start, 1000);
};

/**
 * Stop the viewer synchronously before calling this. Bounded batches let the
 * next route paint while every resource and the old context are still released.
 */
export function deferFactorySceneDisposal(
  roots: Iterable<THREE.Object3D>,
  extra: SceneDisposalExtras,
  finish: () => void,
  schedule: DisposalSchedule = scheduleDisposal,
) {
  return new Promise<void>((resolve) => {
    let reported = false,
      finished = false;
    const failure = () => {
      if (!reported) {
        reported = true;
        reportDisposalFailure();
      }
    };
    const steps = sceneDisposalSteps(roots, extra, failure);
    const finalize = () => {
      if (finished) return;
      finished = true;
      try {
        finish();
      } catch {
        failure();
      } finally {
        resolve();
      }
    };
    const drainSynchronously = () => {
      if (finished) return;
      try {
        while (!steps.next().done) {
          /* last resort */
        }
      } catch {
        failure();
      }
      finalize();
    };
    const request = (run: () => void, first: boolean) => {
      let invoked = false;
      const once = () => {
        if (invoked || finished) return;
        invoked = true;
        run();
      };
      try {
        schedule(once, first, failure);
      } catch {
        failure();
        try {
          setTimeout(once, 0);
        } catch {
          drainSynchronously();
        }
      }
    };
    const batch = () => {
      try {
        const start = performance.now();
        let count = 0;
        while (count++ < 32 && (count === 1 || performance.now() - start < 4)) {
          if (steps.next().done) {
            request(finalize, false);
            return;
          }
        }
        request(batch, false);
      } catch {
        failure();
        drainSynchronously();
      }
    };
    request(batch, true);
  });
}

/** Attempt both cleanup operations even after context loss or a driver error. */
export function releaseFactorySceneRenderer(
  renderer: Pick<THREE.WebGLRenderer, "dispose" | "forceContextLoss">,
) {
  try {
    renderer.dispose();
  } catch {
    reportDisposalFailure();
  }
  try {
    renderer.forceContextLoss();
  } catch {
    reportDisposalFailure();
  }
}

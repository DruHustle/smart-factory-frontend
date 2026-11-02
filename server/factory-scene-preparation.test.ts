import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  FactoryScenePreparation,
  createFactorySprite,
  deferFactorySceneDisposal,
  releaseFactorySceneRenderer,
  disposeFactoryScene,
} from "../client/src/components/workspace/factory-scene-preparation";
import { instantiateFactoryReference } from "../client/src/components/workspace/factory-graphics";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("factory scene graphics preparation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the proxy until the configured environment and target-scene shaders are ready", async () => {
    const environment = deferred(),
      shader = deferred(),
      scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(),
      proxy = new THREE.Group(),
      detail = new THREE.Group();
    scene.add(proxy);
    const compileAsync = vi.fn(() => shader.promise.then(() => detail));
    const preparation = new FactoryScenePreparation(
      { compileAsync },
      camera,
      scene,
      environment.promise,
    );
    const built = vi.fn(() => ({
      object: detail,
      activate: () => {
        scene.remove(proxy);
        scene.add(detail);
      },
    }));
    const result = preparation.enqueue(built);
    await vi.runAllTimersAsync();
    expect(built).not.toHaveBeenCalled();
    environment.resolve();
    await vi.runAllTimersAsync();
    expect(compileAsync).toHaveBeenCalledWith(detail, camera, scene);
    expect(scene.children).toEqual([proxy]);
    shader.resolve();
    await Promise.resolve();
    expect(scene.children).toEqual([proxy]);
    await vi.runAllTimersAsync();
    expect(await result).toBe(true);
    expect(scene.children).toEqual([detail]);
  });

  it("serializes concurrent references across presentation turns and recovers after a failed model", async () => {
    const scene = new THREE.Scene(),
      firstShader = deferred();
    const rendered: { name: string; at: number }[] = [];
    const compileAsync = vi.fn(async (object: THREE.Object3D) => {
      if (object.name === "first") await firstShader.promise;
      if (object.name === "broken") throw Error("Shader unavailable");
      return object;
    });
    const preparation = new FactoryScenePreparation(
      { compileAsync },
      new THREE.Camera(),
      scene,
      Promise.resolve(),
    );
    const enqueue = (name: string) =>
      preparation.enqueue(() => {
        const object = new THREE.Group();
        object.name = name;
        return {
          object,
          activate: () => rendered.push({ name, at: Date.now() }),
        };
      });
    const first = enqueue("first"),
      broken = enqueue("broken").catch((error) => error.message),
      last = enqueue("last");
    await vi.runAllTimersAsync();
    expect(compileAsync).toHaveBeenCalledTimes(1);
    expect(rendered).toEqual([]);
    firstShader.resolve();
    await vi.runAllTimersAsync();
    expect(await first).toBe(true);
    expect(await broken).toBe("Shader unavailable");
    expect(await last).toBe(true);
    expect(rendered.map((entry) => entry.name)).toEqual(["first", "last"]);
    expect(rendered[1].at - rendered[0].at).toBeGreaterThanOrEqual(32);
  });

  it.each(["environment", "compile"])(
    "cannot attach or build queued models after disposal during %s",
    async (phase) => {
      const pending = deferred(),
        object = new THREE.Group(),
        activate = vi.fn();
      const compileAsync = vi.fn(async () => {
        if (phase === "compile") await pending.promise;
        return object;
      });
      const preparation = new FactoryScenePreparation(
        { compileAsync },
        new THREE.Camera(),
        new THREE.Scene(),
        phase === "environment" ? pending.promise : Promise.resolve(),
      );
      const queued = vi.fn(() => ({ object, activate }));
      const first = preparation.enqueue(() => ({ object, activate }));
      const next = preparation.enqueue(queued);
      await vi.runAllTimersAsync();
      preparation.dispose();
      pending.resolve();
      await vi.runAllTimersAsync();
      expect(await first).toBe(false);
      expect(await next).toBe(false);
      expect(activate).not.toHaveBeenCalled();
      expect(queued).not.toHaveBeenCalled();
    },
  );

  it("settles a cancelled presentation wait even when a hidden document never gets another frame", async () => {
    const request = vi.fn(() => 123),
      cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const compileAsync = vi.fn(async (object: THREE.Object3D) => object);
    const preparation = new FactoryScenePreparation(
      { compileAsync },
      new THREE.Camera(),
      new THREE.Scene(),
      Promise.resolve(),
    );
    const build = vi.fn(() => ({
      object: new THREE.Group(),
      activate: vi.fn(),
    }));
    const pending = preparation.enqueue(build);
    await Promise.resolve();
    expect(request).toHaveBeenCalledOnce();
    preparation.dispose();
    expect(await pending).toBe(false);
    expect(cancel).toHaveBeenCalledWith(123);
    expect(build).not.toHaveBeenCalled();
  });
});

describe("deferred factory viewer disposal", () => {
  it("preserves shared Sprite geometry across label replacement and viewer teardown", async () => {
    const oldTexture = new THREE.Texture(),
      closingTexture = new THREE.Texture(),
      activeTexture = new THREE.Texture(),
      oldMaterial = new THREE.SpriteMaterial({ map: oldTexture }),
      closingMaterial = new THREE.SpriteMaterial({ map: closingTexture }),
      activeMaterial = new THREE.SpriteMaterial({ map: activeTexture }),
      oldLabel = new THREE.Sprite(oldMaterial),
      closingLabel = new THREE.Sprite(closingMaterial),
      activeLabel = new THREE.Sprite(activeMaterial),
      sharedDispose = vi.spyOn(oldLabel.geometry, "dispose"),
      oldDisposals = [oldTexture, oldMaterial].map((value) =>
        vi.spyOn(value, "dispose"),
      ),
      closingDisposals = [closingTexture, closingMaterial].map((value) =>
        vi.spyOn(value, "dispose"),
      ),
      activeDisposals = [activeTexture, activeMaterial].map((value) =>
        vi.spyOn(value, "dispose"),
      ),
      tasks: Array<() => void> = [],
      finish = vi.fn();
    try {
      expect(closingLabel.geometry).toBe(oldLabel.geometry);
      expect(activeLabel.geometry).toBe(oldLabel.geometry);
      disposeFactoryScene([oldLabel]);
      for (const dispose of oldDisposals)
        expect(dispose).toHaveBeenCalledOnce();
      expect(sharedDispose).not.toHaveBeenCalled();
      const result = deferFactorySceneDisposal(
        [closingLabel],
        {},
        finish,
        (run) => tasks.push(run),
      );
      while (tasks.length) tasks.shift()!();
      await result;
      for (const dispose of closingDisposals)
        expect(dispose).toHaveBeenCalledOnce();
      for (const dispose of activeDisposals)
        expect(dispose).not.toHaveBeenCalled();
      expect(sharedDispose).not.toHaveBeenCalled();
      expect(finish).toHaveBeenCalledOnce();
    } finally {
      sharedDispose.mockRestore();
      disposeFactoryScene([activeLabel]);
    }
  });

  it("releases each factory Sprite geometry listener without touching other viewers or the shared source", async () => {
    const source = new THREE.Sprite(),
      first = createFactorySprite(new THREE.SpriteMaterial()),
      second = createFactorySprite(new THREE.SpriteMaterial()),
      sourceDispose = vi.spyOn(source.geometry, "dispose"),
      firstDispose = vi.spyOn(first.geometry, "dispose"),
      secondDispose = vi.spyOn(second.geometry, "dispose"),
      listener = vi.fn(),
      tasks: Array<() => void> = [];
    first.geometry.addEventListener("dispose", listener);
    try {
      expect(first.geometry).not.toBe(source.geometry);
      expect(second.geometry).not.toBe(source.geometry);
      expect(first.geometry).not.toBe(second.geometry);
      const result = deferFactorySceneDisposal(
        [first],
        {},
        () => {},
        (run) => tasks.push(run),
      );
      while (tasks.length) tasks.shift()!();
      await result;
      expect(firstDispose).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledOnce();
      expect(secondDispose).not.toHaveBeenCalled();
      expect(sourceDispose).not.toHaveBeenCalled();
      disposeFactoryScene([second]);
      expect(secondDispose).toHaveBeenCalledOnce();
      expect(sourceDispose).not.toHaveBeenCalled();
    } finally {
      sourceDispose.mockRestore();
    }
  });

  it("waits for a presentation frame, then releases the context only once", async () => {
    vi.useFakeTimers();
    let frame!: FrameRequestCallback;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 33;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      const geometry = new THREE.BoxGeometry(),
        dispose = vi.spyOn(geometry, "dispose"),
        finish = vi.fn();
      const result = deferFactorySceneDisposal(
        [new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())],
        {},
        finish,
      );
      expect(dispose).not.toHaveBeenCalled();
      frame(1);
      expect(dispose).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      await result;
      expect(dispose).toHaveBeenCalledOnce();
      expect(finish).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("attempts context release even if renderer disposal reports context loss", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const renderer = {
      dispose: vi.fn(() => {
        throw Error("lost");
      }),
      forceContextLoss: vi.fn(),
    };
    releaseFactorySceneRenderer(renderer);
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("releases collected and remaining resources when collection iterators throw", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const geometry = new THREE.BoxGeometry(),
        extraGeometry = new THREE.BoxGeometry(),
        texture = new THREE.Texture(),
        material = new THREE.MeshBasicMaterial({ map: texture }),
        mesh = new THREE.Mesh(geometry, material),
        finish = vi.fn(),
        tasks: Array<() => void> = [],
        disposal = [geometry, extraGeometry, texture, material].map((item) =>
          vi.spyOn(item, "dispose"),
        );
      function* roots(): Generator<THREE.Object3D> {
        yield mesh;
        throw Error("SECRET_ROOT");
      }
      function* extras(): Generator<THREE.BufferGeometry> {
        yield extraGeometry;
        throw Error("SECRET_EXTRA");
      }
      const result = deferFactorySceneDisposal(
        roots(),
        { geometries: extras() },
        finish,
        (run) => tasks.push(run),
      );
      while (tasks.length) tasks.shift()!();
      await result;
      for (const dispose of disposal) expect(dispose).toHaveBeenCalledOnce();
      expect(finish).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledOnce();
      expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET");
    } finally {
      error.mockRestore();
    }
  });

  it.each(["initial", "later"])(
    "recovers from %s scheduling failure without duplicate finalization",
    async (phase) => {
      vi.useFakeTimers();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const root = new THREE.Group(),
          geometry = new THREE.BoxGeometry(),
          material = new THREE.MeshBasicMaterial(),
          dispose = vi.spyOn(geometry, "dispose"),
          finish = vi.fn();
        root.add(new THREE.Mesh(geometry, material));
        for (let i = 0; i < 100; i++) root.add(new THREE.Group());
        const result = deferFactorySceneDisposal(
          [root],
          {},
          finish,
          (run, first) => {
            setTimeout(run, 0);
            if ((phase === "initial") === first)
              throw Error("SECRET_SCHEDULER");
          },
        );
        await vi.runAllTimersAsync();
        await result;
        expect(dispose).toHaveBeenCalledOnce();
        expect(finish).toHaveBeenCalledOnce();
        expect(error).toHaveBeenCalledOnce();
        expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET");
      } finally {
        error.mockRestore();
        vi.useRealTimers();
      }
    },
  );

  it("drains and finalizes as a last resort if both scheduler and timer fail", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("setTimeout", () => {
      throw Error("SECRET_TIMER");
    });
    try {
      const geometry = new THREE.BoxGeometry(),
        dispose = vi.spyOn(geometry, "dispose"),
        finish = vi.fn(() => {
          throw Error("SECRET_FINISH");
        });
      await deferFactorySceneDisposal(
        [new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())],
        {},
        finish,
        () => {
          throw Error("SECRET_SCHEDULER");
        },
      );
      expect(dispose).toHaveBeenCalledOnce();
      expect(finish).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledOnce();
      expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET");
    } finally {
      error.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it("yields collection and cleanup, and never frees cached or newly mounted viewer resources", async () => {
    const source = new THREE.Group(),
      sourceGeometry = new THREE.BoxGeometry(),
      sourceMaterial = new THREE.MeshStandardMaterial();
    source.add(new THREE.Mesh(sourceGeometry, sourceMaterial));
    const oldMaterials = new Map<THREE.Material, THREE.Material>(),
      oldTextures = new Map<THREE.Texture, THREE.Texture>(),
      oldViewer = instantiateFactoryReference(
        source,
        oldMaterials,
        oldTextures,
      ),
      otherViewer = instantiateFactoryReference(source, new Map(), new Map());
    for (let i = 0; i < 100; i++) oldViewer.add(new THREE.Group());
    const oldGeometry = (oldViewer.children[0] as THREE.Mesh).geometry,
      otherGeometry = (otherViewer.children[0] as THREE.Mesh).geometry,
      oldDispose = vi.spyOn(oldGeometry, "dispose"),
      otherDispose = vi.spyOn(otherGeometry, "dispose"),
      sourceDispose = vi.spyOn(sourceGeometry, "dispose"),
      finish = vi.fn(),
      tasks: Array<() => void> = [],
      firstFlags: boolean[] = [];
    const result = deferFactorySceneDisposal(
      [oldViewer, oldViewer],
      {
        materials: oldMaterials.values(),
        textures: oldTextures.values(),
      },
      finish,
      (run, first) => {
        tasks.push(run);
        firstFlags.push(first);
      },
    );
    expect(oldDispose).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(firstFlags).toEqual([true]);
    tasks.shift()!();
    expect(finish).not.toHaveBeenCalled();
    expect(oldDispose).not.toHaveBeenCalled();
    const remounted = instantiateFactoryReference(source, new Map(), new Map());
    const newGeometry = (remounted.children[0] as THREE.Mesh).geometry;
    const newDispose = vi.spyOn(newGeometry, "dispose");
    while (tasks.length) tasks.shift()!();
    await result;
    expect(firstFlags.length).toBeGreaterThan(3);
    expect(firstFlags.slice(1).every((first) => !first)).toBe(true);
    expect(oldDispose).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(otherDispose).not.toHaveBeenCalled();
    expect(newDispose).not.toHaveBeenCalled();
    expect(sourceDispose).not.toHaveBeenCalled();
    disposeFactoryScene([otherViewer, remounted]);
  });

  it("finishes even when animation frames stop in a hidden tab and a resource throws", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", () => 17);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    try {
      const scene = new THREE.Scene(),
        first = new THREE.BoxGeometry(),
        second = new THREE.BoxGeometry(),
        material = new THREE.MeshBasicMaterial(),
        disposeSecond = vi.spyOn(second, "dispose"),
        finish = vi.fn();
      vi.spyOn(first, "dispose").mockImplementation(() => {
        throw Error("driver failure");
      });
      scene.add(
        new THREE.Mesh(first, material),
        new THREE.Mesh(second, material),
      );
      const result = deferFactorySceneDisposal([scene], {}, finish);
      await vi.advanceTimersByTimeAsync(999);
      expect(disposeSecond).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      await result;
      expect(cancel).toHaveBeenCalledWith(17);
      expect(disposeSecond).toHaveBeenCalledOnce();
      expect(finish).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

it("disposes attached, retired and pending viewer resources once without freeing cached reference geometry", () => {
  const scene = new THREE.Scene(),
    pending = new THREE.Group(),
    ownedGeometry = new THREE.BoxGeometry(),
    cachedGeometry = new THREE.BoxGeometry(),
    texture = new THREE.Texture(),
    material = new THREE.MeshStandardMaterial({ map: texture }),
    unusedTexture = new THREE.Texture(),
    unusedMaterial = new THREE.MeshStandardMaterial({ map: unusedTexture });
  const retired = new THREE.Mesh(ownedGeometry, material);
  scene.add(new THREE.Mesh(ownedGeometry, material));
  const detail = new THREE.Mesh(cachedGeometry, material);
  detail.userData.sharedReferenceGeometry = true;
  pending.add(detail);
  const light = new THREE.DirectionalLight();
  scene.add(light);
  const watched = [
    ownedGeometry,
    texture,
    material,
    unusedMaterial,
    unusedTexture,
    light.shadow,
  ].map((value) => vi.spyOn(value, "dispose"));
  const cachedDispose = vi.spyOn(cachedGeometry, "dispose");
  disposeFactoryScene([scene, retired, pending, scene], {
    materials: [material, unusedMaterial],
    textures: [texture, unusedTexture],
    geometries: [ownedGeometry],
  });
  for (const dispose of watched) expect(dispose).toHaveBeenCalledOnce();
  expect(cachedDispose).not.toHaveBeenCalled();
});

it("releases a closed viewer's shared geometry listeners without invalidating the source or another viewer", () => {
  const cached = new THREE.Group(),
    sourceGeometry = new THREE.BoxGeometry(2, 3, 4),
    sourceTexture = new THREE.Texture(),
    sourceMaterial = new THREE.MeshStandardMaterial({ map: sourceTexture });
  cached.add(new THREE.Mesh(sourceGeometry, sourceMaterial));
  const materials = new Map<THREE.Material, THREE.Material>(),
    textures = new Map<THREE.Texture, THREE.Texture>(),
    attached = instantiateFactoryReference(cached, materials, textures),
    pending = instantiateFactoryReference(cached, materials, textures),
    otherViewer = instantiateFactoryReference(cached, new Map(), new Map()),
    closedGeometry = (attached.children[0] as THREE.Mesh).geometry,
    activeGeometry = (otherViewer.children[0] as THREE.Mesh).geometry;
  expect((pending.children[0] as THREE.Mesh).geometry).toBe(closedGeometry);
  const closedDispose = vi.spyOn(closedGeometry, "dispose"),
    activeDispose = vi.spyOn(activeGeometry, "dispose"),
    cachedDispose = vi.spyOn(sourceGeometry, "dispose"),
    sourceTextureDispose = vi.spyOn(sourceTexture, "dispose"),
    activeListener = vi.fn();
  // Renderer geometry bookkeeping removes its own listener on this event.
  const retiredListener = vi.fn(() =>
    closedGeometry.removeEventListener("dispose", retiredListener),
  );
  closedGeometry.addEventListener("dispose", retiredListener);
  activeGeometry.addEventListener("dispose", activeListener);
  const expectedBounds = new THREE.Box3().setFromObject(otherViewer);
  disposeFactoryScene([attached, pending], {
    materials: materials.values(),
    textures: textures.values(),
  });
  expect(closedDispose).toHaveBeenCalledOnce();
  expect(retiredListener).toHaveBeenCalledOnce();
  expect(closedGeometry.hasEventListener("dispose", retiredListener)).toBe(
    false,
  );
  expect(activeDispose).not.toHaveBeenCalled();
  expect(activeListener).not.toHaveBeenCalled();
  expect(cachedDispose).not.toHaveBeenCalled();
  expect(sourceTextureDispose).not.toHaveBeenCalled();
  expect(new THREE.Box3().setFromObject(otherViewer)).toEqual(expectedBounds);
  const nextViewer = instantiateFactoryReference(cached, new Map(), new Map());
  expect((nextViewer.children[0] as THREE.Mesh).geometry).not.toBe(
    closedGeometry,
  );
  expect((nextViewer.children[0] as THREE.Mesh).geometry).not.toBe(
    activeGeometry,
  );
  expect(new THREE.Box3().setFromObject(nextViewer)).toEqual(expectedBounds);
  disposeFactoryScene([otherViewer, nextViewer]);
  expect(activeListener).toHaveBeenCalledOnce();
  expect(cachedDispose).not.toHaveBeenCalled();
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  FactoryScenePreparation,
  disposeFactoryScene,
} from "../client/src/components/workspace/factory-scene-preparation";

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

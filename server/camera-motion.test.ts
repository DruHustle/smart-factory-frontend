import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { moveCamera } from "../client/src/components/equipment/cameraMotion";

describe("inspection camera motion", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  beforeEach(() => {
    frames.clear();
    id = 0;
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) =>
      frames.delete(frame),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const tick = (at: number) => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(at));
  };
  const setup = () => ({
    camera: new PerspectiveCamera(),
    controls: { target: new Vector3(), update: vi.fn() },
    render: vi.fn(),
  });
  it("keeps spatial continuity and ends at the exact saved position without an idle loop", () => {
    const { camera, controls, render } = setup();
    moveCamera(
      camera,
      controls,
      new Vector3(10, 2, 4),
      new Vector3(2, 4, 6),
      render,
    );
    tick(150);
    expect(camera.position.x).toBeCloseTo(5);
    expect(controls.target.toArray()).toEqual([1, 2, 3]);
    tick(300);
    expect(camera.position.toArray()).toEqual([10, 2, 4]);
    expect(controls.target.toArray()).toEqual([2, 4, 6]);
    expect(frames.size).toBe(0);
  });
  it("applies the destination immediately for reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { camera, controls, render } = setup();
    moveCamera(
      camera,
      controls,
      new Vector3(3, 2, 1),
      new Vector3(1, 1, 1),
      render,
    );
    expect(camera.position.toArray()).toEqual([3, 2, 1]);
    expect(frames.size).toBe(0);
  });
  it("stops queued work on user cancellation without snapping away from the current camera", () => {
    const { camera, controls, render } = setup();
    const cancel = moveCamera(
      camera,
      controls,
      new Vector3(10, 0, 0),
      new Vector3(),
      render,
    );
    tick(150);
    cancel();
    tick(300);
    expect(camera.position.x).toBeCloseTo(5);
    expect(frames.size).toBe(0);
  });
  it("completes once when the page becomes hidden and removes its visibility listener", () => {
    const events = new EventTarget();
    const doc = Object.assign(events, { hidden: false });
    vi.stubGlobal("document", doc);
    const { camera, controls, render } = setup();
    moveCamera(camera, controls, new Vector3(5, 0, 0), new Vector3(), render);
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(camera.position.x).toBe(5);
    expect(frames.size).toBe(0);
    const count = render.mock.calls.length;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(render).toHaveBeenCalledTimes(count);
  });
});

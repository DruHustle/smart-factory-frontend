import * as T from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  measureOrbit,
  type MeasuredRuntime,
} from "../../client/src/components/equipment/benchmark";

vi.mock("../../client/src/components/equipment/drawingFrame", () => ({
  scheduleDrawingFrame: (draw: () => void) => {
    draw();
    return () => {};
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(frameMs: number) {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("navigator", { userAgent: "controlled render fixture" });
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("innerHeight", 1000);
  vi.stubGlobal("devicePixelRatio", 1);
  const gl = {
    CONDITION_SATISFIED: 1,
    TIMEOUT_EXPIRED: 2,
    WAIT_FAILED: 3,
    getExtension: () => null,
    getParameter: () => "controlled graphics fixture",
    getContextAttributes: () => ({ antialias: true }),
    isContextLost: () => false,
    fenceSync: () => ({}),
    clientWaitSync: () => 1,
    deleteSync: vi.fn(),
    flush: vi.fn(),
  };
  const camera = new T.PerspectiveCamera();
  camera.position.set(2, 3, 4);
  const runtime = {
    camera,
    controls: { target: new T.Vector3(), update: vi.fn() },
    scene: new T.Scene(),
    renderer: {
      getContext: () => gl,
      render: vi.fn(() => {
        now += frameMs;
      }),
      info: {
        render: { calls: 1, triangles: 12 },
        memory: { geometries: 1, textures: 1 },
      },
      domElement: { width: 1440, height: 1000 },
      getPixelRatio: () => 1,
      shadowMap: { enabled: true },
      toneMapping: T.ACESFilmicToneMapping,
      toneMappingExposure: 1,
    },
  };
  return runtime as unknown as MeasuredRuntime;
}

describe("render measurement completion", () => {
  it("does not report success or zero-millisecond frame timing when the warmup draw consumes the entire measurement window", async () => {
    const runtime = fixture(4000);
    const originalEye = runtime.camera.position.clone();
    const report = await measureOrbit(runtime, () => true, 500, 2500);
    expect(report.elapsedMs).toBe(4000);
    expect(report.frames).toBe(0);
    expect(report.completed).toBe(false);
    expect(report.incompleteReason).toMatch(
      /No frames were measured after warmup.*retry/,
    );
    expect(report.medianFrameMs).toBeNull();
    expect(report.p95FrameMs).toBeNull();
    expect(runtime.camera.position.equals(originalEye)).toBe(true);
  });

  it("reports a completed measurement only with actual samples and restores the camera", async () => {
    const runtime = fixture(250);
    const originalEye = runtime.camera.position.clone();
    const report = await measureOrbit(runtime, () => true, 500, 2500);
    expect(report.completed).toBe(true);
    expect(report.incompleteReason).toBeNull();
    expect(report.frames).toBe(10);
    expect(report.medianFrameMs).toBe(250);
    expect(report.p95FrameMs).toBe(250);
    expect(runtime.camera.position.equals(originalEye)).toBe(true);
  });

  it("explains a hidden-page interruption without claiming a measurement", async () => {
    const runtime = fixture(250);
    vi.stubGlobal("document", { hidden: true });
    const report = await measureOrbit(runtime, () => true, 500, 2500);
    expect(report.completed).toBe(false);
    expect(report.frames).toBe(0);
    expect(report.incompleteReason).toMatch(/Keep this tab visible and retry/);
  });
});

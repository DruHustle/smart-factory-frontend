import * as T from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { pollGpuFrame } from "./gpuFrame";
import { scheduleDrawingFrame } from "./drawingFrame";
export type MeasuredRuntime = {
  camera: T.PerspectiveCamera;
  controls: OrbitControls;
  renderer: T.WebGLRenderer;
  scene: T.Scene;
};
/** Sustained active orbit, not an idle RAF sample. All settings are returned. */
export async function measureOrbit(
  r: MeasuredRuntime,
  active: () => boolean,
  warmupMs = 1000,
  durationMs = 8000,
  step?: (elapsed: number) => void,
) {
  const eye = r.camera.position.clone(),
    target = r.controls.target.clone(),
    offset = eye.clone().sub(target),
    started = performance.now();
  const gl = r.renderer.getContext() as WebGL2RenderingContext;
  const debug = gl.getExtension("WEBGL_debug_renderer_info"),
    graphics = String(
      gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    ),
    software = /swiftshader|llvmpipe|software/i.test(graphics);
  let fence: WebGLSync | null = null;
  let previous = started,
    drawCalls = 0,
    triangles = 0,
    submittedAt = 0,
    synchronizedFrames = 0,
    synchronizationFailed = false;
  const intervals: number[] = [];
  while (
    active() &&
    !document.hidden &&
    !synchronizationFailed &&
    !gl.isContextLost() &&
    performance.now() - started < warmupMs + durationMs
  ) {
    await new Promise<void>((resolve) =>
      scheduleDrawingFrame(() => {
        const now = performance.now();
        if (active() && !document.hidden && !gl.isContextLost()) {
          if (fence) {
            const { status, synchronized } = pollGpuFrame(
              gl,
              fence,
              submittedAt,
              software,
            );
            if (synchronized) synchronizedFrames++;
            if (status === gl.TIMEOUT_EXPIRED) {
              resolve();
              return;
            }
            gl.deleteSync(fence);
            fence = null;
            if (status === gl.WAIT_FAILED) {
              synchronizationFailed = true;
              resolve();
              return;
            }
          }
          const elapsed = now - started;
          step?.(elapsed);
          r.camera.position
            .copy(offset)
            .applyAxisAngle(
              new T.Vector3(0, 1, 0),
              0.24 * Math.sin(elapsed / 1800),
            )
            .add(target);
          r.camera.lookAt(target);
          r.renderer.render(r.scene, r.camera);
          fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          submittedAt = performance.now();
          gl.flush();
          if (elapsed >= warmupMs) {
            intervals.push(now - previous);
            drawCalls = Math.max(drawCalls, r.renderer.info.render.calls);
            triangles = Math.max(triangles, r.renderer.info.render.triangles);
          }
          previous = now;
        }
        resolve();
      }),
    );
  }
  if (fence && !gl.isContextLost()) gl.deleteSync(fence);
  const elapsedMs = performance.now() - started;
  if (active()) {
    r.camera.position.copy(eye);
    r.controls.target.copy(target);
    r.controls.update();
  }
  const sorted = [...intervals].sort((a, b) => a - b),
    percentile = (p: number) =>
      Math.round(
        (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ??
          0) * 100,
      ) / 100;
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
    }
  ).memory;
  return {
    protocol: "smart-factory-active-orbit-v2",
    measurementStartedAt: performance.timeOrigin + started,
    completed:
      !synchronizationFailed &&
      !document.hidden &&
      !gl.isContextLost() &&
      elapsedMs >= warmupMs + durationMs,
    synchronization:
      "one completed GPU frame in flight; nonblocking WebGL fence with overdue-query drain",
    synchronizedFrames,
    synchronizationFailed,
    warmupMs,
    durationMs,
    elapsedMs,
    frames: intervals.length,
    medianFrameMs: percentile(0.5),
    p95FrameMs: percentile(0.95),
    frameIntervalsMs: intervals,
    drawCalls,
    triangles,
    geometries: r.renderer.info.memory.geometries,
    textures: r.renderer.info.memory.textures,
    jsHeapBytes: memory?.usedJSHeapSize ?? null,
    graphics,
    rendererClass: /swiftshader|llvmpipe|software/i.test(graphics)
      ? "software"
      : "hardware acceleration reported; physical-device qualification separate",
    browser: navigator.userAgent,
    viewport: [innerWidth, innerHeight],
    canvas: [r.renderer.domElement.width, r.renderer.domElement.height],
    devicePixelRatio,
    renderPixelRatio: r.renderer.getPixelRatio(),
    shadows: r.renderer.shadowMap.enabled,
    antialias: gl.getContextAttributes()?.antialias,
    toneMapping: r.renderer.toneMapping,
    exposure: r.renderer.toneMappingExposure,
    orbit: {
      radians: 0.24,
      periodMs: 1800,
      eye: eye.toArray(),
      target: target.toArray(),
    },
  };
}

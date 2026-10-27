import type { PerspectiveCamera, Vector3 } from "three";

/** A bounded camera transition, cancelled by user input and completed immediately when hidden/reduced. */
export function moveCamera(
  camera: PerspectiveCamera,
  controls: { target: Vector3; update: () => unknown },
  eye: Vector3,
  target: Vector3,
  render: () => void,
  duration = 300,
  onSettled?: () => void,
) {
  const startEye = camera.position.clone(),
    startTarget = controls.target.clone();
  const media =
    typeof matchMedia === "function"
      ? matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  let frame = 0,
    done = false;
  const stop = () => {
    if (done) return;
    done = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", visibility);
    media?.removeEventListener?.("change", preference);
    onSettled?.();
  };
  const paint = (amount: number) => {
    camera.position.lerpVectors(startEye, eye, amount);
    controls.target.lerpVectors(startTarget, target, amount);
    controls.update();
    render();
  };
  const finish = () => {
    if (!done) {
      paint(1);
      stop();
    }
  };
  const visibility = () => {
    if (document.hidden) finish();
  };
  const preference = () => {
    if (media?.matches) finish();
  };
  if (
    media?.matches ||
    (typeof document !== "undefined" && document.hidden) ||
    typeof requestAnimationFrame !== "function" ||
    duration <= 0
  ) {
    finish();
    return stop;
  }
  const started = performance.now();
  const step = (at: number) => {
    if (done) return;
    const t = Math.max(0, Math.min(1, (at - started) / duration));
    paint(t * t * (3 - 2 * t));
    if (t < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", visibility);
  media?.addEventListener?.("change", preference);
  frame = requestAnimationFrame(step);
  return stop;
}

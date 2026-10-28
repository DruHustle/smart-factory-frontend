/** Coalesce on-demand drawing on RAF, with a watchdog for suspended compositor
 * callbacks. The caller checks visibility before submitting any GPU work. */
export function scheduleDrawingFrame(draw: () => void) {
  let pending = true;
  let animation = 0;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    pending = false;
    cancelAnimationFrame(animation);
    clearTimeout(watchdog);
  };
  const run = () => {
    if (!pending) return;
    cancel();
    draw();
  };
  animation = requestAnimationFrame(run);
  watchdog = setTimeout(run, 100);
  return cancel;
}

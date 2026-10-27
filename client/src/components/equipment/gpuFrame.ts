/** Normal draws poll without blocking. Recover an overdue software-driver query
 * by draining its single submitted frame, rather than queueing more GPU work. */
export function pollGpuFrame(
  gl: WebGL2RenderingContext,
  fence: WebGLSync,
  submittedAt: number,
  recoverStalledQuery = false,
  now = performance.now(),
) {
  const status = gl.clientWaitSync(fence, gl.SYNC_FLUSH_COMMANDS_BIT, 0);
  if (status !== gl.TIMEOUT_EXPIRED) return { status, synchronized: false };
  gl.flush();
  if (!recoverStalledQuery || now - submittedAt < 500)
    return { status, synchronized: false };
  // Some software drivers finish the frame but delay query availability.
  // finish() confirms completion before the next draw; it never skips work.
  // This exceptional drain can block while outstanding GPU work completes.
  gl.finish();
  return {
    status: gl.isContextLost() ? gl.WAIT_FAILED : gl.CONDITION_SATISFIED,
    synchronized: true,
  };
}

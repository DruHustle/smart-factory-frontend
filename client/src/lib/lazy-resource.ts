/** Bound an optional UI module load so a stalled connection has a recovery path. */
export function loadWithTimeout<T>(
  load: () => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Setup loading timed out")),
      timeoutMs,
    );
  });
  return Promise.race([Promise.resolve().then(load), deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

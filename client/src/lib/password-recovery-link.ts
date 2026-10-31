// Recovery credentials belong only in memory. Capture the hash fragment before
// mounting analytics or sending requests, then remove it from browser history.
let snapshot: { token: string | null; revision: number } = {
  token: null,
  revision: 0,
};
const listeners = new Set<() => void>();

function publish(token: string | null, revision = snapshot.revision) {
  snapshot = { token, revision };
  listeners.forEach((listener) => listener());
}

export function capturePasswordResetToken() {
  const fragment = window.location.hash.slice(1);
  const separator = fragment.indexOf("?");
  if (
    fragment.slice(0, separator < 0 ? undefined : separator) !==
    "/reset-password"
  )
    return;
  if (separator < 0) return;
  const params = new URLSearchParams(fragment.slice(separator + 1));
  const token = params.get("token");
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}#/reset-password`,
  );
  publish(
    token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null,
    snapshot.revision + 1,
  );
}

export function passwordResetToken() {
  capturePasswordResetToken();
  return snapshot.token;
}

export function clearPasswordResetToken() {
  publish(null);
}

export const passwordResetSnapshot = () => snapshot;
export function subscribePasswordResetLink(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function containsSensitivePageMetadata(url: Pick<URL, "hash" | "pathname">) {
  const paths = [url.pathname, url.hash.slice(1).split("?")[0]];
  return paths.some(
    (path) =>
      path === "/reset-password" ||
      path === "/passport/demo" ||
      path.startsWith("/passport/demo/"),
  );
}

/**
 * The analytics SDK can outlive its React component during SPA navigation.
 * Keep both recovery credentials and portable demo identity payloads out of
 * events, including queued events delivered after the user leaves that page.
 */
export function filterPasswordRecoveryAnalytics<T extends { url: string }>(
  event: T,
): T | null {
  if (containsSensitivePageMetadata(window.location)) return null;
  try {
    const url = new URL(event.url, window.location.origin);
    if (containsSensitivePageMetadata(url)) return null;
  } catch {
    return null;
  }
  return event;
}

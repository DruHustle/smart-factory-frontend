import {
  requestedDataWorkspace,
  type DataWorkspace,
} from "@shared/data-workspace";

export const dataWorkspaceChangedKey = "smart-factory:data-workspace-changed";

function workspaceChangedError() {
  return new DOMException(
    "The data workspace changed. Reloading the view.",
    "AbortError",
  );
}

/** A document may only consume responses for the cookie scope it started with. */
export function createDataWorkspaceGuard({
  readWorkspace,
  onChange,
  fetch: fetchRequest = globalThis.fetch,
}: {
  readWorkspace: () => DataWorkspace | undefined;
  onChange: () => void;
  fetch?: typeof globalThis.fetch;
}) {
  const initialWorkspace = readWorkspace();
  const requests = new Set<AbortController>();
  let changing = false;

  function invalidate() {
    if (changing) return;
    changing = true;
    for (const request of requests) request.abort(workspaceChangedError());
    onChange();
  }

  function reconcile() {
    if (readWorkspace() !== initialWorkspace) invalidate();
    return !changing;
  }

  function assertCurrent() {
    if (!reconcile()) throw workspaceChangedError();
  }

  async function fetchInWorkspace(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    assertCurrent();
    const controller = new AbortController();
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : null);
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    requests.add(controller);
    try {
      const response = await fetchRequest(input, {
        ...init,
        credentials: "include",
        signal: controller.signal,
      });
      // tRPC uses complete JSON responses. Keep cancellation and the scope check
      // active through body delivery, including an old request finishing after
      // another tab switches. Do not release mismatched data to either client.
      const body = await response.arrayBuffer();
      assertCurrent();
      return new Response(
        [204, 205, 304].includes(response.status) ? null : body,
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
    } finally {
      requests.delete(controller);
      signal?.removeEventListener("abort", abort);
    }
  }

  return { reconcile, invalidate, fetch: fetchInWorkspace };
}

let browserGuard: ReturnType<typeof createDataWorkspaceGuard> | undefined;
let channel: BroadcastChannel | undefined;

/** Install before auth or protected queries can run. Messages are notifications,
 * never an authorization or workspace value supplied to the server. */
export function installDataWorkspaceSync(onChange: () => void) {
  const guard = createDataWorkspaceGuard({
    readWorkspace: () => requestedDataWorkspace(document.cookie),
    onChange,
  });
  browserGuard = guard;
  const reconcile = () => guard.reconcile();
  const visible = () => {
    if (document.visibilityState === "visible") reconcile();
  };
  const changed = () => guard.invalidate();
  const storage = (event: StorageEvent) => {
    if (event.key === dataWorkspaceChangedKey && event.newValue) changed();
  };
  try {
    channel = new BroadcastChannel(dataWorkspaceChangedKey);
    channel.addEventListener("message", changed);
  } catch {
    // Storage, focus and the request guard also cover browsers without channels.
  }
  window.addEventListener("storage", storage);
  window.addEventListener("focus", reconcile);
  window.addEventListener("pageshow", reconcile);
  document.addEventListener("visibilitychange", visible);
  return () => {
    channel?.close();
    channel = undefined;
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", reconcile);
    window.removeEventListener("pageshow", reconcile);
    document.removeEventListener("visibilitychange", visible);
    if (browserGuard === guard) browserGuard = undefined;
  };
}

export function dataWorkspaceIsCurrent() {
  return browserGuard?.reconcile() ?? true;
}

/** Call only after the cookie write has been verified by the selector. */
export function announceDataWorkspaceChange() {
  try {
    channel?.postMessage("changed");
  } catch {
    // A closing channel must not suppress the cookie-backed switch or fallback.
  }
  try {
    // Each successful switch must produce an event, even a rapid A→B→A change.
    localStorage.setItem(
      dataWorkspaceChangedKey,
      `${Date.now()}:${Math.random()}`,
    );
  } catch {
    // A restricted storage policy must not prevent a cookie-backed switch.
  }
  browserGuard?.invalidate();
}

export function fetchInDataWorkspace(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  if (!browserGuard)
    throw new Error("Data workspace synchronization is not initialized.");
  return browserGuard.fetch(input, init);
}

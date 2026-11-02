import { afterEach, describe, expect, it, vi } from "vitest";
import {
  announceDataWorkspaceChange,
  createDataWorkspaceGuard,
  installDataWorkspaceSync,
} from "../client/src/lib/data-workspace-sync";
import type { DataWorkspace } from "../shared/data-workspace";

afterEach(() => vi.unstubAllGlobals());

describe("document data workspace boundary", () => {
  it("preserves the JSON response and session credentials for the initial scope", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response('{"result":{"data":{"isDemo":false}}}', {
        status: 200,
        headers: { "content-type": "application/json", "x-fixture": "live" },
      }),
    );
    const onChange = vi.fn();
    const guard = createDataWorkspaceGuard({
      readWorkspace: () => "live",
      onChange,
      fetch,
    });

    const response = await guard.fetch(
      "https://example.test/api/trpc/devices.monitor",
    );
    expect(await response.json()).toEqual({
      result: { data: { isDemo: false } },
    });
    expect(response.headers.get("x-fixture")).toBe("live");
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        credentials: "include",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each<DataWorkspace | undefined>(["live", "demo", undefined])(
    "blocks a changed cookie before any request from a %s document",
    async (initial) => {
      let workspace = initial;
      const onChange = vi.fn();
      const fetch = vi.fn<typeof globalThis.fetch>();
      const guard = createDataWorkspaceGuard({
        readWorkspace: () => workspace,
        onChange,
        fetch,
      });
      workspace = initial === "demo" ? "live" : "demo";

      await expect(
        guard.fetch("https://example.test/api/trpc/auth.me"),
      ).rejects.toMatchObject({ name: "AbortError" });
      await expect(
        guard.fetch("https://example.test/api/trpc/devices.monitor"),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(fetch).not.toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403])(
    "preserves an HTTP %s authorization failure",
    async (status) => {
      const failure = {
        error: { message: "Access denied", data: { httpStatus: status } },
      };
      const onChange = vi.fn();
      const guard = createDataWorkspaceGuard({
        readWorkspace: () => "live",
        onChange,
        fetch: vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(new Response(JSON.stringify(failure), { status })),
      });
      const response = await guard.fetch(
        "https://example.test/api/trpc/devices.monitor",
      );
      expect(response.status).toBe(status);
      expect(response.ok).toBe(false);
      expect(await response.json()).toEqual(failure);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("rejects data when the cookie changes while a response body is arriving", async () => {
    let workspace: DataWorkspace = "live";
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            body = controller;
          },
        }),
      ),
    );
    const onChange = vi.fn();
    const guard = createDataWorkspaceGuard({
      readWorkspace: () => workspace,
      onChange,
      fetch,
    });
    const pending = guard.fetch(
      "https://example.test/api/trpc/devices.monitor",
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await Promise.resolve();

    workspace = "demo";
    body.enqueue(new TextEncoder().encode('{"items":[{"name":"Demo PLC"}]}'));
    body.close();
    await rejected;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("aborts outstanding requests and stays closed through a rapid switch back", async () => {
    let workspace: DataWorkspace = "live";
    const onChange = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    const guard = createDataWorkspaceGuard({
      readWorkspace: () => workspace,
      onChange,
      fetch,
    });
    const pending = guard.fetch(
      "https://example.test/api/trpc/devices.monitor",
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    workspace = "demo";
    guard.invalidate();
    workspace = "live";
    guard.invalidate();
    await rejected;

    expect(guard.reconcile()).toBe(false);
    await expect(
      guard.fetch("https://example.test/api/trpc/devices.monitor"),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("preserves caller cancellation without treating it as a workspace change", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    const onChange = vi.fn();
    const guard = createDataWorkspaceGuard({
      readWorkspace: () => "demo",
      onChange,
      fetch,
    });
    const caller = new AbortController();
    const pending = guard.fetch(
      "https://example.test/api/trpc/readings.trend",
      { signal: caller.signal },
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    caller.abort();
    await rejected;
    expect(guard.reconcile()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("missed workspace notification fallback", () => {
  it("still reconciles the switching tab when notifications are unavailable", () => {
    const browserDocument = Object.assign(new EventTarget(), {
      cookie: "smart_factory_data_workspace=live",
    });
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", browserDocument);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        addEventListener() {}
        postMessage() {
          throw new Error("Channel closed");
        }
        close() {}
      },
    );
    vi.stubGlobal("localStorage", {
      setItem() {
        throw new Error("Storage disabled");
      },
    });
    const onChange = vi.fn();
    const dispose = installDataWorkspaceSync(onChange);
    try {
      browserDocument.cookie = "smart_factory_data_workspace=demo";
      expect(() => announceDataWorkspaceChange()).not.toThrow();
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it.each(["focus", "pageshow", "visibilitychange"])(
    "reconciles on %s without BroadcastChannel or storage",
    (event) => {
      const browserWindow = new EventTarget();
      const browserDocument = Object.assign(new EventTarget(), {
        cookie: "smart_factory_data_workspace=live",
        visibilityState: "visible",
      });
      vi.stubGlobal("window", browserWindow);
      vi.stubGlobal("document", browserDocument);
      vi.stubGlobal("BroadcastChannel", undefined);
      const onChange = vi.fn();
      const dispose = installDataWorkspaceSync(onChange);
      try {
        browserDocument.cookie = "smart_factory_data_workspace=demo";
        (event === "visibilitychange"
          ? browserDocument
          : browserWindow
        ).dispatchEvent(new Event(event));
        expect(onChange).toHaveBeenCalledTimes(1);
      } finally {
        dispose();
      }
    },
  );
});

import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function fixture(page: Page) {
  const modulePath =
    "/@fs/" +
    pathToFileURL(resolve("e2e/fixtures/nvidia-floor-harness.tsx")).pathname;
  await page.route("**/__model-batch-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0"><script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import(${JSON.stringify(modulePath)});
    </script></body></html>`,
    }),
  );
  await page.goto("/__model-batch-fixture");
  await page.waitForFunction(() => !!window.floorNvidiaHarness);
  await page.evaluate(() => window.floorNvidiaHarness.probeBatch());
}

async function preparedFirst(page: Page) {
  let releaseFirst!: () => void, failLast!: () => void;
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const last = new Promise<void>((resolve) => {
    failLast = resolve;
  });
  await page.route(
    "**/models/nvidia/nvidia-transfer-conveyor/compact.*.glb",
    async (route) => {
      await first;
      await route.continue();
    },
  );
  await page.route(
    "**/models/nvidia/nvidia-storage-rack/compact.*.glb",
    async (route) => {
      await last;
      await route.abort();
    },
  );
  await fixture(page);
  await page.evaluate(() =>
    window.floorNvidiaHarness.mount(
      "floor",
      "Transfer conveyor",
      "conveyor",
      2,
      true,
      { name: "Warehouse rack", type: "warehouse_rack" },
    ),
  );
  const host = page.locator("#floor");
  const canvas = host.getByRole("img", {
    name: "Interactive 3D factory floor",
  });
  await expect(host.getByRole("status")).toContainText(
    "0 detailed models ready",
    { timeout: 30000 },
  );
  releaseFirst();
  await expect
    .poll(
      () => page.evaluate(() => window.floorNvidiaHarness.batchProbe.staged),
      { timeout: 30000 },
    )
    .toBe(1);
  return { host, canvas, failLast };
}

test("the last failed reference flushes the staged model only after a frame", async ({
  page,
}) => {
  const { host, canvas, failLast } = await preparedFirst(page);
  await expect(canvas).toHaveAttribute("data-floor-nvidia-models", "[]");
  await expect(host.getByRole("status")).toContainText(
    "0 detailed models ready",
  );
  failLast();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.floorNvidiaHarness.batchProbe.lastFinalPending,
      ),
    )
    .toBe(1);
  await expect(canvas).toHaveAttribute(
    "data-floor-nvidia-models",
    '["nvidia-transfer-conveyor"]',
    { timeout: 30000 },
  );
  await expect(host.getByRole("status")).toContainText(
    "1 detailed models ready",
  );
  await expect(host.getByRole("status")).toContainText("1 simplified");
});

test("picking the visible proxy triggers a frame without changing the selected item", async ({
  page,
}) => {
  const { host, canvas, failLast } = await preparedFirst(page);
  const box = await canvas.boundingBox();
  if (!box) throw Error("Canvas unavailable");
  let point: { x: number; y: number } | undefined;
  for (let dy = -100; dy <= 100 && !point; dy += 12) {
    for (let dx = -220; dx <= 220 && !point; dx += 12) {
      const candidate = {
        x: box.x + box.width / 2 + dx,
        y: box.y + box.height / 2 + dy,
      };
      await page.mouse.move(candidate.x, candidate.y);
      if ((await canvas.getAttribute("data-grab-target")) === "asset:1")
        point = candidate;
    }
  }
  expect(point).toBeDefined();
  await expect(canvas).toHaveAttribute("data-floor-nvidia-models", "[]");
  await page.mouse.click(point!.x, point!.y);
  await expect(host.getByTestId("selected")).toHaveText("asset:1");
  await expect(canvas).toHaveAttribute(
    "data-floor-nvidia-models",
    '["nvidia-transfer-conveyor"]',
    { timeout: 30000 },
  );
  failLast();
});

test("unmount cancels a staged batch and releases its WebGL context", async ({
  page,
}) => {
  const { canvas, failLast } = await preparedFirst(page);
  await canvas.evaluate((node) => {
    (
      window as typeof window & { batchContext: WebGL2RenderingContext | null }
    ).batchContext = (node as HTMLCanvasElement).getContext("webgl2");
  });
  await page.evaluate(() => window.floorNvidiaHarness.unmount("floor"));
  await expect
    .poll(() =>
      page.evaluate(() => window.floorNvidiaHarness.batchProbe.disposedPending),
    )
    .toBe(1);
  await page.waitForFunction(
    () =>
      (
        window as typeof window & {
          batchContext: WebGL2RenderingContext | null;
        }
      ).batchContext?.isContextLost(),
    null,
    { timeout: 30000 },
  );
  failLast();
});

test("a failed batch draw does not publish staged model metadata", async ({
  page,
}) => {
  const { host, canvas, failLast } = await preparedFirst(page);
  await canvas.evaluate((node) => {
    const saved = window as typeof window & {
      failedBatchCanvas: HTMLCanvasElement;
      failedBatchContext: WebGL2RenderingContext | null;
    };
    saved.failedBatchCanvas = node as HTMLCanvasElement;
    saved.failedBatchContext = saved.failedBatchCanvas.getContext("webgl2");
  });
  await page.evaluate(() => window.floorNvidiaHarness.failNextRender());
  failLast();
  await expect(host.getByRole("status")).toContainText("3D unavailable", {
    timeout: 30000,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { failedBatchCanvas: HTMLCanvasElement })
            .failedBatchCanvas.dataset.floorNvidiaModels,
      ),
    )
    .toBe("[]");
  await page.waitForFunction(
    () =>
      (
        window as typeof window & {
          failedBatchContext: WebGL2RenderingContext | null;
        }
      ).failedBatchContext?.isContextLost(),
    null,
    { timeout: 30000 },
  );
});

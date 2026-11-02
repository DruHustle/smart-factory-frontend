import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function fixture(page: Page) {
  const modulePath =
    "/@fs/" +
    pathToFileURL(resolve("e2e/fixtures/floor-stage-harness.tsx")).pathname;
  await page.route("**/__floor-stage-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import(${JSON.stringify(modulePath)});
    </script></body></html>`,
    }),
  );
  await page.goto("/__floor-stage-fixture");
}

test("the plan remains usable through a held 3D import and focused handoff", async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(
    "**/src/components/workspace/FactoryFloorScene.tsx*",
    async (route) => {
      requested = true;
      await held;
      await route.continue();
    },
  );
  await fixture(page);
  const stage = page.locator("#stage");
  const preview = stage.locator("[data-floor-preview]");
  const plan = stage.getByRole("img", {
    name: "Accessible factory floor plan",
  });
  const item = plan.getByRole("button", { name: "Select Transfer conveyor" });
  await expect(item).toBeVisible();
  expect(
    await plan.evaluate((svg) => {
      const bounds = svg.getBoundingClientRect();
      return [
        ...svg.querySelectorAll(
          'g[aria-label="Factory loading, storage, production and exit areas"] text',
        ),
      ].every((label) => {
        const box = label.getBoundingClientRect();
        return (
          box.left >= bounds.left - 1 &&
          box.right <= bounds.right + 1 &&
          box.top >= bounds.top - 1 &&
          box.bottom <= bounds.bottom + 1
        );
      });
    }),
  ).toBe(true);
  expect(
    await plan.evaluate((svg) => {
      const area = svg.querySelector(
        'g[role="img"][aria-label^="Warehouse / inventory"]',
      );
      const label = area?.querySelector("text")?.getBoundingClientRect();
      const rack = area?.querySelector("rect")?.getBoundingClientRect();
      return !!label && !!rack && label.bottom <= rack.top + 1;
    }),
  ).toBe(true);
  await stage.screenshot({ path: testInfo.outputPath("immediate-plan.png") });
  await expect.poll(() => requested).toBe(true);
  await item.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("selected")).toHaveText("asset:1");
  release();
  await expect(preview).toHaveAttribute("data-floor-preview", "ready", {
    timeout: 30000,
  });
  await expect(item).toBeFocused();
  await expect(
    stage.getByRole("img", { name: "Interactive 3D factory floor" }),
  ).toHaveCount(0);
  const hiddenCanvas = stage.locator("canvas");
  await expect
    .poll(async () => (await hiddenCanvas.boundingBox())?.width ?? 0)
    .toBeGreaterThan(0);
  const show3D = stage.getByRole("button", { name: "Show 3D" });
  const showBox = await show3D.boundingBox();
  const zoomBox = await stage
    .getByRole("group", { name: "Floor plan zoom" })
    .boundingBox();
  expect(
    showBox &&
      zoomBox &&
      (showBox.y >= zoomBox.y + zoomBox.height ||
        zoomBox.y >= showBox.y + showBox.height),
  ).toBe(true);
  await show3D.click();
  const canvas = stage.getByRole("img", {
    name: "Interactive 3D factory floor",
  });
  await expect(canvas).toBeVisible();
  await expect(canvas).toBeFocused();
  await expect(canvas).toHaveAttribute(
    "data-floor-nvidia-models",
    '["nvidia-transfer-conveyor"]',
    { timeout: 30000 },
  );
  await expect(page.getByTestId("selected")).toHaveText("asset:1");
  const screenshot = await canvas.screenshot({
    path: testInfo.outputPath("first-3d-frame.png"),
  });
  expect(screenshot.length).toBeGreaterThan(1000);
});

test("a plan drag completes before the 3D handoff", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/src/components/workspace/FactoryFloorScene.tsx*",
    async (route) => {
      await held;
      await route.continue();
    },
  );
  await fixture(page);
  const stage = page.locator("#stage");
  const plan = stage.getByRole("img", {
    name: "Accessible factory floor plan",
  });
  const item = plan.getByRole("button", { name: "Select Transfer conveyor" });
  const box = await item.boundingBox();
  if (!box) throw Error("Floor item missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 30,
    box.y + box.height / 2 + 20,
  );
  await expect(page.getByTestId("dragged")).toHaveText("asset:1");
  release();
  await expect(stage.locator("[data-floor-preview]")).toHaveAttribute(
    "data-floor-preview",
    "ready",
    { timeout: 30000 },
  );
  await expect(plan).toHaveAttribute("data-grab-state", "item");
  await expect(page.getByTestId("dragged")).toHaveText("asset:1");
  await page.mouse.up();
  await expect(page.getByTestId("moves")).toHaveText("1");
  await expect(page.getByTestId("dragged")).toHaveText("none");
  await stage.getByRole("button", { name: "Show 3D" }).click();
  await expect(
    stage.getByRole("img", { name: "Interactive 3D factory floor" }),
  ).toBeFocused();
});

test("a floor pan completes before the 3D handoff", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/src/components/workspace/FactoryFloorScene.tsx*",
    async (route) => {
      await held;
      await route.continue();
    },
  );
  await fixture(page);
  const stage = page.locator("#stage");
  const plan = stage.getByRole("img", {
    name: "Accessible factory floor plan",
  });
  const box = await plan.boundingBox();
  if (!box) throw Error("Floor plan missing");
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height - 40);
  await expect(plan).toHaveAttribute("data-grab-state", "floor");
  release();
  await expect(stage.locator("[data-floor-preview]")).toHaveAttribute(
    "data-floor-preview",
    "ready",
    { timeout: 30000 },
  );
  await expect(plan).toHaveAttribute("data-grab-state", "floor");
  await page.mouse.up();
  await expect(page.getByTestId("moves")).toHaveText("0");
  await stage.getByRole("button", { name: "Show 3D" }).click();
  await expect(
    stage.getByRole("img", { name: "Interactive 3D factory floor" }),
  ).toBeVisible();
});

test("requesting 3D does not interrupt another active pointer", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/src/components/workspace/FactoryFloorScene.tsx*",
    async (route) => {
      await held;
      await route.continue();
    },
  );
  await fixture(page);
  const stage = page.locator("#stage");
  const plan = stage.getByRole("img", {
    name: "Accessible factory floor plan",
  });
  const item = plan.getByRole("button", { name: "Select Transfer conveyor" });
  const box = await item.boundingBox();
  if (!box) throw Error("Floor item missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId("dragged")).toHaveText("asset:1");
  release();
  await expect(stage.locator("[data-floor-preview]")).toHaveAttribute(
    "data-floor-preview",
    "ready",
    { timeout: 30000 },
  );
  // Simulate keyboard activation while another pointer remains down.
  await stage
    .getByRole("button", { name: "Show 3D" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(plan).toBeVisible();
  await expect(page.getByTestId("dragged")).toHaveText("asset:1");
  await page.mouse.up();
  await expect(
    stage.getByRole("img", { name: "Interactive 3D factory floor" }),
  ).toBeFocused();
});

test("a deferred handoff does not steal focus moved elsewhere", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/src/components/workspace/FactoryFloorScene.tsx*",
    async (route) => {
      await held;
      await route.continue();
    },
  );
  await fixture(page);
  const stage = page.locator("#stage");
  const item = stage
    .getByRole("img", { name: "Accessible factory floor plan" })
    .getByRole("button", { name: "Select Transfer conveyor" });
  const box = await item.boundingBox();
  if (!box) throw Error("Floor item missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  release();
  await expect(stage.locator("[data-floor-preview]")).toHaveAttribute(
    "data-floor-preview",
    "ready",
    { timeout: 30000 },
  );
  await stage
    .getByRole("button", { name: "Show 3D" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  const outside = page.getByRole("button", { name: "Change equipment" });
  await outside.focus();
  await page.mouse.up();
  await expect(
    stage.getByRole("img", { name: "Interactive 3D factory floor" }),
  ).toBeVisible();
  await expect(outside).toBeFocused();
});

test("a pointer released outside the plan does not block the handoff", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/src/components/workspace/FactoryFloorScene.tsx*",
    async (route) => {
      await held;
      await route.continue();
    },
  );
  await fixture(page);
  const stage = page.locator("#stage");
  const zoom = stage.getByRole("button", { name: "Zoom in floor plan" });
  const box = await zoom.boundingBox();
  if (!box) throw Error("Zoom control missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  release();
  await expect(stage.locator("[data-floor-preview]")).toHaveAttribute(
    "data-floor-preview",
    "ready",
    { timeout: 30000 },
  );
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await page.getByRole("button", { name: "Change equipment" }).focus();
  await expect(
    stage.getByRole("img", { name: "Interactive 3D factory floor" }),
  ).toBeVisible();
});

test("a changed layout cannot reveal a stale 3D frame", async ({ page }) => {
  await fixture(page);
  const stage = page.locator("#stage");
  const originalCanvas = stage.getByRole("img", {
    name: "Interactive 3D factory floor",
  });
  await expect(originalCanvas).toBeVisible({ timeout: 30000 });
  await originalCanvas.focus();
  await page.evaluate(() => {
    const original = window.requestAnimationFrame;
    const cancel = window.cancelAnimationFrame;
    const callbacks = new Map<number, FrameRequestCallback>();
    let next = 10000000;
    window.requestAnimationFrame = (callback) => {
      const id = next++;
      callbacks.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (!callbacks.delete(id)) cancel(id);
    };
    (window as typeof window & { resumeFrames: () => void }).resumeFrames =
      () => {
        window.requestAnimationFrame = original;
        window.cancelAnimationFrame = cancel;
        for (const callback of callbacks.values()) original(callback);
        callbacks.clear();
      };
  });
  // Change the layout without moving focus away from the existing 3D view.
  await page
    .getByRole("button", { name: "Change equipment" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(stage.locator("[data-floor-preview]")).toHaveAttribute(
    "data-floor-preview",
    "loading",
  );
  await expect(
    stage.getByRole("img", { name: "Interactive 3D factory floor" }),
  ).toHaveCount(0);
  await expect(stage.locator("[data-floor-preview]")).toBeFocused();
  await page.evaluate(() =>
    (window as typeof window & { resumeFrames: () => void }).resumeFrames(),
  );
  await expect(stage.locator("[data-floor-preview]")).toHaveAttribute(
    "data-floor-preview",
    "ready",
    { timeout: 30000 },
  );
  await stage.getByRole("button", { name: "Show 3D" }).click();
  const canvas = stage.getByRole("img", {
    name: "Interactive 3D factory floor",
  });
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await expect(canvas).toHaveAttribute(
    "data-floor-nvidia-models",
    '["nvidia-storage-rack"]',
    { timeout: 30000 },
  );
  await expect(canvas).toBeFocused();
});

test("a context loss does not steal focus after the user has left 3D", async ({
  page,
}) => {
  await fixture(page);
  const stage = page.locator("#stage");
  const canvas = stage.getByRole("img", {
    name: "Interactive 3D factory floor",
  });
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await canvas.focus();
  await page.getByRole("button", { name: "Change equipment" }).focus();
  await canvas.evaluate((node) => {
    const extension = (node as HTMLCanvasElement)
      .getContext("webgl2")
      ?.getExtension("WEBGL_lose_context");
    if (!extension) throw Error("Context-loss extension unavailable");
    extension.loseContext();
  });
  await expect(stage.getByRole("status")).toContainText(
    "3D unavailable on this device",
  );
  await expect(
    page.getByRole("button", { name: "Change equipment" }),
  ).toBeFocused();
});

test("the plan remains interactive when the 3D module fails", async ({
  page,
}) => {
  await page.route(
    "**/src/components/workspace/FactoryFloorScene.tsx*",
    (route) => route.abort(),
  );
  await fixture(page);
  const stage = page.locator("#stage");
  await expect(stage.getByRole("status")).toContainText(
    "3D unavailable on this device",
  );
  const item = stage
    .getByRole("img", { name: "Accessible factory floor plan" })
    .getByRole("button", { name: "Select Transfer conveyor" });
  await item.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("selected")).toHaveText("asset:1");
  await expect(
    stage.getByRole("img", { name: "Interactive 3D factory floor" }),
  ).toHaveCount(0);
});

test("a late 3D setup failure disposes partial graphics resources", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      kind: string,
      ...args: unknown[]
    ) {
      const result = original.call(this, kind as "2d", ...args);
      if (kind === "webgl2")
        (
          window as typeof window & {
            capturedGL: WebGL2RenderingContext | null;
          }
        ).capturedGL = result as unknown as WebGL2RenderingContext | null;
      return result;
    } as typeof original;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/src/components/workspace/FactoryFloorScene.tsx*",
    async (route) => {
      await held;
      await route.continue();
    },
  );
  await fixture(page);
  await expect(page.locator("#stage [data-floor-preview]")).toBeVisible();
  await page.evaluate(() => window.floorStageHarness.failConnections());
  release();
  const stage = page.locator("#stage");
  await expect(stage.getByRole("status")).toContainText(
    "3D unavailable on this device",
    { timeout: 30000 },
  );
  await expect(
    stage.getByRole("img", { name: "Accessible factory floor plan" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.floorStageHarness.disposedGeometries),
    )
    .toBeGreaterThan(0);
  await page.waitForFunction(
    () =>
      (
        window as typeof window & { capturedGL: WebGL2RenderingContext | null }
      ).capturedGL?.isContextLost(),
    null,
    { timeout: 30000 },
  );
});

test("actual 3D context loss returns focus to the floor plan", async ({
  page,
}) => {
  await fixture(page);
  const stage = page.locator("#stage");
  const canvas = stage.getByRole("img", {
    name: "Interactive 3D factory floor",
  });
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await canvas.focus();
  await canvas.evaluate((node) => {
    const gl = (node as HTMLCanvasElement).getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) throw Error("Context-loss extension unavailable");
    extension.loseContext();
  });
  await expect(stage.getByRole("status")).toContainText(
    "3D unavailable on this device",
  );
  await expect(stage.locator("[data-floor-preview]")).toBeFocused();
  await expect(
    stage
      .getByRole("img", { name: "Accessible factory floor plan" })
      .getByRole("button"),
  ).toHaveCount(1);
});

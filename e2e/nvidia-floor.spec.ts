import { test, expect, type Page, type Locator } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const assets = [
  {
    name: "Transfer conveyor",
    type: "conveyor",
    slug: "nvidia-transfer-conveyor",
  },
  {
    name: "Warehouse rack",
    type: "warehouse_rack",
    slug: "nvidia-storage-rack",
  },
  { name: "Mobile cart", type: "mobile_cart", slug: "nvidia-mobile-cart" },
];

async function fixture(page: Page) {
  // Vite's document root is client/, while this test-only module is in e2e/.
  // /@fs serves the real workspace file and pathToFileURL escapes spaces.
  const modulePath =
    "/@fs/" +
    pathToFileURL(resolve("e2e/fixtures/nvidia-floor-harness.tsx")).pathname;
  await page.route("**/__nvidia-floor-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      // A fulfilled synthetic HTML response bypasses Vite's normal HTML
      // transform, so install the same React refresh preamble before imports.
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><script type="module">
        import RefreshRuntime from "/@react-refresh";
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        await import(${JSON.stringify(modulePath)});
      </script></body></html>`,
    }),
  );
  await page.goto("/__nvidia-floor-fixture");
  await page.waitForFunction(() => !!window.floorNvidiaHarness, null, {
    timeout: 10000,
  });
}

test("NVIDIA floor fixture starts", async ({ page }) => {
  await fixture(page);
  expect(await page.evaluate(() => !!window.floorNvidiaHarness)).toBe(true);
});

async function mount(page: Page, id: string, asset: (typeof assets)[number]) {
  await page.evaluate(
    ({ id, asset }) =>
      window.floorNvidiaHarness.mount(id, asset.name, asset.type),
    { id, asset },
  );
  const host = page.locator("#" + id);
  const canvas = host.getByRole("img", {
    name: "Interactive 3D factory floor",
    exact: true,
  });
  await expect(canvas).toBeVisible();
  return { host, canvas };
}

async function itemPoint(page: Page, canvas: Locator) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Factory floor canvas missing");
  let point: { x: number; y: number } | undefined;
  for (let dy = -80; dy <= 40 && !point; dy += 8) {
    for (let dx = -70; dx <= 70; dx += 8) {
      const candidate = {
        x: box.x + box.width / 2 + dx,
        y: box.y + box.height / 2 + dy,
      };
      await page.mouse.move(candidate.x, candidate.y);
      if ((await canvas.getAttribute("data-grab-target")) === "asset:1") {
        point = candidate;
        break;
      }
    }
  }
  expect(point, "The actual visible item should be selectable").toBeDefined();
  return point!;
}

async function pickItem(page: Page, canvas: Locator, host: Locator) {
  const point = await itemPoint(page, canvas);
  await page.mouse.click(point.x, point.y);
  await expect(host.getByTestId("selected")).toHaveText("asset:1");
}

test("selectable local geometry appears before delayed studio lighting and upgrades without losing selection", async ({
  page,
}, testInfo) => {
  // Hold the optional atlas until after the usable scene is observed. Extend
  // only its five-second timeout so this invariant is independent of CI GPU
  // speed; this test does not claim a universal first-frame time budget.
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (milliseconds) =>
      timeout(milliseconds === 5000 ? 60_000 : milliseconds);
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/studio-environment.bin.gz*", async (route) => {
    if (route.request().resourceType() !== "fetch") {
      await route.continue();
      return;
    }
    requested = true;
    await held;
    await route.continue();
  });
  await fixture(page);
  const { host, canvas } = await mount(page, "floor", assets[0]);
  try {
    await expect.poll(() => requested).toBe(true);
    await expect(canvas).toHaveAttribute("data-floor-first-frame-ms", /\d+/);
    await expect(canvas).toHaveAttribute(
      "data-graphics-environment",
      "direct-light-preview",
    );
    await expect(host.getByRole("status")).toContainText("1 items on floor");
    await pickItem(page, canvas, host);
    const firstFrameMs = Number(
      await canvas.getAttribute("data-floor-first-frame-ms"),
    );
    expect(Number.isFinite(firstFrameMs)).toBe(true);
    await host.screenshot({
      path: testInfo.outputPath("selectable-lighting-preview.png"),
    });
    release();
    await expect(canvas).toHaveAttribute(
      "data-graphics-environment",
      "baked-hdr-studio",
      { timeout: 30000 },
    );
    await expect(canvas).toHaveAttribute(
      "data-floor-nvidia-models",
      JSON.stringify([assets[0].slug]),
      { timeout: 30000 },
    );
    await expect(host.getByTestId("selected")).toHaveText("asset:1");
    await expect(canvas).toHaveAttribute(
      "data-floor-first-frame-ms",
      String(firstFrameMs),
    );
    await host.screenshot({
      path: testInfo.outputPath("detailed-studio-lighting.png"),
    });
    await testInfo.attach("progressive-floor-timing.json", {
      contentType: "application/json",
      body: JSON.stringify({
        fixture: "single conveyor, controlled delayed studio atlas",
        renderer: await canvas.getAttribute("data-graphics-quality"),
        firstFrameMs,
        environmentReadyMs: Number(
          await canvas.getAttribute("data-floor-environment-ready-ms"),
        ),
      }),
    });
  } finally {
    release();
  }
});

for (const width of [390, 1440]) {
  test(`reviewed NVIDIA floor models attach and remain selectable at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    const requests: string[] = [];
    page.on("response", (response) => {
      if (response.ok() && response.url().includes("/models/nvidia/"))
        requests.push(new URL(response.url()).pathname);
    });
    await fixture(page);
    for (const asset of assets) {
      const { host, canvas } = await mount(page, "floor", asset);
      await expect(canvas).toHaveAttribute(
        "data-floor-nvidia-models",
        JSON.stringify([asset.slug]),
        { timeout: 30000 },
      );
      await expect(canvas).toHaveAttribute(
        "data-floor-reference-failures",
        "0",
      );
      await expect(host.getByRole("status")).toContainText(
        "1 detailed models ready",
      );
      expect(
        requests.some((url) =>
          url.includes(`/models/nvidia/${asset.slug}/compact.`),
        ),
      ).toBe(true);
      await pickItem(page, canvas, host);
      await host.screenshot({
        path: testInfo.outputPath(`${asset.slug}-${width}.png`),
      });
      await page.evaluate(() => window.floorNvidiaHarness.unmount("floor"));
      await expect(host).toHaveCount(0);
    }
  });
}

test("failed model delivery retains a selectable proxy and reports the simplified view", async ({
  page,
}) => {
  await page.route(
    "**/models/nvidia/nvidia-mobile-cart/compact.*.glb",
    (route) => route.abort(),
  );
  await fixture(page);
  const { host, canvas } = await mount(page, "floor", assets[2]);
  await expect(canvas).toHaveAttribute("data-floor-reference-failures", "1", {
    timeout: 30000,
  });
  await expect(canvas).toHaveAttribute("data-floor-nvidia-models", "[]");
  await expect(host.getByRole("status")).toContainText("1 simplified");
  await pickItem(page, canvas, host);
});

test("connection failure during a grab releases the viewer and shows the floor plan", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(
    "**/models/nvidia/nvidia-storage-rack/compact.*.glb",
    async (route) => {
      requested = true;
      await held;
      await route.continue();
    },
  );
  await fixture(page);
  await page.evaluate(
    ({ first, second }) =>
      window.floorNvidiaHarness.mount(
        "floor",
        first.name,
        first.type,
        2,
        true,
        second,
      ),
    { first: assets[0], second: assets[1] },
  );
  const host = page.locator("#floor");
  const canvas = host.getByRole("img", {
    name: "Interactive 3D factory floor",
  });
  await expect(host.getByRole("status")).toContainText(
    "1 detailed models ready",
    { timeout: 30000 },
  );
  await expect.poll(() => requested).toBe(true);
  const point = await itemPoint(page, canvas);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 20, point.y + 12);
  await expect(host.getByTestId("dragged")).toHaveText("asset:1");
  await canvas.evaluate((node) => {
    (
      window as typeof window & { testContext: WebGL2RenderingContext | null }
    ).testContext = (node as HTMLCanvasElement).getContext("webgl2");
  });
  await page.evaluate(() => window.floorNvidiaHarness.failConnections());
  release();
  await expect(host.getByRole("status")).toContainText(
    "3D unavailable on this device",
    { timeout: 30000 },
  );
  await expect(
    host
      .getByRole("img", { name: "Accessible factory floor plan" })
      .getByRole("button"),
  ).toHaveCount(2);
  await expect(host.getByTestId("dragged")).toHaveText("none");
  await page.waitForFunction(
    () =>
      (
        window as typeof window & { testContext: WebGL2RenderingContext | null }
      ).testContext?.isContextLost(),
    null,
    { timeout: 30000 },
  );
  await page.mouse.up();
  await expect(host.getByTestId("moves")).toHaveText("0");
});

test("two instances of one NVIDIA model render and remain independently selectable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await fixture(page);
  await page.evaluate(
    (asset) =>
      window.floorNvidiaHarness.mount("floor", asset.name, asset.type, 2),
    assets[0],
  );
  const host = page.locator("#floor");
  const canvas = host.getByRole("img", {
    name: "Interactive 3D factory floor",
    exact: true,
  });
  await expect(host.getByRole("status")).toContainText(
    "2 detailed models ready",
    {
      timeout: 30000,
    },
  );
  await expect(canvas).toHaveAttribute(
    "data-floor-nvidia-models",
    JSON.stringify([assets[0].slug]),
  );
  await expect(canvas).toHaveAttribute("data-floor-reference-failures", "0");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Factory floor canvas missing");
  const points = new Map<string, { x: number; y: number }>();
  for (let dy = -100; dy <= 100 && points.size < 2; dy += 12) {
    for (let dx = -220; dx <= 220 && points.size < 2; dx += 12) {
      const point = {
        x: box.x + box.width / 2 + dx,
        y: box.y + box.height / 2 + dy,
      };
      await page.mouse.move(point.x, point.y);
      const target = await canvas.getAttribute("data-grab-target");
      if (target === "asset:1" || target === "asset:2")
        points.set(target, point);
    }
  }
  expect([...points.keys()].sort()).toEqual(["asset:1", "asset:2"]);
  for (const id of ["asset:1", "asset:2"]) {
    const point = points.get(id)!;
    await page.mouse.click(point.x, point.y);
    await expect(host.getByTestId("selected")).toHaveText(id);
  }
  await host.screenshot({
    path: testInfo.outputPath("repeated-conveyors.png"),
  });
});

test("theme changes preserve the viewer, selection and eye-level camera", async ({
  page,
}, testInfo) => {
  await fixture(page);
  const { host, canvas } = await mount(page, "floor", assets[0]);
  await expect(host.getByRole("status")).toContainText(
    "1 detailed models ready",
    {
      timeout: 30000,
    },
  );
  await pickItem(page, canvas, host);
  await host
    .getByRole("button", { name: "Explore factory at eye level" })
    .click();
  await expect(canvas).toHaveAttribute("data-view-mode", "explore");
  const original = await canvas.elementHandle();
  if (!original) throw new Error("Factory floor canvas missing");
  const view = await canvas.getAttribute("data-camera-view");
  await canvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement & {
      testContext?: WebGL2RenderingContext | null;
    };
    canvas.testContext = canvas.getContext("webgl2");
  });
  const light = await canvas.screenshot({
    path: testInfo.outputPath("explore-light.png"),
  });
  let modelRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/models/nvidia/")) modelRequests++;
  });
  await page.evaluate(() => window.floorNvidiaHarness.setTheme("floor", true));
  await expect(canvas).toHaveAttribute("data-factory-theme", "dark");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const dark = await canvas.screenshot({
    path: testInfo.outputPath("explore-dark.png"),
  });
  expect(light.equals(dark)).toBe(false);
  expect(await canvas.evaluate((node, prior) => node === prior, original)).toBe(
    true,
  );
  expect(
    await canvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement & {
        testContext?: WebGL2RenderingContext | null;
      };
      return (
        !!canvas.testContext &&
        canvas.testContext === canvas.getContext("webgl2") &&
        !canvas.testContext.isContextLost()
      );
    }),
  ).toBe(true);
  await expect(canvas).toHaveAttribute("data-view-mode", "explore");
  await expect(canvas).toHaveAttribute("data-camera-view", view!);
  await expect(host.getByTestId("selected")).toHaveText("asset:1");
  expect(modelRequests).toBe(0);
  await page.evaluate(() => window.floorNvidiaHarness.setTheme("floor", false));
  await expect(canvas).toHaveAttribute("data-factory-theme", "light");
  await expect(canvas).toHaveAttribute("data-view-mode", "explore");
});

test("the latest theme is used when the viewer has not mounted yet", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const original = window.requestAnimationFrame;
    const pending: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => {
      pending.push(callback);
      return pending.length;
    };
    (window as typeof window & { resumeFrames: () => void }).resumeFrames =
      () => {
        window.requestAnimationFrame = original;
        for (const callback of pending) original(callback);
      };
    window.floorNvidiaHarness.mount("floor", "Transfer conveyor", "conveyor");
  });
  await page.waitForFunction(() =>
    window.floorNvidiaHarness.themeReady("floor"),
  );
  await page.evaluate(() => window.floorNvidiaHarness.setTheme("floor", true));
  // Wait for React to commit the updated prop while animation frames are held.
  await expect(page.locator("#floor").getByTestId("theme")).toHaveText("dark");
  await page.evaluate(() =>
    (window as typeof window & { resumeFrames: () => void }).resumeFrames(),
  );
  const host = page.locator("#floor");
  const canvas = host.getByRole("img", {
    name: "Interactive 3D factory floor",
  });
  await expect(canvas).toHaveAttribute("data-factory-theme", "dark");
  await expect(host.getByRole("status")).toContainText(
    "1 detailed models ready",
    {
      timeout: 30000,
    },
  );
});

test("a theme change cancels an active equipment grab", async ({ page }) => {
  await fixture(page);
  await page.evaluate(
    (asset) =>
      window.floorNvidiaHarness.mount("floor", asset.name, asset.type, 1, true),
    assets[0],
  );
  const host = page.locator("#floor");
  const canvas = host.getByRole("img", {
    name: "Interactive 3D factory floor",
  });
  await expect(host.getByRole("status")).toContainText(
    "1 detailed models ready",
    {
      timeout: 30000,
    },
  );
  const point = await itemPoint(page, canvas);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 20, point.y + 12);
  await expect(host.getByTestId("dragged")).toHaveText("asset:1");
  await page.evaluate(() => window.floorNvidiaHarness.setTheme("floor", true));
  await expect(canvas).toHaveAttribute("data-factory-theme", "dark");
  await expect(host.getByTestId("dragged")).toHaveText("none");
  await expect(canvas).toHaveAttribute("data-grab-state", "idle");
  await page.mouse.up();
  await expect(host.getByTestId("moves")).toHaveText("0");
});

test("a theme change releases an active floor pan", async ({ page }) => {
  await fixture(page);
  const { canvas } = await mount(page, "floor", assets[0]);
  await canvas.evaluate((node) => {
    node.addEventListener("pointerdown", (event) => {
      (node as HTMLElement).dataset.testPointer = String(event.pointerId);
    });
  });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Factory floor canvas missing");
  await page.mouse.move(box.x + 15, box.y + 15);
  await expect(canvas).toHaveAttribute("data-grab-target", "floor");
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + 30);
  await expect(canvas).toHaveAttribute("data-grab-state", "floor");
  await expect
    .poll(() =>
      canvas.evaluate((node) =>
        node.hasPointerCapture(
          Number((node as HTMLElement).dataset.testPointer),
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => window.floorNvidiaHarness.setTheme("floor", true));
  await expect(canvas).toHaveAttribute("data-factory-theme", "dark");
  await expect(canvas).toHaveAttribute("data-grab-state", "idle");
  expect(
    await canvas.evaluate((node) =>
      node.hasPointerCapture(Number((node as HTMLElement).dataset.testPointer)),
    ),
  ).toBe(false);
  await page.mouse.up();
});

test("a theme change releases touch gestures", async ({ page }) => {
  await fixture(page);
  const { canvas } = await mount(page, "floor", assets[0]);
  await canvas.evaluate((node) => {
    const ids: number[] = [];
    node.addEventListener("pointerdown", (event) => {
      ids.push(event.pointerId);
      (node as HTMLElement).dataset.testPointers = JSON.stringify(ids);
    });
  });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Factory floor canvas missing");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const first = { x: box.x + 30, y: box.y + 30, id: 1 };
  const second = { x: box.x + 90, y: box.y + 30, id: 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [first],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [first, second],
  });
  await expect
    .poll(() =>
      canvas.evaluate(
        (node) =>
          JSON.parse((node as HTMLElement).dataset.testPointers ?? "[]").length,
      ),
    )
    .toBe(2);
  await expect
    .poll(() =>
      canvas.evaluate((node) =>
        JSON.parse((node as HTMLElement).dataset.testPointers ?? "[]").some(
          (id: number) => node.hasPointerCapture(id),
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => window.floorNvidiaHarness.setTheme("floor", true));
  await expect(canvas).toHaveAttribute("data-factory-theme", "dark");
  expect(
    await canvas.evaluate((node) =>
      JSON.parse((node as HTMLElement).dataset.testPointers ?? "[]").every(
        (id: number) => !node.hasPointerCapture(id),
      ),
    ),
  ).toBe(true);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
});

test("a second viewer keeps its NVIDIA model after the first is unmounted", async ({
  page,
}) => {
  await fixture(page);
  const first = await mount(page, "first", assets[0]);
  const second = await mount(page, "second", assets[0]);
  await expect(first.canvas).toHaveAttribute(
    "data-floor-nvidia-models",
    JSON.stringify([assets[0].slug]),
    { timeout: 30000 },
  );
  await expect(second.canvas).toHaveAttribute(
    "data-floor-nvidia-models",
    JSON.stringify([assets[0].slug]),
    { timeout: 30000 },
  );
  await page.evaluate(() => window.floorNvidiaHarness.unmount("first"));
  await expect(first.host).toHaveCount(0);
  expect(
    await second.canvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const gl = canvas.getContext("webgl2");
      return !!gl && !gl.isContextLost();
    }),
  ).toBe(true);
  await pickItem(page, second.canvas, second.host);
});

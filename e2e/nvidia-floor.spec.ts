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

async function pickItem(page: Page, canvas: Locator, host: Locator) {
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
  await page.mouse.click(point!.x, point!.y);
  await expect(host.getByTestId("selected")).toHaveText("asset:1");
}

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

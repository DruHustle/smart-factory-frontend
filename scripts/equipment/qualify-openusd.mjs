/** Actual browser rendering and negative delivery tests; no production accounts/data. */
import { chromium, firefox, webkit, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./render-fixture.mjs";
const { assets } = JSON.parse(
  await readFile("shared/industrial-assets.catalog.json", "utf8"),
);
const directory = process.env.OPENUSD_EVIDENCE_DIR || "test-results/openusd";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const results = [];
async function tools(page) {
  for (const text of [
    "Framing and visibility",
    "Explode, section and inspection tools",
  ]) {
    const summary = page
      .locator("summary")
      .filter({ hasText: new RegExp("^" + text + "$") });
    if (
      (await summary.isVisible()) &&
      !(await summary.evaluate((el) => el.parentElement.open))
    )
      await summary.click();
  }
}
async function noOverflow(page) {
  assert.ok(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth <=
        1,
    ),
    "No mobile horizontal overflow",
  );
}
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [],
      requests = [],
      writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (r) => {
      requests.push(r.url());
      if (r.method() !== "GET") writes.push(r.url());
    });
    await page.goto(
      `http://127.0.0.1:3139/__equipment-render/?gallery&theme=${width === 390 ? "dark" : "light"}`,
    );
    await expect(
      page.getByRole("heading", { name: "Factory models", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add to local models", exact: true }),
    ).toHaveCount(0);
    for (const asset of assets) {
      await page
        .getByLabel("Factory reference models", { exact: true })
        .getByRole("button", { name: asset.name, exact: true })
        .click();
      for (const quality of ["compact", "detail"]) {
        await page
          .getByLabel("Rendering quality", { exact: true })
          .selectOption(quality);
        const host = page.locator("[data-state=ready]");
        await expect(host).toHaveAttribute(
          "data-model-bytes",
          String(asset.models[quality].bytes),
          { timeout: 45000 },
        );
        await expect(
          page.getByRole("img", { name: "Interactive 3D equipment model" }),
        ).toHaveCount(1);
        await expect(page.locator("canvas")).toHaveCount(1);
        await expect(
          page.getByLabel("Asset provenance and license"),
        ).toContainText(asset.attribution);
        const link = page.getByRole("link", { name: "Pinned NVIDIA source" });
        await expect(link).toHaveAttribute("href", asset.sourceUrl);
        const components = page
          .getByLabel("Reference components", { exact: true })
          .getByRole("button");
        await expect(components).toHaveCount(
          asset.models[quality].manifest.components.length,
        );
        await components.first().click();
        await expect(components.first()).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await tools(page);
        await expect(
          page.getByRole("button", { name: "Focus selected", exact: true }),
        ).toBeEnabled();
        await page
          .getByRole("button", { name: "Isolate selected", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Isolate selected", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await page
          .getByRole("button", { name: "Show all", exact: true })
          .click();
        await page
          .getByLabel("Explosion percentage", { exact: true })
          .fill("45");
        await page
          .getByLabel("Section axis", { exact: true })
          .selectOption("X");
        await expect(
          page.getByLabel("Section axis", { exact: true }),
        ).toHaveValue("X");
        await expect(
          page.getByText(
            "Visual section only. Solid section caps unavailable for this model.",
          ),
        ).toBeVisible();
        await page.waitForFunction(() => {
          const diagnostics = JSON.parse(
            document
              .querySelector("[data-inspection]")
              ?.getAttribute("data-inspection") || "{}",
          );
          return diagnostics.section === "X" && diagnostics.caps === 0;
        });
        await page
          .getByRole("button", { name: "Restore assembly", exact: true })
          .click();
        await noOverflow(page);
        const name = `${asset.slug}-${quality}-${width}`;
        await host.screenshot({ path: `${directory}/${name}-viewport.png` });
        if (quality === "compact")
          await page.screenshot({
            path: `${directory}/${name}.png`,
            fullPage: true,
          });
        const timing = JSON.parse(await host.getAttribute("data-load-timings"));
        assert.ok(timing.firstFrame >= timing.graphicsCompiled);
        results.push({
          name,
          bytes: asset.models[quality].bytes,
          triangles: asset.models[quality].triangles,
          timing,
        });
      }
    }
    await page.getByLabel("Model provider").selectOption("NVIDIA");
    await page.getByLabel("Search factory models").fill("rack");
    await expect(
      page
        .getByLabel("Factory reference models", { exact: true })
        .getByRole("button"),
    ).toHaveCount(1);
    await page.getByLabel("Search factory models").fill("nonexistent-model");
    await expect(
      page.getByText(
        "No models match these filters. The current inspection remains open.",
      ),
    ).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(1);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      writes,
      [],
      "Reference browsing must not write operational records",
    );
    assert.ok(
      requests.every((r) => new URL(r).origin === "http://127.0.0.1:3139"),
    );
    await context.close();
  }
  for (const mode of ["corruption", "missing", "webgl-disabled"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    if (mode === "webgl-disabled")
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return String(type).includes("webgl")
            ? null
            : original.call(this, type, ...args);
        };
      });
    else
      await page.route("**/models/nvidia/**/*.glb", async (route) => {
        if (mode === "missing")
          return route.fulfill({ status: 404, body: "Missing" });
        const response = await route.fetch();
        const body = await response.body();
        body[body.length - 1] ^= 1;
        return route.fulfill({ response, body });
      });
    await page.goto("http://127.0.0.1:3139/__equipment-render/?gallery");
    await expect(
      page.locator(
        `[data-state=${mode === "webgl-disabled" ? "unsupported" : "error"}]`,
      ),
    ).toBeVisible({ timeout: 30000 });
    const host = page.locator(
      `[data-state=${mode === "webgl-disabled" ? "unsupported" : "error"}]`,
    );
    await expect(
      host.locator(`img[src="${assets[0].previewUrl}"]`).first(),
    ).toBeVisible();
    await expect(
      page
        .getByLabel("Reference components", { exact: true })
        .getByRole("button")
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "CC BY 4.0 license" }),
    ).toBeVisible();
    if (mode === "corruption")
      await expect(
        page.getByText(/Model integrity check failed/),
      ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${directory}/${mode}.png`, fullPage: true });
    results.push({ name: mode, safeFallback: true });
    await context.close();
  }
  for (const [name, engine] of [
    ["firefox", firefox],
    ["webkit", webkit],
  ]) {
    const other = await engine.launch();
    try {
      const page = await other.newPage({
        viewport: { width: 1024, height: 900 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("http://127.0.0.1:3139/__equipment-render/?gallery");
      const host = page.locator("[data-state=ready], [data-state=unsupported]");
      await host.waitFor({ timeout: 45000 });
      const state = await host.getAttribute("data-state");
      if (state === "unsupported")
        await expect(
          host.locator(`img[src="${assets[0].previewUrl}"]`).first(),
        ).toBeVisible();
      await expect(
        page
          .getByLabel("Reference components", { exact: true })
          .getByRole("button")
          .first(),
      ).toBeVisible();
      await noOverflow(page);
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: `${directory}/${name}.png`,
        fullPage: true,
      });
      results.push({ name, state });
    } finally {
      await other.close();
    }
  }
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  const page = browser.contexts().at(-1)?.pages().at(-1);
  if (page) {
    await page
      .screenshot({ path: `${directory}/failure.png`, fullPage: true })
      .catch(() => {});
    await writeFile(`${directory}/failure.html`, await page.content()).catch(
      () => {},
    );
  }
  await writeFile(`${directory}/failure.txt`, String(error.stack || error));
  throw error;
} finally {
  await writeFile(
    `${directory}/results.json`,
    JSON.stringify(results, null, 2) + "\n",
  );
  await browser.close();
  await server.close();
}

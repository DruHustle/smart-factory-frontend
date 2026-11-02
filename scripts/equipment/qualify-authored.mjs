/** Real isolated browser qualification for original Blender references. */
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { server } from "./render-fixture.mjs";

const { assets } = JSON.parse(
  await readFile("shared/authored-assets.catalog.json", "utf8"),
);
const directory = process.env.AUTHORED_EVIDENCE_DIR || "test-results/authored";
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
    page.on("request", (request) => {
      requests.push(request.url());
      if (request.method() !== "GET") writes.push(request.url());
    });
    await page.goto(
      `http://127.0.0.1:3139/__equipment-render/?gallery&theme=${width === 390 ? "dark" : "light"}`,
    );
    await page.getByLabel("Model provider").selectOption("Smart Factory");
    for (const asset of assets) {
      await page
        .getByLabel("Factory reference models", { exact: true })
        .getByRole("button", { name: asset.name, exact: true })
        .click();
      await expect(
        page.getByLabel("Asset provenance and license"),
      ).toContainText(asset.attribution);
      await expect(
        page.getByRole("link", { name: "MIT license", exact: true }),
      ).toHaveAttribute("href", asset.licenseUrl);
      await expect(
        page.getByRole("link", { name: "Pinned NVIDIA source", exact: true }),
      ).toHaveCount(0);
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
        await expect(page.locator("canvas")).toHaveCount(1);
        const parts = page
          .getByLabel("Reference components", { exact: true })
          .getByRole("button");
        await expect(parts).toHaveCount(
          asset.models[quality].manifest.components.length,
        );
        await parts.first().click();
        await expect(parts.first()).toHaveAttribute("aria-pressed", "true");
        for (const name of [
          "Framing and visibility",
          "Explode, section and inspection tools",
        ]) {
          const summary = page
            .locator("summary")
            .filter({ hasText: new RegExp("^" + name + "$") });
          if (
            (await summary.isVisible()) &&
            !(await summary.evaluate((el) => el.parentElement.open))
          )
            await summary.click();
        }
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
        await page.waitForFunction(
          () =>
            JSON.parse(
              document
                .querySelector("[data-inspection]")
                ?.getAttribute("data-inspection") || "{}",
            ).explode === 0.45,
        );
        await page
          .getByLabel("Section axis", { exact: true })
          .selectOption("X");
        await expect(
          page.getByText(
            "Visual section only. Solid section caps unavailable for this model.",
          ),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Restore assembly", exact: true })
          .click();
        await page.waitForFunction(() => {
          const d = JSON.parse(
            document
              .querySelector("[data-inspection]")
              ?.getAttribute("data-inspection") || "{}",
          );
          return (
            d.section === "off" &&
            d.caps === 0 &&
            Math.abs(d.explode) < 0.000001 &&
            d.restorationError < 0.000001
          );
        });
        await page
          .getByRole("button", { name: "Clear selection", exact: true })
          .click();
        assert.ok(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth + 1,
          ),
          "No horizontal overflow",
        );
        const name = `${asset.slug}-${quality}-${width}`;
        await host.screenshot({ path: `${directory}/${name}-viewport.png` });
        if (quality === "compact")
          await page.screenshot({
            path: `${directory}/${name}.png`,
            fullPage: true,
          });
        results.push({
          name,
          bytes: asset.models[quality].bytes,
          triangles: asset.models[quality].triangles,
          timing: JSON.parse(await host.getAttribute("data-load-timings")),
          restoredAssembly: true,
          selectionVerified: true,
        });
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(
      writes,
      [],
      "Browsing references never writes operational data",
    );
    assert.ok(
      requests.every((url) => new URL(url).origin === "http://127.0.0.1:3139"),
      "No external asset requests",
    );
    await context.close();
  }
  for (const mode of ["missing", "corruption"]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.route("**/models/authored/**/*.glb", async (route) => {
      if (mode === "missing")
        return route.fulfill({ status: 404, body: "Missing" });
      const response = await route.fetch(),
        body = await response.body();
      body[body.length - 1] ^= 1;
      return route.fulfill({ response, body });
    });
    await page.goto("http://127.0.0.1:3139/__equipment-render/?gallery");
    await page
      .getByLabel("Factory reference models", { exact: true })
      .getByRole("button", { name: assets[0].name, exact: true })
      .click();
    const host = page.locator("[data-state=error]");
    await expect(host).toBeVisible({ timeout: 30000 });
    await expect(
      host.locator(`img[src="${assets[0].previewUrl}"]`).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "MIT license", exact: true }),
    ).toBeVisible();
    if (mode === "corruption")
      await expect(
        page.getByText(/Model integrity check failed/),
      ).toBeVisible();
    await page.screenshot({ path: `${directory}/${mode}.png`, fullPage: true });
    results.push({ name: mode, safeFallback: true });
    await page.close();
  }
} catch (error) {
  const page = browser.contexts().at(-1)?.pages().at(-1);
  if (page)
    await page
      .screenshot({ path: `${directory}/failure.png`, fullPage: true })
      .catch(() => {});
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
console.log(JSON.stringify({ passed: results.length, results }, null, 2));

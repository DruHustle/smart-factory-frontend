import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { server, fixtureDirectory } from "./render-fixture.mjs";

const directory = process.env.RENDER_EVIDENCE_DIR || "test-results/rendering";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const results = [];
try {
  for (const model of [
    "pump",
    "pi",
    "conveyor",
    "robot-arm",
    "control-cabinet",
    "valve",
    "storage-tank",
  ])
    for (const width of [1440, 390])
      for (const theme of ["light", "dark"]) {
        const name = `${model}-${width}-${theme}`;
        if (
          process.env.RENDER_CASES &&
          !process.env.RENDER_CASES.split(",").includes(name)
        )
          continue;
        const context = await browser.newContext({
          viewport: { width, height: 1000 },
        });
        const page = await context.newPage();
        const errors = [],
          requests = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => requests.push(request.url()));
        await page.goto(
          `http://127.0.0.1:3139/__equipment-render/?model=${model}&theme=${theme}`,
        );
        const host = page.locator("[data-state=ready]");
        await host.waitFor({ timeout: 30000 });
        const timing = JSON.parse(await host.getAttribute("data-load-timings"));
        assert.equal(
          await host.getAttribute("data-model-bytes"),
          String(
            statSync(
              fixtureDirectory(model) +
                (model === "pump" ? "pump-motor.glb" : "model.glb"),
            ).size,
          ),
        );
        assert.ok(timing.firstFrame >= timing.graphicsCompiled);
        assert.equal(
          await host.getAttribute("data-environment"),
          "baked-hdr-studio",
        );
        assert.ok(
          requests.every(
            (url) => new URL(url).origin === "http://127.0.0.1:3139",
          ),
        );
        assert.equal(errors.length, 0, errors.join("\n"));
        await page.screenshot({
          path: `${directory}/${name}.png`,
          fullPage: true,
        });
        await host.screenshot({ path: `${directory}/${name}-viewport.png` });
        await page
          .locator("summary")
          .filter({ hasText: "Explode, section and inspection tools" })
          .click();
        const explode = page.getByLabel("Explosion percentage", {
          exact: true,
        });
        await explode.press("End");
        await page.waitForFunction(
          () =>
            JSON.parse(
              document
                .querySelector("[data-inspection]")
                ?.getAttribute("data-inspection") || "{}",
            ).explode === 1,
          {},
          { timeout: 8000 },
        );
        for (let count = 0; count < 40; count++)
          await explode.press("ArrowLeft");
        await page.waitForFunction(
          () =>
            JSON.parse(
              document
                .querySelector("[data-inspection]")
                ?.getAttribute("data-inspection") || "{}",
            ).explode === 0.6,
          {},
          { timeout: 8000 },
        );
        await page.getByLabel("Ghost housings", { exact: true }).check();
        await page.waitForFunction(
          () =>
            JSON.parse(
              document
                .querySelector("[data-inspection]")
                ?.getAttribute("data-inspection") || "{}",
            ).ghost === true,
        );
        await page.screenshot({
          path: `${directory}/${name}-exploded.png`,
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Restore assembly", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            JSON.parse(
              document
                .querySelector("[data-inspection]")
                ?.getAttribute("data-inspection") || "{}",
            ).restorationError === 0,
        );
        await page
          .getByLabel("Section axis", { exact: true })
          .selectOption("X");
        await page.waitForFunction(
          () =>
            JSON.parse(
              document
                .querySelector("[data-inspection]")
                ?.getAttribute("data-inspection") || "{}",
            ).caps > 0,
        );
        await page
          .getByRole("button", { name: "Reset section", exact: true })
          .click();
        results.push({
          name,
          timing,
          modelBytes: await host.getAttribute("data-model-bytes"),
          graphics: await host.getAttribute("data-graphics"),
          requests,
          errors,
        });
        await writeFile(
          `${directory}/measurements.json`,
          JSON.stringify(results, null, 2),
        );
        console.log(JSON.stringify({ name, timing }));
        await context.close();
      }
  // A useful, accurately labelled first image must not depend on GLB delivery.
  if (!process.env.RENDER_SKIP_GALLERY)
    for (const [width, theme] of [
      [1440, "light"],
      [390, "dark"],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      const page = await context.newPage();
      await page.goto(
        `http://127.0.0.1:3139/__equipment-render/?gallery=1&theme=${theme}`,
      );
      await page
        .getByRole("heading", { name: "Factory models", exact: true })
        .waitFor();
      for (const [slug, label] of [
        ["conveyor", "Belt conveyor"],
        ["robot-arm", "Six-axis industrial robot"],
        ["control-cabinet", "Industrial control cabinet"],
        ["valve", "Flanged ball valve"],
        ["storage-tank", "Stainless process tank"],
      ]) {
        await page
          .getByLabel("Factory reference models", { exact: true })
          .getByRole("button", { name: label, exact: true })
          .click();
        const host = page.locator("[data-state=ready]");
        await host.waitFor({ timeout: 30000 });
        assert.equal(
          await host.getAttribute("data-model-bytes"),
          String(statSync(fixtureDirectory(slug) + "model.glb").size),
        );
        assert.equal(await page.locator("canvas").count(), 1);
      }
      await page
        .getByLabel("Search reference components")
        .fill("Agitator shaft");
      const part = page.getByRole("button", {
        name: "Agitator shaft",
        exact: true,
      });
      await part.click();
      assert.equal(await part.getAttribute("aria-pressed"), "true");
      await page.locator("[data-state=ready]").scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () =>
          JSON.parse(
            document
              .querySelector("[data-render-status]")
              ?.getAttribute("data-render-status") || "{}",
          ).phase === "drawn",
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page
        .locator("[data-state=ready]")
        .screenshot({
          path: `${directory}/gallery-canvas-${width}-${theme}.png`,
        });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: `${directory}/gallery-${width}-${theme}.png`,
        fullPage: true,
      });
      await context.close();
      console.log(
        `Gallery model switching, component selection and one active canvas pass at ${width}px ${theme}.`,
      );
    }
  // A useful, accurately labelled first image must not depend on GLB delivery.
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/api/equipment/fixture/model?**", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("http://127.0.0.1:3139/__equipment-render/?model=pump");
    try {
      await page
        .getByText("Model preview · Downloading 3D model", { exact: true })
        .waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-state=loading] img")?.naturalWidth > 0,
      );
      assert.equal(await page.locator("[data-state=ready]").count(), 0);
      await page.screenshot({ path: `${directory}/preview-before-model.png` });
    } finally {
      release();
    }
    await page.locator("[data-state=ready]").waitFor({ timeout: 30000 });
    await context.close();
    console.log("Preview is visible while model delivery is held.");
  }
  // Asset or decompressor failures retain inspection with direct lights.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route(
      (url) =>
        url.pathname.endsWith("/studio-environment.bin.gz") &&
        !url.searchParams.has("import") &&
        !url.searchParams.has("url"),
      (route) => route.abort(),
    );
    await page.goto("http://127.0.0.1:3139/__equipment-render/?model=pi");
    const host = page.locator("[data-state=ready]");
    await host.waitFor({ timeout: 30000 });
    assert.equal(
      await host.getAttribute("data-environment"),
      "direct-light-fallback",
    );
    await context.close();
    console.log("Missing studio asset retains a working 3D fallback.");
  }
} finally {
  await browser.close();
  await server.close();
}

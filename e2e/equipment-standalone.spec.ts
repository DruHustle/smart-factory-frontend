import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
async function submitEquipment(page: Page, name: string) {
  const pending = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname.includes("/equipment.create"),
    { timeout: 30000 },
  );
  await page
    .getByRole("button", { name: "Create equipment", exact: true })
    .click();
  const response = await pending,
    body = await response.json(),
    item = Array.isArray(body) ? body[0] : body;
  expect(
    item.error?.json?.message ?? item.error?.message ?? null,
    "Equipment creation must receive an explicit successful response",
  ).toBeNull();
  expect(response.ok()).toBe(true);
  const id = (item.result?.data?.json ?? item.result?.data)?.id;
  expect(typeof id).toBe("string");
  await expect(page.locator("#local-equipment")).toHaveValue(id);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
test.describe("standalone native equipment monitoring", () => {
  test.skip(
    process.env.E2E_EQUIPMENT_STANDALONE !== "true",
    "Run against the separate standalone fixture server",
  );
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ])
    test(`local context, files, simulation and saved work at ${viewport.width}px without peer access`, async ({
      browser,
      baseURL,
    }, testInfo) => {
      const context = await browser.newContext({ viewport });
      const attempted: string[] = [];
      const blockedExternal: string[] = [];
      const peer: string[] = [];
      await context.route("**/*", (route) => {
        const url = route.request().url();
        attempted.push(url);
        const host = new URL(url).hostname;
        if (new URL(url).origin !== new URL(baseURL!).origin) {
          blockedExternal.push(url);
          if (/onesa/i.test(host) || ["127.0.0.1", "localhost"].includes(host))
            peer.push(url);
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on("websocket", (socket) => {
        const url = new URL(socket.url());
        for (const key of [...url.searchParams.keys()])
          if (/token|secret|auth|key/i.test(key))
            url.searchParams.set(key, "redacted");
        attempted.push(url.href);
        if (url.host !== new URL(baseURL!).host) peer.push(url.href);
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (e) => {
        if (
          e.type() === "error" &&
          /THREE.WebGLProgram|GL_INVALID|shader error/i.test(e.text())
        )
          errors.push(e.text());
      });
      await page.goto("/#/login");
      await page.getByLabel("Email").fill("local-equipment@example.test");
      await page
        .getByLabel("Password", { exact: true })
        .fill("Synthetic-fixture-only-2026!");
      await page.getByRole("button", { name: /^sign in$/i }).click();
      await expect(
        page.getByRole("heading", { name: "Factory Overview", exact: true }),
      ).toBeVisible();
      await page.goto("/#/equipment");
      await expect(
        page.getByRole("heading", { name: "Equipment view", exact: true }),
      ).toBeVisible();
      await page.getByText("Create local equipment", { exact: true }).click();
      await page
        .getByLabel("Equipment name", { exact: true })
        .fill(`Standalone pump ${viewport.width}`);
      await page
        .getByLabel("Serial number", { exact: true })
        .fill(`LOCAL-${viewport.width}-${Date.now()}`);
      await submitEquipment(page, `Standalone pump ${viewport.width}`);
      await expect(
        page.getByRole("heading", {
          name: `Standalone pump ${viewport.width}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("img", { name: "Interactive 3D equipment model" }),
      ).toBeVisible();
      await expect(page.locator("[data-state=ready]")).toBeVisible();
      if (viewport.width === 1440) {
        await page
          .getByRole("button", { name: "Assembly", exact: true })
          .click();
        const canvas = page.getByRole("img", {
            name: "Interactive 3D equipment model",
          }),
          box = await canvas.boundingBox();
        let picked = false;
        for (const y of [0.45, 0.55, 0.65]) {
          for (const x of [0.4, 0.5, 0.6]) {
            await canvas.click({
              position: { x: box!.width * x, y: box!.height * y },
            });
            if (
              (await page
                .getByRole("button", { name: "Assembly", exact: true })
                .getAttribute("aria-pressed")) === "false"
            ) {
              picked = true;
              break;
            }
          }
          if (picked) break;
        }
        expect(picked).toBe(true);
      }
      await page.getByRole("button", { name: "Pump", exact: true }).click();
      await page
        .getByRole("button", { name: "Focus selected", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Hide selected", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Show selected", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Isolate selected", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Isolate selected", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Show all", exact: true }).click();
      await page
        .getByRole("button", { name: "Transparency", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Transparency", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page
        .getByRole("button", { name: "Transparency", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Fit / reset", exact: true })
        .click();
      await page.getByRole("button", { name: "Alarm", exact: true }).click();
      await expect(page.getByText("7 bar", { exact: true })).toBeVisible();
      const doc = await page.request.get(
        (await page
          .getByRole("link", { name: "Open local maintenance document" })
          .getAttribute("href")) ?? "",
      );
      expect(doc.status()).toBe(200);
      expect(await doc.text()).toContain("Original synthetic reference");
      const model = await page.request.get(
        (await page
          .getByRole("link", { name: "Download local GLB" })
          .getAttribute("href")) ?? "",
      );
      expect(model.status()).toBe(200);
      expect((await model.body()).subarray(0, 4).toString()).toBe("glTF");
      await page
        .getByLabel("Note for Pump")
        .fill("Saved without a peer account or endpoint");
      await page
        .getByRole("button", { name: "Save local work", exact: true })
        .click();
      await expect(
        page.getByText("Local work saved.", { exact: true }),
      ).toBeVisible();
      await page.getByLabel("Viewpoint name").fill("Maintenance angle");
      await page
        .getByRole("button", { name: "Save viewpoint", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Open viewpoint: Maintenance angle" }),
      ).toBeVisible();
      const equipmentId = await page.locator("#local-equipment").inputValue();
      await page.reload();
      await page.locator("#local-equipment").selectOption(equipmentId);
      await expect(
        page.getByRole("button", { name: "Pump", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByText("Saved without a peer account or endpoint", {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByText("Classified local history", { exact: true }).click();
      await expect(
        page.getByText(/simulated · quality good/).first(),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Open viewpoint: Maintenance angle" })
        .click();
      await page
        .getByRole("button", { name: "Replay this observation time" })
        .first()
        .click();
      await expect(
        page.getByRole("button", { name: "Return to latest" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Return to latest" }).click();
      await page.getByRole("button", { name: "Switch to light theme" }).click();
      await page.screenshot({
        path: testInfo.outputPath(
          `local-equipment-light-${viewport.width}.png`,
        ),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Switch to dark theme" }).click();
      await page.emulateMedia({ colorScheme: "dark" });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`local-equipment-${viewport.width}.png`),
        fullPage: true,
      });
      if (viewport.width === 1440) {
        const lost = await page.locator("canvas").evaluate((c) => {
          const gl = (c as HTMLCanvasElement).getContext("webgl2");
          const extension = gl?.getExtension("WEBGL_lose_context");
          extension?.loseContext();
          return !!extension;
        });
        if (lost) {
          await expect(page.getByText(/Graphics context lost/)).toBeVisible();
          await page.getByRole("button", { name: "Retry graphics" }).click();
          await expect(page.locator("[data-state=ready]")).toBeVisible();
        }
      }
      expect(peer).toEqual([]);
      expect(errors).toEqual([]);
      await testInfo.attach("attempted-network-requests.json", {
        body: JSON.stringify(
          {
            renderer: "smart-factory-local-three-1",
            attempted,
            peer,
            blockedExternal,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      await context.close();
    });
});

test("public equipment demonstration is read-only and local files require authentication", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.E2E_EQUIPMENT_STANDALONE === "true",
    "Public demonstration uses the existing demo regression server",
  );
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Demo Viewer", exact: true }).click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Factory Overview", exact: true }),
  ).toBeVisible();
  await page.goto("/#/equipment");
  await expect(
    page.getByText("Read-only demonstration", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Create local equipment", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save local work", exact: true }),
  ).toHaveCount(0);
  const model = await page
    .getByRole("link", { name: "Download local GLB" })
    .getAttribute("href");
  expect((await page.request.get(model!)).status()).toBe(200);
  expect((await request.get(model!)).status()).toBe(401);
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
])
  test(`detailed reference inspection and measurement at ${viewport.width}px`, async ({
    browser,
  }, testInfo) => {
    test.skip(
      process.env.E2E_EQUIPMENT_STANDALONE !== "true",
      "Separate private standalone fixture",
    );
    test.setTimeout(240000);
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (e) => {
      if (
        e.type() === "error" &&
        /THREE.WebGLProgram|GL_INVALID|shader error/i.test(e.text())
      )
        errors.push(e.text());
    });
    await page.goto("/#/login");
    await page.getByLabel("Email").fill("local-equipment@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("Synthetic-fixture-only-2026!");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(
      page.getByRole("heading", { name: "Factory Overview", exact: true }),
    ).toBeVisible();
    await page.goto("/#/equipment");
    const baseline = process.env.EQUIPMENT_COMPARE_REVISION === "3";
    if (viewport.width === 1440 || baseline) {
      await page
        .getByText("Import local GLB and component manifest", { exact: true })
        .click();
      await page
        .getByLabel("GLB file", { exact: true })
        .setInputFiles(
          baseline
            ? "fixtures/equipment/revisions/3/model.glb"
            : "fixtures/equipment/pump-motor.glb",
        );
      await page
        .getByRole("button", {
          name: "Use local manifest example",
          exact: true,
        })
        .click();
      if (baseline) {
        const t = JSON.parse(
          await (
            await import("node:fs/promises")
          ).readFile("fixtures/equipment/revisions/3/template.json", "utf8"),
        );
        await page.getByLabel("Mapping manifest JSON").fill(
          JSON.stringify({
            schemaVersion: "smart-factory-model-1",
            name: "Revision 3 comparison",
            provenance: "Original archived Smart Factory reference 3",
            license: "MIT",
            units: "m",
            handedness: "right",
            upAxis: "+Y",
            components: t.components,
            bindings: t.bindings,
            maintenanceText: t.maintenanceText ?? null,
          }),
        );
      }
      await page
        .getByRole("button", {
          name: "Validate and import local model",
          exact: true,
        })
        .click();
      await expect(
        page.getByText(/Validated model stored locally: local-import:/),
      ).toBeVisible({ timeout: 30000 });
    }
    await page.getByText("Create local equipment", { exact: true }).click();
    await page
      .getByLabel("Equipment name", { exact: true })
      .fill("Detailed inspection " + viewport.width);
    await page
      .getByLabel("Serial number", { exact: true })
      .fill(`DETAIL-${viewport.width}-${Date.now()}`);
    if (viewport.width === 1440 || baseline)
      await page
        .getByRole("combobox", { name: "Local model/template", exact: true })
        .selectOption({ index: 1 });
    await submitEquipment(page, "Detailed inspection " + viewport.width);
    await expect(
      page.getByRole("heading", {
        name: "Detailed inspection " + viewport.width,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("[data-state=ready]")).toBeVisible();
    const stats: Record<string, unknown> = {
      configuration: {
        viewport,
        browser:
          "Playwright Chromium / ANGLE SwiftShader; software WebGL, no physical mobile claim",
      },
    };
    const select = async (name: string) => {
      await page.getByLabel("Search BOM").fill(name);
      await page.getByRole("button", { name, exact: true }).click();
    };
    const evidence = async (name: string) => {
      const output = page.getByLabel("Render measurement"),
        previous = await output.textContent();
      await page
        .getByRole("button", { name: "Measure render", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Measure render", exact: true }),
      ).toBeEnabled({ timeout: 60000 });
      await expect(output).not.toBeEmpty({ timeout: 60000 });
      await expect.poll(() => output.textContent()).not.toBe(previous);
      const result = JSON.parse((await output.textContent())!);
      expect(result.completed).toBe(true);
      expect(result.durationMs).toBe(2500);
      expect(result.frames).toBeGreaterThan(0);
      stats[name] = {
        ...JSON.parse((await output.textContent())!),
        viewpoint: JSON.parse(
          (await page
            .locator("[data-state=ready]")
            .getAttribute("data-viewpoint"))!,
        ),
        asset: JSON.parse(
          await (
            await import("node:fs/promises")
          ).readFile(
            baseline
              ? "fixtures/equipment/revisions/3/template.json"
              : "fixtures/equipment/geometry-audit.json",
            "utf8",
          ),
        ),
      };
      await page.evaluate(() =>
        document.querySelectorAll("details").forEach((d) => {
          d.open = false;
        }),
      );
      console.log(
        "workspace dimensions",
        await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        })),
      );
      await page.screenshot({
        path: testInfo.outputPath(`${name}-workspace-${viewport.width}.png`),
        fullPage: true,
      });
      await page.locator("[data-state=ready]").screenshot({
        path: testInfo.outputPath(`${name}-${viewport.width}.png`),
      });
    };
    await evidence("assembled");
    await page.getByRole("button", { name: "Explode", exact: true }).click();
    await page.waitForTimeout(600);
    await page
      .getByRole("button", { name: "Fit / reset", exact: true })
      .click();
    await evidence("fully-exploded");
    expect((stats["fully-exploded"] as any).explode).toBe(1);
    await select("Mechanical seal");
    await page
      .getByRole("button", { name: "Focus selected", exact: true })
      .click();
    await page
      .getByLabel("Explosion scope", { exact: true })
      .selectOption({ label: "Mechanical seal" });
    await page.waitForTimeout(600);
    await page
      .getByRole("button", { name: "Isolate selected", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Focus selected", exact: true })
      .click();
    await evidence("seal-subassembly");
    // Pick actual moved geometry, rather than relying only on BOM selection.
    const movedCanvas = page.getByRole("img", {
        name: "Interactive 3D equipment model",
      }),
      bounds = await movedCanvas.boundingBox();
    let movedPick = false;
    for (const y of [0.35, 0.45, 0.55, 0.65]) {
      for (const x of [0.3, 0.4, 0.5, 0.6, 0.7]) {
        await movedCanvas.click({
          position: { x: bounds!.width * x, y: bounds!.height * y },
        });
        if (
          (await page
            .getByRole("button", { name: "Mechanical seal", exact: true })
            .getAttribute("aria-pressed")) === "false"
        ) {
          movedPick = true;
          break;
        }
      }
      if (movedPick) break;
    }
    expect(
      movedPick,
      "Picking must follow the exploded, isolated seal geometry",
    ).toBe(true);
    await select("Mechanical seal");

    await page.getByRole("button", { name: "Reassemble", exact: true }).click();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Show all", exact: true }).click();
    await page
      .getByRole("button", { name: "Fit / reset", exact: true })
      .click();
    await page.getByLabel("Section axis", { exact: true }).selectOption("Z");
    await page
      .getByRole("button", { name: "Reverse section", exact: true })
      .click();
    await page.waitForTimeout(1000);
    await evidence("sectioned");
    expect((stats.sectioned as any).caps).toBeGreaterThan(10);
    await page
      .getByRole("button", { name: "Reset section", exact: true })
      .click();
    await page.getByLabel("Ghost housings", { exact: true }).check();
    await page.getByLabel("Hide covers", { exact: true }).check();
    await evidence("ghost-housings");
    await select("Winding phase 1");
    await page
      .getByRole("button", { name: "Isolate selected", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Focus selected", exact: true })
      .click();
    await evidence("internal-closeup");
    await page
      .getByRole("button", { name: "Transparency", exact: true })
      .click();
    await page.getByLabel("Viewpoint name").fill("Internal inspection");
    await page
      .getByRole("button", { name: "Save viewpoint", exact: true })
      .click();
    await expect(
      page.getByText("Local work saved.", { exact: true }),
    ).toBeVisible();
    const installedId = await page.locator("#local-equipment").inputValue();
    await page.reload();
    await expect(page.locator("#local-equipment")).toHaveValue(installedId);
    await expect(
      page.getByRole("heading", {
        name: "Detailed inspection " + viewport.width,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("[data-state=ready]")).toBeVisible();
    await page
      .getByRole("button", {
        name: "Open viewpoint: Internal inspection",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Ghost housings", { exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Transparency", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Restore assembly", exact: true })
      .click();
    await expect(
      page.getByLabel("Ghost housings", { exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByLabel("Hide covers", { exact: true }),
    ).not.toBeChecked();
    await page.waitForTimeout(600);
    await page
      .getByRole("button", { name: "Fit / reset", exact: true })
      .click();
    await evidence("restored");
    expect((stats.restored as any).covers).toBe(false);
    expect((stats.restored as any).isolated).toBe(false);
    expect((stats.restored as any).drawCalls).toBe(
      (stats.assembled as any).drawCalls,
    );
    expect((stats.restored as any).restorationError).toBeLessThan(1e-12);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    for (const [name, part] of [
      ["coupling-closeup", "Flexible coupling"],
      ["bearing-closeup", "Motor DE bearing"],
      ["pump-closeup", "Wet end"],
      ["motor-closeup", "Motor"],
    ]) {
      await page
        .getByRole("button", { name: "Restore assembly", exact: true })
        .click();
      await select(part);
      await page
        .getByRole("button", { name: "Isolate selected", exact: true })
        .click();
      await page
        .getByLabel("Explosion scope", { exact: true })
        .selectOption({ label: part });
      await page.getByLabel("Explosion percentage", { exact: true }).fill("70");
      await page.waitForTimeout(700);
      await page
        .getByRole("button", { name: "Focus selected", exact: true })
        .click();
      await evidence(name);
    }
    await page
      .getByRole("button", { name: "Restore assembly", exact: true })
      .click();
    if (!baseline) {
      await page
        .getByRole("button", { name: "Run inspection benchmark", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Run inspection benchmark",
          exact: true,
        }),
      ).toBeEnabled({ timeout: 150000 });
      const sustained = JSON.parse(
        (await page.getByLabel("Render measurement").textContent())!,
      );
      expect(sustained.stages).toHaveLength(7);
      for (const stage of sustained.stages) {
        expect(stage.durationMs).toBe(8000);
        expect(stage.warmupMs).toBe(1500);
        expect(stage.frames).toBeGreaterThan(5);
      }
      stats.sustained = sustained;
    }
    expect(errors).toEqual([]);
    await writeFile(
      testInfo.outputPath("reference-performance.json"),
      JSON.stringify(stats, null, 2),
    );
    await testInfo.attach("reference-performance.json", {
      body: JSON.stringify(stats, null, 2),
      contentType: "application/json",
    });
    await context.close();
  });

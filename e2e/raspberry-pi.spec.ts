import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { setTheme } from "./experience-helpers";
test.skip(
  process.env.PUBLIC_DEMO_E2E !== "true",
  "Uses the isolated read-only showcase",
);
for (const width of [390, 1440])
  for (const theme of ["light", "dark"] as const)
    test.describe(`Raspberry Pi inspection ${width} ${theme}`, () => {
      test("selectable native components and finite inspection motion", async ({
        browser,
        baseURL,
      }, testInfo) => {
        test.setTimeout(60000);
        const context = await browser.newContext({
          baseURL,
          viewport: { width, height: 1000 },
          hasTouch: width < 768,
          recordVideo: {
            dir: testInfo.outputPath("recording"),
            size: { width, height: 1000 },
          },
        });
        const page = await context.newPage();
        let modelPath: string | undefined;
        let codeRequested = false,
          modelRequests = 0;
        // Observe shared renderer code across the journey, but count only the
        // selected Pi workspace's GLB; floor references use separate endpoints.
        page.on("request", (request) => {
          if (request.url().includes("LocalEquipmentRenderer"))
            codeRequested = true;
          if (modelPath && new URL(request.url()).pathname === modelPath)
            modelRequests++;
        });
        try {
          await page.setViewportSize({ width, height: 1000 });
          await page.goto("/#/login");
          await page
            .getByRole("button", { name: "Demo Viewer", exact: true })
            .click();
          await page.getByRole("button", { name: /^sign in$/i }).click();
          await expect(
            page.getByRole("heading", { name: "Overview", exact: true }),
          ).toBeVisible();
          await setTheme(page, theme);
          const s = (
            await (await page.request.get("/api/trpc/system.showcase")).json()
          ).result.data.json;
          expect(s.version).toBe(4);
          expect(s.raspberryPiRef).toMatch(/^equipment:/);
          if (width < 768)
            await page.locator('[data-sidebar="trigger"]').click();
          await page
            .locator('[data-sidebar="sidebar"]')
            .filter({ visible: true })
            .first()
            .getByRole("link", { name: "Demo guide", exact: true })
            .click();
          await expect(
            page.getByRole("heading", { name: "Demonstration", exact: true }),
          ).toBeVisible({ timeout: 15000 });
          modelPath = `/api/equipment/${s.raspberryPiRef.slice("equipment:".length)}/model`;
          let release!: () => void;
          const gate = new Promise<void>((r) => {
            release = r;
          });
          await page.route(
            (url) => url.pathname.includes("/api/trpc/inventory.item"),
            async (route) => {
              await gate;
              await route.continue();
            },
          );
          await page
            .getByRole("link", { name: "Raspberry Pi gateway", exact: true })
            .click();
          try {
            await expect.poll(() => codeRequested).toBe(true);
            expect(
              modelRequests,
              "No Pi model delivery before Pi item authorization",
            ).toBe(0);
          } finally {
            release();
          }
          await expect(
            page.getByRole("heading", {
              name: "Showcase Raspberry Pi 4 Model B",
              exact: true,
            }),
          ).toBeVisible();
          const host = page.locator("[data-model-bytes]");
          await expect(host).toHaveAttribute("data-model-bytes", "288440");
          await expect(page.locator("[data-state=ready]")).toBeVisible({
            timeout: 30000,
          });
          expect(modelRequests).toBe(1);
          const timing = JSON.parse(
            (await host.getAttribute("data-load-timings"))!,
          );
          expect(timing.downloadCompleted).toBeGreaterThanOrEqual(
            timing.downloadStarted,
          );
          expect(timing.firstFrame).toBeGreaterThanOrEqual(
            timing.graphicsCompiled,
          );
          await page
            .locator("summary")
            .filter({ hasText: "Explode, section and inspection tools" })
            .click();
          const explosion = page.getByLabel("Explosion percentage", {
            exact: true,
          });
          await explosion.press("End");
          for (let n = 0; n < 40; n++) await explosion.press("ArrowLeft");
          await expect
            .poll(
              async () =>
                JSON.parse((await host.getAttribute("data-inspection"))!)
                  .explode,
            )
            .toBe(0.6);
          await page.getByLabel("Ghost housings", { exact: true }).check();
          await expect
            .poll(
              async () =>
                JSON.parse((await host.getAttribute("data-inspection"))!).ghost,
            )
            .toBe(true);
          const directory =
            process.env.RASPBERRY_PI_EVIDENCE_DIR ??
            "test-results/public-demo/raspberry-pi-evidence";
          mkdirSync(directory, { recursive: true });
          await page.evaluate(() => {
            if (document.activeElement instanceof HTMLElement)
              document.activeElement.blur();
            window.scrollTo(0, 0);
          });
          await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
          await page.screenshot({
            path: `${directory}/exploded-${width}-${theme}.png`,
            fullPage: true,
          });
          await page.getByLabel("Ghost housings", { exact: true }).uncheck();
          await explosion.press("Home");
          await expect
            .poll(
              async () =>
                JSON.parse((await host.getAttribute("data-inspection"))!)
                  .explode,
            )
            .toBe(0);
          await expect
            .poll(
              async () =>
                JSON.parse((await host.getAttribute("data-inspection"))!)
                  .restorationError,
            )
            .toBe(0);
          await page
            .getByLabel("Section axis", { exact: true })
            .selectOption("X");
          await expect
            .poll(
              async () =>
                JSON.parse((await host.getAttribute("data-inspection"))!).caps,
            )
            .toBeGreaterThan(0);
          await page
            .getByRole("button", { name: "Reset section", exact: true })
            .click();
          await page.evaluate(() => {
            if (document.activeElement instanceof HTMLElement)
              document.activeElement.blur();
            window.scrollTo(0, 0);
          });
          await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
          await page.screenshot({
            path: `${directory}/assembled-${width}-${theme}.png`,
            fullPage: true,
          });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
        } finally {
          if (testInfo.status !== testInfo.expectedStatus) {
            const diagnostic = await page
              .locator("[data-load-timings]")
              .evaluateAll((nodes) =>
                nodes.map((node) =>
                  Object.fromEntries(
                    node
                      .getAttributeNames()
                      .filter((name) => name.startsWith("data-"))
                      .map((name) => [name, node.getAttribute(name)]),
                  ),
                ),
              );
            await testInfo.attach("renderer-state", {
              body: JSON.stringify(diagnostic, null, 2),
              contentType: "application/json",
            });
          }
          await context.close();
          const video = page.video();
          if (video)
            await video.saveAs(
              testInfo.outputPath(`inspection-${width}-${theme}.webm`),
            );
        }
      });
    });

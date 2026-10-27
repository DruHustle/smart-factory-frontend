import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { selectSection, setTheme } from "./experience-helpers";
import { measureThemeContrast } from "./contrast-helpers";
import { execFileSync } from "node:child_process";

test.describe("product experience rendered evidence", () => {
  test.skip(
    process.env.EXPERIENCE_E2E !== "true",
    "Requires the guarded isolated experience runner",
  );
  for (const width of [360, 390, 768, 1024, 1440])
    for (const theme of ["light", "dark"] as const) {
      test(`whole journey at ${width}px in ${theme}`, async ({ page }) => {
        const phase =
          process.env.EXPERIENCE_CAPTURE_PHASE === "before"
            ? "before"
            : process.env.EXPERIENCE_CAPTURE_PHASE === "preview"
              ? "preview"
              : "after";
        const folder =
          phase === "preview"
            ? "/private/tmp/product-ui-preview"
            : `docs/evidence/product-experience/${phase}`;
        mkdirSync(folder, { recursive: true });
        await page.setViewportSize({ width, height: 960 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto("/#/login");
        await page.getByLabel("Email").fill("security-admin@example.test");
        await page
          .getByLabel("Password", { exact: true })
          .fill("Synthetic-security-only-2026!");
        await page.getByRole("button", { name: /^sign in$/i }).click();
        await expect(
          page.getByRole("heading", { name: "Overview", exact: true }),
        ).toBeVisible();
        if (
          (await page.locator("html").getAttribute("class"))?.includes(
            "dark",
          ) !==
          (theme === "dark")
        )
          await setTheme(page, theme);
        const capture = async (name: string) => {
          await page.waitForLoadState("networkidle");
          await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
          await expect
            .poll(() =>
              page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            )
            .toBe(true);
          const height = await page.evaluate(
            () => document.documentElement.scrollHeight,
          );
          // The existing empty analytics page exceeds practical capture textures.
          // Record its full height and first viewport; the redesigned page must fit.
          const fullPage = phase === "after" || height < 7500;
          const source = execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim();
          writeFileSync(
            `${folder}/${name}-${theme}-${width}.json`,
            JSON.stringify(
              {
                phase,
                width,
                height,
                theme,
                fullPage,
                dataset: "isolated synthetic workspace fixtures",
                source,
                uiBase: "81bdd2f5f2a1449f903c22bef5539aa7e79ec013",
              },
              null,
              2,
            ),
          );
          await page.screenshot({
            path: `${folder}/${name}-${theme}-${width}.png`,
            fullPage,
            animations: "disabled",
          });
        };
        writeFileSync(
          `${folder}/contrast-${theme}-${width}.json`,
          JSON.stringify(await measureThemeContrast(page), null, 2),
        );
        await capture("overview");
        await page.goto("/#/inventory?search=Workspace");
        await expect(
          page.getByRole("status", { name: "Inventory results" }),
        ).toBeVisible();
        await capture("inventory");
        await page
          .getByRole("link", { name: "Workspace imported asset", exact: true })
          .filter({ visible: true })
          .first()
          .click();
        await selectSection(page, "AAS & submodels");
        await expect(
          page.getByRole("heading", { name: "AAS submodels", exact: true }),
        ).toBeVisible();
        await capture("item-aas");
        await page.goto("/#/cybersecurity");
        await expect(
          page.getByRole("heading", { name: "Cybersecurity", exact: true }),
        ).toBeVisible();
        await page.getByLabel("Filter evidence mode").selectOption("simulated");
        await expect(
          page.getByRole("button", { name: "Open high findings" }),
        ).toBeVisible();
        await capture("cybersecurity");
        await page.goto("/#/inventory?search=Workspace%20standalone");
        await page
          .getByRole("link", { name: "Workspace standalone pump", exact: true })
          .filter({ visible: true })
          .first()
          .click();
        await selectSection(page, "3D inspection");
        // Match the existing native equipment runner's cold GLB readiness budget.
        await expect(page.locator("[data-state=ready]")).toBeVisible({
          timeout: 20000,
        });
        await capture("equipment");
        await page.goto("/#/analytics");
        await expect(
          page.getByRole("heading", { name: "Analytics", exact: true }),
        ).toBeVisible();
        await capture("analytics");
        const response = await page.request.get("/api/trpc/system.showcase");
        const showcase = (await response.json()).result.data.json;
        const scope = new URLSearchParams({
          asset: showcase.assetId,
          scope: "simulated",
          from: showcase.from.slice(0, 16),
          to: showcase.anchor.slice(0, 16),
        });
        await page.goto("/#/analytics?" + scope);
        await expect(
          page.getByRole("img", { name: /temperature in °C/ }),
        ).toBeVisible();
        await capture("analytics-observed");
        await page.goto("/#/monitoring?search=Workspace");
        await expect(page.getByRole("article").first()).toBeVisible();
        await capture("monitoring");
        await page.goto("/#/alerts?search=Simulated%20temperature");
        await expect(page.getByLabel("Search alerts")).toBeVisible();
        await capture("alerts");
        await page.goto("/#/assistant");
        await page
          .getByLabel("Ask the Smart Factory Assistant")
          .fill("What evidence is available for the showcase pump?");
        await page.getByRole("button", { name: "Ask", exact: true }).click();
        await expect(
          page.getByTestId("assistant-answer-content").first(),
        ).toBeVisible();
        await capture("assistant");
        for (const [route, name] of [
          ["users", "administration-users"],
          ["integrations", "administration-integrations"],
          ["audit", "administration-audit"],
          ["workspace", "administration-settings"],
        ]) {
          await page.goto("/#/administration/" + route);
          await expect(
            page.getByRole("heading", { name: "Administration", exact: true }),
          ).toBeVisible();
          await capture(name);
        }
        await page.goto("/#/notifications");
        await expect(
          page.getByRole("heading", { name: "Notifications", exact: true }),
        ).toBeVisible();
        await capture("notifications");
        await page.goto("/#/ota");
        await expect(
          page.getByRole("heading", {
            name: "Firmware & updates",
            exact: true,
          }),
        ).toBeVisible();
        await capture("firmware");
      });
    }
});

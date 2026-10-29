import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enterSimulation, noOverflow } from "./visual-workspace-helpers";
const dir =
  process.env.VISUAL_WORKSPACE_EVIDENCE_DIR ?? "test-results/visual-workspaces";
for (const width of [360, 390, 768, 1024, 1440])
  for (const theme of ["light", "dark"])
    test(`shared typography and graphical workspaces ${width} ${theme}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await enterSimulation(page, width, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      if (width < 768)
        await page
          .getByRole("button", { name: "Toggle navigation", exact: true })
          .filter({ visible: true })
          .first()
          .click();
      const nav =
        width < 768
          ? page.getByRole("dialog")
          : page.getByRole("navigation", { name: "Primary navigation" });
      const measured = await nav
        .locator("[data-navigation-heading]")
        .evaluateAll((labels) =>
          labels.map((label) => {
            const style = getComputedStyle(label),
              icon = label.parentElement?.querySelector(
                "svg[data-navigation-icon]",
              ),
              b = icon?.getBoundingClientRect();
            return {
              label: label.textContent,
              font: style.fontSize,
              weight: style.fontWeight,
              line: style.lineHeight,
              spacing: style.letterSpacing,
              casing: style.textTransform,
              width: b?.width,
              height: b?.height,
              stroke: icon?.getAttribute("stroke-width"),
            };
          }),
        );
      expect(measured.length).toBe(6);
      for (const m of measured) {
        expect(m.font).toBe("12px");
        expect(m.weight).toBe("500");
        expect(m.line).toBe("16px");
        expect(m.casing).toBe("uppercase");
        expect(m.width).toBe(16);
        expect(m.height).toBe(16);
        expect(m.stroke).toBe("1.75");
      }
      await expect(
        nav.getByRole("link", { name: "Service health", exact: true }),
      ).toBeVisible();
      if (width < 768) await page.keyboard.press("Escape");
      for (const [name, route, title] of [
        ["overview", "/", "Overview"],
        ["inventory", "/inventory", "Assets & devices"],
        ["monitoring", "/monitoring", "Monitoring"],
        ["network", "/network", "FX & TSN"],
        ["alerts", "/alerts", "Alerts"],
        ["security", "/cybersecurity", "Cybersecurity"],
        ["analytics", "/analytics", "Analytics"],
        ["administration", "/administration/integrations", "Administration"],
        ["assistant-empty", "/assistant", "Assistant"],
      ]) {
        await page.goto("/#" + route);
        const heading = page
          .getByRole("heading", { name: title, exact: true })
          .first();
        await expect(heading).toBeVisible({ timeout: 15000 });
        expect(
          await heading.evaluate((el) => getComputedStyle(el).fontFamily),
        ).toContain("Segoe UI");
        expect(
          await heading.evaluate((el) => getComputedStyle(el).fontSize),
        ).toBe("26px");
        expect(
          await heading.evaluate((el) => getComputedStyle(el).fontWeight),
        ).toBe("730");
        await noOverflow(page);
        const fields = page.locator(
          "input:not([type=checkbox]):not([type=range]):visible,select:visible,textarea:visible",
        );
        if (width < 768)
          for (const field of await fields.all())
            expect(
              parseFloat(
                await field.evaluate((el) => getComputedStyle(el).fontSize),
              ),
            ).toBeGreaterThanOrEqual(16);
        if ([390, 1440].includes(width)) {
          mkdirSync(dir, { recursive: true });
          await page.screenshot({
            path: `${dir}/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
      const composer = page.getByRole("textbox", {
        name: "Ask the Smart Factory Assistant",
      });
      await composer.fill("Why does Showcase pump 01 need attention?");
      await page.getByRole("button", { name: "Ask", exact: true }).click();
      await expect(page.getByTestId("assistant-answer-content")).toBeVisible();
      await expect(page.locator("svg.recharts-surface").first()).toBeVisible();
      await noOverflow(page);
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: `${dir}/assistant-answer-${width}-${theme}.png`,
          fullPage: true,
        });
      if (width === 1440) {
        await page.goto("/#/inventory");
        await page
          .getByRole("button", { name: "Toggle navigation", exact: true })
          .filter({ visible: true })
          .first()
          .click();
        const icons = page.locator(
          "[data-sidebar=sidebar] svg[data-navigation-icon]:visible",
        );
        for (const icon of await icons.all()) {
          const b = await icon.boundingBox();
          expect(b?.width).toBe(16);
          expect(b?.height).toBe(16);
        }
        await page
          .getByRole("button", { name: "Toggle navigation", exact: true })
          .filter({ visible: true })
          .first()
          .click();
        await page.evaluate(() => {
          document.documentElement.style.zoom = "2";
        });
        await noOverflow(page);
        await page.evaluate(() => {
          document.documentElement.style.zoom = "";
        });
      }
      expect(errors).toEqual([]);
    });

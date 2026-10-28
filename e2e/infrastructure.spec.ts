import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enterSimulation, noOverflow, rpc } from "./visual-workspace-helpers";
const dir =
  process.env.VISUAL_WORKSPACE_EVIDENCE_DIR ??
  "test-results/visual-workspaces";
for (const width of [390, 1440])
  for (const theme of ["light", "dark"])
    test(`isolated infrastructure failure, recovery and evidence ${width} ${theme}`, async ({
      page,
    }) => {
      await enterSimulation(page, width, theme);
      await page.goto("/#/infrastructure/service-health");
      await expect(
        page.getByRole("heading", { name: "Service health", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Simulated infrastructure", { exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      await page
        .getByRole("combobox", { name: "Infrastructure simulation scenario" })
        .selectOption("failure");
      const mqtt = page
        .getByRole("button", {
          name: /MQTT subscriber, Unavailable; inspect evidence/,
        })
        .or(
          page.getByRole("button", {
            name: "MQTT subscriber Unavailable",
            exact: true,
          }),
        )
        .filter({ visible: true })
        .first();
      await expect(mqtt).toBeVisible();
      await mqtt.click();
      const evidence =
        width < 1280
          ? page.getByRole("dialog")
          : page.getByRole("complementary", { name: "Service evidence" });
      await expect(evidence).toContainText("SIMULATED_SUBSCRIPTION_LOSS");
      await expect(evidence).toContainText("Observed");
      await expect(evidence).toContainText("Collected");
      if (width < 1280) await page.keyboard.press("Escape");
      else
        await page
          .getByRole("button", { name: "Close service evidence" })
          .click();
      await page
        .getByRole("combobox", { name: "Infrastructure simulation scenario" })
        .selectOption("recovery");
      await expect(
        page
          .getByRole("button", { name: /MQTT subscriber.*Healthy/ })
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: `${dir}/infrastructure-overview-${width}-${theme}.png`,
        fullPage: true,
      });
      for (const view of ["Services", "Resources", "Queues", "History"]) {
        const tab = page.getByRole("tab", { name: view, exact: true });
        if (await tab.isVisible()) await tab.click();
        else
          await page
            .getByRole("combobox", { name: "Service health views" })
            .selectOption(view.toLowerCase());
        await noOverflow(page);
        if (view === "Resources") {
          await page
            .getByRole("combobox", { name: "Infrastructure resource metric" })
            .selectOption("host-memory");
          await expect(
            page.getByText("No collected history", { exact: true }),
          ).toBeVisible();
          await expect(
            page.getByText(/A host collector is required/).first(),
          ).toBeVisible();
        }
        if (view === "Queues")
          await expect(
            page.getByRole("heading", { name: "Queues & acceptance age" }),
          ).toBeVisible();
      }
      await expect(page.getByText(/gaps.*Recorded observations/)).toBeVisible();
      await page.screenshot({
        path: `${dir}/infrastructure-history-${width}-${theme}.png`,
        fullPage: true,
      });
      const result = await page.request.get(
        rpc("system.infrastructure", { range: "2h", scenario: "failure" }),
      );
      expect(result.ok()).toBe(true);
      const data = (await result.json()).result.data.json;
      expect(data.snapshot.synthetic).toBe(true);
      expect(JSON.stringify(data)).not.toMatch(
        /152\.70\.22\.84|postgres:\/\/|sslip\.io|INGESTION_API_TOKEN/,
      );
      expect(data.snapshot.recovery).toEqual([]);
    });

import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test("operational reports print their scoped fixture data", async ({
  page,
}) => {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill("security-viewer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-security-only-2026!");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();

  const report = async (button: string, title: string, file: string) => {
    await page.getByRole("button", { name: button, exact: true }).click();
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("menuitem", { name: "Export as PDF" }).click();
    const popup = await popupPromise;
    await expect(
      popup.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      popup.getByRole("button", { name: "Print / save as PDF" }),
    ).toBeVisible();
    await popup.emulateMedia({ media: "print" });
    await expect(
      popup.getByRole("button", {
        name: "Print / save as PDF",
        includeHidden: true,
      }),
    ).toBeHidden();
    const directory = process.env.REPORT_EVIDENCE_DIR;
    if (directory) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      await popup.pdf({ path: join(directory, file), printBackground: true });
    }
    return popup;
  };

  await page.goto("/#/inventory?search=Workspace%20direct%20sensor");
  await page
    .getByRole("link", { name: "Workspace direct sensor", exact: true })
    .first()
    .click();
  const device = await report(
    "Export operational 24h",
    "Device Report: Workspace direct sensor",
    "device.pdf",
  );
  await expect(device.locator("body")).toContainText("workspace-direct");
  await expect(device.locator("body")).toContainText("23.0");
  await expect(device.locator("body")).toContainText("operational");
  await expect(device.locator("body")).toContainText(
    "Observed source status at report generation",
  );
  await expect(device.locator("body")).toContainText("Last seen (UTC)");
  await expect(device.locator("body")).toContainText("UTC window:");
  const observedStatus = (
    await device.locator(".status-badge").first().innerText()
  ).trim();
  expect(["live", "stale"]).toContain(observedStatus);
  await expect(
    page.getByText("Source status", { exact: false }).first(),
  ).toContainText(observedStatus === "live" ? "Receiving" : observedStatus);
  await device.close();

  await page.goto("/#/inventory?search=Workspace%20never%20configured");
  await page
    .getByRole("link", { name: "Workspace never configured", exact: true })
    .first()
    .click();
  const unknown = await report(
    "Export operational 24h",
    "Device Report: Workspace never configured",
    "device-unknown.pdf",
  );
  await expect(unknown.locator("body")).toContainText("unknown");
  await expect(unknown.locator("body")).toContainText("Unavailable");
  await unknown.close();

  await page.goto("/#/inventory?search=Workspace%20observed%20offline");
  await page
    .getByRole("link", { name: "Workspace observed offline", exact: true })
    .first()
    .click();
  const stale = await report(
    "Export operational 24h",
    "Device Report: Workspace observed offline",
    "device-stale.pdf",
  );
  await expect(stale.locator(".status-badge").first()).toHaveText("stale");
  await expect(
    page.getByText("Source status", { exact: false }).first(),
  ).toContainText("stale");
  await stale.close();

  await page.goto("/#/analytics");
  const analytics = await report(
    "Export report",
    "Asset Telemetry Report",
    "analytics.pdf",
  );
  await expect(analytics.locator("body")).toContainText(
    "Workspace linked asset",
  );
  await expect(analytics.locator("body")).toContainText("Samples");
  await expect(analytics.locator("body")).toContainText("Scope: operational");
  await expect(analytics.locator("body")).toContainText("UTC window:");
  await analytics.close();

  await page.goto("/#/alerts");
  const alerts = await report(
    "Export history",
    "Alert History Report",
    "alerts.pdf",
  );
  await expect(alerts.locator("body")).toContainText("Alert Details");
  await expect(alerts.locator("body")).toContainText("total");
  await expect(alerts.locator("body")).toContainText("UTC window:");
  await alerts.close();
});

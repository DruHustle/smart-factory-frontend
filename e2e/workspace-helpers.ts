import { expect, type Page } from "@playwright/test";
import { selectSection } from "./experience-helpers";
/** Legacy regression journeys use the new user-visible entry points. */
export async function navigate(page: Page, name: string) {
  if (name === "Assets" || name === "Devices") {
    await page.goto(
      "/#/inventory?view=" + (name === "Assets" ? "assets" : "all"),
    );
    await expect(
      page.getByRole("heading", { name: "Assets & devices", exact: true }),
    ).toBeVisible();
    return;
  }
  const labels: Record<string, string> = {
    Dashboard: "Overview",
    "OTA Updates": "Firmware & updates",
    "User Access": "Users & access",
    "Smart Factory Assistant": "Assistant",
  };
  const label = labels[name] ?? name;
  if (["Integrations", "Users & access"].includes(label)) {
    await page.goto(
      "/#/administration/" +
        (label === "Integrations" ? "integrations" : "users"),
    );
    return;
  }
  await page
    .getByRole("link", {
      name: label === "Notifications" ? /^Notifications and history/ : label,
      exact: label !== "Notifications",
    })
    .click();
}
export async function addItem(
  page: Page,
  kind: "gateway" | "asset" | "device",
) {
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page
    .getByRole("button", {
      name:
        kind === "gateway"
          ? /^Gateway A connectivity/
          : kind === "asset"
            ? /^AAS-backed asset Create/
            : /^IoT device A standalone/,
    })
    .click();
}
export async function openItem(page: Page, name: string, section?: string) {
  await page.getByLabel("Search inventory", { exact: true }).fill(name);
  await page
    .getByRole("link", { name, exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  if (section) await selectSection(page, section);
}
export async function finishGateway(page: Page) {
  await page
    .getByRole("button", { name: "Next: connection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Next: representation", exact: true })
    .click();
  await page.getByRole("button", { name: "Next: review", exact: true }).click();
  await page
    .getByRole("button", { name: "Register Gateway", exact: true })
    .click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
}

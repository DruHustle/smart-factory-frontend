import {
  navigate,
  addItem,
  openItem,
  finishGateway,
} from "./workspace-helpers";
import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, role: "admin" | "engineer" | "viewer") {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill(`security-${role}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-security-only-2026!");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

async function expectSoundDocumentStructure(page: Page) {
  await expect(page.locator("h1").first()).toBeVisible();
  const audit = await page.evaluate(() => {
    const duplicateIds = Array.from(
      document.querySelectorAll<HTMLElement>("[id]"),
    )
      .map((element) => element.id)
      .filter((id, index, ids) => id && ids.indexOf(id) !== index);

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, a[href], input:not([type='hidden']), textarea, select, [role='button'], [role='link'], [role='combobox']",
      ),
    );
    const textFromIds = (ids: string) =>
      ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ")
        .trim();
    const controlName = (element: HTMLElement) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const ownId = element.id;
      return (
        element.getAttribute("aria-label")?.trim() ||
        (labelledBy ? textFromIds(labelledBy) : "") ||
        (ownId
          ? document
              .querySelector<HTMLLabelElement>(
                `label[for="${CSS.escape(ownId)}"]`,
              )
              ?.textContent?.trim()
          : "") ||
        element.closest("label")?.textContent?.trim() ||
        element.getAttribute("title")?.trim() ||
        element.innerText?.trim() ||
        ""
      );
    };
    const unnamedControls = controls
      .filter(
        (element) =>
          element.getAttribute("aria-hidden") !== "true" &&
          !controlName(element),
      )
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}${element.getAttribute("role") ? `[role=${element.getAttribute("role")}]` : ""}`,
      );

    return {
      duplicateIds: [...new Set(duplicateIds)],
      unnamedControls,
      mainCount: document.querySelectorAll("main").length,
      h1Count: document.querySelectorAll("h1").length,
      horizontalOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });

  expect(audit.duplicateIds).toEqual([]);
  expect(audit.unnamedControls).toEqual([]);
  expect(audit.mainCount).toBe(1);
  expect(audit.h1Count).toBeGreaterThanOrEqual(1);
  expect(audit.horizontalOverflow).toBeLessThanOrEqual(1);
}

test("signed-out and authenticated routes expose named controls and sound landmarks", async ({
  page,
}) => {
  await page.goto("/#/login");
  await expect(
    page.getByRole("heading", { name: "Smart Factory" }),
  ).toBeVisible();
  await expectSoundDocumentStructure(page);
  const password = page.locator("#password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");

  await loginAs(page, "viewer");
  const routes = [
    ["/", "Overview"],
    ["/monitoring", "Monitoring"],
    ["/devices", "Assets & devices"],
    ["/assets", "Assets & devices"],
    ["/alerts", "Alerts"],
    ["/notifications", "Notifications"],
    ["/analytics", "Analytics"],
    ["/assistant", "Assistant"],
  ] as const;

  for (const [route, heading] of routes) {
    await page.goto(`/#${route}`);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expectSoundDocumentStructure(page);
  }

  await page.goto("/#/devices");
  await expect(
    page.getByRole("link", { name: "Assets & devices", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const resizer = page.getByRole("separator", { name: "Resize navigation" });
  const originalWidth = Number(await resizer.getAttribute("aria-valuenow"));
  await resizer.focus();
  await page.keyboard.press("ArrowRight");
  await expect(resizer).toHaveAttribute(
    "aria-valuenow",
    String(
      Math.min(
        Number(await resizer.getAttribute("aria-valuemax")),
        originalWidth + 10,
      ),
    ),
  );
});

test("core operational routes remain within a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "viewer");

  for (const route of [
    "/",
    "/monitoring",
    "/devices",
    "/assets",
    "/alerts",
    "/notifications",
    "/analytics",
    "/assistant",
  ]) {
    await page.goto(`/#${route}`);
    await expect(page.locator("#dashboard-main")).toBeVisible();
    await expectSoundDocumentStructure(page);
  }

  const menu = page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .filter({ visible: true })
    .first();
  await menu.click();
  await expect(
    page.getByRole("link", { name: "Monitoring", exact: true }),
  ).toBeVisible();
  await navigate(page, "Monitoring");
  await expect(
    page.getByRole("heading", { name: "Monitoring", exact: true }),
  ).toBeVisible();
});

import { test, expect } from "@playwright/test";
test("individual accounts save and reopen layouts from account storage", async ({
  page,
}) => {
  await page.goto("/#/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("security-admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-security-only-2026!");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.goto("/#/layouts");
  await page
    .getByLabel("Layout name", { exact: true })
    .fill("Owned account layout");
  await page
    .getByRole("button", { name: /^Place .*\(asset\)$/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(
    page.getByText("Layout saved to your account", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New layout", exact: true }).click();
  await expect(page.getByLabel("Layout name", { exact: true })).toHaveValue(
    "My factory",
  );
  await page
    .getByRole("button", { name: "Owned account layout · v1", exact: true })
    .click();
  await expect(page.getByLabel("Layout name", { exact: true })).toHaveValue(
    "Owned account layout",
  );
  await page.reload();
  await expect(page.getByLabel("Layout name", { exact: true })).toHaveValue(
    "Owned account layout",
  );
});

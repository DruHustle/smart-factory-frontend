import { test, expect } from "@playwright/test";

test.skip(
  process.env.WORKSPACE_E2E !== "true",
  "Uses isolated individual-account fixtures",
);

for (const [route, title, rpc, searchLabel] of [
  ["inventory", "Assets & devices", "inventory.list", "Search inventory"],
  ["monitoring", "Monitoring", "devices.monitor", "Search sources"],
  ["alerts", "Alerts", "alerts.page", "Search alerts"],
  [
    "notifications",
    "Notifications",
    "notifications.page",
    "Search notifications",
  ],
]) {
  test(`${title} recovers malformed saved filters and oversized search links`, async ({
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
    const params = new URLSearchParams({
      search: "x".repeat(200),
      page: "Infinity",
      view: "retired",
      status: "invalid",
      mode: "invalid",
      type: "invalid",
      scope: "invalid",
      capability: "invalid",
      sort: "invalid",
    });
    const response = page.waitForResponse(
      (r) => r.url().includes(`/api/trpc/`) && r.url().includes(rpc),
    );
    await page.goto(`/#/${route}?${params}`);
    expect((await response).status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel(searchLabel, { exact: true })).toHaveValue(
      "x".repeat(100),
    );
    await expect(page.getByLabel(searchLabel, { exact: true })).toHaveAttribute(
      "maxlength",
      "100",
    );
  });
}

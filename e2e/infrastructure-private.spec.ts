import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { rpc, noOverflow } from "./visual-workspace-helpers";
test.skip(
  process.env.WORKSPACE_E2E !== "true",
  "Uses the individual-account disposable workspace",
);
async function login(page: Page, role: string) {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill(`security-${role}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-security-only-2026!");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
for (const role of ["viewer", "operator", "engineer"])
  test(`private ${role} cannot inspect installation infrastructure`, async ({
    page,
  }) => {
    await login(page, role);
    await expect(
      page.getByRole("link", { name: "Service health", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.get(
          rpc("system.infrastructure", { range: "2h", scenario: "normal" }),
        )
      ).status(),
    ).toBe(403);
    expect(
      (await page.request.get("/api/trpc/system.operations")).status(),
    ).toBe(403);
    await page.goto("/#/infrastructure/service-health");
    await expect(
      page.getByText("Service health is restricted", { exact: true }),
    ).toBeVisible();
  });
test("individual administrator inspects real scoped process and database evidence without controls", async ({
  page,
}) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Service health", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Service health", exact: true }),
  ).toBeVisible();
  const response = await page.request.get(
    rpc("system.infrastructure", { range: "2h", scenario: "normal" }),
  );
  expect(response.ok()).toBe(true);
  const data = (await response.json()).result.data.json;
  expect(data.snapshot.synthetic).toBe(false);
  expect(data.snapshot.services.find((s: any) => s.id === "api").state).toBe(
    "healthy",
  );
  expect(
    data.snapshot.services.find((s: any) => s.id === "database").state,
  ).toBe("healthy");
  expect(
    data.snapshot.resources.find((s: any) => s.id === "api-rss").value,
  ).toBeGreaterThan(0);
  expect(
    data.snapshot.resources.find((s: any) => s.id === "host-memory").value,
  ).toBeNull();
  expect(JSON.stringify(data)).not.toContain("postgres://");
  expect(data.snapshot.recovery).toEqual([]);
  await page.getByRole("tab", { name: "Services", exact: true }).click();
  await page
    .getByRole("button", { name: /Application PostgreSQL.*Healthy/ })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Service evidence" }),
  ).toContainText("QUERY_COMPLETED");
  await expect(
    page.getByRole("button", { name: /restart|purge|deploy/i }),
  ).toHaveCount(0);
  await noOverflow(page);
});
test("registration and role-filtered navigation retain mobile sizing, icons and keyboard access", async ({
  page,
}) => {
  await login(page, "admin");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/inventory");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByRole("button", { name: /IoT device A standalone/ }).click();
  await expect(page.getByLabel("Device ID", { exact: true })).toBeVisible();
  for (const field of await page.locator("[role=dialog] input:visible").all())
    expect(
      parseFloat(await field.evaluate((el) => getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  const dir =
    process.env.VISUAL_WORKSPACE_EVIDENCE_DIR ??
    "test-results/visual-workspaces";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/registration-390-light.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await noOverflow(page);
  const trigger = page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .filter({ visible: true })
    .first();
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Service health", exact: true }),
  ).toBeVisible();
  for (const icon of await page
    .getByRole("dialog")
    .locator("svg[data-navigation-icon]")
    .all()) {
    const b = await icon.boundingBox();
    expect(b!.width).toBe(16);
    expect(b!.height).toBe(16);
    expect(await icon.getAttribute("stroke-width")).toBe("1.75");
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

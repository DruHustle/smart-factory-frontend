import { test, expect } from "@playwright/test";
for (const role of ["Admin", "Engineer", "Operator", "Viewer"]) {
  test(`shared ${role} sees only approved fixtures and cannot mutate any operational domain`, async ({
    page,
  }) => {
    await page.goto("/#/login");
    await page
      .getByRole("button", { name: `Demo ${role}`, exact: true })
      .click();
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    const me = await page.request.get("/api/trpc/auth.me");
    expect((await me.json()).result.data.json.access).toMatchObject({
      demoOnly: true,
      canOperate: false,
      canEngineer: false,
      canAdminister: false,
    });
    const inventory = await page.request.get(
      "/api/trpc/inventory.list?input=" +
        encodeURIComponent(JSON.stringify({ json: { page: 0, pageSize: 50 } })),
    );
    const items = (await inventory.json()).result.data.json.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i: any) => i.isDemo === true)).toBe(true);
    expect(JSON.stringify(items)).not.toContain("Workspace imported asset");
    for (const procedure of [
      "devices.create",
      "devices.update",
      "devices.delete",
      "devices.pulseIndicator",
      "assets.create",
      "assets.update",
      "assets.delete",
      "assets.controlAda031",
      "assets.publishGatewayConfiguration",
      "assets.publishPassport",
      "thresholds.upsert",
      "alerts.assign",
      "alerts.resolve",
      "users.create",
      "users.setRole",
      "users.setEnabled",
      "system.setDemoData",
      "readings.create",
      "equipment.create",
      "security.createSource",
      "notifications.retryEmail",
    ]) {
      const denied = await page.request.post("/api/trpc/" + procedure, {
        data: { json: {} },
      });
      expect(denied.status(), procedure).toBe(403);
    }
    for (const path of [
      "/api/aas/shells",
      "/api/onesa/artifacts/equipment.json",
      "/api/trpc/users.list",
      "/api/trpc/system.operations",
    ])
      expect((await page.request.get(path)).status(), path).toBe(403);
    const raw = await page.request.post("/api/assets/import", {
      multipart: {
        file: {
          name: "blocked.aasx",
          mimeType: "application/aas+zip",
          buffer: Buffer.from("PKsynthetic"),
        },
      },
    });
    expect(raw.status()).toBe(403);
    await page.goto("/#/inventory");
    await expect(
      page.getByRole("button", { name: "Add item", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Administration", exact: true }),
    ).toHaveCount(0);
    await page.goto("/#/assistant");
    await page
      .getByLabel("Ask the Smart Factory Assistant")
      .fill("How many assets are visible in this workspace?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(
      page.getByTestId("assistant-answer-content").first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("assistant-answer-content").first(),
    ).not.toContainText("Workspace imported asset");
  });
}

import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
const query = (name: string, input: unknown) =>
  "/api/trpc/" +
  name +
  "?input=" +
  encodeURIComponent(JSON.stringify({ json: input }));
async function enterDemo(page: import("@playwright/test").Page, width: number) {
  test.skip(
    process.env.PUBLIC_DEMO_E2E !== "true",
    "Requires isolated public-demo server",
  );
  await page.setViewportSize({ width, height: 960 });
  await page.addInitScript(
    ({ dark }) => localStorage.setItem("theme", dark ? "dark" : "light"),
    { dark: width === 390 },
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Demo Viewer", exact: true }).click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const s = (await (await page.request.get("/api/trpc/system.showcase")).json())
    .result.data.json;
  expect(s.version).toBe(2);
  expect(s.chapters).toHaveLength(12);
  const dir =
    process.env.SHOWCASE_EVIDENCE_DIR ?? `${tmpdir()}/showcase-evidence`;
  mkdirSync(dir, { recursive: true });
  return { s, dir, errors };
}
for (const width of [390, 1440]) {
  test(`recorded analytics and isolated inbox at ${width}px`, async ({
    page,
  }) => {
    const { s, dir, errors } = await enterDemo(page, width);
    await page.goto("/#/demo");
    await expect(
      page.getByRole("heading", { name: "Demonstration", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Native 3D inspection", exact: true }),
    ).toBeVisible();
    await page.goto("/#/analytics");
    await expect(
      page.getByText("No verified measurements in this period", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator("svg.recharts-surface").first()).toBeVisible();
    await expect(page.locator("[data-demo-anchor]")).toHaveAttribute(
      "data-demo-anchor",
      s.anchor,
    );
    await page.screenshot({
      path: `${dir}/analytics-${width}.png`,
      fullPage: true,
    });
    await page.goto("/#/notifications");
    await expect(
      page.getByText("Simulation · email not requested").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mark read", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Simulated process incident ready for review", {
        exact: true,
      }),
    ).toBeVisible();
    const notes = (
      await (
        await page.request.get(
          query("notifications.page", { page: 0, search: "", view: "all" }),
        )
      ).json()
    ).result.data.json;
    expect(notes.total).toBe(2);
    expect(notes.items.every((n: any) => n.emailStatus === "demo_only")).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
  test(`read-only administration, firmware and passport at ${width}px`, async ({
    page,
  }) => {
    const { s, dir, errors } = await enterDemo(page, width);
    await page.goto("/#/administration/users");
    await expect(
      page.getByText("Individual account roles", { exact: true }),
    ).toBeVisible();
    expect((await page.request.get("/api/trpc/users.list")).status()).toBe(403);
    await page.goto("/#/administration/integrations");
    await expect(
      page.getByText("Demonstration integrations", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Consumer required", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `${dir}/administration-${width}.png`,
      fullPage: true,
    });
    await page.goto("/#/ota");
    await expect(
      page.getByText("SIM-2.0.0", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("OTA delivery is disabled", { exact: true }),
    ).toBeVisible();
    expect((await page.request.get("/api/trpc/firmware.list")).status()).toBe(
      403,
    );
    await page.goto("/#/passport/published/" + s.passportId);
    await expect(
      page.getByText("Showcase pump 01 · simulated product passport", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/No asset-specific guidance has been published/),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
test("demonstration exposes exact component evidence and preserved inspection views", async ({
  page,
}) => {
  test.skip(
    process.env.PUBLIC_DEMO_E2E !== "true",
    "Requires isolated public-demo server",
  );
  await page.goto("/#/login");
  await page
    .getByRole("button", { name: "Demo Engineer", exact: true })
    .click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const s = (await (await page.request.get("/api/trpc/system.showcase")).json())
    .result.data.json;
  const response = await page.request.get(
    query("equipment.get", { id: s.equipmentId, mode: "simulated" }),
  );
  expect(response.status()).toBe(200);
  const w = (await response.json()).result.data.json;
  expect(w.components).toHaveLength(87);
  expect(w.viewpoints).toHaveLength(2);
  expect(
    w.observations.filter((o: any) => o.value !== null && o.unitVerified),
  ).toHaveLength(4);
  const modelResponse = await page.request.get(
    `/api/equipment/${s.equipmentId}/model`,
  );
  expect(modelResponse.status()).toBe(200);
  const modelBody = await modelResponse.body();
  expect(modelBody.byteLength).toBeGreaterThan(0);
  expect(modelBody.byteLength).toBeLessThanOrEqual(20 * 1024 * 1024);
  await page.goto("/#/inventory/" + s.assetRef + "/3d");
  await expect(page.locator("[data-model-bytes]")).toHaveAttribute(
    "data-model-bytes",
    /^[1-9]\d*$/,
  );
  await expect(page.locator("[data-state=ready]")).toBeVisible();
  await page.goto(
    "/#/cybersecurity?finding=" + s.securityFindingId + "&mode=simulated",
  );
  await expect(
    page.getByText(/Authored investigation: compare supplied hashes/).first(),
  ).toBeVisible();
  const dirs =
    process.env.SHOWCASE_EVIDENCE_DIR ?? `${tmpdir()}/showcase-evidence`;
  mkdirSync(dirs, { recursive: true });
  await page.screenshot({
    path: `${dirs}/mapped-security.png`,
    fullPage: true,
  });
  expect(
    (
      await page.request.post("/api/trpc/equipment.save", {
        data: { json: {} },
      })
    ).status(),
  ).toBe(403);
});

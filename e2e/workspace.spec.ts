import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
const password = "Synthetic-security-only-2026!";
async function call(
  r: APIRequestContext,
  path: string,
  input?: unknown,
  query = true,
) {
  const data = { json: input };
  const res = query
    ? await r.get(
        `/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(data))}`,
      )
    : await r.post(`/api/trpc/${path}`, { data });
  const body = await res.json();
  return { res, data: body.result?.data?.json, body };
}
async function login(page: Page, role = "admin") {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill(`security-${role}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
async function inventory(page: Page, search = "Workspace") {
  await page.goto("/#/inventory?search=" + encodeURIComponent(search));
  await expect(
    page.getByRole("heading", { name: "Assets & devices", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Inventory results" }),
  ).toBeVisible();
}
async function open(page: Page, name: string) {
  await page
    .getByRole("link", { name, exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
test.describe("unified item workspace", () => {
  test.skip(
    process.env.WORKSPACE_E2E !== "true",
    "Requires isolated workspace fixtures",
  );
  test("direct IoT registration completes and accepts telemetry without a gateway or AAS", async ({
    page,
  }) => {
    await login(page);
    await inventory(page);
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await page.getByRole("button", { name: /IoT device A standalone/ }).click();
    await page
      .getByLabel("Device ID", { exact: true })
      .fill("workspace-browser-direct");
    await page
      .getByLabel("Device name", { exact: true })
      .fill("Workspace browser direct");
    await page.getByRole("button", { name: "Next: connection" }).click();
    await page.getByRole("combobox", { name: "Connection route" }).click();
    await page.getByRole("option", { name: "Direct MQTT over TLS" }).click();
    await page.getByLabel("Expected maximum sample age").fill("120");
    await page
      .getByRole("button", { name: "Register Device", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Workspace browser direct",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await call(page.request, "assets.getAllForDevice", {
          devicePk: Number(
            (
              await call(page.request, "inventory.list", {
                search: "workspace-browser-direct",
              })
            ).data.items[0].id,
          ),
        })
      ).data,
    ).toEqual([]);
    const ingress = await page.request.post("/api/internal/telemetry", {
      headers: { Authorization: "Bearer isolated-workspace-ingestion-token" },
      data: {
        deviceId: "workspace-browser-direct",
        timestamp: Date.now(),
        temperature: 24,
      },
    });
    expect(ingress.ok()).toBe(true);
    await page.reload();
    await expect(page.getByText("Direct MQTT", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Telemetry", exact: true }).click();
    await expect(
      page.getByText("Historical Data", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "AAS & submodels" }),
    ).toHaveCount(0);
  });
  test("gateway shows all children and linked assets; imported AAS and explicit 3D remain distinct capabilities", async ({
    page,
  }) => {
    await login(page);
    await inventory(page);
    await open(page, "Workspace gateway");
    await page.getByRole("tab", { name: "Connected items" }).click();
    await expect(
      page.getByText("Connected equipment (4)", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Workspace child A/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Workspace imported asset/ }),
    ).toBeVisible();
    await inventory(page);
    await open(page, "Workspace imported asset");
    await expect(
      page.getByText("Historical ·", { exact: false }).first(),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "AAS & submodels" }).click();
    await page.getByText("VendorNameplate", { exact: true }).first().click();
    await expect(
      page.getByText("Isolated fixture manufacturer", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy full identifier" }).last(),
    ).toBeVisible();
    await inventory(page, "Workspace linked");
    expect(
      await page
        .getByRole("link", { name: "Workspace linked asset", exact: true })
        .filter({ visible: true })
        .count(),
    ).toBe(1);
    await open(page, "Workspace linked asset");
    await expect(
      page.getByRole("tab", { name: "3D inspection" }),
    ).toBeVisible();
    await inventory(page, "Workspace standalone");
    await open(page, "Workspace standalone pump");
    await expect(
      page.getByRole("tab", { name: "AAS & submodels" }),
    ).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Saved views" })).toBeVisible();
  });
  test("retains filters, typed identity, reload, back/forward and legacy links", async ({
    page,
  }) => {
    await login(page);
    await inventory(page, "Workspace child");
    await page
      .getByLabel("Observed status", { exact: true })
      .selectOption("stale");
    await expect(
      page
        .getByRole("link", { name: "Workspace child A", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await open(page, "Workspace child A");
    const item = page.url();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Workspace child A", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Connectivity", exact: true }).click();
    await page.goBack();
    expect(page.url()).toBe(item);
    await page.goForward();
    await page.getByRole("link", { name: /Return to results/ }).click();
    await expect(
      page.getByLabel("Observed status", { exact: true }),
    ).toHaveValue("stale");
    await expect(
      page.getByLabel("Search inventory", { exact: true }),
    ).toHaveValue("Workspace child");
    await expect(
      page
        .getByRole("link", { name: "Workspace child A", exact: true })
        .filter({ visible: true }),
    ).toBeFocused();
    expect(
      new URLSearchParams(page.url().split("#")[1].split("?")[1]).get(
        "selected",
      ),
    ).toMatch(/^device:/);
    const row = (
      await call(page.request, "inventory.list", { search: "workspace-direct" })
    ).data.items[0];
    await page.goto(`/#/devices/${row.id}`);
    await expect(
      page.getByRole("heading", {
        name: "Workspace direct sensor",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto("/#/assets");
    await expect(page.getByRole("tab", { name: /^Assets \(/ })).toHaveAttribute(
      "data-state",
      "active",
    );
  });
  test("viewer sees capability sections while protected direct calls stay forbidden", async ({
    page,
  }) => {
    await login(page, "viewer");
    await inventory(page, "Workspace direct");
    await open(page, "Workspace direct sensor");
    await expect(page.getByRole("tab", { name: "Thresholds" })).toHaveCount(0);
    const denied = await call(
      page.request,
      "devices.create",
      {
        type: "sensor",
        route: "direct",
        deviceId: "denied-ui",
        name: "Denied UI",
      },
      false,
    );
    expect(denied.res.status()).toBe(403);
    await expect(page.getByRole("button", { name: "Add item" })).toHaveCount(0);
    await page.goto("/#/users");
    await expect(
      page.getByRole("heading", { name: "404", exact: true }),
    ).toBeVisible();
  });
  test("mode scope reaches summary, events and exports; source facts retain raw details", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/#/cybersecurity?mode=simulated");
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await expect(page.getByLabel("Filter evidence mode")).toHaveValue(
      "simulated",
    );
    await page.getByText("Demonstration / setup", { exact: true }).click();
    await page
      .getByRole("button", {
        name: "Load local security demonstration",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Authored simulation and replay evidence is ready.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open high findings" }).click();
    await expect(
      page.getByRole("tab", { name: "Findings", exact: true }),
    ).toHaveAttribute("data-state", "active");
    await expect(page.getByLabel("Filter evidence mode")).toHaveValue(
      "simulated",
    );
    await expect(page.getByLabel("Filter finding severity")).toHaveValue(
      "high",
    );
    await page.getByLabel("Filter finding severity").selectOption("medium");
    await page
      .getByRole("button", { name: /^Repeated rejected sign-ins/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Original normalized evidence",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Filter evidence mode").selectOption("replay");
    await expect(
      page.getByRole("heading", {
        name: "Original normalized evidence",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByLabel("Filter evidence mode").selectOption("simulated");
    await page.reload();
    await expect(page.getByLabel("Filter evidence mode")).toHaveValue(
      "simulated",
    );
    await page.getByRole("tab", { name: "Events", exact: true }).click();
    await expect(page.getByLabel("Filter evidence mode")).toHaveValue(
      "simulated",
    );
    const scoped = await call(page.request, "security.overview", {
      mode: "simulated",
    });
    expect(scoped.res.ok()).toBe(true);
    expect(scoped.data.activity.every((e: any) => e.mode === "simulated")).toBe(
      true,
    );
  });
  test("distinguishes a data-service failure from a valid empty inventory", async ({
    page,
  }) => {
    await login(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/api\/trpc\/.*inventory\.list/, async (route) => {
      await gate;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify([
          {
            error: {
              json: {
                message: "Isolated data-service failure",
                code: -32603,
                data: { code: "SERVICE_UNAVAILABLE", httpStatus: 503 },
              },
            },
          },
        ]),
      });
    });
    await page.goto("/#/inventory");
    await expect(
      page.getByText("Loading inventory…", { exact: true }),
    ).toBeVisible();
    release();
    await expect(
      page.getByText("Inventory unavailable", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No inventory items yet", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "docs/evidence/workspace-20261026/inventory-error.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.unroute(/\/api\/trpc\/.*inventory\.list/);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByText(/matching items · View filters/)).toBeVisible();
  });
  test("keeps item-specific 3D context across inspection, observations and saved-view sections", async ({
    page,
  }) => {
    await login(page);
    await inventory(page, "Workspace standalone");
    await open(page, "Workspace standalone pump");
    await page
      .getByRole("tab", { name: "Components / BOM", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Volute casing", exact: true })
      .click();
    await page.getByRole("tab", { name: "Observations", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Volute casing · observations",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("Observation component", { exact: true })
      .selectOption({ label: "Motor" });
    await expect(
      page.getByRole("heading", { name: "Motor · observations", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Saved views", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Local notes and selected component",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Observations", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Motor · observations", exact: true }),
    ).toBeVisible();
  });
  test("renders populated and empty inventory in both themes at 360, 390, tablet and desktop; mobile drawer restores focus", async ({
    page,
  }) => {
    await login(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    mkdirSync("docs/evidence/workspace-20261026", { recursive: true });
    for (const width of [360, 390, 768, 1440])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 960 });
        await inventory(page);
        const current = await page.locator("html").getAttribute("class");
        if ((current?.includes("dark") ? "dark" : "light") !== theme)
          await page
            .getByRole("button", { name: `Switch to ${theme} theme` })
            .click();
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBe(true);
        await expect(
          page
            .getByRole("link", { name: "Workspace direct sensor", exact: true })
            .filter({ visible: true }),
        ).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(
              () => getComputedStyle(document.documentElement).colorScheme,
            ),
          )
          .toBe(theme);
        await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
        // A toolbar can fit the viewport while squeezing a field to zero width.
        const searchBox = await page
          .getByRole("textbox", { name: "Search inventory" })
          .boundingBox();
        expect(searchBox?.width).toBeGreaterThanOrEqual(150);
        await page.screenshot({
          path: `docs/evidence/workspace-20261026/inventory-${theme}-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
      }
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Toggle navigation", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page
        .getByRole("button", { name: "Toggle navigation", exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeFocused();
    await inventory(page, "no-such-inventory");
    await expect(
      page.getByText("No matching items", { exact: true }),
    ).toBeVisible();
    for (const [width, theme] of [
      [390, "dark"],
      [1440, "light"],
    ] as const) {
      await page.setViewportSize({ width, height: 960 });
      if (
        (await page.locator("html").getAttribute("class"))?.includes("dark") !==
        (theme === "dark")
      )
        await page
          .getByRole("button", { name: `Switch to ${theme} theme` })
          .click();
      await inventory(page, "Workspace imported");
      await open(page, "Workspace imported asset");
      await page
        .getByRole("tab", { name: "AAS & submodels", exact: true })
        .click();
      await page
        .locator("summary")
        .getByText("VendorNameplate", { exact: true })
        .click();
      await expect(
        page.getByText("Isolated fixture manufacturer", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `docs/evidence/workspace-20261026/aas-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await page.goto("/#/cybersecurity");
      await page.getByText("Demonstration / setup", { exact: true }).click();
      await page
        .getByRole("button", {
          name: "Load local security demonstration",
          exact: true,
        })
        .click();
      await expect(
        page.getByText("Authored simulation and replay evidence is ready.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByLabel("Filter evidence mode").selectOption("simulated");
      await expect(
        page.getByRole("button", { name: "Open high findings" }),
      ).toBeVisible();
      await page.screenshot({
        path: `docs/evidence/workspace-20261026/security-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await inventory(page, "Workspace standalone");
      await open(page, "Workspace standalone pump");
      await page
        .getByRole("tab", { name: "3D inspection", exact: true })
        .click();
      await expect(page.locator("[data-state=ready]")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: `docs/evidence/workspace-20261026/equipment-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  });
});

import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import superjson from "superjson";
import {
  requiredCapabilities,
  runtimeContractVersion,
} from "../shared/runtime-contract";
import { demoInfrastructure } from "../server/infrastructure/demo";
import { demoNetwork } from "../server/network-diagnostics/demo";
import { canonicalUnits } from "../shared/measurements";
import type { InventoryItem } from "../shared/inventory";

// Browser contracts use clearly labelled synthetic records and the real UI.
// API authorization and record isolation are independently covered by the
// private/shared acceptance suites; these mocks cannot establish authorization.
async function workspaceFixture(
  page: Page,
  restricted = false,
  control: { floor: "normal" | "empty" | "error" } = { floor: "normal" },
) {
  let signedIn = true;
  const requests: { procedure: string; input: any }[] = [];
  await page.route("**/api/runtime/contract", (route) =>
    route.fulfill({
      json: {
        contractVersion: runtimeContractVersion,
        capabilities: requiredCapabilities,
        schema: { ready: true },
        versioned: true,
      },
    }),
  );
  await page.route("**/api/trpc/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const batch = url.searchParams.has("batch");
    const procedures = decodeURIComponent(
      url.pathname.split("/trpc/")[1],
    ).split(",");
    const inputs = JSON.parse(
      url.searchParams.get("input") ?? request.postData() ?? "{}",
    );
    const cookie = (await request.allHeaders()).cookie ?? "";
    const demo =
      restricted || /smart_factory_data_workspace=demo(?:;|$)/.test(cookie);
    const mode = demo ? "Demo" : "Live";
    const items: InventoryItem[] = Array.from({ length: 57 }, (_, index) => {
      const n = index + 1;
      const kind = n <= 5 ? "asset" : n === 17 ? "equipment" : "device";
      const id =
        kind === "equipment"
          ? "00000000-0000-4000-8000-000000000017"
          : String(n);
      return {
        ref: `${kind}:${id}`,
        kind,
        id,
        name: `${mode} system ${String(n).padStart(2, "0")}`,
        identifier: `${mode.toLowerCase()}-source-${n}`,
        itemType:
          n <= 5
            ? "pump"
            : n <= 12
              ? "gateway"
              : n === 17
                ? "3D equipment"
                : "sensor",
        location: "Synthetic factory",
        zone:
          n <= 20 ? "Assembly" : n <= 40 ? "Packaging" : "Process utilities",
        configured: n !== 16,
        isDemo: demo,
        route: n === 16 ? "Not configured" : "Linked devices",
        status: "unknown",
        lastObserved: null,
        sampleAt: null,
        mode: demo ? "simulated" : "live",
        quality: "unknown",
        freshnessMs: null,
        lifecycle: null,
        aas: kind === "asset",
        equipmentId:
          n <= 2 || n === 17
            ? `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
            : null,
        firmware: null,
      };
    });
    const groups = [
      { kind: "asset", itemType: "pump", equipment: true, count: 2 },
      { kind: "asset", itemType: "pump", equipment: false, count: 3 },
      { kind: "device", itemType: "gateway", equipment: false, count: 7 },
      { kind: "device", itemType: "sensor", equipment: false, count: 44 },
      {
        kind: "equipment",
        itemType: "3D equipment",
        equipment: true,
        count: 1,
      },
    ];
    const responses = procedures.map((procedure, index) => {
      const input = (batch ? inputs[String(index)]?.json : inputs.json) ?? {};
      requests.push({ procedure, input });
      if (procedure === "factory.floor" && control.floor === "error")
        return {
          error: superjson.serialize({
            message: "Isolated floor interruption",
            code: -32603,
            data: {
              code: "INTERNAL_SERVER_ERROR",
              httpStatus: 500,
              path: procedure,
            },
          }),
        };
      let value: unknown;
      switch (procedure) {
        case "auth.me":
          value = signedIn
            ? {
                id: 90001,
                name: restricted ? "Demo Engineer" : "Fixture engineer",
                email: restricted ? "tech@dev.local" : "engineer@example.test",
                role: "engineer",
                openId: restricted ? "demo-engineer" : "individual-engineer",
                access: {
                  demoOnly: demo,
                  canSwitchData: !restricted,
                  workspaceView: demo ? "demo" : "live",
                  canOperate: !demo,
                  canEngineer: !demo,
                  canAdminister: false,
                },
              }
            : null;
          break;
        case "auth.logout":
          signedIn = false;
          value = { success: true };
          break;
        case "auth.demoAccounts":
          value = [];
          break;
        case "auth.registrationPolicy":
          value = { enabled: true, requiresApproval: true };
          break;
        case "notifications.summary":
          value = { unread: 0 };
          break;
        case "system.infrastructure":
          value = demoInfrastructure();
          break;
        case "system.showcase":
          value = null;
          break;
        case "analytics.getOverview":
          value = {
            devices: {
              total: 51,
              online: 0,
              stale: 0,
              offline: 0,
              unknown: 51,
              maintenance: 0,
              error: 0,
            },
            alerts: {
              open: 0,
              critical: 0,
              warning: 0,
              info: 0,
              activeDowntime: 0,
            },
          };
          break;
        case "alerts.list":
          value = [];
          break;
        case "factories.list":
          value = [];
          break;
        case "factory.floor":
          value = {
            items: control.floor === "empty" ? [] : items,
            total: control.floor === "empty" ? 0 : items.length,
            groups: control.floor === "empty" ? [] : groups,
            links: [
              {
                from: "device:6",
                to: "asset:1",
                kind: "acquisition",
                label: "opcua",
              },
              {
                from: "device:6",
                to: "device:13",
                kind: "gateway",
                label: "Gateway uplink",
              },
            ],
            complete: true,
            sampledAt: new Date().toISOString(),
          };
          break;
        case "networkDiagnostics.overview":
          value = demo
            ? demoNetwork(input.scenario)
            : {
                synthetic: false,
                scenario: "operational",
                snapshots: [],
                importedAt: null,
                stale: false,
                provenance: "unavailable",
              };
          break;
        case "readings.trend": {
          const buckets = Array.from({ length: 30 }, (_, n) => ({
            timestamp: input.startTime + n * 60000,
            value: n === 8 ? null : 30 + Math.sin(n / 4) * 5,
            count: n === 8 ? 0 : 6,
          }));
          value = {
            scope: input.scope,
            metric: input.metric,
            unit: canonicalUnits[input.metric as keyof typeof canonicalUnits],
            startTime: input.startTime,
            endTime: input.endTime,
            intervalMs: 60000,
            total: 174,
            verified: 174,
            unverified: 0,
            statisticsComplete: true,
            truncated: false,
            summary: {
              min: 25,
              max: 35,
              average: 30,
              latest: 33,
              latestAt: input.endTime,
            },
            buckets,
          };
          break;
        }
        case "inventory.list": {
          const start = Number(input.page ?? 0) * Number(input.pageSize ?? 12);
          value = {
            items: items.slice(start, start + Number(input.pageSize ?? 12)),
            total: items.length,
            groups: [
              { kind: "asset", itemType: "pump", equipment: true, count: 2 },
              { kind: "asset", itemType: "pump", equipment: false, count: 3 },
              {
                kind: "device",
                itemType: "gateway",
                equipment: false,
                count: 7,
              },
              {
                kind: "device",
                itemType: "sensor",
                equipment: false,
                count: 4,
              },
              {
                kind: "equipment",
                itemType: "3D equipment",
                equipment: true,
                count: 1,
              },
            ],
          };
          break;
        }
        case "devices.monitor": {
          const gateways = items.filter((item) => item.itemType === "gateway");
          const pageSize = Number(input.pageSize ?? 6),
            current = Number(input.page ?? 0);
          value = {
            items: gateways
              .slice(current * pageSize, (current + 1) * pageSize)
              .map((item) => ({
                id: Number(item.id),
                name: item.name,
                observedStatus: "unknown",
                lastSeen: null,
              })),
            total: gateways.length,
            hasMore: (current + 1) * pageSize < gateways.length,
          };
          break;
        }
        case "devices.getConnectedAssets":
          value =
            Number(input.id) <= 10
              ? [
                  {
                    id: Number(input.id) - 5,
                    name: `${mode} system ${String(Number(input.id) - 5).padStart(2, "0")}`,
                    assetType: "pump",
                    protocol: "opcua",
                  },
                ]
              : [];
          break;
        case "devices.getConnectedDevices":
          value =
            Number(input.id) === 6
              ? [{ id: 13, name: `${mode} system 13`, type: "sensor" }]
              : [];
          break;
        default:
          throw new Error(`Unexpected fixture procedure: ${procedure}`);
      }
      return { result: { data: superjson.serialize(value) } };
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(batch ? responses : responses[0]),
    });
  });
  return requests;
}

for (const width of [390, 1440]) {
  test(`Overview graphics data modes: individual switches both ways and persists at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    const requests = await workspaceFixture(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      "/?equipment=00000000-0000-4000-8000-000000000001#/?source=asset%3A1",
    );
    const selector = page.getByRole("combobox", {
      name: "Data workspace",
      exact: true,
    });
    const floor = page.getByTestId("factory-floor");
    await expect(selector).toHaveValue("live");
    await expect(floor).toHaveAttribute("data-total-items", "57");
    await page
      .locator("summary")
      .filter({ hasText: /^Find an item/ })
      .click();
    const list = page.getByRole("list", {
      name: "Factory floor items",
      exact: true,
    });
    await expect(list.getByRole("listitem")).toHaveCount(57);
    await expect(list).toContainText("Live system 57");
    let navigations = 0;
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        navigations++;
    });
    await selector.selectOption("demo");
    await expect(selector).toHaveValue("demo");
    await expect(floor).toHaveAttribute("data-visible-items", "57");
    await page
      .locator("summary")
      .filter({ hasText: /^Find an item/ })
      .click();
    await expect(list).toContainText("Demo system 57");
    await expect(list).not.toContainText("Live system");
    expect(new URL(page.url()).search).toBe("");
    expect(new URL(page.url()).hash).toBe("#/");
    expect(navigations).toBe(1);
    await page.reload();
    await expect(selector).toHaveValue("demo");
    await expect(floor).toHaveAttribute("data-total-items", "57");
    navigations = 0;
    await selector.selectOption("live");
    await expect(selector).toHaveValue("live");
    await expect(floor).toHaveAttribute("data-total-items", "57");
    expect(navigations).toBe(1);
    expect(
      (await page.context().cookies()).find(
        (c) => c.name === "smart_factory_data_workspace",
      )?.value,
    ).toBe("live");
    await expect
      .poll(
        () => requests.filter((r) => r.procedure === "readings.trend").length,
      )
      .toBeGreaterThan(0);
    for (const request of requests.filter(
      (r) => r.procedure === "readings.trend",
    ))
      expect(request.input.assetIds).toHaveLength(6);
    expect(
      requests.filter((r) => /equipment\.(get|workspace)/.test(r.procedure)),
    ).toEqual([]);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`Overview graphics data modes: shared demo explains live access at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await workspaceFixture(page, true);
    await page.goto("/#/");
    const selector = page.getByRole("combobox", {
      name: "Data workspace",
      exact: true,
    });
    await expect(selector).toHaveValue("demo");
    await expect(selector.locator('option[value="live"]')).toBeDisabled();
    await expect(page.getByRole("note")).toContainText("individual account");
    await page
      .getByRole("button", { name: "About demo and live data", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Demo and live data",
      exact: true,
    });
    await expect(dialog).toContainText("Demo Engineer");
    await expect(dialog).toContainText(
      "This session is restricted to demonstration data.",
    );
    await expect(dialog).toContainText(
      "Use an individual account on this site to view live systems.",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "Sign out and switch account", exact: true })
      .click();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Register", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Request an account", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Enter your details for administrator approval.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Request approval", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    expect(
      (await page.context().cookies()).some(
        (c) => c.name === "smart_factory_data_workspace",
      ),
    ).toBe(false);
  });
}

test("Overview graphics renders all 57 items in 3D, preserves whole-factory scope after selection and supports the floor plan", async ({
  page,
}) => {
  const requests = await workspaceFixture(page);
  await page.route("**/api/equipment/reference/**", (route) =>
    route.fulfill({
      status: 503,
      body: "Reference unavailable in this proxy-rendering fixture",
    }),
  );
  await page.goto("/#/");
  const floor = page.getByTestId("factory-floor");
  await expect(floor).toHaveAttribute("data-visible-items", "57");
  const canvas = page.getByRole("img", {
    name: "Interactive 3D factory floor",
    exact: true,
  });
  await expect(canvas).toHaveAttribute("data-floor-node-count", "57");
  await expect(
    page.getByRole("status").filter({ hasText: "57 items on floor" }),
  ).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: /^Find an item/ })
    .click();
  const list = page.getByRole("list", {
    name: "Factory floor items",
    exact: true,
  });
  await expect(list.getByRole("listitem")).toHaveCount(57);
  await list
    .getByRole("button", { name: "Live system 57", exact: true })
    .click();
  await expect(page.getByLabel("Selected floor item")).toContainText(
    "Live system 57",
  );
  await expect(floor).toHaveAttribute("data-visible-items", "57");
  await expect(
    page.getByRole("link", { name: "Open item", exact: true }),
  ).toHaveAttribute("href", /#\/inventory\/device%3A57\/overview/);
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  const plan = page.getByRole("img", {
    name: "Accessible factory floor plan",
    exact: true,
  });
  await expect(plan.getByRole("button")).toHaveCount(57);
  await page
    .getByLabel("Factory floor zone", { exact: true })
    .selectOption("Packaging");
  await expect(floor).toHaveAttribute("data-visible-items", "20");
  await page
    .getByRole("button", { name: "Fit whole factory floor", exact: true })
    .click();
  await expect(floor).toHaveAttribute("data-visible-items", "57");
  await expect(
    page.getByRole("group", { name: "System item types", exact: true }),
  ).toContainText("57");
  await expect(
    page.getByRole("heading", { name: "Factory observations", exact: true }),
  ).toBeVisible();
  expect(
    requests.filter((r) => /devices\.getConnected/.test(r.procedure)),
  ).toEqual([]);
  mkdirSync("test-results/factory-overview", { recursive: true });
  await page.screenshot({
    path: join("test-results/factory-overview", "factory-complete-plan.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("Overview graphics FX and TSN scenarios show late timing, clock loss and recovery without machine mutations", async ({
  page,
}) => {
  const requests = await workspaceFixture(page, true);
  await page.goto("/#/network");
  await expect(
    page.getByRole("heading", { name: "FX & TSN", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "FX automation components", exact: true })
      .locator(":scope > li"),
  ).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Import snapshot", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("tab", { name: "Timing & diagnostics", exact: true })
    .click();
  await expect(
    page.getByRole("img", {
      name: "Reported clock offset in nanoseconds",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Network demonstration scenario", { exact: true })
    .selectOption("late-delivery");
  await expect(page.getByText("12", { exact: true })).toBeVisible();
  await page
    .getByLabel("Network demonstration scenario", { exact: true })
    .selectOption("clock-loss");
  await expect(page.getByText(/One-way latency unavailable/)).toBeVisible();
  await page
    .getByLabel("Network demonstration scenario", { exact: true })
    .selectOption("recovery");
  await expect(page.getByText(/One-way latency unavailable/)).toHaveCount(0);
  await expect(
    page.getByRole("img", {
      name: "Reported stream latency and jitter in microseconds",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    requests.filter((r) =>
      /importSnapshot|deploy|control|simulate/.test(r.procedure),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Overview graphics distinguishes an unavailable floor from empty inventory and recovers complete scope", async ({
  page,
}) => {
  const control: { floor: "normal" | "empty" | "error" } = { floor: "error" };
  await workspaceFixture(page, false, control);
  await page.goto("/#/");
  await expect(
    page.getByText("Factory floor unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No registered factory items", { exact: true }),
  ).toHaveCount(0);
  control.floor = "empty";
  await page
    .getByRole("button", { name: "Retry factory floor", exact: true })
    .click();
  await expect(
    page.getByText("No registered factory items", { exact: true }),
  ).toBeVisible();
  control.floor = "normal";
  await page
    .getByRole("button", { name: "Refresh overview", exact: true })
    .click();
  await expect(page.getByTestId("factory-floor")).toHaveAttribute(
    "data-visible-items",
    "57",
  );
});

test("Overview graphics retains the complete floor plan when WebGL is unavailable", async ({
  page,
}) => {
  await workspaceFixture(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      context: string,
      ...args: unknown[]
    ) {
      if (
        context === "webgl2" ||
        context === "webgl" ||
        context === "experimental-webgl"
      )
        return null;
      return original.call(this, context as "2d", ...args);
    } as typeof original;
  });
  await page.goto("/#/");
  await expect(page.getByTestId("factory-floor")).toHaveAttribute(
    "data-visible-items",
    "57",
  );
  await expect(
    page
      .getByRole("img", { name: "Accessible factory floor plan", exact: true })
      .getByRole("button"),
  ).toHaveCount(57);
  await expect(
    page.getByRole("heading", { name: "Factory observations", exact: true }),
  ).toBeVisible();
});

for (const width of [390, 1440])
  for (const theme of ["light", "dark"] as const)
    test(`Overview graphics recovers actual WebGL context loss at ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 960 });
      await page.emulateMedia({ colorScheme: theme });
      await workspaceFixture(page);
      await page.route("**/api/equipment/reference/**", (route) =>
        route.fulfill({ status: 503 }),
      );
      await page.goto("/#/");
      const canvas = page.getByRole("img", {
        name: "Interactive 3D factory floor",
        exact: true,
      });
      await expect(canvas).toHaveAttribute("data-floor-node-count", "57");
      await expect(
        page.getByRole("status").filter({ hasText: "57 items on floor" }),
      ).toBeVisible();
      await canvas.evaluate((node) => {
        const gl = (node as HTMLCanvasElement).getContext("webgl2");
        const extension = gl?.getExtension("WEBGL_lose_context");
        if (!extension)
          throw new Error(
            "The rendering fixture must support actual context-loss testing",
          );
        extension.loseContext();
      });
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "3D unavailable on this device" }),
      ).toBeVisible();
      const plan = page.getByRole("img", {
        name: "Accessible factory floor plan",
        exact: true,
      });
      await expect(plan.getByRole("button")).toHaveCount(57);
      const item = plan.getByRole("button", {
        name: "Select Live system 57",
        exact: true,
      });
      await expect(item).toHaveAttribute(
        "aria-description",
        "unknown · live evidence",
      );
      await item.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("Selected floor item")).toContainText(
        "Live system 57",
      );
      await expect(item).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("factory-floor")).toHaveAttribute(
        "data-visible-items",
        "57",
      );
      await expect(
        page.getByRole("link", { name: "Open item", exact: true }),
      ).toHaveAttribute("href", /#\/inventory\/device%3A57\/overview/);
      await expect(
        page.getByRole("heading", {
          name: "Factory observations",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByLabel("Factory floor zone", { exact: true })
        .selectOption("Packaging");
      await expect(page.getByTestId("factory-floor")).toHaveAttribute(
        "data-visible-items",
        "20",
      );
      await page
        .getByRole("button", { name: "Fit whole factory floor", exact: true })
        .click();
      await expect(plan.getByRole("button")).toHaveCount(57);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      mkdirSync("test-results/factory-overview", { recursive: true });
      await page.screenshot({
        path: join(
          "test-results/factory-overview",
          `context-loss-${width}-${theme}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    });

test("Overview design keeps factory, status and summaries in the desktop composition and restricts live infrastructure", async ({
  page,
}) => {
  const requests = await workspaceFixture(page);
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto("/#/");
  const floor = page.getByTestId("factory-floor");
  const status = page.getByRole("complementary", {
    name: "Factory status",
    exact: true,
  });
  await expect(floor).toHaveAttribute("data-visible-items", "57");
  await expect(
    status.getByRole("heading", { name: "Connection health", exact: true }),
  ).toBeVisible();
  const floorBounds = await floor.boundingBox(),
    statusBounds = await status.boundingBox();
  expect(floorBounds).not.toBeNull();
  expect(statusBounds!.x).toBeGreaterThan(floorBounds!.x + floorBounds!.width);
  await expect(
    page.getByRole("group", { name: "Source observation states", exact: true }),
  ).toContainText("51");
  await expect(
    page.getByText("Service evidence is available to administrators.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(
    requests.filter((r) => r.procedure === "system.infrastructure"),
  ).toHaveLength(0);
  await page
    .getByLabel("Overview time range", { exact: true })
    .selectOption("24h");
  await expect
    .poll(() =>
      requests
        .filter((r) => r.procedure === "readings.trend")
        .some((r) => r.input.endTime - r.input.startTime === 86400000),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Overview design shows explicitly simulated infrastructure and a truthful GPU fallback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      kind: string,
      ...args: any[]
    ) {
      return /webgl/i.test(kind)
        ? null
        : getContext.call(this, kind as any, ...args);
    } as typeof getContext;
  });
  await workspaceFixture(page, true);
  await page.goto("/#/");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "3D unavailable on this device" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Accessible factory floor plan",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Overview service health", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(4);
  await expect(
    page.getByText("Simulated infrastructure", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Theme settings, system", exact: true })
    .click();
  await page.getByRole("menuitemradio", { name: /Dark/ }).click();
  await expect(page.getByTestId("factory-overview-dashboard")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const width of [390, 1440]) {
  test(`Factory floor selects equipment directly by ${width < 768 ? "touch" : "mouse"} and reveals scoped details at ${width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height: 960 },
      hasTouch: width < 768,
      isMobile: width < 768,
      baseURL: "http://127.0.0.1:3185",
    });
    const page = await context.newPage();
    try {
      await workspaceFixture(page);
      await page.route("**/api/equipment/reference/**", (route) =>
        route.fulfill({ status: 503 }),
      );
      await page.goto("/#/");
      const canvas = page.getByRole("img", {
        name: "Interactive 3D factory floor",
        exact: true,
      });
      await expect(
        page.getByRole("status").filter({ hasText: "57 items on floor" }),
      ).toBeVisible();
      const details = page.getByLabel("Selected floor item", { exact: true });
      // Aim at a visible surface, not the old enlarged invisible hit volumes.
      // Re-enter between probes so hover rotation does not move the target while aiming.
      let pickedRef: string | undefined;
      if (width >= 768) {
        await canvas.scrollIntoViewIfNeeded();
        const bounds = (await canvas.boundingBox())!;
        const offsets = [
          0, -0.02, 0.02, -0.04, 0.04, -0.06, 0.06, -0.08, 0.08, -0.1, 0.1,
        ];
        outer: for (const dy of offsets) {
          for (const dx of offsets) {
            await page.mouse.move(bounds.x - 5, bounds.y - 5);
            const x = bounds.x + bounds.width * (0.5 + dx),
              y = bounds.y + bounds.height * (0.5 + dy);
            await page.mouse.move(x, y);
            const ref = await canvas.getAttribute("data-grab-target");
            if (ref && ref !== "floor") {
              pickedRef = ref;
              await page.mouse.click(x, y);
              break outer;
            }
          }
        }
        expect(
          pickedRef,
          "A visible rendered item must be directly selectable",
        ).toBeTruthy();
      } else {
        for (const y of [0.5, 0.4, 0.6, 0.3, 0.7]) {
          for (const x of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
            if (await details.count()) break;
            const bounds = (await canvas.boundingBox())!;
            await canvas.tap({
              position: { x: bounds.width * x, y: bounds.height * y },
            });
          }
          if (await details.count()) break;
        }
      }
      await expect(details).toBeVisible();
      const ref = new URLSearchParams(
        new URL(page.url()).hash.split("?")[1],
      ).get("source");
      expect(ref).toBeTruthy();
      if (pickedRef) expect(ref).toBe(pickedRef);
      const n = ref?.startsWith("equipment:") ? 17 : Number(ref?.split(":")[1]);
      await expect(details.getByRole("heading")).toHaveText(
        `Live system ${String(n).padStart(2, "0")}`,
      );
      await expect(details).toContainText(`live-source-${n}`);
      await expect(details).toContainText("unknown quality");
      await expect(details).toContainText("No scalar values in this sample");
      await expect(
        details.getByRole("link", { name: "Open item", exact: true }),
      ).toHaveAttribute(
        "href",
        new RegExp(encodeURIComponent(ref!) + "/overview"),
      );
      await expect(page.getByTestId("factory-floor")).toHaveAttribute(
        "data-visible-items",
        "57",
      );
      await page
        .getByLabel("Factory floor zone", { exact: true })
        .selectOption("Packaging");
      await expect(details).toHaveCount(0);
      await expect(
        page.getByLabel("Selected factory section", { exact: true }),
      ).toContainText("20 registered items");
      await expect(
        page.getByLabel("Selected factory section", { exact: true }),
      ).toContainText("unknown");
      await page
        .getByRole("button", { name: "Floor plan", exact: true })
        .click();
      await page
        .getByRole("img", {
          name: "Accessible factory floor plan",
          exact: true,
        })
        .getByRole("button", { name: "Select Live system 21", exact: true })
        .click();
      await expect(details.getByRole("heading")).toHaveText("Live system 21");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
}

for (const width of [375, 390, 430, 768, 1440]) {
  test(`Overview KPI cards fill their final row without an empty mobile cell at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await workspaceFixture(page);
    await page.goto("/#/");
    const cards = page.locator(".overview-kpi");
    await expect(cards).toHaveCount(5);
    const grid = await page.locator(".overview-kpis").boundingBox();
    const last = await cards.last().boundingBox();
    expect(grid).toBeTruthy();
    expect(last).toBeTruthy();
    if (width < 640) {
      expect(Math.abs(last!.width - grid!.width)).toBeLessThan(2);
      expect(Math.abs(last!.x - grid!.x)).toBeLessThan(2);
    } else {
      const first = await cards.first().boundingBox();
      expect(Math.abs(last!.width - first!.width)).toBeLessThan(2);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("Factory floor details follow registered connections and preserve the factory totals", async ({
  page,
}) => {
  await workspaceFixture(page);
  await page.goto("/#/");
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  await page
    .getByRole("img", { name: "Accessible factory floor plan", exact: true })
    .getByRole("button", { name: "Select Live system 06", exact: true })
    .click();
  const details = page.getByLabel("Selected floor item", { exact: true });
  await expect(details).toContainText("Connected items · 2");
  await details
    .getByRole("button", { name: "Live system 01", exact: true })
    .click();
  await expect(details.getByRole("heading")).toHaveText("Live system 01");
  await expect(details).toContainText("Connected items · 1");
  await expect(page.getByTestId("factory-floor")).toHaveAttribute(
    "data-visible-items",
    "57",
  );
});

test("direct overview grabs move equipment and its links without moving the view or changing totals", async ({
  page,
}) => {
  await workspaceFixture(page);
  await page.goto("/#/");
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  const plan = page.getByRole("img", {
    name: "Accessible factory floor plan",
    exact: true,
  });
  await plan.scrollIntoViewIfNeeded();
  const symbol = plan.locator('[data-floor-ref="asset:1"]');
  await symbol.hover();
  const geometry = symbol.locator(":scope > g[transform]").first();
  const initial = await geometry.getAttribute("transform"),
    view = await plan.getAttribute("viewBox");
  const connection = plan.locator("line").first(),
    endpoint = await connection.getAttribute("x2");
  const box = (await symbol.boundingBox())!,
    scroll = await page.evaluate(() => scrollY);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(symbol).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(
    box.x + box.width / 2 + 30,
    box.y + box.height / 2 + 15,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(geometry).not.toHaveAttribute("transform", initial!);
  await expect(connection).not.toHaveAttribute("x2", endpoint!);
  await expect(plan).toHaveAttribute("viewBox", view!);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await expect(page.getByTestId("factory-floor")).toHaveAttribute(
    "data-total-items",
    "57",
  );
  const moved = await geometry.getAttribute("transform");
  await page.reload();
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  await expect(
    page.locator('[data-floor-ref="asset:1"] > g[transform]').first(),
  ).toHaveAttribute("transform", moved!);
});

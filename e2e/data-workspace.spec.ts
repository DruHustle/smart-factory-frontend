import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import superjson from "superjson";
import {
  requiredCapabilities,
  runtimeContractVersion,
} from "../shared/runtime-contract";
import type { InventoryItem } from "../shared/inventory";

// Browser contracts use clearly labelled synthetic records and the real UI.
// API authorization and record isolation are independently covered by the
// private/shared acceptance suites; these mocks cannot establish authorization.
async function workspaceFixture(page: Page, restricted = false) {
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
    const items: InventoryItem[] = Array.from({ length: 17 }, (_, index) => {
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
        zone: "Assembly",
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
    const responses = procedures.map((procedure, index) => {
      const input = (batch ? inputs[String(index)]?.json : inputs.json) ?? {};
      requests.push({ procedure, input });
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
        case "notifications.summary":
          value = { unread: 0 };
          break;
        case "system.showcase":
          value = null;
          break;
        case "analytics.getOverview":
          value = {
            devices: {
              total: 11,
              online: 0,
              stale: 0,
              offline: 0,
              unknown: 11,
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
  test(`Overview graphics data modes: individual switches both ways and persists the scope at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    const requests = await workspaceFixture(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      "/?equipment=00000000-0000-4000-8000-000000000001#/?itemsPage=1",
    );
    const selector = page.getByRole("combobox", {
      name: "Data workspace",
      exact: true,
    });
    const list = page.getByRole("list", {
      name: "System inventory items",
      exact: true,
    });
    await expect(selector).toHaveValue("live");
    await expect(list.getByRole("listitem")).toHaveCount(5);
    await expect(list).toContainText("Live system 17");
    let navigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });
    await selector.selectOption("demo");
    await expect(selector).toHaveValue("demo");
    await expect(list.getByRole("listitem")).toHaveCount(12);
    await expect(list).toContainText("Demo system 01");
    await expect(list).not.toContainText("Live system");
    expect(new URL(page.url()).search).toBe("");
    expect(new URL(page.url()).hash).toBe("#/");
    expect(navigations).toBe(1);
    await page.reload();
    await expect(selector).toHaveValue("demo");
    await expect(list).toContainText("Demo system 01");
    navigations = 0;
    await selector.selectOption("live");
    await expect(selector).toHaveValue("live");
    await expect(list).toContainText("Live system 01");
    await expect(list).not.toContainText("Demo system");
    expect(navigations).toBe(1);
    expect(
      (await page.context().cookies()).find(
        (cookie) => cookie.name === "smart_factory_data_workspace",
      )?.value,
    ).toBe("live");
    expect(
      requests.filter(({ procedure }) =>
        /equipment\.|readings\.trend/.test(procedure),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`Overview graphics data modes: demo restriction explains live access and offers account switching at ${width}px`, async ({
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
    await expect(dialog).toContainText("operational installation");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "Sign out and switch account", exact: true })
      .click();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    expect(
      (await page.context().cookies()).some(
        (cookie) => cookie.name === "smart_factory_data_workspace",
      ),
    ).toBe(false);
  });
}

test("Overview graphics factory flow includes every gateway and independent item across pages", async ({
  page,
}) => {
  const requests = await workspaceFixture(page);
  await page.goto("/#/");
  const paths = page.getByRole("list", {
    name: "Factory gateway paths",
    exact: true,
  });
  // Assert the six gateway roots, rather than counting nested asset/device nodes.
  await expect(paths.locator(":scope > li")).toHaveCount(6);
  await expect(
    page.getByRole("list", {
      name: "Recorded links for Live system 06",
      exact: true,
    }),
  ).toContainText("Live system 01");
  await expect(
    page.getByRole("list", {
      name: "Recorded links for Live system 06",
      exact: true,
    }),
  ).toContainText("Live system 13");
  const distribution = page.getByRole("group", {
    name: "System item types",
    exact: true,
  });
  await expect(distribution).toContainText("17");
  await page
    .getByRole("button", { name: "Next gateways", exact: true })
    .click();
  await expect(paths.locator(":scope > li")).toHaveCount(1);
  await expect(paths).toContainText("Live system 12");
  await expect(
    page.getByRole("button", { name: "Next gateways", exact: true }),
  ).toBeDisabled();
  await expect(distribution).toContainText("17");
  await page.getByRole("button", { name: "Next items", exact: true }).click();
  const items = page.getByRole("list", {
    name: "System inventory items",
    exact: true,
  });
  await expect(items.getByRole("listitem")).toHaveCount(5);
  await expect(items).toContainText("Live system 16");
  await expect(items).toContainText("Not configured");
  await expect(items).toContainText("Live system 17");
  await page.reload();
  await expect(paths.locator(":scope > li")).toHaveCount(1);
  await expect(items.getByRole("listitem")).toHaveCount(5);
  expect(
    requests.filter(({ procedure }) =>
      /equipment\.|readings\.trend/.test(procedure),
    ),
  ).toEqual([]);
  mkdirSync("test-results/factory-overview", { recursive: true });
  await page
    .getByRole("button", { name: "Previous gateways", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Previous items", exact: true })
    .click();
  await expect(paths.locator(":scope > li")).toHaveCount(6);
  await page.screenshot({
    path: join("test-results/factory-overview", "factory-wide-overview.png"),
    fullPage: true,
    animations: "disabled",
  });
});

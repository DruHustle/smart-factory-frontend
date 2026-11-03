import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import superjson from "superjson";
import {
  requiredCapabilities,
  optionalCapabilities,
  runtimeContractVersion,
} from "../shared/runtime-contract";
import { demoInfrastructure } from "../server/infrastructure/demo";
import { demoNetwork } from "../server/network-diagnostics/demo";
import { demoOperations } from "../server/operations/demo";
import {
  analyseProduction,
  defaultOperationsConfiguration,
  resolveShift,
  type OperationsSummary,
} from "../shared/operations";
import { canonicalUnits } from "../shared/measurements";
import type { InventoryItem } from "../shared/inventory";

// Browser contracts use clearly labelled synthetic records and the real UI.
// API authorization and record isolation are independently covered by the
// private/shared acceptance suites; these mocks cannot establish authorization.
async function workspaceFixture(
  page: Page,
  restricted = false,
  control: {
    floor: "normal" | "empty" | "error";
    telemetry?: "unverified" | "verified";
    buttonCount?: number;
    wroverHealthy?: boolean;
    summary?: "populated" | "error";
    attention?: boolean;
    olderApi?: boolean;
    viewer?: boolean;
    actions?: boolean;
    actionsError?: boolean;
    incidentPage?: boolean;
  } = { floor: "normal" },
) {
  let signedIn = true;
  let siteTimezone = "UTC";
  const requests: { procedure: string; input: any }[] = [];
  await page.route("**/api/runtime/contract", (route) =>
    route.fulfill({
      json: {
        contractVersion: runtimeContractVersion,
        capabilities: control.olderApi
          ? requiredCapabilities
          : [...requiredCapabilities, ...optionalCapabilities],
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
      if (control.actionsError && procedure === "alerts.actionQueue")
        return {
          error: superjson.serialize({
            message: "Actions unavailable",
            code: -32603,
            data: {
              code: "INTERNAL_SERVER_ERROR",
              httpStatus: 500,
              path: procedure,
            },
          }),
        };
      if (
        control.summary === "error" &&
        ["analytics.getOverview", "notifications.summary"].includes(procedure)
      )
        return {
          error: superjson.serialize({
            message: "Summary unavailable",
            code: -32603,
            data: {
              code: "INTERNAL_SERVER_ERROR",
              httpStatus: 500,
              path: procedure,
            },
          }),
        };
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
                role: control.viewer ? "viewer" : "engineer",
                openId: restricted ? "demo-engineer" : "individual-engineer",
                access: {
                  demoOnly: demo,
                  canSwitchData: !restricted,
                  workspaceView: demo ? "demo" : "live",
                  canOperate: !demo && !control.viewer,
                  canEngineer: !demo && !control.viewer,
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
          value = { unread: control.summary === "populated" ? 3 : 0 };
          break;
        case "notifications.page":
          value = {
            items: [],
            total: 0,
            page: 0,
            returned: 0,
            hasMore: false,
            truncated: false,
            summary: { unread: 3, attention: 0, accepted: 0, available: 3 },
          };
          break;
        case "security.availability":
          value = { enabled: false };
          break;
        case "assets.getConnections":
        case "connectivity.assetTags":
          value = [];
          break;
        case "inventory.item": {
          if (input.ref === "asset:1") {
            value = { ...items[0], status: "offline", equipmentId: null };
            break;
          }
          const gateway = input.ref === "device:6";
          value = {
            ref: input.ref,
            kind: "device",
            id: gateway ? "6" : "13",
            name: gateway ? "Pi gateway" : "WROVER sensor",
            identifier: gateway ? "pi-edge-01" : "esp32-wrover-01",
            itemType: gateway ? "gateway" : "edge_device",
            location: "Bench",
            zone: "Bench",
            configured: true,
            isDemo: demo,
            route: gateway ? "Gateway uplink" : "Via gateway: pi-edge-01",
            status: "unknown",
            lastObserved: null,
            sampleAt: gateway ? null : Date.now(),
            mode: "unknown",
            quality: "unknown",
            freshnessMs: null,
            lifecycle: null,
            aas: false,
            equipmentId: null,
            firmware: null,
            values: gateway ? {} : { temperature: 20.7 },
            measurements: gateway
              ? {}
              : {
                  temperature: {
                    sourceValue: 20.7,
                    sourceUnit: null,
                    canonicalValue: null,
                    canonicalUnit: null,
                    conversionVersion: null,
                    quality: "unknown",
                  },
                },
            evidence: gateway
              ? null
              : { eligible: false, reason: "not_commissioned" },
          };
          break;
        }
        case "devices.getById":
          value = {
            id: Number(input.id),
            deviceId: Number(input.id) === 6 ? "pi-edge-01" : "esp32-wrover-01",
            name: Number(input.id) === 6 ? "Pi gateway" : "WROVER sensor",
            type: Number(input.id) === 6 ? "gateway" : "edge_device",
            status: control.wroverHealthy ? "online" : "offline",
            observedStatus: control.wroverHealthy ? "live" : "unknown",
            isDemo: demo,
            metadata: { gatewayId: "pi-edge-01" },
            lastSeen: null,
          };
          break;
        case "devices.heartbeatHistory":
          value = {
            items: [
              {
                receivedAt: new Date(),
                eligible: false,
                reason: "route_not_commissioned",
              },
            ],
            returned: 1,
            hasMore: false,
            detailLimit: 100,
          };
          break;
        case "assets.getAllForDevice":
        case "readings.getForDevice":
        case "thresholds.getForDevice":
          value = [];
          break;
        case "readings.getLatest":
          value =
            !demo && control.wroverHealthy && input.scope === undefined
              ? {
                  deviceId: 13, timestamp: Date.now(), createdAt: new Date(),
                  assetSignals: { buttonPressed: 0, buttonPressCount: 31 },
                  integration: { mode: "live", acquisition: { sensorStatus: "ok" } },
                }
            : !demo && input.scope === "unknown" && control.telemetry
              ? {
                  deviceId: 13,
                  timestamp: Date.now(),
                  createdAt: new Date(),
                  temperature: 20.7,
                  assetSignals: control.buttonCount === undefined ? undefined : { buttonPressed: 0, buttonPressCount: control.buttonCount },
                  measurements: {
                    temperature: {
                      sourceValue: 20.7,
                      sourceUnit: null,
                      canonicalValue: null,
                      canonicalUnit: null,
                      conversionVersion: null,
                      quality: "unknown",
                    },
                  },
                  integration: {
                    mode: "unknown",
                    evidence: { eligible: false, reason: "not_commissioned" },
                  },
                }
              : null;
          break;
        case "export.deviceReport":
          value = {
            html: "<!doctype html><html><body><h1>Device report fixture</h1><p>Operational observations</p></body></html>",
            filename: "device-report.html",
          };
          break;
        case "devices.pulseIndicator":
          value = { published: true, commandId: "test-command", physicalStateConfirmed: false };
          break;
        case "system.infrastructure":
          value = demoInfrastructure();
          break;
        case "system.showcase":
          value = null;
          break;
        case "operations.summary": {
          if (demo) {
            value = demoOperations(
              input.scenario ?? "healthy",
              null,
              input.startTime != null && input.endTime != null
                ? { startTime: input.startTime, endTime: input.endTime }
                : undefined,
            );
            break;
          }
          const fixtureAt = Date.parse("2026-10-31T12:00:00Z");
          const configuration = {
            ...defaultOperationsConfiguration,
            boundaryLabel: "Synthetic fixture installation",
            timeZone: siteTimezone,
          };
          const shift = resolveShift(configuration, input.at ?? fixtureAt);
          const startTime = input.startTime ?? shift.startTime;
          const endTime = input.endTime ?? Math.min(shift.endTime, fixtureAt);
          value = {
            scope: {
              id: input.factoryId ?? "installation",
              label: "Synthetic fixture installation",
            },
            configured: false,
            configuration,
            version: 0,
            demo: false,
            shift,
            analysis: analyseProduction(
              [],
              startTime,
              endTime,
              configuration.boundaryLabel,
            ),
            records: [],
            notes: [],
            notesHasMore: false,
            outstanding: [],
            evidence: null,
          } satisfies OperationsSummary;
          break;
        }
        case "operations.setTimeZone":
          siteTimezone = input.timeZone;
          value = { version: 0 };
          break;
        case "analytics.getOverview":
          value = {
            devices: {
              total: 51,
              online: control.summary === "populated" ? 7 : 0,
              stale: control.summary === "populated" ? 2 : 0,
              offline: control.summary === "populated" ? 4 : 0,
              unknown: control.summary === "populated" ? 36 : 51,
              maintenance: control.summary === "populated" ? 1 : 0,
              error: control.summary === "populated" ? 1 : 0,
            },
            alerts: {
              open: control.summary === "populated" ? 5 : 0,
              critical: 0,
              warning: 0,
              info: 0,
              activeDowntime: 0,
            },
          };
          break;
        case "alerts.page":
          value = {
            items: control.incidentPage ? [{
              id: 1, message: "First-page incident", severity: "warning",
              status: "active", currentCondition: "unknown", acknowledged: false,
              createdAt: new Date("2026-10-31T12:00:00Z"), deviceName: "Fixture source",
            }] : [],
            total: control.incidentPage ? 26 : 0,
            returned: control.incidentPage ? 1 : 0,
            hasMore: !!control.incidentPage,
            summary: { total: control.incidentPage ? 26 : 0, critical: 0, warning: 1, info: 0, resolved: 0 },
          };
          break;
        case "alerts.list":
          value = control.attention
            ? [
                {
                  id: 42,
                  message: "Pressure below configured threshold",
                  severity: "critical",
                  createdAt: new Date("2026-10-31T12:00:00Z"),
                  deviceName: "Compressor pressure sensor",
                  assignedToName: "Operator",
                  assignedToId: 12,
                  status: "acknowledged",
                },
              ]
            : [];
          break;
        case "alerts.actionQueue":
          value = {
            items: control.actions
              ? input.page === 0
                ? [
                    {
                      id: 3,
                      incidentId: 42,
                      title: "Inspect compressor",
                      ownerId: 12,
                      ownerName: "Operator",
                      dueDate: "2026-12-10",
                      status: "open",
                      deviceName: "Compressor pressure sensor",
                    },
                    {
                      id: 4,
                      incidentId: 42,
                      title: "Inspect pump",
                      ownerId: 12,
                      ownerName: "Operator",
                      dueDate: null,
                      status: "open",
                      deviceName: "Pump",
                    },
                    {
                      id: 5,
                      incidentId: 42,
                      title: "Inspect motor",
                      ownerId: 12,
                      ownerName: "Operator",
                      dueDate: null,
                      status: "open",
                      deviceName: "Motor",
                    },
                  ]
                : [
                    {
                      id: 6,
                      incidentId: 43,
                      title: "Inspect conveyor",
                      ownerId: 12,
                      ownerName: "Operator",
                      dueDate: null,
                      status: "open",
                      deviceName: "Conveyor",
                    },
                  ]
              : [],
            hasMore: !!control.actions && input.page === 0,
          };
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
          if (control.telemetry) {
            value = {
              items: [
                {
                  id: 13,
                  name: demo ? "Demo sensor" : "WROVER sensor",
                  deviceId: demo ? "demo-sensor" : "esp32-wrover-01",
                  type: "edge_device",
                  observedStatus: "unknown",
                  status: "offline",
                  location: "Bench",
                  metadata: { gatewayId: "pi-edge-01" },
                },
              ],
              total: 1,
              hasMore: false,
            };
            break;
          }
          const gateways = items.filter((item) => item.itemType === "gateway");
          const pageSize = Number(input.pageSize ?? 6),
            current = Number(input.page ?? 0);
          value = {
            items: gateways
              .slice(current * pageSize, (current + 1) * pageSize)
              .map((item) => ({
                id: Number(item.id),
                name: item.name,
                deviceId: item.identifier,
                type: "gateway",
                isDemo: demo,
                status: "offline",
                observedStatus: "unknown",
                lastSeen: null,
              })),
            total: gateways.length,
            hasMore: (current + 1) * pageSize < gateways.length,
          };
          break;
        }
        case "readings.getLatestBatch": {
          const isUnknown = input.scope === "unknown";
          const hasReading =
            !demo &&
            control.telemetry &&
            (isUnknown ||
              (control.telemetry === "verified" &&
                input.scope === "operational"));
          value = hasReading
            ? [
                {
                  deviceId: 13,
                  timestamp: Date.now(),
                  createdAt: new Date(),
                  temperature: isUnknown ? 20.7 : 22,
                  humidity: 44,
                  measurements: {
                    temperature: {
                      sourceValue: isUnknown ? 20.7 : 22,
                      sourceUnit: null,
                      canonicalValue: null,
                      canonicalUnit: null,
                      conversionVersion: null,
                      quality: "unknown",
                    },
                  },
                  integration: {
                    mode: isUnknown ? "unknown" : "live",
                    evidence: {
                      eligible: !isUnknown,
                      reason: isUnknown ? "not_commissioned" : null,
                      validForMs: 120000,
                    },
                  },
                },
              ]
            : [];
          break;
        }
        case "devices.getConnectedAssets":
          value = control.telemetry
            ? []
            : Number(input.id) <= 10
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
          value = control.telemetry
            ? []
            : Number(input.id) === 6
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

test("engineers can change the shared factory timezone without commissioning shifts", async ({ page }) => {
  const requests = await workspaceFixture(page);
  await page.goto("/#/");
  const panel = page.getByTestId("ot-operations");
  await panel.getByRole("button", { name: "Change factory timezone, current UTC" }).click();
  const dialog = page.getByRole("dialog", { name: "Factory timezone" });
  await expect(dialog).toContainText("changes shift boundaries");
  const field = dialog.getByLabel("Site timezone");
  await field.fill("Not/A_Timezone");
  await dialog.getByRole("button", { name: "Save timezone" }).click();
  await expect(dialog.getByRole("alert")).toContainText("valid IANA timezone");
  await field.fill("Europe/Berlin");
  await dialog.getByRole("button", { name: "Save timezone" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole("button", { name: "Change factory timezone, current Europe/Berlin" })).toBeVisible();
  await expect(panel).toContainText("Production boundary and shifts are not configured.");
  const chart = page.getByRole("region", { name: "Factory observations" });
  await expect(chart.locator(".overview-trend-plot")).toContainText("Europe/Berlin");
  await chart.getByText("Accessible bucket table").click();
  await expect(chart.getByRole("columnheader", { name: "Time (Europe/Berlin)" })).toBeVisible();
  expect(requests.filter((request) => request.procedure === "operations.setTimeZone")).toHaveLength(1);
  expect(requests.find((request) => request.procedure === "operations.setTimeZone")?.input).toMatchObject({ expectedVersion: 0, expectedTimeZone: "UTC", timeZone: "Europe/Berlin" });
  await page.setViewportSize({ width: 320, height: 900 });
  await panel.getByRole("button", { name: "Change factory timezone, current Europe/Berlin" }).click();
  await dialog.getByLabel("Site timezone").fill("America/Argentina/Buenos_Aires");
  await dialog.getByRole("button", { name: "Save timezone" }).click();
  const longZone = panel.getByRole("button", { name: "Change factory timezone, current America/Argentina/Buenos_Aires" });
  await expect(longZone).toBeVisible();
  const box = await longZone.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Data workspace stays consistent across two open tabs in both directions", async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  const requests = await workspaceFixture(page);
  const otherRequests = await workspaceFixture(other);
  const errors: string[] = [];
  for (const tab of [page, other])
    tab.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/monitoring?selected=6");
  await other.goto("/#/");
  const selector = (tab: Page) =>
    tab.getByRole("combobox", { name: "Data workspace", exact: true });
  await expect(selector(page)).toHaveValue("live");
  await expect(
    page.getByText("Live system 06", { exact: true }).first(),
  ).toBeVisible();
  await expect(selector(other)).toHaveValue("live");

  let reconciliations = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      reconciliations++;
  });
  await selector(other).selectOption("demo");
  await expect(selector(page)).toHaveValue("demo");
  await expect(selector(other)).toHaveValue("demo");
  expect(new URL(page.url()).hash).toBe("#/");
  expect(reconciliations).toBe(1);

  // Reopen the same workspace that exhibited the production defect. The old
  // Live rows and selected source must not survive its cache/auth reset.
  await page.goto("/#/monitoring");
  await expect(
    page.getByText("Demo system 06", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Live system 06", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Refresh monitoring", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Refresh monitoring", exact: true })
    .click();
  await expect(selector(page)).toHaveValue("demo");
  await expect(
    page.getByText("Demo system 06", { exact: true }).first(),
  ).toBeVisible();

  reconciliations = 0;
  await selector(other).selectOption("live");
  await expect(selector(page)).toHaveValue("live");
  await expect(selector(other)).toHaveValue("live");
  expect(new URL(page.url()).hash).toBe("#/");
  expect(reconciliations).toBe(1);
  await page.goto("/#/monitoring");
  await expect(
    page.getByText("Live system 06", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Demo system 06", { exact: true })).toHaveCount(
    0,
  );
  expect(
    requests.filter((request) => request.procedure === "auth.me").length,
  ).toBeGreaterThanOrEqual(3);
  expect(
    otherRequests.filter((request) => request.procedure === "auth.me").length,
  ).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});

test("Data workspace request guard reconciles a tab that missed notifications and focus", async ({
  page,
  context,
}) => {
  // Model a suspended/restricted tab that did not receive either notification
  // mechanism or a focus callback. Its next real UI query must detect the
  // cookie change without relying on any of those events.
  await page.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", {
      value: undefined,
      configurable: true,
    });
    const addWindowListener = window.addEventListener.bind(window);
    window.addEventListener = ((type: string, ...args: any[]) => {
      if (["storage", "focus", "pageshow"].includes(type)) return;
      (addWindowListener as any)(type, ...args);
    }) as typeof window.addEventListener;
    const addDocumentListener = document.addEventListener.bind(document);
    document.addEventListener = ((type: string, ...args: any[]) => {
      if (type === "visibilitychange") return;
      (addDocumentListener as any)(type, ...args);
    }) as typeof document.addEventListener;
  });
  const other = await context.newPage();
  const requests = await workspaceFixture(page);
  await workspaceFixture(other);
  await page.goto("/#/monitoring");
  const selector = page.getByRole("combobox", {
    name: "Data workspace",
    exact: true,
  });
  await expect(selector).toHaveValue("live");
  await expect(
    page.getByText("Live system 06", { exact: true }).first(),
  ).toBeVisible();
  // Avoid the 30-second poll racing this deliberate missed-event fixture.
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await other.goto("/#/");
  await other
    .getByRole("combobox", { name: "Data workspace", exact: true })
    .selectOption("demo");
  await expect(
    other.getByRole("combobox", { name: "Data workspace", exact: true }),
  ).toHaveValue("demo");
  await expect(selector).toHaveValue("live");
  const previousReads = requests.filter(
    (request) => request.procedure === "devices.monitor",
  ).length;

  await page
    .getByRole("button", { name: "Refresh monitoring", exact: true })
    .click();
  await expect(selector).toHaveValue("demo");
  expect(new URL(page.url()).hash).toBe("#/");
  // The stale Monitoring document must not send another inventory request in
  // the new cookie scope. The replacement document starts at Overview.
  expect(
    requests.filter((request) => request.procedure === "devices.monitor"),
  ).toHaveLength(previousReads);
  await page.goto("/#/monitoring");
  await expect(
    page.getByText("Demo system 06", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Live system 06", { exact: true })).toHaveCount(
    0,
  );
});

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
    await expect(selector).toHaveAttribute(
      "title",
      "Live data requires an approved individual account",
    );
    await expect(
      page.getByText("Demo factory · simulated", { exact: true }),
    ).toHaveCount(0);
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
      page.getByRole("heading", { name: "Choose a role", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Engineer", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Request an account", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Need personal access? Register for administrator approval.",
        { exact: true },
      ),
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
  ).toHaveCount(1);
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
      ).toHaveCount(1);
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
    status.getByRole("heading", { name: "Needs attention", exact: true }),
  ).toBeVisible();
  const floorBounds = await floor.boundingBox(),
    floorPanelBounds = await page
      .locator(".overview-main-grid > div")
      .boundingBox(),
    statusBounds = await status.boundingBox();
  expect(floorBounds).not.toBeNull();
  expect(floorPanelBounds).not.toBeNull();
  expect(floorBounds!.width).toBeGreaterThan(700);
  expect(statusBounds!.x).toBeGreaterThanOrEqual(
    floorBounds!.x + floorBounds!.width,
  );
  expect(Math.abs(statusBounds!.y - floorPanelBounds!.y)).toBeLessThan(2);
  await expect(
    page.locator(".overview-kpis").getByRole("link", { name: /Needs review/ }),
  ).toBeVisible();
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
      ).toHaveCount(1);
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

for (const width of [320, 360, 375, 390, 430, 768, 1440]) {
  test(`Overview keeps compact controls and complete KPI rows at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await workspaceFixture(page);
    await page.goto("/#/");
    const cards = page.locator(".overview-kpi");
    await expect(cards).toHaveCount(6);
    const grid = await page.locator(".overview-kpis").boundingBox();
    const last = await cards.last().boundingBox();
    expect(grid).toBeTruthy();
    expect(last).toBeTruthy();
    const first = await cards.first().boundingBox();
    expect(Math.abs(last!.width - first!.width)).toBeLessThan(2);
    expect(
      Math.abs(last!.x + last!.width - grid!.x - grid!.width),
    ).toBeLessThan(2);
    const cardRows = await cards.evaluateAll((elements) => [
      ...new Set(
        elements.map((element) =>
          Math.round(element.getBoundingClientRect().y),
        ),
      ),
    ]);
    expect(cardRows).toHaveLength(width < 360 ? 3 : width < 1280 ? 2 : 1);
    if (width >= 360 && width < 768)
      expect(grid!.height).toBeLessThanOrEqual(184);
    expect(
      await cards.evaluateAll((elements) =>
        elements.every((element) => element.scrollWidth <= element.clientWidth),
      ),
    ).toBe(true);
    if (width < 768) {
      const controls = [
        page.getByLabel("Active factory", { exact: true }),
        page.getByLabel("Overview time range", { exact: true }),
        page.getByRole("button", { name: "Refresh overview", exact: true }),
      ];
      const boxes = await Promise.all(
        controls.map((control) => control.boundingBox()),
      );
      for (const box of boxes) {
        expect(box).toBeTruthy();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(Math.abs(box!.y - boxes[0]!.y)).toBeLessThan(2);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      for (const select of controls.slice(0, 2)) {
        expect(
          await select.evaluate(
            (element) => getComputedStyle(element).fontSize,
          ),
        ).toBe("16px");
      }
      const emptyAttention = page.locator(".overview-attention-empty");
      await expect(emptyAttention).toContainText("No open process incidents.");
      expect((await emptyAttention.boundingBox())!.height).toBeLessThanOrEqual(
        100,
      );
      expect(
        (await emptyAttention
          .getByRole("link", { name: "View alerts" })
          .boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
      const operations = page.getByTestId("ot-operations");
      const timezoneButton = operations.getByRole("button", { name: "Change factory timezone, current UTC" });
      const timezoneBox = await timezoneButton.boundingBox();
      expect(timezoneBox).toBeTruthy();
      expect(timezoneBox!.height).toBeGreaterThanOrEqual(44);
      expect(timezoneBox!.width).toBeGreaterThanOrEqual(44);
      expect(timezoneBox!.x + timezoneBox!.width).toBeLessThanOrEqual(width);
      const metrics = operations.locator(".operations-metrics > button");
      await expect(metrics).toHaveCount(4);
      const metricRows = await metrics.evaluateAll((elements) => [
        ...new Set(
          elements.map((element) =>
            Math.round(element.getBoundingClientRect().y),
          ),
        ),
      ]);
      expect(metricRows).toHaveLength(width < 360 ? 4 : 2);
      await expect(operations).toContainText(
        "Production boundary and shifts are not configured.",
      );
      const setupDetails = operations.locator("details").filter({
        has: page.locator("summary", { hasText: "Setup details" }),
      });
      await expect(setupDetails).not.toHaveAttribute("open");
      await setupDetails.locator("summary").focus();
      await setupDetails.locator("summary").press("Enter");
      await expect(setupDetails).toContainText("Shift defaults are provisional.");
      await expect(setupDetails).toHaveAttribute("open", "");
      const configure = operations.getByRole("button", {
        name: "Configure operations",
        exact: true,
      });
      expect((await configure.boundingBox())!.height).toBeGreaterThanOrEqual(
        44,
      );
      await configure.click();
      await expect(
        operations.getByRole("button", { name: "Settings", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    if (width === 390) {
      const actions = page.getByRole("button", {
        name: "Factory actions",
        exact: true,
      });
      await actions.focus();
      await actions.press("Enter");
      await page
        .getByRole("menuitem", { name: "Create factory", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Create a factory",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByLabel("Factory name", { exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(actions).toBeFocused();
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

test("Monitoring shows a received unverified sample without asserting live status", async ({
  page,
}) => {
  const requests = await workspaceFixture(page, false, {
    floor: "normal",
    telemetry: "unverified",
  });
  await page.goto("/#/monitoring");
  const row = page.locator("article").filter({ hasText: "WROVER sensor" });
  await expect(row).toContainText("20.7");
  await expect(row).toContainText("unit unverified");
  await expect(row).toContainText(
    "Unverified reading · not used for live status",
  );
  await expect(row).toContainText("unknown");
  await expect(row).not.toContainText("Receiving");
  await expect
    .poll(() =>
      requests.some(
        (r) =>
          r.procedure === "readings.getLatestBatch" &&
          r.input.scope === "unknown",
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("Evidence scope").selectOption("unknown");
  await expect(row).toContainText(
    "Unverified reading · not used for live status",
  );
});

test("Monitoring keeps operational readings ahead of unverified samples", async ({
  page,
}) => {
  const requests = await workspaceFixture(page, false, {
    floor: "normal",
    telemetry: "verified",
  });
  await page.goto("/#/monitoring");
  const row = page.locator("article").filter({ hasText: "WROVER sensor" });
  await expect(row).toContainText("22");
  await expect(row).not.toContainText("Unverified reading");
  expect(
    requests.filter(
      (r) =>
        r.procedure === "readings.getLatestBatch" &&
        r.input.scope === "unknown",
    ),
  ).toHaveLength(0);
});

test("Demo monitoring never requests private unverified observations", async ({
  page,
}) => {
  const requests = await workspaceFixture(page, true, {
    floor: "normal",
    telemetry: "unverified",
  });
  await page.goto("/#/monitoring");
  const row = page.locator("article").filter({ hasText: "Demo sensor" });
  await expect(row).toContainText("No observations in this evidence scope");
  await expect(row).not.toContainText("20.7");
  expect(
    requests.filter(
      (r) =>
        r.procedure === "readings.getLatestBatch" &&
        r.input.scope === "unknown",
    ),
  ).toHaveLength(0);
});

test("WROVER details show received unverified data instead of a false offline claim", async ({
  page,
}) => {
  await workspaceFixture(page, false, {
    floor: "normal",
    telemetry: "unverified",
  });
  await page.goto("/#/devices/13");
  await expect(
    page.getByRole("heading", { name: "WROVER sensor" }),
  ).toBeVisible();
  await expect(
    page.getByText("Unverified reading · not used for live status"),
  ).toBeVisible();
  await expect(page.getByText("20.7", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("WROVER offline", { exact: true })).toHaveCount(
    0,
  );
});

test("Gateway details show an unverified received heartbeat", async ({
  page,
}) => {
  await workspaceFixture(page, false, {
    floor: "normal",
    telemetry: "unverified",
  });
  await page.goto("/#/devices/6");
  await expect(
    page.getByText("Gateway heartbeat", { exact: true }).locator(".."),
  ).toContainText("unverified");
});

test("WROVER connectivity does not call unknown status offline", async ({
  page,
}) => {
  await workspaceFixture(page, false, {
    floor: "normal",
    telemetry: "unverified",
  });
  await page.goto("/#/inventory/device%3A13/connectivity");
  await expect(page.getByText("WROVER status unverified")).toBeVisible();
  await expect(page.getByText("WROVER offline", { exact: true })).toHaveCount(
    0,
  );
});

test("an incident selected outside the current page never opens the first row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests = await workspaceFixture(page, false, { floor: "normal", incidentPage: true });
  await page.goto("/#/alerts?selected=999");
  await expect(page.getByText("First-page incident")).toBeVisible();
  await expect(page.getByText("Selected incident is not on this page")).toBeVisible();
  await expect(page.getByLabel("Incident investigation")).toHaveCount(0);
  expect(requests.filter((request) => request.procedure === "alerts.getById")).toEqual([]);
});

test("WROVER telemetry shows unverified source values outside verified trends", async ({
  page,
}) => {
  await workspaceFixture(page, false, {
    floor: "normal",
    telemetry: "unverified",
  });
  await page.goto("/#/inventory/device%3A13/telemetry");
  const sample = page
    .locator("section")
    .filter({ hasText: "Unverified reading · not used for live status" });
  await expect(sample).toContainText("20.7");
  await expect(sample).toContainText("unit unverified");
  await expect(sample).toContainText("Sample reported");
  await page.getByLabel("Evidence scope").selectOption("simulated");
  await expect(sample).toHaveCount(0);
  await page.getByLabel("Evidence scope").selectOption("unknown");
  await expect(sample).toContainText("20.7");
});

test("WROVER button count updates from unverified diagnostics without enabling control", async ({
  page,
}) => {
  const fixture = {
    floor: "normal" as const,
    telemetry: "unverified" as const,
    buttonCount: 31,
  };
  await workspaceFixture(page, false, fixture);
  await page.goto("/#/inventory/device%3A13/telemetry");
  await expect(
    page.getByText("Button signal · unverified source · 31 presses"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pulse GPIO18" }),
  ).toBeDisabled();
  fixture.buttonCount = 32;
  await expect(
    page.getByText("Button signal · unverified source · 32 presses"),
  ).toBeVisible({ timeout: 10000 });
});

test("device workspace opens its operational report for the last 24 hours", async ({
  page,
}) => {
  const requests = await workspaceFixture(page, false, {
    floor: "normal",
    telemetry: "unverified",
  });
  await page.goto("/#/inventory/device%3A13/telemetry");
  await page.getByRole("button", { name: "Export operational 24h" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Export as PDF" }).click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("heading", { name: "Device report fixture" }),
  ).toBeVisible();
  await expect(
    popup.getByRole("button", { name: "Print / save as PDF" }),
  ).toBeVisible();
  const report = requests.find(
    (request) => request.procedure === "export.deviceReport",
  );
  expect(report?.input).toMatchObject({ deviceId: 13, scope: "operational" });
  expect(report.input.endTime - report.input.startTime).toBe(
    24 * 60 * 60 * 1000,
  );
});

test("commissioned WROVER control sends the bounded output request without claiming confirmation", async ({ page }) => {
  const requests = await workspaceFixture(page, false, { floor: "normal", wroverHealthy: true });
  await page.goto("/#/inventory/device%3A13/telemetry");
  const pulse = page.getByRole("button", { name: "Pulse GPIO18" });
  await expect(pulse).toBeEnabled();
  await pulse.click();
  await expect(page.getByText("GPIO18 command sent")).toBeVisible();
  await expect(page.getByText("The broker accepted the command; the device has not confirmed the output state.")).toBeVisible();
  expect(requests.filter((request) => request.procedure === "devices.pulseIndicator").map((request) => request.input)).toEqual([{ id: 13 }]);
});

test("Overview prioritizes connectivity, review, incidents and unread notifications", async ({
  page,
}) => {
  const requests = await workspaceFixture(page, false, {
    floor: "normal",
    summary: "populated",
    telemetry: "unverified",
  });
  await page.goto("/#/");
  const cards = page.locator(".overview-kpis");
  const online = cards.getByRole("link", { name: /^Online\s+7$/ });
  const offline = cards.getByRole("link", { name: /^Offline\s+4$/ });
  const review = cards.getByRole("link", { name: /^Needs review\s+40$/ });
  const incidents = cards.getByRole("link", { name: /^Open incidents\s+5$/ });
  const notices = cards.getByRole("link", {
    name: /^Unread notifications\s+3$/,
  });
  await expect(online).toHaveAttribute("href", "#/monitoring?status=live");
  await expect(offline).toHaveAttribute("href", "#/monitoring?status=offline");
  await expect(review).toHaveAttribute(
    "title",
    "Unknown, stale, maintenance or error status",
  );
  await expect(incidents).toHaveAttribute("href", "#/alerts?status=open");
  await expect(notices).toHaveAttribute("href", "#/notifications?view=unread");
  await online.click();
  await expect
    .poll(() =>
      requests.some(
        (r) => r.procedure === "devices.monitor" && r.input.status === "live",
      ),
    )
    .toBe(true);
  await page.goto("/#/");
  await page
    .locator(".overview-kpis")
    .getByRole("link", { name: /^Offline\s+4$/ })
    .click();
  await expect
    .poll(() =>
      requests.some(
        (r) =>
          r.procedure === "devices.monitor" && r.input.status === "offline",
      ),
    )
    .toBe(true);
  await page.goto("/#/");
  await page
    .locator(".overview-kpis")
    .getByRole("link", { name: /^Unread notifications\s+3$/ })
    .click();
  await expect
    .poll(() =>
      requests.some(
        (r) =>
          r.procedure === "notifications.page" && r.input.view === "unread",
      ),
    )
    .toBe(true);
});

test("Overview requests severity priority and puts attention before the floor on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const requests = await workspaceFixture(page, false, {
    floor: "normal",
    summary: "populated",
    attention: true,
  });
  await page.goto("/#/");
  const attention = page.getByRole("link", {
    name: /Pressure below configured threshold/,
  });
  await expect(attention).toContainText("Compressor pressure sensor");
  await expect(attention).toContainText("critical");
  await expect(attention).toContainText("Operator");
  await expect(attention).toHaveAttribute("href", "#/alerts/42?return=%2F");
  expect(
    requests.some(
      (r) =>
        r.procedure === "alerts.list" &&
        r.input.order === "severity" &&
        r.input.openOnly,
    ),
  ).toBe(true);
  const statusBox = await page.getByLabel("Factory status").boundingBox();
  const floorBox = await page.getByTestId("factory-floor").boundingBox();
  expect(statusBox && floorBox && statusBox.y < floorBox.y).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  const wideStatus = await page.getByLabel("Factory status").boundingBox();
  const wideFloor = await page.getByTestId("factory-floor").boundingBox();
  expect(wideStatus && wideFloor && wideStatus.x > wideFloor.x).toBe(true);
});

test("Overview reports unavailable summaries instead of false zero counts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await workspaceFixture(page, false, { floor: "normal", summary: "error" });
  await page.goto("/#/");
  const cards = page.locator(".overview-kpis");
  await expect(
    cards.getByRole("link", { name: /^Online\s+Unavailable$/ }),
  ).toBeVisible();
  await expect(
    cards.getByRole("link", { name: /^Offline\s+Unavailable$/ }),
  ).toBeVisible();
  await expect(
    cards.getByRole("link", { name: /^Unread notifications\s+Unavailable$/ }),
  ).toBeVisible();
  expect(
    await cards
      .locator(".overview-kpi")
      .evaluateAll((elements) =>
        elements.every((element) => element.scrollWidth <= element.clientWidth),
      ),
  ).toBe(true);
});

test("Overview does not claim priority ordering with an older API", async ({
  page,
}) => {
  const requests = await workspaceFixture(page, false, {
    floor: "normal",
    olderApi: true,
  });
  await page.goto("/#/");
  await expect(
    page.getByText(
      "Priority view unavailable. Open alerts to review incidents.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /View alerts/ })).toHaveAttribute(
    "href",
    "#/alerts?status=open",
  );
  expect(requests.some((r) => r.procedure === "alerts.list")).toBe(false);
});

test("An offline source does not declare the asset stopped or unhealthy", async ({
  page,
}) => {
  await workspaceFixture(page, false, { floor: "normal", viewer: true });
  await page.goto("/#/inventory/asset%3A1/overview");
  await expect(
    page.getByText("Source status", { exact: false }).first(),
  ).toContainText(/offline/i);
  const details = page
    .getByRole("heading", { name: "Item details" })
    .locator("..");
  await expect(
    details.locator("dt", { hasText: "Operating state" }).locator("+ dd"),
  ).toHaveText("Unknown");
  await expect(
    details.locator("dt", { hasText: "Asset condition" }).locator("+ dd"),
  ).toHaveText("Unknown");
});

test("Overview links outstanding actions to their incident", async ({
  page,
}) => {
  await workspaceFixture(page, false, { floor: "normal", actions: true });
  await page.goto("/#/");
  await page.getByText("Follow-up · 3+", { exact: true }).click();
  const action = page.getByRole("link", { name: /Inspect compressor/ });
  await expect(action).toContainText("Operator");
  await expect(action).toContainText("2026-12-10");
  await expect(action).toHaveAttribute("href", "#/alerts/42?return=%2F");
  await page.getByRole("button", { name: "Next actions" }).click();
  await expect(
    page.getByRole("link", { name: /Inspect conveyor/ }),
  ).toHaveAttribute("href", "#/alerts/43?return=%2F");
  await page.getByRole("button", { name: "Previous actions" }).click();
  await expect(
    page.getByRole("link", { name: /Inspect compressor/ }),
  ).toBeVisible();
});

test("Overview offers a retry when follow-up actions are unavailable", async ({
  page,
}) => {
  const requests = await workspaceFixture(page, false, {
    floor: "normal",
    actionsError: true,
  });
  await page.goto("/#/");
  const error = page
    .getByRole("status")
    .filter({ hasText: "Follow-up actions unavailable" });
  await expect(error).toBeVisible();
  await error.getByRole("button", { name: "Retry" }).click();
  await expect
    .poll(
      () =>
        requests.filter((request) => request.procedure === "alerts.actionQueue")
          .length,
    )
    .toBeGreaterThanOrEqual(2);
});

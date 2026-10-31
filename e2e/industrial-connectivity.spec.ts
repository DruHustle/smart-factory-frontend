import { test, expect, type Page } from "@playwright/test";
import superjson from "superjson";
import {
  industrialDrivers,
  industrialConfigurationSchema,
  type IndustrialConfiguration,
  type IndustrialConnection,
  type ConnectivityObservation,
} from "../shared/industrial-connectivity";
import {
  requiredCapabilities,
  runtimeContractVersion,
} from "../shared/runtime-contract";

const baseConnection: IndustrialConnection = {
  connectionId: "pump-controller",
  name: "Pump controller",
  protocol: "modbus_tcp",
  endpoint: "tcp://192.168.10.20:502",
  enabled: true,
  intervalMs: 1000,
  tags: [
    {
      tagId: "inlet-pressure",
      name: "Inlet pressure",
      dataType: "float32",
      unit: "bar",
      source: {
        address: 100,
        registerType: "holding_register",
        unitId: 1,
        count: 2,
      },
      assetId: "urn:example:pump101",
      property: "inletPressure",
    },
    {
      tagId: "outlet-pressure",
      name: "Outlet pressure",
      dataType: "float32",
      unit: "bar",
      source: {
        address: 102,
        registerType: "holding_register",
        unitId: 1,
        count: 2,
      },
      assetId: "urn:example:pump101",
      property: "outletPressure",
    },
  ],
};

async function fixture(
  page: Page,
  options: {
    synthetic?: boolean;
    empty?: boolean;
    role?: "engineer" | "viewer";
    network?: boolean;
    assetDetail?: boolean;
    probeUnconfirmed?: boolean;
    publicationUnconfirmed?: boolean;
  } = {},
) {
  const role = options.role ?? "engineer";
  const writes: Array<{ name: string; input: any }> = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const observedAt = new Date().toISOString();
  let configuration: IndustrialConfiguration = {
    schemaVersion: "industrial-connectivity/v1",
    gatewayDeviceId: "gateway-01",
    revision: 1,
    connections: options.empty ? [] : [structuredClone(baseConnection)],
  };
  const report: ConnectivityObservation = {
    schemaVersion: "industrial-observation/v1",
    connectionId: "pump-controller",
    configurationRevision: 1,
    eventId: "2d6d75e3-dc92-4321-a822-d211ecf217b1",
    observedAt,
    state: "connected",
    discoveredTags: [],
    tags: [
      {
        tagId: "inlet-pressure",
        dataType: "float32",
        value: 2.5,
        quality: "good",
        qualityBasis: "communication",
        unit: "bar",
      },
      {
        tagId: "outlet-pressure",
        dataType: "float32",
        value: 4.7,
        quality: "good",
        qualityBasis: "communication",
        unit: "bar",
      },
    ],
  };
  if (options.network) {
    configuration.connections = [
      {
        ...baseConnection,
        connectionId: "fx-controller",
        name: "FX controller",
        protocol: "opcua_fx",
        endpoint: "opc.tcp://192.168.10.20:4840",
        tags: [],
        fx: { mode: "diagnostics" },
        tsn: { interface: "eth0", ptpDomain: 0 },
      },
    ];
    report.connectionId = "fx-controller";
    report.tags = [];
    report.fx = {
      mode: "diagnostics",
      modelVerified: true,
      determinism: "unverified",
      warnings: [],
      components: [
        {
          name: "Assembly controller",
          nodeId: "ns=2;s=AC1",
          namespaceUri: "http://opcfoundation.org/UA/FX/AC/",
          kind: "automation_component",
        },
      ],
    };
    report.tsn = {
      interface: "eth0",
      observedAt,
      clock: { state: "unknown" },
      capabilities: { hardwareTimestamping: "supported" },
      qdiscs: [{ kind: "taprio" }],
      counters: { rxDropped: 0 },
      evidence: [
        { source: "ethtool", status: "observed" },
        { source: "pmc", status: "unavailable" },
      ],
      determinism: "unverified",
    };
  }
  let activeConfiguration = structuredClone(configuration);
  let probeResult: ConnectivityObservation | undefined;
  let pendingProbe: {
    commandId: string;
    expiresAt: number;
    connectionId: string;
    status: string;
  } | null = null;
  let publishedRevision: number | null = 1;
  let reportedRevision = 1;
  let publication: {
    revision: number;
    status: "unconfirmed";
    startedAt: number;
  } | null = null;
  const detail = () => ({
    configuration,
    activeConfiguration,
    publication,
    revision: configuration.revision,
    reportedRevision,
    publishedRevision,
    publishedAt: observedAt,
    lastReceivedAt: observedAt,
    lastError: null,
    observations:
      options.empty ||
      activeConfiguration.revision !== report.configurationRevision
        ? []
        : [report],
    canConfigure: role === "engineer" && !options.synthetic,
    synthetic: options.synthetic ?? false,
    assets: [{ assetId: "urn:example:pump101", name: "Pump P-101" }],
    probe: pendingProbe
      ? {
          ...pendingProbe,
          ...(probeResult ? { result: probeResult, status: "completed" } : {}),
        }
      : null,
  });
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
    const request = route.request(),
      url = new URL(request.url());
    const batch = url.searchParams.has("batch");
    const procedures = decodeURIComponent(
      url.pathname.split("/trpc/")[1],
    ).split(",");
    const serialized = JSON.parse(
      request.method() === "GET"
        ? (url.searchParams.get("input") ?? "{}")
        : (request.postData() ?? "{}"),
    );
    const responses = procedures.map((procedure, index) => {
      const encoded = batch ? serialized[String(index)] : serialized;
      const input: any =
        encoded?.json !== undefined
          ? superjson.deserialize(encoded)
          : undefined;
      if (request.method() !== "GET") writes.push({ name: procedure, input });
      let value: unknown;
      switch (procedure) {
        case "auth.me":
          value = {
            id: 91001,
            name: "Connectivity review",
            email: "connectivity@example.test",
            openId: "connectivity-review",
            role,
            access: {
              demoOnly: !!options.synthetic,
              workspaceView: options.synthetic ? "demo" : "live",
              canSwitchData: false,
              canOperate: role === "engineer",
              canEngineer: role === "engineer",
              canAdminister: false,
            },
          };
          break;
        case "notifications.summary":
          value = { unread: 0 };
          break;
        case "auth.demoAccounts":
          value = [];
          break;
        case "inventory.item":
          value = {
            ref: "asset:101",
            kind: "asset",
            id: "101",
            name: "Pump P-101",
            identifier: "urn:example:pump101",
            itemType: "pump",
            location: "Process room",
            zone: null,
            configured: true,
            route: "gateway-01",
            status: "unknown",
            lastObserved: null,
            sampleAt: null,
            mode: "live",
            quality: "unknown",
            freshnessMs: null,
            lifecycle: null,
            aas: true,
            equipmentId: null,
            firmware: null,
          };
          break;
        case "security.availability":
          value = { enabled: false };
          break;
        case "connectivity.assetTags":
          expect(input.assetId).toBe("urn:example:pump101");
          value = baseConnection.tags.map((tag, index) => ({
            gatewayDeviceId: "gateway-01",
            connectionId: baseConnection.connectionId,
            tagId: tag.tagId,
            name: tag.name,
            property: tag.property,
            unit: tag.unit,
            dataType: tag.dataType,
            value: report.tags[index].value,
            quality: "good",
            observedAt:
              index === 0
                ? observedAt
                : new Date(Date.now() - 600_000).toISOString(),
            currentEligible: index === 0,
            mode: index === 0 ? "live" : "simulated",
            configurationRevision: 1,
          }));
          break;
        case "connectivity.drivers":
          value = industrialDrivers;
          break;
        case "networkDiagnostics.overview":
          value = {
            synthetic: false,
            scenario: "normal",
            stale: false,
            importedAt: null,
            provenance: "service-collector",
            snapshots: [
              {
                version: 1,
                gatewayId: "another-gateway",
                observedAt,
                source: "collector",
                components: [],
                connections: [],
                ports: [],
                streams: [],
              },
            ],
          };
          break;
        case "connectivity.gateways":
          value = [
            {
              gatewayDeviceId: "gateway-01",
              name: "Factory gateway",
              status: "online",
            },
          ];
          break;
        case "connectivity.get":
          value = detail();
          break;
        case "connectivity.history":
          value = report.tags
            .filter((tag) => tag.tagId === input.tagId)
            .map((tag) => ({
              ...tag,
              eventId: report.eventId,
              observedAt,
              configurationRevision: 1,
              currentEligible: true,
            }));
          break;
        case "connectivity.save": {
          expect(input.expectedRevision).toBe(configuration.revision);
          configuration = industrialConfigurationSchema.parse({
            ...configuration,
            revision: configuration.revision + 1,
            connections: input.connections,
          });
          value = { saved: true, revision: configuration.revision };
          break;
        }
        case "connectivity.publish": {
          expect(input.expectedRevision).toBe(configuration.revision);
          if (options.publicationUnconfirmed) {
            publication = {
              revision: configuration.revision,
              status: "unconfirmed",
              startedAt: Date.now(),
            };
            value = {
              published: false,
              revision: configuration.revision,
              reason: "delivery_unconfirmed",
            };
            break;
          }
          publishedRevision = configuration.revision;
          activeConfiguration = structuredClone(configuration);
          value = { published: true, revision: publishedRevision };
          break;
        }
        case "connectivity.probe": {
          pendingProbe = {
            commandId: "99c8cb45-5627-4327-939c-bbc143ea0e94",
            expiresAt: Date.now() + 60000,
            connectionId: input.connection.connectionId,
            status: options.probeUnconfirmed ? "unconfirmed" : "published",
          };
          value = {
            commandId: pendingProbe.commandId,
            expiresAt: pendingProbe.expiresAt,
            published: !options.probeUnconfirmed,
            ...(options.probeUnconfirmed
              ? { reason: "delivery_unconfirmed" }
              : {}),
          };
          break;
        }
        default:
          throw Error(`Unexpected connectivity fixture request: ${procedure}`);
      }
      return { result: { data: superjson.serialize(value) } };
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(batch ? responses : responses[0]),
    });
  });
  await page.goto(
    options.assetDetail
      ? "/#/inventory/asset%3A101/overview"
      : "/#/connectivity",
  );
  await expect(
    page.getByRole("heading", {
      name: options.assetDetail
        ? "Pump P-101"
        : "Industrial device connectivity",
      exact: true,
    }),
  ).toBeVisible();
  if (!options.assetDetail)
    await expect(page.getByLabel("Edge gateway", { exact: true })).toHaveValue(
      "gateway-01",
    );
  return {
    writes,
    errors,
    configuration: () => configuration,
    finishPublication() {
      publication = null;
      publishedRevision = configuration.revision;
      reportedRevision = configuration.revision;
      activeConfiguration = structuredClone(configuration);
    },
    remoteEdit() {
      configuration = {
        ...configuration,
        revision: configuration.revision + 1,
        connections: configuration.connections.map((connection) => ({
          ...connection,
          name: "Remote controller revision",
        })),
      };
    },
    finishProbe() {
      if (!pendingProbe) throw Error("Request a probe first");
      probeResult = {
        schemaVersion: "industrial-observation/v1",
        connectionId: pendingProbe.connectionId,
        configurationRevision: 1,
        eventId: "0cfb9c62-c5a8-43f5-8acb-75fd19a34b60",
        commandId: pendingProbe.commandId,
        observedAt: new Date().toISOString(),
        state: "connected",
        tags: [],
        discoveredTags: [
          {
            name: "Pump pressure",
            nodeId: "s=Pressure",
            namespaceUri: "urn:example:controller",
            dataType: "Double",
          },
          {
            name: "Valve pressure",
            nodeId: "s=Pressure",
            namespaceUri: "urn:example:valve",
            dataType: "Double",
          },
        ],
      };
    },
  };
}

for (const width of [390, 1440]) {
  test(`independent tags and saved/applied revisions remain clear at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const result = await fixture(page);
    await expect(
      page.getByRole("button", { name: "Inlet pressure", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Outlet pressure", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "2.5 bar", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "4.7 bar", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/connectivity/connectivity-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel(/^Tag 2 name/).fill("Discharge pressure");
    await page
      .getByRole("button", { name: "Keep in draft", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Apply to gateway", exact: true }),
    ).toBeDisabled();
    expect(result.writes).toEqual([]);
    await page
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save configuration", exact: true }),
    ).toBeDisabled();
    expect(
      result.configuration().connections[0].tags.map((tag) => tag.tagId),
    ).toEqual(["inlet-pressure", "outlet-pressure"]);
    expect(result.configuration().connections[0].tags[1].name).toBe(
      "Discharge pressure",
    );
    await expect(
      page.getByRole("button", { name: "Outlet pressure", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Discharge pressure", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("cell", { name: "4.7 bar", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Apply to gateway", exact: true })
      .click();
    await expect(
      page.getByText("Gateway applied revision", { exact: false }),
    ).toContainText("1");
    await expect(
      page.getByText("Sent revision", { exact: false }),
    ).toContainText("2");
    expect(result.writes.map((write) => write.name)).toEqual([
      "connectivity.save",
      "connectivity.publish",
    ]);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expect(
      page.getByText(
        "Configuration sent. Waiting for the gateway to report its applied revision.",
        { exact: true },
      ),
    ).toBeHidden();
    await page
      .getByRole("heading", {
        name: "Industrial device connectivity",
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/connectivity/connectivity-${width}-pending.png`,
      fullPage: true,
    });
    expect(result.errors).toEqual([]);
  });
}

test("saving a desired deletion retains published acquisition until the new revision is applied", async ({
  page,
}) => {
  const result = await fixture(page);
  await page
    .getByRole("button", { name: "Remove Pump controller", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove from draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save configuration", exact: true }),
  ).toBeDisabled();
  expect(result.configuration().connections).toHaveLength(0);
  await expect(page.getByText("Published only", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inlet pressure", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "2.5 bar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Restore to desired configuration",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Apply to gateway", exact: true })
    .click();
  await expect(
    page.getByText("No equipment connections configured", { exact: true }),
  ).toBeVisible();
  expect(result.writes.map((write) => write.name)).toEqual([
    "connectivity.save",
    "connectivity.publish",
  ]);
  expect(result.errors).toEqual([]);
});

test("asset detail keeps bound signals separate and distinguishes historical source evidence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const result = await fixture(page, { assetDetail: true, role: "viewer" });
  const signals = page.getByRole("list", { name: "Bound industrial signals" });
  await expect(signals.getByRole("listitem")).toHaveCount(2);
  await expect(
    signals.getByRole("heading", { name: "Inlet pressure", exact: true }),
  ).toBeVisible();
  await expect(
    signals.getByRole("heading", { name: "Outlet pressure", exact: true }),
  ).toBeVisible();
  await expect(signals.getByText("2.5 bar", { exact: true })).toBeVisible();
  await expect(signals.getByText("4.7 bar", { exact: true })).toBeVisible();
  await expect(signals.getByText("live source", { exact: true })).toHaveCount(
    1,
  );
  await expect(
    signals.getByText("simulated source", { exact: true }),
  ).toHaveCount(1);
  await expect(signals.getByText("Not current", { exact: true })).toHaveCount(
    1,
  );
  await expect(
    signals
      .getByRole("link", { name: "Gateway gateway-01", exact: true })
      .first(),
  ).toHaveAttribute("href", "#/connectivity?gateway=gateway-01");
  expect(result.writes).toEqual([]);
  expect(result.errors).toEqual([]);
});

for (const unconfirmed of [false, true])
  test(`OPC UA ${unconfirmed ? "unconfirmed" : "pending"} test waits for a correlated gateway result`, async ({
    page,
  }) => {
    const result = await fixture(page, {
      empty: true,
      probeUnconfirmed: unconfirmed,
    });
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    await page
      .getByLabel("Connection name", { exact: true })
      .fill("Controller OPC UA");
    await page.getByLabel(/^Endpoint/).fill("opc.tcp://192.168.10.21:4840");
    await page
      .getByRole("button", { name: "Test & discover", exact: true })
      .click();
    await expect(
      page.getByText(
        unconfirmed
          ? "Gateway test delivery unconfirmed"
          : "Test sent to the gateway",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Gateway reported: connected", { exact: true }),
    ).toHaveCount(0);
    result.finishProbe();
    await expect(
      page.getByText("Gateway reported: connected", { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/Pump pressure/).check();
    await page
      .getByRole("button", { name: "Add selected variables", exact: true })
      .click();
    await expect(page.getByLabel(/^Tag 1 node ID/)).toHaveValue("s=Pressure");
    await expect(page.getByLabel(/^Tag 1 namespace URI/)).toHaveValue(
      "urn:example:controller",
    );
    await expect(page.getByLabel(/^Tag 1 data type/)).toHaveValue("float64");
    await page
      .getByRole("button", { name: "Keep in draft", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save configuration", exact: true }),
    ).toBeDisabled();
    expect(result.configuration().connections[0].tags[0].source).toEqual({
      nodeId: "s=Pressure",
      namespaceUri: "urn:example:controller",
    });
    expect(result.configuration().connections[0].tags).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

test("unconfirmed publication retains the last published values and can reconcile a later receipt", async ({
  page,
}) => {
  const result = await fixture(page, { publicationUnconfirmed: true });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Connection name", { exact: true })
    .fill("Updated controller");
  await page
    .getByRole("button", { name: "Keep in draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save configuration", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Apply to gateway", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Delivery of revision 2 is unconfirmed",
  );
  await expect(
    page.getByRole("cell", { name: "2.5 bar", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Sent revision", { exact: false })).toContainText(
    "1",
  );
  result.finishPublication();
  await page
    .getByRole("button", { name: "Refresh device connectivity", exact: true })
    .click();
  await expect(page.getByText("Sent revision", { exact: false })).toContainText(
    "2",
  );
  await expect(
    page.getByText("Gateway applied revision", { exact: false }),
  ).toContainText("2");
  await expect(
    page.getByText(/Delivery of revision 2 is unconfirmed/),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(result.errors).toEqual([]);
});

test("a concurrent configuration revision preserves the local draft until explicitly discarded", async ({
  page,
}) => {
  const result = await fixture(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Connection name", { exact: true })
    .fill("My local controller edit");
  await page
    .getByRole("button", { name: "Keep in draft", exact: true })
    .click();
  result.remoteEdit();
  await page
    .getByRole("button", { name: "Refresh device connectivity", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Your draft is preserved",
  );
  await expect(
    page.getByRole("heading", {
      name: "My local controller edit",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save configuration", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Apply to gateway", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Reload saved configuration", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "My local controller edit",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reload saved configuration", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Remote controller revision",
      exact: true,
    }),
  ).toBeVisible();
  expect(result.writes).toEqual([]);
  expect(result.errors).toEqual([]);
});

test("OPC UA FX and TSN show reported evidence without asserting deterministic timing", async ({
  page,
}) => {
  const result = await fixture(page, { network: true });
  await expect(
    page.getByRole("heading", { name: "OPC UA FX evidence", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("FX information model identified", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Assembly controller", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Reported clock:", { exact: false }),
  ).toContainText("unknown");
  await expect(
    page.getByText(/Deterministic timing is unverified\./),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open FX & TSN diagnostics", exact: true }),
  ).toHaveAttribute("href", "#/network?tab=timing&gateway=gateway-01");
  await page
    .getByRole("link", { name: "Open FX & TSN diagnostics", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "FX & TSN", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Diagnostics gateway", { exact: true }),
  ).toHaveValue("gateway-01");
  await expect(
    page.getByText("No FX / TSN evidence available", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Device connectivity", exact: true }),
  ).toHaveAttribute("href", "#/connectivity?gateway=gateway-01");
  expect(result.writes).toEqual([]);
  expect(result.errors).toEqual([]);
});

test("FX UDP mode requires explicit unsigned-observer acknowledgement", async ({
  page,
}) => {
  const result = await fixture(page, { empty: true });
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await page
    .getByLabel("Connection name", { exact: true })
    .fill("FX data observer");
  await page.getByLabel(/^Protocol/).selectOption("opcua_fx");
  await page
    .getByLabel("FX acquisition mode", { exact: true })
    .selectOption("udp_uadp");
  await page.getByLabel(/^Endpoint/).fill("opc.udp://239.0.0.1:4840");
  await page
    .getByRole("button", { name: "Keep in draft", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Confirm unsigned UDP observation",
  );
  expect(result.writes).toEqual([]);
  await page.getByLabel(/Allow this read-only observer/).check();
  await page
    .getByRole("button", { name: "Keep in draft", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("complete field layout");
  await page.getByRole("button", { name: "Add tag", exact: true }).click();
  await page
    .getByLabel("Tag 1 name", { exact: true })
    .fill("Observed pressure");
  await page
    .getByLabel("Tag 1 data set field index", { exact: true })
    .fill("2");
  await page
    .getByRole("button", { name: "Keep in draft", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("complete field layout");
  await page
    .getByLabel("Tag 1 data set field index", { exact: true })
    .fill("0");
  await page
    .getByRole("button", { name: "Keep in draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save configuration", exact: true }),
  ).toBeDisabled();
  expect(result.configuration().connections[0].fx).toMatchObject({
    mode: "udp_uadp",
    allowUnsecured: true,
  });
  expect(result.errors).toEqual([]);
});

for (const options of [{ synthetic: true }, { role: "viewer" as const }]) {
  test(`${options.synthetic ? "demo" : "viewer"} connection view cannot configure or test a gateway`, async ({
    page,
  }) => {
    const result = await fixture(page, options);
    await expect(
      page.getByRole("button", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add connection", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save configuration", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Apply to gateway", exact: true }),
    ).toHaveCount(0);
    expect(result.writes).toEqual([]);
    expect(result.errors).toEqual([]);
  });
}

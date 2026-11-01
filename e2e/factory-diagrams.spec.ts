import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import {
  requiredCapabilities,
  runtimeContractVersion,
} from "../shared/runtime-contract";

// Synthetic inventory: the process link is real within this fixture, while the
// gateway relationship deliberately supplies no evidence of electrical wiring.
const draftsKey = "smart-factory:layout-drafts:v1:90001:live";
const diagramKey =
  'smart-factory:diagram:v1:[90001,"live","layout-study:diagram-review"]:electrical';
const placements = [
  { ref: "asset:1", x: -6, z: 0, rotation: 0, zoneId: null },
  { ref: "asset:2", x: 0, z: -3, rotation: 0, zoneId: null },
  { ref: "asset:3", x: 6, z: 0, rotation: 0, zoneId: null },
];
const links = [
  {
    from: "asset:1",
    to: "asset:2",
    kind: "process",
    label: "Process connection",
  },
  {
    from: "asset:1",
    to: "asset:3",
    kind: "gateway",
    label: "Gateway connection",
  },
];
const items = ["pump", "tank", "control cabinet"].map((itemType, i) => ({
  ref: `asset:${i + 1}`,
  id: String(i + 1),
  kind: "asset",
  name: `Review ${itemType}`,
  identifier: `review-${i + 1}`,
  itemType,
  location: "Assembly",
  zone: "Assembly",
  configured: false,
  isDemo: false,
  route: "Not configured",
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
}));
const demoItems = [
  ["tank-01", "Feed tank", "tank"],
  ["valve-01", "Feed valve", "valve"],
  ["pump-02", "Transfer pump", "pump"],
  ["mixer-01", "Process mixer", "mixer"],
  ["tank-02", "Product tank", "tank"],
  ["tank-03", "Buffer tank", "tank"],
  ["cabinet-01", "Assembly cabinet", "control cabinet"],
  ["conveyor-01", "Assembly conveyor", "conveyor"],
  ["robot-01", "Assembly robot", "robot"],
  ["cabinet-02", "Packaging cabinet", "control cabinet"],
  ["conveyor-03", "Packaging conveyor", "conveyor"],
  ["feed-temperature", "Feed temperature", "temperature sensor"],
  ["feed-pressure", "Feed pressure", "pressure sensor"],
  ["pump-vibration", "Pump vibration", "vibration sensor"],
  ["process", "Process PLC", "plc"],
].map(([key, name, itemType], index) => ({
  ...items[0],
  ref: `${index < 11 ? "asset" : "device"}:${index + 101}`,
  id: String(index + 101),
  kind: index < 11 ? "asset" : "device",
  name,
  itemType,
  identifier:
    index < 11
      ? `urn:smart-factory:showcase:floor:${key}`
      : index === 14
        ? "showcase.fx.plc:process"
        : `showcase.floor:${key}`,
  mode: "simulated",
  isDemo: true,
}));
const demoPlacements = demoItems.map((item, index) => ({
  ref: item.ref,
  x: (index % 5) * 8 - 16,
  z: Math.floor(index / 5) * 9 - 9,
  rotation: 0,
  zoneId: null,
}));
const powerConnection = {
  id: "power-1",
  from: "asset:3",
  to: "asset:1",
  kind: "power",
  label: "Motor feeder",
  direction: "forward",
  fromTerminal: "QF1:2",
  toTerminal: "M1:U1",
  designation: "W-101",
  specification: "Illustrative cable metadata",
};
const powerDiagram = {
  version: 1,
  mode: "electrical",
  title: "Electrical review",
  connections: [powerConnection],
};

const planFor = (page: Page) =>
  page.getByRole("img", { name: "Accessible factory floor plan", exact: true });
const sceneFor = (page: Page) =>
  page.getByRole("img", { name: "Interactive 3D factory floor", exact: true });
const schematicFor = (page: Page) => page.getByTestId("factory-schematic");
const readPlacements = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!)[0].document.placements,
    draftsKey,
  );

async function fixture(page: Page, { noWebGL = false, demo = false } = {}) {
  const writes: string[] = [],
    errors: string[] = [];
  const scopedItems = demo ? demoItems : items;
  const scopedLinks = demo ? [] : links;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ draftsKey, placements, noWebGL }) => {
      if (localStorage.getItem("theme-preference") === null)
        localStorage.setItem("theme-preference", "light");
      if (!localStorage.getItem(draftsKey))
        localStorage.setItem(
          draftsKey,
          JSON.stringify([
            {
              key: "diagram-review",
              document: {
                name: "Diagram review",
                width: 40,
                depth: 30,
                zones: [],
                placements,
              },
              version: 0,
              updatedAt: "2026-10-31T00:00:00Z",
            },
            {
              key: "diagram-review-other",
              document: {
                name: "Diagram review",
                width: 40,
                depth: 30,
                zones: [],
                placements,
              },
              version: 0,
              updatedAt: "2026-10-31T00:00:00Z",
            },
          ]),
        );
      if (noWebGL) {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          kind: string,
          ...args: unknown[]
        ) {
          if (["webgl", "webgl2", "experimental-webgl"].includes(kind))
            return null;
          return Reflect.apply(original, this, [kind, ...args]);
        } as typeof HTMLCanvasElement.prototype.getContext;
      }
    },
    {
      draftsKey: demo
        ? "smart-factory:layout-drafts:v1:demo-visitor"
        : draftsKey,
      placements: demo ? demoPlacements : placements,
      noWebGL,
    },
  );
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
  await page.route("**/api/equipment/reference/*/model?**", (route) =>
    route.fulfill({ status: 404, body: "Synthetic reference unavailable" }),
  );
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url()),
      batch = url.searchParams.has("batch");
    const procedures = decodeURIComponent(
      url.pathname.split("/trpc/")[1],
    ).split(",");
    if (route.request().method() !== "GET") writes.push(...procedures);
    const responses = procedures.map((procedure) => {
      let value: unknown;
      switch (procedure) {
        case "auth.me":
          value = {
            id: 90001,
            name: "Review engineer",
            email: "review@example.test",
            openId: "review-engineer",
            role: "engineer",
            access: {
              demoOnly: demo,
              workspaceView: demo ? "demo" : "live",
              canSwitchData: !demo,
              canOperate: true,
              canEngineer: true,
              canAdminister: false,
            },
          };
          break;
        case "notifications.summary":
          value = { unread: 0 };
          break;
        case "factoryLayouts.list":
          value = [];
          break;
        case "factory.floor":
          value = {
            items: scopedItems,
            total: scopedItems.length,
            groups: [],
            links: scopedLinks,
            complete: true,
            sampledAt: "2026-10-31T00:00:00Z",
          };
          break;
        default:
          throw Error(`Unexpected diagram fixture request: ${procedure}`);
      }
      return { result: { data: superjson.serialize(value) } };
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(batch ? responses : responses[0]),
    });
  });
  await page.goto("/#/layouts");
  await expect(page.getByLabel("Layout name", { exact: true })).toHaveValue(
    "Diagram review",
  );
  if (!noWebGL)
    await expect(sceneFor(page)).toHaveAttribute(
      "data-connection-count",
      String(scopedLinks.length),
    );
  return { writes, errors };
}

async function openDiagramEditor(page: Page) {
  const editor = page.getByTestId("diagram-configuration");
  if (
    !(await editor.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await editor.locator("summary").click();
  return editor;
}

async function importDiagram(page: Page, value: unknown) {
  await openDiagramEditor(page);
  await page.getByLabel("Import diagram JSON", { exact: true }).setInputFiles({
    name: "diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
}

async function enterFullscreen(page: Page) {
  await page
    .getByRole("button", { name: "Enter fullscreen", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Factory floor overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Exit fullscreen", exact: true }),
  ).toBeVisible();
}

for (const width of [390, 1440]) {
  test(`floor, process and electrical modes preserve asset selection at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const control = await fixture(page);
    await page.getByRole("button", { name: "Floor plan", exact: true }).click();
    const pump = planFor(page).getByRole("button", {
      name: "Select Review pump",
      exact: true,
    });
    await pump.focus();
    await pump.press("Enter");
    await expect(pump).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Process / P&ID", exact: true })
      .click();
    await expect(schematicFor(page)).toHaveAttribute(
      "data-diagram-kind",
      "process",
    );
    await expect(
      page.getByRole("button", {
        name: "Connection Process connection",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Connection Gateway connection",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      schematicFor(page).getByRole("button", {
        name: "Select Review pump",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    const tank = schematicFor(page).getByRole("button", {
      name: "Select Review tank",
      exact: true,
    });
    await tank.focus();
    await tank.press("Enter");
    await expect(
      page.getByLabel("Selected floor item", { exact: true }),
    ).toContainText("Review tank");
    const processViewport = schematicFor(page).getByRole("group", {
      name: "Process and instrumentation diagram",
      exact: true,
    });
    const beforeDetailsScale = await processViewport.evaluate(
      (element) => (element as unknown as SVGSVGElement).getScreenCTM()!.a,
    );
    await page
      .getByRole("button", {
        name: "Connection Process connection",
        exact: true,
      })
      .press("Enter");
    await expect(
      page.getByLabel("Selected diagram connection summary", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        Math.abs(
          (await processViewport.evaluate(
            (element) =>
              (element as unknown as SVGSVGElement).getScreenCTM()!.a,
          )) - beforeDetailsScale,
        ),
      )
      .toBeLessThan(0.02);
    await page
      .getByRole("button", { name: "Electrical wiring", exact: true })
      .click();
    await expect(schematicFor(page)).toHaveAttribute(
      "data-diagram-kind",
      "electrical",
    );
    await expect(
      page.getByText("No electrical connections defined", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Connection / }),
    ).toHaveCount(0);
    await expect(
      schematicFor(page).getByRole("button", {
        name: "Select Review tank",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Floor plan", exact: true }).click();
    await expect(
      planFor(page).getByRole("button", {
        name: "Select Review tank",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "3D floor", exact: true }).click();
    await expect(sceneFor(page)).toBeVisible();
    await expect(
      page.getByLabel("Selected floor item", { exact: true }),
    ).toContainText("Review tank");
    await page
      .getByRole("button", { name: "Process / P&ID", exact: true })
      .click();
    await enterFullscreen(page);
    await expect(
      page.getByRole("dialog", { name: "Factory floor overview", exact: true }),
    ).toBeVisible();
    await expect(
      schematicFor(page).getByRole("button", {
        name: "Select Review tank",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Fit diagram", exact: true })
      .click();
    await page.screenshot({
      path: `test-results/factory-process-${width}.png`,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Exit fullscreen", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await readPlacements(page)).toEqual(placements);
    expect(control.writes).toEqual([]);
    expect(control.errors).toEqual([]);
  });

  test(`electrical terminal connections persist, export and stay within their layout at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const control = await fixture(page);
    await page
      .getByRole("button", { name: "Electrical wiring", exact: true })
      .click();
    await openDiagramEditor(page);
    await page
      .getByLabel("Connection type", { exact: true })
      .selectOption("power");
    await page
      .getByLabel("From equipment", { exact: true })
      .selectOption("asset:3");
    await page
      .getByLabel("To equipment", { exact: true })
      .selectOption("asset:1");
    await page
      .getByLabel("Connection label", { exact: true })
      .fill(powerConnection.label);
    await page
      .getByLabel("Flow direction", { exact: true })
      .selectOption("forward");
    await page
      .getByLabel("From terminal", { exact: true })
      .fill(powerConnection.fromTerminal);
    await page
      .getByLabel("To terminal", { exact: true })
      .fill(powerConnection.toTerminal);
    await page
      .getByLabel("Line or cable tag", { exact: true })
      .fill(powerConnection.designation);
    await page
      .getByLabel("Connection specification", { exact: true })
      .fill(powerConnection.specification);
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    const feeder = page.getByRole("button", {
      name: "Connection Motor feeder",
      exact: true,
    });
    await expect(feeder).toBeVisible();
    await expect(feeder.locator("title")).toContainText("QF1:2");
    await expect(feeder.locator("title")).toContainText("M1:U1");
    const connectionDetails = page.getByRole("region", {
      name: "Selected diagram connection",
      exact: true,
    });
    await expect(
      connectionDetails.getByRole("button", {
        name: "From: Review control cabinet",
        exact: true,
      }),
    ).toBeVisible();
    await connectionDetails
      .getByRole("button", { name: "To: Review pump", exact: true })
      .click();
    await expect(
      schematicFor(page).getByRole("button", {
        name: "Select Review pump",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() =>
        page.evaluate(
          (key) =>
            JSON.parse(localStorage.getItem(key) ?? "null")?.connections
              ?.length,
          diagramKey,
        ),
      )
      .toBe(1);
    const configured = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      diagramKey,
    );
    expect(configured.connections[0]).toMatchObject({
      ...powerConnection,
      id: expect.any(String),
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Electrical wiring", exact: true })
      .click();
    await expect(feeder).toBeVisible();
    await expect(feeder.locator("title")).toContainText("QF1:2");
    await openDiagramEditor(page);
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export diagram JSON", exact: true })
      .click();
    const download = await downloadEvent;
    const path = await download.path();
    expect(path).not.toBeNull();
    expect(JSON.parse(await readFile(path!, "utf8"))).toEqual(configured);
    await page
      .getByLabel("Layout name", { exact: true })
      .fill("Other diagram review");
    // Both drafts intentionally begin with the same name. Wait for the renamed
    // draft list to render before identifying the remaining original by name.
    await expect(
      page.getByRole("button", {
        name: "Other diagram review · 3 items",
        exact: true,
      }),
    ).toBeVisible();
    await expect(feeder).toBeVisible();
    await page
      .getByRole("button", { name: "Diagram review · 3 items", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Electrical wiring", exact: true })
      .click();
    await expect(
      page.getByText("No electrical connections defined", { exact: true }),
    ).toBeVisible();
    await expect(feeder).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "Other diagram review · 3 items",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Electrical wiring", exact: true })
      .click();
    await expect(feeder).toBeVisible();
    await page
      .getByLabel("Layout name", { exact: true })
      .fill("Diagram review");
    await expect(feeder).toBeVisible();
    await enterFullscreen(page);
    await expect(feeder).toBeVisible();
    await page.screenshot({
      path: `test-results/factory-electrical-${width}.png`,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Exit fullscreen", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await readPlacements(page)).toEqual(placements);
    expect(control.writes).toEqual([]);
    expect(control.errors).toEqual([]);
  });
}

test("invalid and cross-scope diagram imports retain the last valid drawing", async ({
  page,
}) => {
  const control = await fixture(page);
  await page
    .getByRole("button", { name: "Electrical wiring", exact: true })
    .click();
  await importDiagram(page, powerDiagram);
  const feeder = page.getByRole("button", {
    name: "Connection Motor feeder",
    exact: true,
  });
  await expect(feeder).toBeVisible();
  const original = await page.evaluate(
    (key) => localStorage.getItem(key),
    diagramKey,
  );
  for (const invalid of [
    { ...powerDiagram, version: 999 },
    {
      ...powerDiagram,
      connections: [{ ...powerConnection, from: "asset:999" }],
    },
    { ...powerDiagram, connections: [{ ...powerConnection, kind: "process" }] },
  ]) {
    await importDiagram(page, invalid);
    await expect(
      page.getByTestId("diagram-configuration").getByRole("alert"),
    ).toBeVisible();
    await expect(feeder).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), diagramKey),
    ).toBe(original);
  }
  expect(control.writes).toEqual([]);
  expect(control.errors).toEqual([]);
});

test("all 2D diagrams remain usable without WebGL", async ({ page }) => {
  const control = await fixture(page, { noWebGL: true });
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  await expect(planFor(page)).toBeVisible();
  await planFor(page)
    .getByRole("button", { name: "Select Review pump", exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "Process / P&ID", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Connection Process connection",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    schematicFor(page).getByRole("button", {
      name: "Select Review pump",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Electrical wiring", exact: true })
    .click();
  await importDiagram(page, powerDiagram);
  await expect(
    page.getByRole("button", { name: "Connection Motor feeder", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Zoom in diagram", exact: true })
    .click();
  await page.getByRole("button", { name: "Fit diagram", exact: true }).click();
  expect(control.writes).toEqual([]);
  expect(control.errors).toEqual([]);
});

test("unreadable drawings are retained and storage failures remain exportable", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "unreadable-diagram"),
    diagramKey,
  );
  const control = await fixture(page);
  await page
    .getByRole("button", { name: "Electrical wiring", exact: true })
    .click();
  await openDiagramEditor(page);
  await expect(page.getByRole("alert")).toContainText("retained");
  await expect(
    page.getByRole("button", { name: "Add connection", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), diagramKey),
  ).toBe("unreadable-diagram");
  await page
    .getByRole("button", { name: "Reset unreadable diagram", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add connection", exact: true }),
  ).toBeEnabled();
  const persisted = await page.evaluate(
    (key) => localStorage.getItem(key),
    diagramKey,
  );
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("smart-factory:diagram:"))
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await importDiagram(page, powerDiagram);
  await expect(
    page.getByRole("button", { name: "Connection Motor feeder", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("could not be saved");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), diagramKey),
  ).toBe(persisted);
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export diagram JSON", exact: true })
    .click();
  const download = await downloadEvent;
  expect(JSON.parse(await readFile((await download.path())!, "utf8"))).toEqual(
    powerDiagram,
  );
  expect(control.writes).toEqual([]);
  expect(control.errors).toEqual([]);
});

test("floor plan zoom preserves item placement and held-drag pan semantics", async ({
  page,
}) => {
  const control = await fixture(page);
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  const plan = planFor(page);
  const initialView = await plan.getAttribute("viewBox");
  await page
    .getByRole("button", { name: "Zoom in floor plan", exact: true })
    .click();
  await expect(plan).toHaveAttribute("data-zoom", "1.250");
  expect(await readPlacements(page)).toEqual(placements);
  const screenPoint = (x: number, y: number) =>
    plan.evaluate(
      (element, point) => {
        const matrix = (element as unknown as SVGSVGElement).getScreenCTM()!;
        const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        return { x: screen.x, y: screen.y };
      },
      { x, y },
    );
  const start = await screenPoint(-6, 0);
  await page.mouse.move(start.x, start.y);
  const stationary = await plan.getAttribute("viewBox");
  await page.mouse.move(start.x + 5, start.y + 5);
  expect(await plan.getAttribute("viewBox")).toBe(stationary);
  await page.keyboard.down("Space");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 20, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(plan).not.toHaveAttribute("viewBox", stationary!);
  expect(await readPlacements(page)).toEqual(placements);
  const afterPan = await plan.getAttribute("viewBox");
  await page.mouse.move(start.x + 80, start.y + 60);
  expect(await plan.getAttribute("viewBox")).toBe(afterPan);
  await page
    .getByRole("button", { name: "Fit floor plan", exact: true })
    .click();
  await expect(plan).toHaveAttribute("viewBox", initialView!);
  await expect(plan).toHaveAttribute("data-zoom", "1.000");
  const pump = plan.getByRole("button", {
    name: "Select Review pump",
    exact: true,
  });
  await pump.focus();
  await pump.press("Enter");
  await pump.press("ArrowRight");
  await expect.poll(async () => (await readPlacements(page))[0].x).toBe(-5.5);
  const beforeWheel = await readPlacements(page);
  const box = (await plan.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await expect
    .poll(async () => Number(await plan.getAttribute("data-zoom")))
    .toBeGreaterThan(1);
  expect(await readPlacements(page)).toEqual(beforeWheel);
  expect(control.writes).toEqual([]);
  expect(control.errors).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`authored demo process and electrical diagrams render automatically at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const control = await fixture(page, { demo: true });
    for (const [mode, label, count] of [
      ["process", "Process / P&ID", 8],
      ["electrical", "Electrical wiring", 7],
    ] as const) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(schematicFor(page)).toHaveAttribute(
        "data-diagram-kind",
        mode,
      );
      await expect(
        page.getByLabel("Diagram source", { exact: true }),
      ).toContainText("Illustrative demo diagram");
      await expect(
        schematicFor(page).getByRole("button", { name: /^Connection / }),
      ).toHaveCount(count);
      const pump = schematicFor(page).getByRole("button", {
        name: "Select Transfer pump",
        exact: true,
      });
      await pump.focus();
      await pump.press("Enter");
      await expect(pump).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(async () => {
          const node = await pump.boundingBox();
          const viewport = await schematicFor(page)
            .getByRole("group", {
              name:
                mode === "process"
                  ? "Process and instrumentation diagram"
                  : "Electrical wiring diagram",
              exact: true,
            })
            .boundingBox();
          return (
            !!node &&
            !!viewport &&
            node.x >= viewport.x - 2 &&
            node.y >= viewport.y - 2 &&
            node.x + node.width <= viewport.x + viewport.width + 2 &&
            node.y + node.height <= viewport.y + viewport.height + 2
          );
        })
        .toBe(true);
      await schematicFor(page).screenshot({
        path: `test-results/factory-demo-${mode}-inline-${width}.png`,
        animations: "disabled",
      });
      await enterFullscreen(page);
      await expect(
        schematicFor(page).getByRole("button", { name: /^Connection / }),
      ).toHaveCount(count);
      await page
        .getByRole("button", { name: "Fit diagram", exact: true })
        .click();
      await page.screenshot({
        path: `test-results/factory-demo-${mode}-fullscreen-${width}.png`,
        animations: "disabled",
      });
      await page
        .getByRole("button", { name: "Exit fullscreen", exact: true })
        .click();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(control.writes).toEqual([]);
    expect(control.errors).toEqual([]);
  });
}

import { test, expect, type Page, type Locator } from "@playwright/test";
import superjson from "superjson";
import { requiredCapabilities, runtimeContractVersion } from "../shared/runtime-contract";

const draftsKey = "smart-factory:layout-drafts:v1:90001:live";
const routeKey = 'smart-factory:connection-appearance:v1:[90001,"live","Routing review"]';
const processId = '["process","asset:1","asset:2"]';
const placements = [
  { ref: "asset:1", x: -6, z: 0, rotation: 0, zoneId: null },
  { ref: "asset:2", x: 0, z: -3, rotation: 0, zoneId: null },
  { ref: "asset:3", x: 6, z: 0, rotation: 0, zoneId: null },
];
const links = [
  { from: "asset:1", to: "asset:2", kind: "process", label: "Process connection" },
  { from: "asset:1", to: "asset:3", kind: "gateway", label: "Gateway connection" },
];
const items = ["pump", "tank", "control cabinet"].map((itemType, i) => ({
  ref: `asset:${i + 1}`, id: String(i + 1), kind: "asset", name: `Review ${itemType}`,
  identifier: `review-${i + 1}`, itemType, location: "Assembly", zone: "Assembly",
  configured: false, isDemo: false, route: "Not configured", status: "unknown",
  lastObserved: null, sampleAt: null, mode: "live", quality: "unknown", freshnessMs: null,
  lifecycle: null, aas: true, equipmentId: null, firmware: null,
}));

type RouteSummary = { id: string; type: string; shape: string; diameter: number; color: string;
  from: number[]; to: number[]; midpoint: number[] };
const canvasFor = (page: Page) => page.getByRole("img", { name: "Interactive 3D factory floor", exact: true });
const routes = async (canvas: Locator): Promise<RouteSummary[]> =>
  JSON.parse((await canvas.getAttribute("data-connection-routes"))!);
const readPlacements = (page: Page) => page.evaluate((key) =>
  JSON.parse(localStorage.getItem(key)!)[0].document.placements, draftsKey);

async function fixture(page: Page, authenticated = true) {
  const writes: string[] = [], errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ draftsKey, placements }) => {
    if (localStorage.getItem("theme-preference") === null)
      localStorage.setItem("theme-preference", "light");
    if (!localStorage.getItem(draftsKey)) localStorage.setItem(draftsKey, JSON.stringify([{
      key: "routing-review", document: { name: "Routing review", width: 40, depth: 30, zones: [], placements },
      version: 0, updatedAt: "2026-10-31T00:00:00Z",
    }]));
  }, { draftsKey, placements });
  await page.route("**/api/runtime/contract", (route) => route.fulfill({ json: {
    contractVersion: runtimeContractVersion, capabilities: requiredCapabilities,
    schema: { ready: true }, versioned: true,
  } }));
  // Reference geometry is covered separately; these tests exercise the real proxy scene and routing.
  await page.route("**/api/equipment/reference/*/model?**", (route) => route.fulfill({ status: 404, body: "Synthetic reference unavailable" }));
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url()), batch = url.searchParams.has("batch");
    const procedures = decodeURIComponent(url.pathname.split("/trpc/")[1]).split(",");
    if (route.request().method() !== "GET") writes.push(...procedures);
    const responses = procedures.map((procedure) => {
      let value: unknown;
      switch (procedure) {
        case "auth.me": value = authenticated ? {
          id: 90001, name: "Review engineer", email: "review@example.test", openId: "review-engineer", role: "engineer",
          access: { demoOnly: false, workspaceView: "live", canSwitchData: true,
            canOperate: true, canEngineer: true, canAdminister: false },
        } : null; break;
        case "auth.demoAccounts": value = []; break;
        case "auth.registrationPolicy": value = { enabled: false }; break;
        case "notifications.summary": value = { unread: 0 }; break;
        case "factoryLayouts.list": value = []; break;
        case "factory.floor": value = { items, total: items.length, groups: [], links,
          complete: true, sampledAt: "2026-10-31T00:00:00Z" }; break;
        default: throw Error(`Unexpected routing/theme fixture request: ${procedure}`);
      }
      return { result: { data: superjson.serialize(value) } };
    });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(batch ? responses : responses[0]) });
  });
  await page.goto(authenticated ? "/#/layouts" : "/#/login");
  if (authenticated) {
    await expect(page.getByLabel("Layout name", { exact: true })).toHaveValue("Routing review");
    await expect(canvasFor(page)).toHaveAttribute("data-connection-count", "2");
  } else await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  return { writes, errors };
}

async function setTheme(page: Page, name: "Light" | "Dark" | "System") {
  await page.getByRole("button", { name: /^Theme settings/ }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}
async function planLines(page: Page) {
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  const plan = page.getByRole("img", { name: "Accessible factory floor plan", exact: true });
  const lines = plan.locator('line[stroke-dasharray=".2 .15"]');
  await expect(lines).toHaveCount(2);
  return lines.evaluateAll((elements) => elements.map((line) =>
    ["x1", "y1", "x2", "y2", "stroke-width", "stroke-dasharray"].map((name) => line.getAttribute(name))));
}

for (const width of [390, 1440]) {
  test(`physical wire/pipe routing persists without changing floor-plan lines or equipment at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const control = await fixture(page), canvas = canvasFor(page);
    await expect(canvas).toHaveAttribute("data-connection-rendering", "physical-meshes");
    expect((await routes(canvas)).map((r) => r.type)).toEqual(["pipe", "wire"]);
    const original = await readPlacements(page), lines = await planLines(page);
    await page.getByRole("button", { name: "3D floor", exact: true }).click();
    await expect(canvas).toHaveAttribute("data-connection-count", "2");
    await page.getByTestId("connection-routing").locator("summary").click();
    await page.getByLabel("3D connection", { exact: true }).selectOption(processId);
    const camera = await canvas.getAttribute("data-camera-view");
    await page.getByLabel("3D connection type", { exact: true }).selectOption("wire");
    await page.getByLabel("3D route shape", { exact: true }).selectOption("curve");
    await expect.poll(async () => (await routes(canvas))[0].type).toBe("wire");
    await expect.poll(async () => (await routes(canvas))[0].shape).toBe("curve");
    await page.getByLabel("3D route shape", { exact: true }).selectOption("straight");
    await expect.poll(async () => (await routes(canvas))[0].shape).toBe("straight");
    await page.getByLabel("3D connection type", { exact: true }).selectOption("pipe");
    await page.getByLabel("3D route shape", { exact: true }).selectOption("elbow");
    await page.getByLabel("Route height (m)", { exact: true }).fill("2.4");
    await page.getByLabel("Route height (m)", { exact: true }).press("Tab");
    await page.getByLabel("Diameter (m)", { exact: true }).fill("0.22");
    await page.getByLabel("Diameter (m)", { exact: true }).press("Tab");
    await expect.poll(async () => (await routes(canvas))[0].diameter).toBe(0.22);
    await page.getByLabel("3D connection colour", { exact: true }).fill("#8899aa");
    await expect.poll(async () => (await routes(canvas))[0].color).toBe("#8899aa");
    await page.getByLabel("3D route shape", { exact: true }).selectOption("custom");
    await page.getByRole("button", { name: "Add bend point", exact: true }).click();
    await page.getByLabel("Point 1 Y (m)", { exact: true }).fill("3");
    await page.getByLabel("Point 1 Y (m)", { exact: true }).press("Tab");
    await page.getByRole("button", { name: "Add bend point", exact: true }).click();
    await page.getByRole("button", { name: "Move point 2 earlier", exact: true }).click();
    await page.getByRole("button", { name: "Remove point 2", exact: true }).click();
    await expect(page.getByLabel("Point 2 Y (m)", { exact: true })).toHaveCount(0);
    await expect.poll(async () => (await routes(canvas))[0].shape).toBe("custom");
    expect(await canvas.getAttribute("data-camera-view")).toBe(camera);
    expect(await readPlacements(page)).toEqual(original);
    const configured = (await routes(canvas))[0];
    await page.getByLabel("Diameter (m)", { exact: true }).fill("-1");
    await page.getByLabel("Diameter (m)", { exact: true }).press("Tab");
    await expect(page.getByLabel("Diameter (m)", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect((await routes(canvas))[0].diameter).toBe(0.22);
    await page.reload();
    await expect.poll(async () => (await routes(canvas))[0]).toEqual(configured);
    expect(await planLines(page)).toEqual(lines);
    expect(await readPlacements(page)).toEqual(original);
    await page.getByRole("button", { name: "3D floor", exact: true }).click();
    await expect(canvas).toHaveAttribute("data-connection-count", "2");
    // A different layout scope must not inherit another study's custom route.
    await page.getByLabel("Layout name", { exact: true }).fill("Other routing review");
    await expect.poll(async () => (await routes(canvas))[0].shape).toBe("elbow");
    await page.getByLabel("Layout name", { exact: true }).fill("Routing review");
    await expect.poll(async () => (await routes(canvas))[0].shape).toBe("custom");
    await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Factory floor overview", exact: true })).toBeVisible();
    await expect(page.getByTestId("connection-routing").locator("summary")).toBeVisible();
    await page.getByRole("button", { name: "Fit whole factory floor", exact: true }).click();
    await page.screenshot({ path: `test-results/physical-routing-${width}.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(control.writes).toEqual([]);
    expect(control.errors).toEqual([]);
  });
}

for (const width of [390, 1440]) {
  test(`navigation stays dark while the workspace changes theme at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const control = await fixture(page);
    const nav = page.locator('[data-sidebar="sidebar"]:visible');
    const open = async () => { if (width < 768) await page.locator('[data-sidebar="trigger"]').click(); };
    const close = async () => { if (width < 768) await page.keyboard.press("Escape"); };
    const colours = () => nav.evaluate((element) => {
      const selectors = [":scope", '[data-sidebar="header"]', '[data-sidebar="menu-button"][data-active="true"]', '[aria-label="Open account menu"]'];
      return selectors.map((selector) => {
        const target = selector === ":scope" ? element : element.querySelector(selector)!;
        const style = getComputedStyle(target);
        return { background: style.backgroundColor, color: style.color, border: style.borderColor,
          muted: style.getPropertyValue("--muted-foreground"), primary: style.getPropertyValue("--primary") };
      });
    });
    await expect(page.locator("html")).toHaveClass(/light/);
    await open();
    await expect(nav).toHaveCSS("background-color", "rgb(15, 22, 41)");
    const baseline = await colours();
    await nav.getByRole("button", { name: "Open account menu", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCSS("background-color", "rgb(17, 29, 61)");
    await page.keyboard.press("Escape");
    await close();
    const lightMain = await page.locator("#dashboard-main").evaluate((e) => getComputedStyle(e).backgroundColor);
    await setTheme(page, "Dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("#dashboard-main")).not.toHaveCSS("background-color", lightMain);
    await open();
    expect(await colours()).toEqual(baseline);
    await close();
    await setTheme(page, "Light");
    await expect(page.locator("#dashboard-main")).toHaveCSS("background-color", lightMain);
    await open();
    expect(await colours()).toEqual(baseline);
    await page.screenshot({ path: `test-results/fixed-sidebar-light-${width}.png`, animations: "disabled" });
    await close();
    if (width >= 768) {
      await page.locator('[data-sidebar="trigger"]').click();
      await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible();
      await expect(nav).toHaveCSS("background-color", "rgb(15, 22, 41)");
    }
    expect(control.errors).toEqual([]);
  });
}

test("login keeps its photograph and dark form under light, dark and system preferences", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const control = await fixture(page, false);
  const login = page.locator('main[data-theme-scope="fixed-dark"]');
  const colours = () => login.evaluate((element) => {
    const selectors = [":scope", '[data-slot="card"]', "#email", "#password", "label", 'button[type="submit"]'];
    return selectors.map((selector) => {
      const target = selector === ":scope" ? element : element.querySelector(selector)!;
      const style = getComputedStyle(target);
      return { background: style.backgroundColor, color: style.color, border: style.borderColor,
        image: style.backgroundImage, scheme: style.colorScheme };
    });
  });
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(login.locator('[data-slot="card"]')).toHaveCSS("background-color", "rgb(17, 29, 61)");
  const baseline = await colours();
  expect(baseline[0].image).toContain("industrial-blur-bg.webp");
  for (const preference of ["dark", "light", "system"]) {
    await page.evaluate((value) => localStorage.setItem("theme-preference", value), preference);
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    expect(await colours()).toEqual(baseline);
    expect(await page.evaluate(() => localStorage.getItem("theme-preference"))).toBe(preference);
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await colours()).toEqual(baseline);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/light/);
  expect(await colours()).toEqual(baseline);
  await page.getByLabel("Email", { exact: true }).fill("review@example.test");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-test-only");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(page.locator("#password")).toHaveAttribute("type", "text");
  await page.screenshot({ path: "test-results/fixed-login-light.png", animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(control.errors).toEqual([]);
});

test("corrupt routing is retained and storage failure is reported without changing operational links", async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "unreadable-routing");
  }, routeKey);
  const control = await fixture(page), canvas = canvasFor(page);
  await page.getByTestId("connection-routing").locator("summary").click();
  await expect(page.getByRole("alert")).toContainText("retained");
  expect(await page.evaluate((key) => localStorage.getItem(key), routeKey)).toBe("unreadable-routing");
  await expect(page.getByLabel("3D connection type", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Reset unreadable 3D routing", exact: true }).click();
  await expect(page.getByLabel("3D connection type", { exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("smart-factory:connection-appearance:")) throw new DOMException("Synthetic quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByLabel("3D connection type", { exact: true }).selectOption("wire");
  await expect.poll(async () => (await routes(canvas))[0].type).toBe("wire");
  await expect(page.getByRole("alert")).toContainText("could not be saved");
  await expect(canvas).toHaveAttribute("data-connection-count", "2");
  expect(control.writes).toEqual([]);
  expect(control.errors).toEqual([]);
});

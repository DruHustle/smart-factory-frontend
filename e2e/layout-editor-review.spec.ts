import { test, expect, type Page } from "@playwright/test";
import superjson from "superjson";
import { readFile } from "node:fs/promises";
import {
  requiredCapabilities,
  runtimeContractVersion,
} from "../shared/runtime-contract";
import type { FactoryLayoutDocument } from "../shared/factory-layout";

const storageKey = "smart-factory:layout-drafts:v1:90001:live";
const document = (name: string): FactoryLayoutDocument => ({
  name,
  width: 40,
  depth: 30,
  zones: [],
  placements: [],
});
const id = "00000000-0000-4000-8000-000000000001";
const stored = (name: string, version = 1) => ({
  id,
  document: document(name),
  version,
  updatedAt: new Date().toISOString(),
  omittedItems: 0,
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
// Synthetic API delays exercise the actual editor without changing production accounts.
async function fixture(page: Page, graphics = false) {
  const control = {
    saveGate: undefined as ReturnType<typeof gate> | undefined,
    getGate: undefined as ReturnType<typeof gate> | undefined,
    saved: stored("Account layout"),
    saves: [] as any[],
    gets: 0,
  };
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
    const req = route.request(),
      url = new URL(req.url()),
      batch = url.searchParams.has("batch");
    const inputs = JSON.parse(
      url.searchParams.get("input") ?? req.postData() ?? "{}",
    );
    const procedures = decodeURIComponent(
      url.pathname.split("/trpc/")[1],
    ).split(",");
    const responses = await Promise.all(
      procedures.map(async (procedure, index) => {
        const input = (batch ? inputs[String(index)]?.json : inputs.json) ?? {};
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
                demoOnly: false,
                workspaceView: "live",
                canSwitchData: true,
                canOperate: true,
                canEngineer: true,
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
          case "auth.registrationPolicy":
            value = { enabled: false };
            break;
          case "factory.floor":
            value = {
              items: graphics
                ? [
                    "pump",
                    "conveyor",
                    "robot",
                    "control cabinet",
                    "valve",
                    "tank",
                    "gateway",
                  ].map((itemType, index) => ({
                    ...{
                      ref: "asset:1",
                      id: "1",
                      kind: "asset",
                      name: "Review pump",
                      identifier: "review-pump",
                      itemType: "pump",
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
                    },
                    ref: `asset:${index + 1}`,
                    id: String(index + 1),
                    name: `Reference ${itemType}`,
                    itemType,
                    equipmentId:
                      index === 6
                        ? "00000000-0000-4000-8000-000000000007"
                        : null,
                  }))
                : [
                    {
                      ref: "asset:1",
                      id: "1",
                      kind: "asset",
                      name: "Review pump",
                      identifier: "review-pump",
                      itemType: "pump",
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
                    },
                  ],
              total: graphics ? 7 : 1,
              groups: [],
              links: [],
              complete: true,
              sampledAt: new Date().toISOString(),
            };
            break;
          case "factoryLayouts.list":
            value = [
              {
                id,
                name: control.saved.document.name,
                version: control.saved.version,
                updatedAt: control.saved.updatedAt,
              },
            ];
            break;
          case "factoryLayouts.save":
            control.saves.push(input);
            await control.saveGate?.promise;
            control.saved = {
              ...stored(input.document.name, input.expectedVersion + 1),
              document: input.document,
            };
            value = control.saved;
            break;
          case "factoryLayouts.get":
            control.gets++;
            await control.getGate?.promise;
            value = control.saved;
            break;
          default:
            throw Error(`Unexpected review fixture request: ${procedure}`);
        }
        return { result: { data: superjson.serialize(value) } };
      }),
    );
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(batch ? responses : responses[0]),
    });
  });
  await page.goto("/#/layouts");
  await expect(page.getByLabel("Layout name", { exact: true })).toBeVisible();
  return control;
}
const readDrafts = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
    storageKey,
  );

for (const switchDraft of [false, true]) {
  test(`late save preserves ${switchDraft ? "another active draft and acknowledges the original" : "edits made after submission"}`, async ({
    page,
  }) => {
    const control = await fixture(page);
    const name = page.getByLabel("Layout name", { exact: true });
    await name.fill("Submitted layout");
    control.saveGate = gate();
    await page
      .getByRole("button", { name: "Save layout", exact: true })
      .click();
    await expect.poll(() => control.saves.length).toBe(1);
    if (switchDraft)
      await page
        .getByRole("button", { name: "New layout", exact: true })
        .click();
    await name.fill("Newer unsaved edits");
    control.saveGate.release();
    await expect(
      page.getByRole("button", { name: "Save layout", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(async () =>
        (await readDrafts(page)).some((d: any) => d.sourceId === id),
      )
      .toBe(true);
    await expect(name).toHaveValue("Newer unsaved edits");
    const drafts = await readDrafts(page);
    expect(drafts[0].document.name).toBe("Newer unsaved edits");
    expect(drafts[0].sourceId).toBe(switchDraft ? undefined : id);
    expect(drafts.find((d: any) => d.sourceId === id).version).toBe(1);
    await page.reload();
    await expect(name).toHaveValue("Newer unsaved edits");
    if (switchDraft)
      await page
        .getByRole("button", {
          name: "Submitted layout · 0 items",
          exact: true,
        })
        .click();
    await page
      .getByRole("button", { name: "Save layout", exact: true })
      .click();
    await expect.poll(() => control.saves.length).toBe(2);
    expect(control.saves[1]).toMatchObject({ id, expectedVersion: 1 });
  });
}

test("late account open cannot replace a newer draft or newer edits; reopen fetches the current version", async ({
  page,
}) => {
  const control = await fixture(page),
    name = page.getByLabel("Layout name", { exact: true });
  control.getGate = gate();
  await page
    .getByRole("button", { name: "Account layout · v1", exact: true })
    .click();
  await expect.poll(() => control.gets).toBe(1);
  await page.getByRole("button", { name: "New layout", exact: true }).click();
  await name.fill("Keep this draft");
  control.getGate.release();
  await expect.poll(() => control.gets).toBe(1);
  await expect(name).toHaveValue("Keep this draft");
  await page
    .getByRole("button", { name: "Account layout · v1", exact: true })
    .click();
  await expect(name).toHaveValue("Account layout");
  control.saved = stored("Updated in another browser", 4);
  await page
    .getByRole("button", { name: "Account layout · v1", exact: true })
    .click();
  await expect.poll(() => control.gets).toBe(3);
  await expect(name).toHaveValue("Updated in another browser");
  control.getGate = gate();
  await page
    .getByRole("button", { name: "Account layout · v1", exact: true })
    .click();
  await expect.poll(() => control.gets).toBe(4);
  await name.fill("Edit while opening");
  control.getGate.release();
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect.poll(() => control.saves.length).toBe(1);
  expect(control.saves[0]).toMatchObject({
    expectedVersion: 4,
    document: { name: "Edit while opening" },
  });
});

test("full browser draft storage can be recovered by removal and undo without deleting account saves", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, values }) => localStorage.setItem(key, JSON.stringify(values)),
    {
      key: storageKey,
      values: Array.from({ length: 50 }, (_, n) => ({
        key: `draft-${n}`,
        document: document(`Draft ${n}`),
        version: 0,
        updatedAt: new Date().toISOString(),
      })),
    },
  );
  const control = await fixture(page);
  await page.getByRole("button", { name: "New layout", exact: true }).click();
  await expect(page.getByLabel("Layout name", { exact: true })).toHaveValue(
    "Draft 0",
  );
  expect(await readDrafts(page)).toHaveLength(50);
  await page
    .getByRole("button", { name: "Remove browser draft Draft 49", exact: true })
    .click();
  await expect.poll(async () => (await readDrafts(page)).length).toBe(49);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await readDrafts(page)).length).toBe(50);
  await expect(page.getByLabel("Layout name", { exact: true })).toHaveValue(
    "Draft 49",
  );
  await page
    .getByRole("button", { name: "Remove browser draft Draft 48", exact: true })
    .click();
  await page.getByRole("button", { name: "New layout", exact: true }).click();
  await expect(page.getByLabel("Layout name", { exact: true })).toHaveValue(
    "My factory",
  );
  await expect.poll(async () => (await readDrafts(page)).length).toBe(50);
  expect(control.saves).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Account layout · v1", exact: true }),
  ).toBeVisible();
});

test("placing and selecting equipment in the editor keeps the floor in view", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByLabel("Layout name", { exact: true })
    .fill("Floor selection review");
  const canvas = page.getByRole("img", {
    name: "Interactive 3D factory floor",
    exact: true,
  });
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await page
    .getByRole("button", { name: "Place Review pump (asset)", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(
    page.getByLabel("Selected item rotation", { exact: true }),
  ).toBeAttached();
  // An animation frame allows selection effects and the deferred scene to settle.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await page.evaluate(() => scrollY)).toBe(before);
  await expect(canvas).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  const longName = "Factory".repeat(17);
  await page.getByLabel("Layout name", { exact: true }).fill(longName);
  const remove = page.getByRole("button", {
    name: `Remove browser draft ${longName}`,
    exact: true,
  });
  await expect(remove).toBeAttached();
  const row = await remove.evaluate((button) => {
    const container = button.closest("li")!.getBoundingClientRect();
    return [...button.parentElement!.querySelectorAll("button")].map(
      (child) => ({
        left: child.getBoundingClientRect().left - container.left,
        right: child.getBoundingClientRect().right - container.right,
      }),
    );
  });
  expect(row.every(({ left, right }) => left >= -1 && right <= 1)).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

async function grabFixture(page: Page, plan = false) {
  await fixture(page);
  await page
    .getByRole("button", { name: "Place Review pump (asset)", exact: true })
    .click();
  if (plan)
    await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  const canvas = page.getByRole("img", {
    name: plan
      ? "Accessible factory floor plan"
      : "Interactive 3D factory floor",
    exact: true,
  });
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-interaction", "grab");
  await expect(
    page.getByRole("group", { name: "Floor interaction", exact: true }),
  ).toHaveCount(0);
  await canvas.scrollIntoViewIfNeeded();
  await canvas.hover({ position: { x: 15, y: 15 } });
  const bounds = (await canvas.boundingBox())!;
  const item = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2 - 10,
  };
  const placement = async () =>
    (await readDrafts(page))[0].document.placements[0];
  return { canvas, bounds, item, placement };
}

test("3D hand grabs empty floor or equipment directly; camera stays fixed during item movement", async ({
  page,
}) => {
  const { canvas, bounds, item, placement } = await grabFixture(page);
  await expect(canvas).toHaveCSS("cursor", "grab");
  const original = await placement(),
    camera = await canvas.getAttribute("data-camera-view");
  await page.mouse.move(
    bounds.x + bounds.width * 0.5,
    bounds.y + bounds.height * 0.7,
  );
  await page.mouse.down();
  await expect(canvas).toHaveCSS("cursor", "grabbing");
  await expect(canvas).toHaveAttribute("data-grab-state", "floor");
  await page.mouse.move(
    bounds.x + bounds.width * 0.65,
    bounds.y + bounds.height * 0.8,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(canvas).toHaveCSS("cursor", "grab");
  await expect
    .poll(() => canvas.getAttribute("data-camera-view"))
    .not.toBe(camera);
  expect(await placement()).toEqual(original);
  await page
    .getByRole("button", { name: "Fit whole factory floor", exact: true })
    .click();
  await canvas.scrollIntoViewIfNeeded();
  await page.mouse.move(item.x, item.y);
  await expect(canvas).toHaveAttribute("data-grab-target", "asset:1");
  await page.keyboard.down("Space");
  const beforeSpace = await canvas.getAttribute("data-camera-view");
  await page.mouse.down();
  await expect(canvas).toHaveAttribute("data-grab-state", "floor");
  await page.mouse.move(item.x + 45, item.y + 25, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect
    .poll(() => canvas.getAttribute("data-camera-view"))
    .not.toBe(beforeSpace);
  expect(await placement()).toEqual(original);
  await page
    .getByRole("button", { name: "Fit whole factory floor", exact: true })
    .click();
  await page.mouse.move(item.x, item.y);
  const fixedCamera = await canvas.getAttribute("data-camera-view");
  await page.mouse.down();
  await expect(canvas).toHaveAttribute("data-grab-state", "item");
  await expect(canvas).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(item.x + 60, item.y + 25, { steps: 8 });
  expect(await placement()).toEqual(original); // Only dropping commits a layout edit.
  expect(await canvas.getAttribute("data-camera-view")).toBe(fixedCamera);
  await page.mouse.up();
  await expect.poll(placement).not.toEqual(original);
  await expect(canvas).toHaveAttribute("data-grab-state", "idle");
  const moved = await placement();
  await canvas.press("ArrowRight");
  await expect.poll(placement).not.toEqual(moved);
  expect(await canvas.getAttribute("data-camera-view")).toBe(fixedCamera);
  const beforeRotate = await canvas.getAttribute("data-camera-view"),
    beforeView = await placement();
  await page.mouse.move(item.x, item.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(item.x + 60, item.y + 25, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await expect
    .poll(() => canvas.getAttribute("data-camera-view"))
    .not.toBe(beforeRotate);
  const zoom = JSON.parse(
    (await canvas.getAttribute("data-camera-view"))!,
  ).zoom;
  await page.mouse.wheel(0, -180);
  await expect
    .poll(
      async () =>
        JSON.parse((await canvas.getAttribute("data-camera-view"))!).zoom,
    )
    .toBeGreaterThan(zoom);
  expect(await placement()).toEqual(beforeView);
  await page
    .getByLabel("Layout name", { exact: true })
    .fill("Direct grab factory");
  await page
    .getByRole("button", { name: "Fit whole factory floor", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/direct-floor-grab/desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Fit whole factory floor", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/direct-floor-grab/mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("3D grabs cancel safely and release outside the canvas; a pinch never moves equipment", async ({
  page,
  context,
}) => {
  const { canvas, bounds, item, placement } = await grabFixture(page);
  const original = await placement();
  await page.mouse.move(item.x, item.y);
  await page.mouse.down();
  await page.mouse.move(item.x + 35, item.y + 15, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await placement()).toEqual(original);
  await expect(canvas).toHaveCSS("cursor", "grab");
  await page.mouse.move(item.x, item.y);
  await page.mouse.down();
  await page.mouse.move(item.x + 20, item.y + 15, { steps: 6 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  expect(await placement()).toEqual(original);
  await expect(canvas).toHaveAttribute("data-grab-state", "idle");
  const cdp = await context.newCDPSession(page);
  const touch = (id: number, x: number, y: number) => ({
    id,
    x,
    y,
    radiusX: 2,
    radiusY: 2,
    force: 1,
  });
  const camera = await canvas.getAttribute("data-camera-view");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(1, item.x, item.y)],
  });
  await expect(canvas).toHaveAttribute("data-grab-state", "item");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(1, item.x, item.y), touch(2, item.x + 60, item.y)],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touch(1, item.x - 30, item.y), touch(2, item.x + 90, item.y)],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => canvas.getAttribute("data-camera-view"))
    .not.toBe(camera);
  expect(await placement()).toEqual(original);
  await expect(canvas).toHaveAttribute("data-grab-state", "idle");
  await page
    .getByRole("button", { name: "Fit whole factory floor", exact: true })
    .click();
  await page.mouse.move(item.x, item.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 25, bounds.y + bounds.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect.poll(placement).not.toEqual(original);
  await expect(canvas).toHaveAttribute("data-grab-state", "idle");
  await expect(canvas).toHaveCSS("cursor", "grab");
});

test("floor-plan fallback uses the same hand gesture and preserves cancelled edits", async ({
  page,
}) => {
  const { canvas, bounds, placement } = await grabFixture(page, true);
  const original = await placement(),
    view = await canvas.getAttribute("viewBox");
  await page.mouse.move(bounds.x + 30, bounds.y + 30);
  await page.mouse.down();
  await expect(canvas).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(bounds.x + 80, bounds.y + 50, { steps: 8 });
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute("viewBox", view!);
  expect(await placement()).toEqual(original);
  const symbol = canvas.locator('[data-floor-ref="asset:1"]');
  await symbol.hover();
  await expect(symbol).toHaveCSS("cursor", "grab");
  const box = (await symbol.boundingBox())!;
  const fixed = await canvas.getAttribute("viewBox");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute("data-grab-state", "item");
  await page.mouse.move(
    box.x + box.width / 2 + 40,
    box.y + box.height / 2 + 15,
    { steps: 8 },
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await placement()).toEqual(original);
  await symbol.hover();
  const b = (await symbol.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 15, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(placement).not.toEqual(original);
  await expect(canvas).toHaveAttribute("viewBox", fixed!);
  await expect(canvas).toHaveCSS("cursor", "grab");
});

for (const fallback of [false, true]) {
  test(`fullscreen enlarges the live floor and exits safely (${fallback ? "page fallback" : "native"})`, async ({
    page,
  }) => {
    if (fallback)
      await page.addInitScript(() => {
        Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
          configurable: true,
          value: undefined,
        });
      });
    const { canvas, placement } = await grabFixture(page, fallback);
    const before = await placement();
    const initialHeight = (await canvas.boundingBox())!.height;
    await page
      .getByRole("button", { name: "Enter fullscreen", exact: true })
      .click();
    const panel = page.getByRole("dialog", {
      name: "Factory floor overview",
      exact: true,
    });
    await expect(panel).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Exit fullscreen", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(async () => (await canvas.boundingBox())!.height)
      .toBeGreaterThan(initialHeight + 150);
    const bounds = (await panel.boundingBox())!,
      viewport = page.viewportSize()!;
    expect(Math.abs(bounds.width - viewport.width)).toBeLessThan(2);
    expect(Math.abs(bounds.height - viewport.height)).toBeLessThan(2);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      "hidden",
    );
    if (!fallback)
      expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(
        true,
      );
    expect(await placement()).toEqual(before);
    await page
      .getByRole("button", { name: "Exit fullscreen", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Enter fullscreen", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Enter fullscreen", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Factory floor overview", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Factory floor overview", exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
      "hidden",
    );
    expect(await placement()).toEqual(before);
  });
}

test("detailed equipment retains physical materials in the fullscreen factory", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/api/equipment/reference/*/model?**", async (route) => {
    const slug = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const file =
      slug === "pump-motor"
        ? "fixtures/equipment/pump-motor.glb"
        : slug === "raspberry-pi-4b"
          ? `fixtures/equipment/${slug}/model.glb`
          : `fixtures/equipment/factory/${slug}/model.glb`;
    await route.fulfill({
      contentType: "model/gltf-binary",
      body: await readFile(file),
    });
  });
  await fixture(page, true);
  for (const [name, value] of [
    ["Floor width in metres", "18"],
    ["Floor depth in metres", "12"],
  ]) {
    await page.getByLabel(name, { exact: true }).fill(value);
    await page.getByLabel(name, { exact: true }).press("Tab");
  }
  for (const type of [
    "pump",
    "conveyor",
    "robot",
    "control cabinet",
    "valve",
    "tank",
    "gateway",
  ])
    await page
      .getByRole("button", {
        name: `Place Reference ${type} (asset)`,
        exact: true,
      })
      .click();
  // Arrange the synthetic scene before reopening it; this check concerns real GLB rendering.
  await page.evaluate((key) => {
    const drafts = JSON.parse(localStorage.getItem(key)!);
    const coordinates = [
      [-6, -2],
      [-2, -2],
      [3, -2],
      [6, -2],
      [-5, 3],
      [0, 3],
      [5, 3],
    ];
    drafts[0].document.placements.forEach((p: any, index: number) => {
      [p.x, p.z] = coordinates[index];
    });
    localStorage.setItem(key, JSON.stringify(drafts));
  }, storageKey);
  await page.reload();
  await page
    .getByRole("button", { name: "Enter fullscreen", exact: true })
    .click();
  const canvas = page.getByRole("img", {
    name: "Interactive 3D factory floor",
    exact: true,
  });
  await expect(
    page.getByText("7 items on floor · 7 detailed models ready", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(canvas).toHaveAttribute(
    "data-graphics-environment",
    "baked-hdr-studio",
  );
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-reference-material-count")),
    )
    .toBeGreaterThan(10);
  await page
    .getByRole("button", { name: "Fit whole factory floor", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/direct-floor-grab/realistic-factory-fullscreen.png",
  });
  // Close focus uses the same live scene, without moving or saving any equipment.
  const before = (await readDrafts(page))[0].document.placements;
  const bounds = (await canvas.boundingBox())!;
  // Find a real model using the public hover hit target, then double-click it.
  let found = false;
  for (let y = 0.25; y < 0.8 && !found; y += 0.12)
    for (let x = 0.25; x < 0.8; x += 0.08) {
      await page.mouse.move(
        bounds.x + bounds.width * x,
        bounds.y + bounds.height * y,
      );
      if (
        (await canvas.getAttribute("data-grab-target"))?.startsWith("asset:")
      ) {
        const camera = await canvas.getAttribute("data-camera-view");
        await page.mouse.dblclick(
          bounds.x + bounds.width * x,
          bounds.y + bounds.height * y,
        );
        await expect(canvas).not.toHaveAttribute("data-camera-view", camera!);
        found = true;
        break;
      }
    }
  expect(found).toBe(true);
  expect((await readDrafts(page))[0].document.placements).toEqual(before);
  await page.screenshot({
    path: "test-results/direct-floor-grab/realistic-equipment-close.png",
  });
  await page
    .getByRole("button", { name: "Exit fullscreen", exact: true })
    .click();
  await page.getByRole("button", { name: /^Theme settings/ }).click();
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click();
  await page
    .getByRole("button", { name: "Enter fullscreen", exact: true })
    .click();
  await expect(
    page.getByText("7 items on floor · 7 detailed models ready", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(canvas).toHaveAttribute(
    "data-graphics-environment",
    "baked-hdr-studio",
  );
  await page.screenshot({
    path: "test-results/direct-floor-grab/realistic-factory-dark.png",
  });
  await page
    .getByRole("button", { name: "Exit fullscreen", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Enter fullscreen", exact: true })
    .click();
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Factory floor overview", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await canvas.boundingBox())!.height)
    .toBeGreaterThan(500);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/direct-floor-grab/realistic-factory-mobile.png",
  });
  expect(failures).toEqual([]);
});

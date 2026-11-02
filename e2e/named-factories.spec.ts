import { test, expect, type Page } from "@playwright/test";
import { noOverflow } from "./visual-workspace-helpers";
// These journeys include login, several inventory edits, persistence and history.
test.setTimeout(120000);
const key = "smart-factory:editable-demo:v2";
const snapshot = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);
const factoryIn = (state: any, id: string) => {
  const factory = state.factories.find((candidate: any) => candidate.id === id);
  expect(factory, "The selected factory must still be present").toBeDefined();
  return factory;
};
async function prepare(page: Page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create factory", exact: true })
    .click();
  await page
    .getByLabel("Factory name", { exact: true })
    .fill("Acceptance factory");
  await page.getByLabel("Floor width (m)", { exact: true }).fill("32");
  await page.getByLabel("Floor depth (m)", { exact: true }).fill("24");
  await page
    .getByRole("button", { name: "Create factory", exact: true })
    .last()
    .click();
  await expect(page.getByTestId("named-factory-workspace")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Acceptance factory", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  const id = await page
    .getByLabel("Active factory", { exact: true })
    .inputValue();
  expect(id).not.toBe("");
  return id;
}
async function add(page: Page, type: string, name: string, tag: string) {
  await page
    .getByRole("button", { name: "Add equipment", exact: true })
    .click();
  await page.getByLabel("Equipment type", { exact: true }).selectOption(type);
  await page.getByLabel("Item name", { exact: true }).fill(name);
  await page
    .getByLabel("Item tag (unique in this factory)", { exact: true })
    .fill(tag);
  await page
    .getByRole("button", { name: "Add inventory item", exact: true })
    .click();
  await expect(
    page.getByLabel("Factory editor", { exact: true }),
  ).not.toBeVisible();
}

test.describe("Explore with a selected named-factory item", () => {
  test.use({ hasTouch: true });
  for (const width of [320, 390])
    test(`controls do not cover the delete action at ${width}px`, async ({
      page,
    }) => {
      const factoryId = await prepare(page);
      await add(page, "pump", "Acceptance pump", "P-01");
      await page
        .getByRole("button", {
          name: "Select Acceptance pump on floor",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Close factory editor", exact: true })
        .click();
      await page.getByRole("button", { name: "3D floor", exact: true }).click();
      await page.setViewportSize({ width, height: 844 });
      await page
        .getByRole("button", { name: "Enter fullscreen", exact: true })
        .click();
      const before = await snapshot(page);
      await page
        .getByRole("button", {
          name: "Explore factory at eye level",
          exact: true,
        })
        .tap();
      const canvas = page.getByRole("img", {
        name: "Interactive 3D factory floor",
        exact: true,
      });
      await expect(canvas).toHaveAttribute("data-view-mode", "explore");
      const floor = (await canvas.boundingBox())!;
      const controls = (await page
        .getByRole("group", { name: "Explore controls" })
        .boundingBox())!;
      const exit = (await page
        .getByRole("button", { name: "Exit factory exploration" })
        .boundingBox())!;
      const legend = (await page
        .getByLabel("Floor indicator legend")
        .boundingBox())!;
      const selection = (await page
        .locator('[data-floor-selection-overlay="true"]')
        .boundingBox())!;
      const deleteButton = page.getByRole("button", {
        name: "Delete selected item from factory inventory",
        exact: true,
      });
      await expect(deleteButton).toBeVisible();
      const deletion = (await deleteButton.boundingBox())!;
      const overlaps = (a: typeof controls, b: typeof controls) =>
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
      expect(controls.x).toBeGreaterThanOrEqual(floor.x);
      expect(controls.y).toBeGreaterThanOrEqual(floor.y);
      expect(controls.x + controls.width).toBeLessThanOrEqual(
        floor.x + floor.width,
      );
      expect(controls.y + controls.height).toBeLessThanOrEqual(
        floor.y + floor.height,
      );
      for (const overlay of [exit, legend, selection, deletion])
        expect(overlaps(controls, overlay)).toBe(false);
      expect(factoryIn(await snapshot(page), factoryId)).toEqual(
        factoryIn(before, factoryId),
      );
    });
});
test("named factory inventory, hand drop to bin and attributed history stay consistent", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/trpc/"))
      writes.push(r.url().split("/trpc/")[1].split("?")[0]);
  });
  const factoryId = await prepare(page);
  await add(page, "pump", "Acceptance pump", "P-01");
  await add(page, "rack", "Warehouse rack", "RACK-01");
  await add(page, "loading", "Receiving door", "IN-01");
  const first = await snapshot(page),
    f = factoryIn(first, factoryId),
    ref = f.draft.document.placements[0].ref;
  expect(f.draft.document.width).toBe(32);
  expect(f.draft.document.placements).toHaveLength(3);
  expect(first.items.some((i: any) => i.ref === ref)).toBe(true);
  await page
    .getByRole("button", {
      name: "Select Acceptance pump on floor",
      exact: true,
    })
    .click();
  await page.getByLabel("X (m)", { exact: true }).fill("4");
  await page.getByLabel("Rotation (°)", { exact: true }).fill("90");
  await page
    .getByRole("button", { name: "Close factory editor", exact: true })
    .click();
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save layout", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId("named-factory-workspace")).toBeVisible();
  expect(
    factoryIn(await snapshot(page), factoryId).draft.document.placements.find(
      (p: any) => p.ref === ref,
    ),
  ).toMatchObject({ x: 4, rotation: 90 });
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  const item = page
    .locator(`[data-floor-ref="${ref}"]`)
    .locator("rect")
    .first();
  await item.scrollIntoViewIfNeeded();
  let body = (await item.boundingBox())!;
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
  await page.mouse.down();
  const bin = page.locator("[data-floor-bin]");
  await expect(bin).toContainText("Drop to delete");
  let b = (await bin.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  expect((await snapshot(page)).items.some((i: any) => i.ref === ref)).toBe(
    true,
  );
  await confirm.getByRole("button", { name: "Keep item", exact: true }).click();
  expect(
    factoryIn(await snapshot(page), factoryId).draft.document.placements.find(
      (p: any) => p.ref === ref,
    ).x,
  ).toBe(4);
  await item.click();
  await page
    .getByRole("button", {
      name: "Delete selected item from factory inventory",
      exact: true,
    })
    .click();
  await confirm
    .getByRole("button", { name: "Delete inventory item", exact: true })
    .click();
  await expect(confirm).not.toBeVisible();
  const removed = await snapshot(page);
  expect(removed.items.some((i: any) => i.ref === ref)).toBe(false);
  expect(factoryIn(removed, factoryId).draft.document.placements).toHaveLength(
    2,
  );
  await page
    .getByRole("button", { name: "Factory activity", exact: true })
    .click();
  const history = page.getByLabel("Factory change history", { exact: true });
  await expect(history).toContainText("Demo Admin");
  await expect(history).toContainText("Inventory item deleted");
  await expect(history).toContainText("Placement or dimensions changed");
  await history.getByText("View changes", { exact: true }).first().click();
  await expect(history).toContainText("P-01");
  await page.screenshot({
    path: "test-results/public-demo/named-factory-history.png",
    fullPage: true,
  });
  expect(writes.filter((p) => !p.startsWith("auth."))).toEqual([]);
});
test("factory roles, fullscreen editor and mobile layout work without server demo writes", async ({
  page,
}) => {
  const factoryId = await prepare(page);
  await add(page, "exit", "Personnel exit", "EXIT-01");
  await page
    .getByLabel("Factory demo role", { exact: true })
    .selectOption("viewer");
  await expect(
    page.getByRole("button", { name: "Add equipment", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save layout", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Enter fullscreen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Factory activity", exact: true })
    .click();
  const fullscreen = page.getByRole("dialog", {
    name: "Factory floor overview",
    exact: true,
  });
  await expect(
    fullscreen.getByLabel("Factory change history", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close factory editor", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Exit fullscreen", exact: true })
    .click();
  await page
    .getByLabel("Factory demo role", { exact: true })
    .selectOption("engineer");
  await expect(
    page.getByRole("button", { name: "Add equipment", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Delete selected item from factory inventory",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Edit factory floor", exact: true })
    .click();
  await page
    .getByLabel("Saved factory name", { exact: true })
    .fill("Mobile factory");
  await page
    .getByRole("button", { name: "Close factory editor", exact: true })
    .click();
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Mobile factory", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/public-demo/named-factory-mobile.png",
    fullPage: true,
  });
  await page.goto("/#/inventory");
  await expect(
    page.getByLabel("Factory inventory", { exact: true }),
  ).toContainText("Personnel exit");
  await page
    .getByRole("button", { name: "Edit factory floor", exact: true })
    .click();
  await page
    .getByLabel("Saved factory name", { exact: true })
    .fill("Discarded by explicit reset");
  await page.goto("/#/sandbox");
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset this demo workspace", exact: true })
    .click();
  const reset = await snapshot(page);
  expect(reset.factories).toHaveLength(1);
  expect(reset.factories[0].draft.document).toMatchObject({
    name: "Current Pi + DHT11 setup",
    width: 4,
    depth: 4,
  });
  expect(reset.factories[0].draft.document.placements).toHaveLength(2);
  expect(reset.factories.some((factory: any) => factory.id === factoryId)).toBe(
    false,
  );
  expect(reset.factoryActivity).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("smart-factory:named-factory-draft:v1:"),
        ).length,
    ),
  ).toBe(0);
  await page.goto("/#/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
});

test("the rendered factory supports direct hand dragging to its inventory bin", async ({
  page,
  browserName,
}) => {
  const factoryId = await prepare(page);
  await add(page, "pump", "Grabbed pump", "GRAB-01");
  const initial = await snapshot(page),
    ref = factoryIn(initial, factoryId).draft.document.placements[0].ref;
  await page.getByRole("button", { name: "3D floor", exact: true }).click();
  const scene = page.getByRole("img", {
      name: "Interactive 3D factory floor",
      exact: true,
    }),
    plan = page.getByRole("img", {
      name: "Accessible factory floor plan",
      exact: true,
    });
  await expect
    .poll(
      async () =>
        ((await scene.isVisible()) &&
          (await scene.getAttribute("data-interaction")) === "grab") ||
        (await page
          .getByText("3D unavailable on this device · Showing floor plan", {
            exact: true,
          })
          .isVisible()),
    )
    .toBe(true);
  let point: { x: number; y: number } | undefined;
  if (await scene.isVisible()) {
    await expect(scene).toHaveAttribute("data-interaction", "grab");
    await scene.scrollIntoViewIfNeeded();
    const box = (await scene.boundingBox())!;
    for (const dy of [-20, -15, -10, -5, 0, 5, 10]) {
      for (const dx of [0, -5, 5, -10, 10, -15, 15]) {
        await page.mouse.move(box.x - 8, box.y - 8);
        const candidate = {
          x: box.x + box.width / 2 + dx,
          y: box.y + box.height / 2 + dy,
        };
        await page.mouse.move(candidate.x, candidate.y);
        if ((await scene.getAttribute("data-grab-target")) === ref) {
          point = candidate;
          break;
        }
      }
      if (point) break;
    }
    expect(
      point,
      "The visible measured equipment surface must be directly grabbable",
    ).toBeTruthy();
  } else {
    expect(browserName).toBe("webkit");
    await plan.scrollIntoViewIfNeeded();
    const box = (await plan
      .locator(`[data-floor-ref="${ref}"] rect`)
      .first()
      .boundingBox())!;
    point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    test.info().annotations.push({
      type: "renderer",
      description: "Automatic accessible floor-plan fallback",
    });
  }
  await page.mouse.move(point!.x, point!.y);
  await page.mouse.down();
  const bin = page.locator("[data-floor-bin]");
  await expect(bin).toContainText("Drop to delete");
  const box = (await bin.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 8,
  });
  await expect(bin).toHaveAttribute("data-drop-active", "true");
  await page.mouse.up();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Grabbed pump");
  expect((await snapshot(page)).items.some((i: any) => i.ref === ref)).toBe(
    true,
  );
  await confirm
    .getByRole("button", { name: "Delete inventory item", exact: true })
    .click();
  await expect(confirm).not.toBeVisible();
  expect(
    factoryIn(await snapshot(page), factoryId).draft.document.placements,
  ).toEqual([]);
  expect((await snapshot(page)).factoryActivity.at(-1)).toMatchObject({
    action: "inventory.deleted",
    actorName: "Demo Admin",
  });
});

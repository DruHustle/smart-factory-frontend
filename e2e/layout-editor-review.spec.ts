import { test, expect, type Page } from "@playwright/test";
import superjson from "superjson";
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
async function fixture(page: Page) {
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
              items: [
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
              total: 1,
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

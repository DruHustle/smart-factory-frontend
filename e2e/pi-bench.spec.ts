import { expect, test } from "@playwright/test";

test("current hardware bench shows the Pi 5, WROVER/DHT11 and recorded gateway path", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Demo Admin", exact: true }).click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const factory = page.getByLabel("Active factory", { exact: true });
  await expect(
    factory.getByRole("option", {
      name: "Current Pi + DHT11 setup · 2 items",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(factory).toHaveValue("");
  await factory.selectOption({ label: "Current Pi + DHT11 setup · 2 items" });
  await expect(
    page.getByRole("heading", { name: "Current Pi + DHT11 setup" }),
  ).toBeVisible();
  await expect(page.getByText("Hardware topology: DHT11")).toBeVisible();
  const scene = page.getByRole("img", {
    name: "Interactive 3D factory floor",
    exact: true,
  });
  await expect(scene).toBeVisible();
  await expect(
    page.getByTestId("factory-floor").getByRole("status"),
  ).toHaveText("2 items on floor · 0 detailed models ready");
  // These bench boards use detailed procedural geometry, not downloaded GLBs.
  await expect(scene).toHaveAttribute(
    "data-graphics-environment",
    "baked-hdr-studio",
  );
  await expect(
    page.getByText("Login successful!", { exact: true }),
  ).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await scene.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    const floor = page.getByTestId("factory-floor");
    const status = await floor.getByRole("status").boundingBox();
    const rotate = await floor
      .getByRole("button", { name: "Rotate with mouse movement", exact: true })
      .boundingBox();
    expect(status).not.toBeNull();
    expect(rotate).not.toBeNull();
    expect(
      status!.x + status!.width <= rotate!.x ||
        rotate!.x + rotate!.width <= status!.x ||
        status!.y + status!.height <= rotate!.y ||
        rotate!.y + rotate!.height <= status!.y,
      `Factory status and rotation control must not overlap at ${width}px`,
    ).toBe(true);
    if (width === 390) {
      const representations = page.getByRole("group", {
        name: "Floor representation",
      });
      const rows = await representations
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getBoundingClientRect().y),
        );
      expect(
        new Set(rows).size,
        "All four representations should fit a single mobile toolbar row",
      ).toBe(1);
      const help = page
        .locator("summary")
        .filter({ hasText: /^View controls$/ });
      await help.click();
      await expect(
        page.getByText(/Rotate off: hovering stays still/),
      ).toBeVisible();
      await help.click();
    }
    // Full-page captures should place the sticky header at the page top and
    // avoid retaining keyboard focus from the preceding login/viewport change.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await page.screenshot({
      path: `test-results/public-demo/pi-bench-3d-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  const plan = page.getByRole("img", {
    name: "Accessible factory floor plan",
  });
  await expect(plan).toHaveAttribute("data-factory-areas", "[]");
  await expect(plan.locator("[data-floor-ref]")).toHaveCount(2);
  await expect(
    plan.getByRole("button", { name: "Select Raspberry Pi 5 gateway" }),
  ).toBeVisible();
  await expect(
    plan.getByRole("button", { name: "Select ESP32 WROVER + DHT11 sensor" }),
  ).toBeVisible();
  await expect(plan.locator('line[stroke="var(--info)"]')).toHaveCount(1);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Current Pi + DHT11 setup" }),
  ).toBeVisible();
  await factory.selectOption("");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(factory).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
});

test("a returning demo user adds the Pi bench while retaining saved work and an unsaved draft", async ({
  page,
}) => {
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Demo Admin", exact: true }).click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Active factory")
      .getByRole("option", { name: "Current Pi + DHT11 setup · 2 items" }),
  ).toHaveCount(1);
  const saved = await page.evaluate(() => {
    const key = "smart-factory:editable-demo:v2";
    const state = JSON.parse(localStorage.getItem(key)!);
    const benchRefs = new Set(
      state.factories.flatMap((factory: any) =>
        factory.draft.document.placements.map((p: any) => p.ref),
      ),
    );
    state.items = state.items.filter((item: any) => !benchRefs.has(item.ref));
    const factory = {
      id: crypto.randomUUID(),
      version: 1,
      updatedAt: state.updatedAt,
      draft: {
        document: {
          name: "Saved assembly floor",
          width: 6,
          depth: 6,
          zones: [],
          placements: [],
        },
        dimensions: {},
        tags: {},
      },
    };
    state.factories = [factory];
    state.factoryActivity = [
      {
        id: "1",
        factoryId: factory.id,
        changeSet: crypto.randomUUID(),
        actorId: null,
        actorName: "Demo Engineer",
        actorRole: "engineer",
        action: "factory.created",
        targetRef: null,
        at: state.updatedAt,
        before: null,
        after: { name: factory.draft.document.name },
      },
    ];
    state.audit = [
      {
        id: crypto.randomUUID(),
        at: state.updatedAt,
        role: "engineer",
        action: "factory.create",
      },
    ];
    localStorage.setItem(key, JSON.stringify(state));
    const draftKey = `smart-factory:named-factory-draft:v1:demo-visitor:demo:${factory.id}`;
    const draft = structuredClone(factory.draft);
    draft.document.width = 8;
    const rawDraft = JSON.stringify({
      baseVersion: 1,
      baseFingerprint: JSON.stringify(factory.draft),
      writer: crypto.randomUUID(),
      draft,
    });
    localStorage.setItem(draftKey, rawDraft);
    return { state, draftKey, rawDraft };
  });
  await page.reload();
  const selector = page.getByLabel("Active factory", { exact: true });
  await expect(selector).toHaveValue("");
  await page.getByRole("button", { name: "Add Pi bench", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Current Pi + DHT11 setup",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add Pi bench", exact: true }),
  ).toHaveCount(0);
  const after = await page.evaluate(
    (draftKey) => ({
      state: JSON.parse(
        localStorage.getItem("smart-factory:editable-demo:v2")!,
      ),
      rawDraft: localStorage.getItem(draftKey),
    }),
    saved.draftKey,
  );
  expect(after.state.items.slice(0, saved.state.items.length)).toEqual(
    saved.state.items,
  );
  expect(after.state.factories[0]).toEqual(saved.state.factories[0]);
  expect(after.state.samples).toEqual(saved.state.samples);
  expect(after.state.factoryActivity[0]).toEqual(
    saved.state.factoryActivity[0],
  );
  expect(after.state.factories).toHaveLength(2);
  expect(after.rawDraft).toBe(saved.rawDraft);
  await page.reload();
  await expect(
    selector.getByRole("option", {
      name: "Current Pi + DHT11 setup · 2 items",
      exact: true,
    }),
  ).toHaveCount(1);
  await selector.selectOption(saved.state.factories[0].id);
  await expect(
    page.getByRole("heading", { name: "Saved assembly floor", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Unsaved layout draft · Browser sandbox", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Factory totals", { exact: true }),
  ).toContainText("8 × 6 m");
  await expect(
    page.getByRole("button", { name: "Save layout", exact: true }),
  ).toBeEnabled();
});

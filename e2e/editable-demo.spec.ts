import { test, expect, type Page } from "@playwright/test";
import { enterSimulation, noOverflow } from "./visual-workspace-helpers";
async function ask(page: Page, text: string) {
  const count = await page.getByTestId("assistant-answer-content").count();
  await page
    .getByRole("textbox", { name: "Ask the Smart Factory Assistant" })
    .fill(text);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("assistant-answer-content")).toHaveCount(
    count + 1,
  );
  return page.getByTestId("assistant-answer-content").last();
}
test("Assistant handles the reported question and coherent follow-ups without machinery noise", async ({
  page,
}) => {
  await enterSimulation(page, 390);
  await page.goto("/#/assistant");
  await expect(await ask(page, "hi")).toContainText("Hello");
  const a = await ask(page, "whats fx and tsn");
  await expect(a).toContainText("Field eXchange");
  await expect(a).toContainText("Time-Sensitive Networking");
  await expect(a).not.toContainText("gateway-01");
  expect(await page.locator("svg.recharts-surface").count()).toBe(0);
  await expect(await ask(page, "explain that simply")).toContainText("FX");
  await expect(await ask(page, "give me an example")).toContainText("TSN");
  await expect(await ask(page, "do I need both")).toContainText("FX");
  await expect(
    await ask(page, "are we using it on real hardware"),
  ).toContainText("Real timing claims need compatible hardware");
  await noOverflow(page);
});
test("editable demo persists, respects roles, informs the assistant, prints and resets", async ({
  page,
  browser,
}) => {
  await enterSimulation(page);
  await page.goto("/#/sandbox?tab=inventory");
  await expect(
    page.getByRole("button", { name: "Create demo equipment", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Demo role", { exact: true }).selectOption("admin");
  await expect(
    page.getByRole("button", { name: "Create demo equipment", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Demo equipment name", { exact: true })
    .fill("Acceptance pump");
  await page
    .getByRole("button", { name: "Create demo equipment", exact: true })
    .click();
  await page
    .getByLabel("Demo equipment", { exact: true })
    .selectOption({ label: "Acceptance pump · asset" });
  await page
    .getByRole("button", { name: "Telemetry & incidents", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save demo threshold", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate simulated reading", exact: true })
    .click();
  await expect(
    page.getByRole("article").filter({ hasText: "Acceptance pump · critical" }),
  ).toContainText("Status: open");
  await page
    .getByRole("button", { name: "Acknowledge demo incident", exact: true })
    .click();
  await expect(
    page.getByRole("article").filter({ hasText: "Acceptance pump · critical" }),
  ).toContainText("acknowledged");
  await page.reload();
  await expect(
    page.getByRole("article").filter({ hasText: "Acceptance pump · critical" }),
  ).toContainText("acknowledged");
  await page
    .getByRole("button", { name: "Resolve demo incident", exact: true })
    .click();
  await expect(
    page.getByRole("article").filter({ hasText: "Acceptance pump · critical" }),
  ).toContainText("Status: resolved");
  await page.goto("/#/assistant");
  const answer = await ask(page, "What is Acceptance pump temperature?");
  await expect(answer).toContainText("85 °C");
  await expect(answer).toContainText("Acceptance pump");
  await expect(answer).toContainText("simulation");
  await page.goto("/#/sandbox?tab=telemetry");
  await page
    .getByLabel("Demo equipment", { exact: true })
    .selectOption({ label: "Acceptance pump · asset" });
  await page.getByLabel("Simulated reading value", { exact: true }).fill("95");
  await page
    .getByRole("button", { name: "Generate simulated reading", exact: true })
    .click();
  await page.goto("/#/assistant");
  const latest = await ask(page, "What is Acceptance pump temperature?");
  await expect(latest).toContainText("95 °C");
  await expect(latest).not.toContainText("85 °C");
  await page.goto("/#/sandbox?tab=passport");
  await page
    .getByLabel("Demo equipment", { exact: true })
    .selectOption({ label: "Acceptance pump · asset" });
  await page.evaluate(() => {
    (window as any).__printed = 0;
    window.print = () => {
      (window as any).__printed++;
    };
  });
  await page
    .getByRole("button", { name: "Print demo passport", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("heading", { name: "Acceptance pump", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/visual-workspaces/demo-passport-print.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "Firmware & integrations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add sample firmware metadata", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Queue demo update", exact: true })
    .click();
  await expect(
    page.getByRole("article").filter({ hasText: "demo-2.0.0" }),
  ).toContainText("queued");
  await page
    .getByRole("button", { name: "Simulate completion", exact: true })
    .click();
  await expect(
    page.getByRole("article").filter({ hasText: "demo-2.0.0" }),
  ).toContainText("completed");
  await page
    .getByRole("button", { name: "Network & security", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create simulated finding", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record demo decision", exact: true })
    .click();
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: "Simulated software review finding" }),
  ).toContainText("investigated");
  await page
    .getByRole("button", { name: "Users & settings", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export demo backup", exact: true })
    .click();
  const download = await downloadPromise,
    stream = (await download.createReadStream())!,
    chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const backup = Buffer.concat(chunks);
  expect(
    JSON.parse(backup.toString()).items.some(
      (i: any) => i.name === "Acceptance pump",
    ),
  ).toBe(true);
  const independent = await browser.newContext();
  try {
    const separate = await independent.newPage();
    await enterSimulation(separate);
    await separate.goto("/#/sandbox?tab=inventory");
    await expect(
      separate.getByLabel("Demo equipment", { exact: true }),
    ).not.toContainText("Acceptance pump");
  } finally {
    await independent.close();
  }
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset this demo workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Inventory & engineering", exact: true })
    .click();
  await expect(
    page.getByLabel("Demo equipment", { exact: true }),
  ).not.toContainText("Acceptance pump");
  await page.reload();
  await expect(
    page.getByLabel("Demo equipment", { exact: true }),
  ).not.toContainText("Acceptance pump");
  await page
    .getByRole("button", { name: "Users & settings", exact: true })
    .click();
  await page.getByLabel("Restore demo backup", { exact: true }).setInputFiles({
    name: "demo-workspace-backup.json",
    mimeType: "application/json",
    buffer: backup,
  });
  await page
    .getByRole("button", { name: "Inventory & engineering", exact: true })
    .click();
  await expect(
    page.getByLabel("Demo equipment", { exact: true }),
  ).toContainText("Acceptance pump");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});

test("reference demo passports print approved fields while anonymous previews remain private", async ({
  page,
  browser,
}) => {
  const s = await enterSimulation(page);
  const id = s.assetRef.split(":")[1];
  await page.goto(`/#/passport/${id}`);
  await expect(
    page.getByText("Demo product passport · simulated information", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed snapshot",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__printed = 0;
    window.print = () => {
      (window as any).__printed++;
    };
  });
  await page
    .getByRole("button", { name: "Print passport", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
  const anonymous = await browser.newContext();
  try {
    const p = await anonymous.newPage();
    await p.goto(new URL(`/#/passport/${id}`, page.url()).href);
    await expect(
      p.getByText("Private passport preview", { exact: true }),
    ).toBeVisible();
  } finally {
    await anonymous.close();
  }
});
test("factory layouts place and move items, pan the floor and reopen a saved draft", async ({
  page,
}) => {
  await enterSimulation(page);
  await page.goto("/#/layouts");
  await page
    .getByLabel("Layout name", { exact: true })
    .fill("My acceptance factory");
  await page.getByRole("button", { name: "Add zone", exact: true }).click();
  await page.getByLabel("Zone 1 name", { exact: true }).fill("Assembly");
  const place = page
    .getByRole("button", { name: /^Place .*\(asset\)$/ })
    .first();
  await expect(place).toBeVisible();
  await place.click();
  await page.getByLabel("Selected item rotation", { exact: true }).fill("45");
  await page.getByLabel("Selected item rotation", { exact: true }).press("Tab");
  const canvas = page.getByRole("img", {
    name: "Interactive 3D factory floor",
    exact: true,
  });
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-camera-view", /.+/);
  await expect(canvas).toHaveAttribute("data-interaction", "grab");
  await canvas.scrollIntoViewIfNeeded();
  await canvas.hover({ position: { x: 20, y: 20 } });
  const readPlacement = () =>
    page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("smart-factory:layout-drafts:v1:demo-visitor")!,
        )[0].document.placements[0],
    );
  const originalPlacement = await readPlacement();
  const before = await canvas.getAttribute("data-camera-view"),
    box = (await canvas.boundingBox())!;
  await canvas.hover({ position: { x: box.width * 0.5, y: box.height * 0.6 } });
  await expect(canvas).toHaveAttribute("data-grab-target", "floor");
  await page.mouse.down();
  await expect(canvas).toHaveAttribute("data-grab-state", "floor");
  expect((await canvas.boundingBox())!.y).toBe(box.y);
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.7, {
    steps: 12,
  });
  await page.mouse.up();
  expect(await readPlacement()).toEqual(originalPlacement);
  expect((await canvas.boundingBox())!.y).toBe(box.y);
  await expect
    .poll(() => canvas.getAttribute("data-camera-view"))
    .not.toBe(before);
  await page
    .getByRole("button", { name: "Fit whole factory floor", exact: true })
    .click();
  const placement = await readPlacement();
  const fixedCamera = await canvas.getAttribute("data-camera-view");
  await expect(canvas).toHaveAttribute("data-interaction", "grab");
  await canvas.scrollIntoViewIfNeeded();
  await canvas.hover({ position: { x: 20, y: 20 } });
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2 - 10,
  );
  await expect(canvas).toHaveAttribute("data-grab-target", placement.ref);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute("data-grab-state", "item");
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 60,
    bounds.y + bounds.height / 2 + 20,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect.poll(readPlacement).not.toEqual(placement);
  expect(await canvas.getAttribute("data-camera-view")).toBe(fixedCamera);
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  const symbol = page.locator("[data-floor-ref]").first();
  const geometry = symbol.locator(":scope > g[transform]").first();
  const transform = await geometry.getAttribute("transform");
  await symbol.focus();
  await symbol.press("ArrowRight");
  await expect(geometry).not.toHaveAttribute("transform", transform!);
  const moved = await geometry.getAttribute("transform");
  await page
    .getByRole("button", { name: "Save demo layout", exact: true })
    .click();
  await page.reload();
  await expect(page.getByLabel("Layout name", { exact: true })).toHaveValue(
    "My acceptance factory",
  );
  await expect(
    page.getByLabel("Selected item rotation", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  await expect(
    page.locator("[data-floor-ref] > g[transform]").first(),
  ).toHaveAttribute("transform", moved!);
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/visual-workspaces/factory-layout-mobile.png",
    fullPage: true,
  });
});

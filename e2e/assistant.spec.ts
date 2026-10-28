import { test, expect, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enterSimulation, noOverflow } from "./visual-workspace-helpers";
const out =
  process.env.VISUAL_WORKSPACE_EVIDENCE_DIR ??
  "test-results/visual-workspaces";
const question = "Why does Showcase pump 01 need attention?";
const input = (page: import("@playwright/test").Page) =>
  page.getByRole("textbox", { name: "Ask the Smart Factory Assistant" });
async function ask(page: import("@playwright/test").Page, text = question) {
  await input(page).fill(text);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    page.getByTestId("assistant-answer-content").last(),
  ).toBeVisible();
}
function response(route: Route, data: unknown) {
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(
      new URL(route.request().url()).searchParams.has("batch")
        ? [{ result: { data: { json: data } } }]
        : { result: { data: { json: data } } },
    ),
  });
}
test("Assistant uses stored visual evidence, earlier sources and one automatic preview", async ({
  page,
}) => {
  const s = await enterSimulation(page);
  await page.goto("/#/assistant");
  await expect(
    page.getByRole("heading", { name: "What would you like to understand?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Assistant asset context" }),
  ).toHaveCount(1);
  await ask(page);
  await expect(page.locator("svg.recharts-surface").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Showcase pump 01 recorded/ }),
  ).toContainText("°C");
  await expect(page.locator("[data-state=ready]")).toBeVisible({
    timeout: 30000,
  });
  expect(
    await page
      .getByRole("img", { name: "Interactive 3D equipment model" })
      .count(),
  ).toBe(1);
  const first = page.getByRole("article").first();
  await ask(page, "How do I import an AASX package?");
  await expect(
    page.getByRole("navigation", { name: "Workflow navigation" }),
  ).toBeVisible();
  await first.getByRole("button", { name: /Sources & context/ }).click();
  await expect(
    first.getByRole("button", { name: /Sources & context/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("region", { name: "Answer evidence" }),
  ).toContainText("Answer snapshot");
  const source = first.getByRole("button", { name: /Source \d+:/ }).first();
  await source.click();
  await expect(
    page.locator("[data-source-number] details[open]").first(),
  ).toBeVisible();
  const numbers = await page
    .locator("[data-source-number]")
    .evaluateAll((rows) =>
      rows.map((r) => r.getAttribute("data-source-number")),
    );
  await page
    .getByRole("button", { name: "Stored evidence", exact: true })
    .click();
  const filtered = await page
    .locator("[data-source-number]")
    .evaluateAll((rows) =>
      rows.map((r) => r.getAttribute("data-source-number")),
    );
  expect(filtered.every((n) => numbers.includes(n))).toBe(true);
  await expect(
    page.getByRole("link", { name: "Open 3D inspection", exact: true }),
  ).toHaveAttribute(
    "href",
    new RegExp(s.assetRef.replace(":", "%3A") + "|" + s.assetRef),
  );
  await page.goto("/#/inventory");
  await page.goto("/#/assistant");
  await expect(page.getByTestId("assistant-answer-content")).toHaveCount(2);
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(page.getByTestId("assistant-answer-content")).toHaveCount(0);
  await expect(input(page)).toBeFocused();
});
test("Assistant immediately shows pending, retains a failed draft and retries its captured context", async ({
  page,
}) => {
  const s = await enterSimulation(page, 390, "dark");
  await page.goto("/#/assistant?asset=" + encodeURIComponent(s.assetId));
  let release: () => void = () => {},
    attempts = 0;
  const bodies: string[] = [];
  await page.route("**/api/trpc/assistant.ask*", async (route) => {
    attempts++;
    bodies.push(route.request().postData() ?? "");
    if (attempts === 1) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify([
          {
            error: {
              json: {
                message: "Isolated service interruption",
                code: -32603,
                data: {
                  code: "INTERNAL_SERVER_ERROR",
                  httpStatus: 503,
                  path: "assistant.ask",
                },
              },
            },
          },
        ]),
      });
    }
    await route.continue();
  });
  await input(page).fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("article")).toContainText(question);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Checking authorized evidence" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ask", exact: true }),
  ).toBeDisabled();
  expect(attempts).toBe(1);
  release();
  await expect(
    page.getByRole("button", { name: "Retry this question" }),
  ).toBeVisible();
  await expect(input(page)).toHaveValue(question);
  await page.getByRole("button", { name: "Retry this question" }).click();
  await expect(page.getByTestId("assistant-answer-content")).toBeVisible();
  expect(attempts).toBe(2);
  expect(bodies[1]).toBe(bodies[0]);
  await page.getByRole("button", { name: /Sources & context/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Sources & context/ }),
  ).toBeFocused();
  await noOverflow(page);
});
test("Assistant keeps Markdown safe, citations stable, IME and mobile composition usable", async ({
  page,
}) => {
  await enterSimulation(page, 390);
  await page.goto("/#/assistant");
  let calls = 0;
  await page.route("**/api/trpc/assistant.ask*", async (route) => {
    calls++;
    return response(route, {
      answer:
        '## Approved workflow\n1. Review the [inventory](/#/inventory). [2]\n2. Read the source.\n\n```javascript\nconst example = "<img src=x onerror=window.__assistantInjected=true>";\n' +
        "veryLongIdentifier".repeat(80) +
        "\n```\n\n<img src=x onerror=window.__assistantInjected=true>\n" +
        "Review approved documentation before commissioning. ".repeat(35),
      contextAt: "2026-10-27T09:00:00Z",
      sources: [
        {
          title: "Mocked approved guide",
          section: "Documentation",
          path: "docs/guide.md",
          excerpt: "An isolated UI-test documentation excerpt.",
          kind: "documentation",
        },
        {
          title: "Mocked stored observation",
          section: "Simulated evidence",
          path: "/inventory",
          href: "/#/inventory",
          timestamp: "2026-10-27T08:59:00Z",
          excerpt: "Synthetic UI-test evidence; no physical observation.",
          kind: "live-data",
        },
      ],
    });
  });
  await input(page).fill("Inspect this evidence");
  await input(page).dispatchEvent("compositionstart");
  await input(page).dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
    keyCode: 229,
  });
  expect(calls).toBe(0);
  await input(page).dispatchEvent("compositionend");
  await input(page).press("Shift+Enter");
  await expect(input(page)).toHaveValue("Inspect this evidence\n");
  await input(page).press("Enter");
  await expect(page.getByTestId("assistant-answer-content")).toBeVisible();
  expect(calls).toBe(1);
  await expect(page.locator("pre code")).toContainText("<img src=x");
  expect(
    await page.evaluate(() => (window as any).__assistantInjected),
  ).toBeUndefined();
  await noOverflow(page);
  await page
    .getByRole("button", { name: "Source 2: Mocked stored observation" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator('[data-source-number="2"]')).toBeFocused();
  await page
    .getByRole("button", { name: "Stored evidence", exact: true })
    .click();
  await expect(page.locator("[data-source-number]")).toHaveAttribute(
    "data-source-number",
    "2",
  );
  await page.keyboard.press("Escape");
  await input(page).fill("x".repeat(501));
  await expect(
    page.getByRole("button", { name: "Ask", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Use no more than 500 characters. Your draft is retained."),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 430 });
  await input(page).focus();
  const rect = await input(page).boundingBox();
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(430);
  await noOverflow(page);
});
test("Assistant handles unavailable WebGL and clears sensitive state on logout", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      kind: any,
      ...args: any[]
    ) {
      return kind === "webgl2" ? null : original.call(this, kind, ...args);
    } as typeof original;
  });
  await enterSimulation(page);
  await page.goto("/#/assistant");
  await ask(page);
  await expect(page.locator("[data-state=unsupported]")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Components / accessible detail" }),
  ).toBeVisible();
  await input(page).fill("Sensitive draft from the current session");
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Demo Viewer", exact: true }).click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.goto("/#/assistant");
  await expect(input(page)).toHaveValue("");
  await expect(page.getByTestId("assistant-answer-content")).toHaveCount(0);
});
for (const [width, theme] of [
  [1440, "light"],
  [390, "dark"],
] as const)
  test(`record graphical Assistant inspection ${width} ${theme}`, async ({
    browser,
  }) => {
    mkdirSync(out, { recursive: true });
    const context = await browser.newContext({
        recordVideo: { dir: out, size: { width, height: 960 } },
        viewport: { width, height: 960 },
      }),
      page = await context.newPage();
    try {
      await enterSimulation(page, width, theme);
      await page.goto("/#/assistant");
      await page.screenshot({
        path: `${out}/assistant-empty-${width}-${theme}.png`,
        fullPage: true,
      });
      await ask(page);
      if (width < 1280)
        await page.getByRole("button", { name: /Sources & context/ }).click();
      await expect(page.locator("[data-state=ready]")).toBeVisible({
        timeout: 30000,
      });
      await page
        .getByRole("link", { name: "Open 3D inspection", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Showcase pump 01", exact: true }),
      ).toBeVisible();
      await expect(page.locator("[data-state=ready]")).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Explode", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Reassemble", exact: true }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

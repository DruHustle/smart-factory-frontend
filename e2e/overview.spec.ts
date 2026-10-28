import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTheme, selectSection } from "./experience-helpers";

const directory =
  process.env.OVERVIEW_EVIDENCE_DIR ?? join(tmpdir(), "visual-first-evidence");

test("Overview graphics to Analytics: custom date recovery at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/#/analytics?from=not-a-date&to=2026-10-28T12%3A00&interval=60000.5");
  const invalid = page.getByText("Review the selected dates", { exact: true });
  await expect(invalid).toBeVisible();
  await expect(page.getByLabel("Analysis from UTC")).toBeVisible();
  const period = page.getByRole("combobox", { name: "Time range", exact: true });
  await period.selectOption("24h");
  await period.selectOption("custom");
  const from = page.getByLabel("Analysis from UTC");
  await from.fill("");
  await expect(invalid).toBeVisible();
  await expect(from).toBeVisible();
  await expect(page.getByLabel("Analysis to UTC")).toBeVisible();
  await expect(page.getByRole("img", { name: /temperature in °C/ })).toHaveCount(0);
  await capture(page, "analytics-cleared-date-390", { state: "incomplete custom UTC dates remain editable" });
  await from.fill("2026-10-27T12:00");
  await page.getByLabel("Analysis to UTC").fill("2026-10-28T12:00");
  await expect(invalid).toHaveCount(0);
  await expect(page.getByText("Analytics unavailable", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Aggregation", { exact: true })).toHaveValue("60000");
  await capture(page, "analytics-restored-date-390", { state: "custom UTC dates restored; malformed aggregation normalized" });
});

test("Overview graphics recovery after a lazy page cannot load", async ({ page }) => {
  await login(page);
  await page.route("**/src/pages/AnalyticsPage.tsx*", (route) => route.abort("failed"));
  await page.goto("/#/analytics");
  await expect(page.getByRole("heading", { name: "This page couldn’t load" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload page", exact: true })).toBeVisible();
  await page.unroute("**/src/pages/AnalyticsPage.tsx*");
  await page.getByRole("button", { name: "Open overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/#/analytics");
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
});

async function login(page: Page) {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill("security-admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-security-only-2026!");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
async function typography(page: Page, width: number) {
  if (width < 768)
    await page
      .getByRole("button", { name: "Toggle navigation", exact: true })
      .tap();
  const labels = page
    .locator("[data-navigation-heading]")
    .filter({ visible: true });
  await expect(labels).toHaveText([
    "Overview",
    "Assets & devices",
    "Operations",
    "Insights",
    "Infrastructure",
    "Tools & settings",
  ]);
  const actual = await labels.evaluateAll((nodes) =>
    nodes.map((node) => {
      const s = getComputedStyle(node);
      return {
        label: node.textContent,
        size: s.fontSize,
        weight: s.fontWeight,
        spacing: s.letterSpacing,
        lineHeight: s.lineHeight,
        transform: s.textTransform,
      };
    }),
  );
  expect(
    new Set(actual.map(({ label, ...style }) => JSON.stringify(style))).size,
  ).toBe(1);
  expect(actual[0]).toMatchObject({
    size: "12px",
    weight: "500",
    lineHeight: "16px",
    transform: "uppercase",
  });
  const nav = page
    .locator('[data-sidebar="sidebar"]')
    .filter({ visible: true })
    .first();
  await expect(
    nav.getByRole("link", { name: "Monitoring", exact: true }),
  ).toHaveText("Monitoring");
  if (width < 768) {
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Toggle navigation", exact: true }),
    ).toBeFocused();
  }
  return actual;
}
async function capture(page: Page, name: string, metadata: unknown) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: `${directory}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  writeFileSync(
    `${directory}/${name}.json`,
    JSON.stringify(
      {
        dataset: "isolated synthetic workspace fixtures",
        source: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        appSourceClean: !execFileSync(
          "git",
          ["diff", "HEAD", "--", "client", "server", "shared"],
          { encoding: "utf8" },
        ).trim(),
        metadata,
      },
      null,
      2,
    ) + "\n",
  );
}

for (const width of [390, 1440])
  for (const theme of ["light", "dark"] as const)
    test.describe(`Overview graphics ${width}px ${theme}`, () => {
      test.skip(
        process.env.EXPERIENCE_E2E !== "true",
        "Requires the guarded disposable experience fixture",
      );
      test("recorded visuals, scoped drill-downs, uniform sidebar and on-demand model", async ({
        browser,
      }) => {
        mkdirSync(directory, { recursive: true });
        const context = await browser.newContext({
          baseURL:
            process.env.EXPERIENCE_E2E_BASE_URL ?? "http://127.0.0.1:3123",
          viewport: { width, height: 960 },
          hasTouch: width < 768,
          isMobile: width < 768,
          colorScheme: theme,
          recordVideo: {
            dir: `${directory}/raw-video`,
            size: { width, height: 960 },
          },
        });
        const page = await context.newPage();
        const video = page.video();
        const commands: string[] = [],
          errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            /controlAda031|pulseIndicator|ota\.deploy|simulate/.test(
              request.url(),
            )
          )
            commands.push(request.url());
        });
        try {
          await login(page);
          await setTheme(page, theme);
          const font = await typography(page, width);
          const s = (
            await (await page.request.get("/api/trpc/system.showcase")).json()
          ).result.data.json;
          const overviewContext = `/?source=${encodeURIComponent(s.assetRef)}&scope=simulated&range=1h&at=${Date.parse(s.anchor)}`;
          await page.goto("/#" + overviewContext);
          await expect(
            page.getByRole("group", {
              name: "Source observation states",
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            page.getByRole("figure", {
              name: "Recorded gateway and equipment relationships",
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            page.getByRole("link", { name: /temperature in °C/ }),
          ).toBeVisible();
          const trendInput = {
            assetIds: [s.assetId],
            metric: "temperature",
            scope: "simulated",
            startTime: Date.parse(s.anchor) - 3600000,
            endTime: Date.parse(s.anchor),
            intervalMs: 60000,
          };
          const trend = (
            await (
              await page.request.get(
                "/api/trpc/readings.trend?input=" +
                  encodeURIComponent(JSON.stringify({ json: trendInput })),
              )
            ).json()
          ).result.data.json;
          expect(trend.verified).toBeGreaterThan(0);
          expect(
            trend.buckets.some(
              (bucket: { value: number | null }) => bucket.value === null,
            ),
          ).toBe(true);
          const canvas = page.getByRole("img", {
            name: "Interactive 3D equipment model",
            exact: true,
          });
          await expect(page.locator("[data-state=ready]")).toBeVisible({
            timeout: 30000,
          });
          await expect(canvas).toHaveCount(1);
          const box = (await canvas.boundingBox())!;
          if (width < 768) {
            const touch = await context.newCDPSession(page);
            await touch.send("Input.dispatchTouchEvent", {
              type: "touchStart",
              touchPoints: [
                { x: box.x + box.width * 0.45, y: box.y + box.height * 0.5 },
              ],
            });
            for (let step = 1; step <= 12; step++)
              await touch.send("Input.dispatchTouchEvent", {
                type: "touchMove",
                touchPoints: [
                  {
                    x: box.x + box.width * (0.45 + (0.2 * step) / 12),
                    y: box.y + box.height * (0.5 + (0.1 * step) / 12),
                  },
                ],
              });
            await touch.send("Input.dispatchTouchEvent", {
              type: "touchEnd",
              touchPoints: [],
            });
            await touch.detach();
          } else {
            await page.mouse.move(
              box.x + box.width * 0.45,
              box.y + box.height * 0.5,
            );
            await page.mouse.down();
            await page.mouse.move(
              box.x + box.width * 0.65,
              box.y + box.height * 0.6,
              { steps: 15 },
            );
            await page.mouse.up();
          }
          await page
            .getByRole("button", { name: "Reset model preview", exact: true })
            .click();
          await expect(page.locator('[data-camera-moving="true"]')).toHaveCount(
            0,
          );
          await capture(page, `overview-${theme}-${width}`, {
            typography: font,
            gapBuckets: trend.buckets.filter(
              (bucket: { value: number | null }) => bucket.value === null,
            ).length,
            modelLoadedOnDemand: true,
          });
          await page
            .getByRole("list", {
              name: "Source observation states details",
              exact: true,
            })
            .getByRole("link", { name: /Unknown/ })
            .click();
          await expect(
            page.getByRole("heading", {
              name: "Assets & devices",
              exact: true,
            }),
          ).toBeVisible();
          await typography(page, width);
          expect(new URL(page.url()).hash).toContain("status=unknown");
          await page.goBack();
          await expect(
            page.getByLabel("Overview evidence scope", { exact: true }),
          ).toHaveValue("simulated");
          await page
            .getByRole("link", { name: "Open telemetry", exact: true })
            .click();
          await expect(
            page.getByRole("heading", {
              name: "Showcase pump 01",
              exact: true,
            }),
          ).toBeVisible();
          expect(new URL(page.url()).hash).toContain("scope=simulated");
          await page
            .getByRole("link", {
              name: "Overview / Return to overview",
              exact: true,
            })
            .click();
          expect(new URL(page.url()).hash).toContain("scope=simulated");
          await page
            .getByRole("list", {
              name: "Recent open process incident timeline",
              exact: true,
            })
            .getByRole("link")
            .first()
            .click();
          await expect(
            page
              .getByRole("button", { name: "Acknowledge", exact: true })
              .or(page.getByRole("heading", { name: /Investigation/ }))
              .first(),
          ).toBeVisible();
          await page
            .getByRole("link", { name: "Return to overview", exact: true })
            .click();
          for (const [name, route, heading] of [
            ["inventory", "/inventory", "Assets & devices"],
            ["monitoring", "/monitoring", "Monitoring"],
            ["security", "/cybersecurity", "Cybersecurity"],
            [
              "analytics",
              `/analytics?asset=${encodeURIComponent(s.assetId)}&scope=simulated&from=${encodeURIComponent(s.from.slice(0, 16))}&to=${encodeURIComponent(s.anchor.slice(0, 16))}`,
              "Analytics",
            ],
            ["assistant", "/assistant", "Assistant"],
            [
              "administration",
              "/administration/integrations",
              "Administration",
            ],
          ]) {
            await page.goto("/#" + route);
            await expect(
              page.getByRole("heading", { name: heading, exact: true }),
            ).toBeVisible();
            if (name === "monitoring") {
              await expect(
                page.getByRole("heading", {
                  name: "Workspace direct sensor",
                  exact: true,
                }),
              ).toBeVisible();
              await expect(
                page
                  .getByRole("img", { name: /temperature in °C/ })
                  .locator(".recharts-line-dot"),
              ).toBeVisible();
            }
            if (name === "assistant") {
              await page
                .getByLabel("Ask the Smart Factory Assistant")
                .fill("What evidence is available for Showcase pump 01?");
              await page
                .getByRole("button", { name: "Ask", exact: true })
                .click();
              await expect(
                page.getByTestId("assistant-answer-content").first(),
              ).toBeVisible();
            }
            await capture(page, `${name}-${theme}-${width}`, { route });
          }
          expect(commands).toEqual([]);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
          if (video)
            await video.saveAs(
              `${directory}/navigation-${theme}-${width}.webm`,
            );
        }
      });
    });

for (const width of [390, 1440])
  test.describe(`Overview graphics inspection ${width}px`, () => {
    test.skip(
      process.env.EXPERIENCE_E2E !== "true",
      "Requires guarded disposable equipment",
    );
    test("record explosion, sections, ghosting, component focus and saved-view restoration", async ({
      browser,
    }) => {
      mkdirSync(directory, { recursive: true });
      const context = await browser.newContext({
        baseURL: process.env.EXPERIENCE_E2E_BASE_URL ?? "http://127.0.0.1:3123",
        viewport: { width, height: 960 },
        hasTouch: width < 768,
        isMobile: width < 768,
        colorScheme: width === 390 ? "dark" : "light",
        recordVideo: {
          dir: `${directory}/raw-video`,
          size: { width, height: 960 },
        },
      });
      const page = await context.newPage(),
        video = page.video();
      const commands: string[] = [];
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          /controlAda031|pulseIndicator|ota\.deploy|simulate/.test(
            request.url(),
          )
        )
          commands.push(request.url());
      });
      try {
        await login(page);
        const inventory = (
          await (
            await page.request.get(
              "/api/trpc/inventory.list?input=" +
                encodeURIComponent(
                  JSON.stringify({
                    json: {
                      search: "Workspace standalone pump",
                      capability: "3d",
                      page: 0,
                      pageSize: 1,
                    },
                  }),
                ),
            )
          ).json()
        ).result.data.json;
        expect(inventory.items).toHaveLength(1);
        const item = inventory.items[0];
        await page.goto(
          `/#/inventory/${encodeURIComponent(item.ref)}/3d?return=%2F`,
        );
        await expect(page.locator("[data-state=ready]")).toBeVisible({
          timeout: 30000,
        });
        const tools = async () => {
          for (const name of [
            "Framing and visibility",
            "Explode, section and inspection tools",
          ]) {
            const summary = page
              .locator("summary")
              .filter({ hasText: new RegExp("^" + name + "$") });
            if (
              (await summary.isVisible()) &&
              !(await summary.evaluate(
                (node) => (node.parentElement as HTMLDetailsElement).open,
              ))
            )
              await summary.click();
          }
        };
        await tools();
        await page
          .getByRole("button", { name: "Explode", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Reassemble", exact: true }),
        ).toBeVisible();
        // Leave the finite 360 ms choreography visible in the recording.
        await page.waitForTimeout(500);
        await page
          .getByRole("button", { name: "Reassemble", exact: true })
          .click();
        await page.waitForTimeout(500);
        await page
          .getByLabel("Section axis", { exact: true })
          .selectOption("Z");
        await page
          .getByRole("button", { name: "Reverse section", exact: true })
          .click();
        await page.waitForTimeout(500);
        await page
          .getByRole("button", { name: "Reset section", exact: true })
          .click();
        await page.getByLabel("Ghost housings", { exact: true }).check();
        const mobile = page.getByRole("button", {
          name: "Assembly / BOM",
          exact: true,
        });
        const drawer = await mobile.isVisible();
        if (drawer) await mobile.click();
        await page
          .getByLabel("Search BOM", { exact: true })
          .fill("Winding phase 1");
        await page
          .getByRole("button", { name: "Winding phase 1", exact: true })
          .click();
        if (drawer) {
          await page.keyboard.press("Escape");
          await expect(
            page.getByRole("dialog", {
              name: "Assembly and components",
              exact: true,
            }),
          ).toHaveCount(0);
        }
        await page
          .getByRole("button", { name: "Focus selected", exact: true })
          .click();
        await expect(page.locator('[data-camera-moving="true"]')).toHaveCount(
          0,
        );
        await capture(page, `inspection-${width}`, {
          component: "Winding phase 1",
          ghostHousings: true,
          physicalMovement: false,
        });
        await selectSection(page, "Saved views");
        const name = `Recorded internal inspection ${width}`;
        await page.getByLabel("Viewpoint name", { exact: true }).fill(name);
        await page
          .getByRole("button", { name: "Save viewpoint", exact: true })
          .click();
        await expect(
          page.getByText("Local work saved.", { exact: true }),
        ).toBeVisible();
        await tools();
        await page
          .getByRole("button", { name: "Restore assembly", exact: true })
          .click();
        await expect(
          page.getByLabel("Ghost housings", { exact: true }),
        ).not.toBeChecked();
        await page
          .getByRole("button", { name: `Open viewpoint: ${name}`, exact: true })
          .click();
        await expect(
          page.getByLabel("Ghost housings", { exact: true }),
        ).toBeChecked();
        await expect(page.locator('[data-camera-moving="true"]')).toHaveCount(
          0,
        );
        expect(commands).toEqual([]);
      } finally {
        await context.close();
        if (video) await video.saveAs(`${directory}/inspection-${width}.webm`);
      }
    });
  });

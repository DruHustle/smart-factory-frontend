import { test, expect, type Page, type Route } from "@playwright/test";
import type { InventoryItem } from "../shared/inventory";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTheme, selectSection } from "./experience-helpers";

const directory =
  process.env.OVERVIEW_EVIDENCE_DIR ?? join(tmpdir(), "visual-first-evidence");

test("Overview graphics to Analytics: custom date recovery at 390px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(
    "/#/analytics?from=not-a-date&to=2026-10-28T12%3A00&interval=60000.5",
  );
  const invalid = page.getByText("Review the selected dates", { exact: true });
  await expect(invalid).toBeVisible();
  await expect(page.getByLabel("Analysis from UTC")).toBeVisible();
  const period = page.getByRole("combobox", {
    name: "Time range",
    exact: true,
  });
  await period.selectOption("24h");
  await period.selectOption("custom");
  const from = page.getByLabel("Analysis from UTC");
  await from.fill("");
  await expect(invalid).toBeVisible();
  await expect(from).toBeVisible();
  await expect(page.getByLabel("Analysis to UTC")).toBeVisible();
  await expect(
    page.getByRole("img", { name: /temperature in °C/ }),
  ).toHaveCount(0);
  await capture(page, "analytics-cleared-date-390", {
    state: "incomplete custom UTC dates remain editable",
  });
  await from.fill("2026-10-27T12:00");
  await page.getByLabel("Analysis to UTC").fill("2026-10-28T12:00");
  await expect(invalid).toHaveCount(0);
  await expect(
    page.getByText("Analytics unavailable", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Aggregation", { exact: true })).toHaveValue(
    "60000",
  );
  await capture(page, "analytics-restored-date-390", {
    state: "custom UTC dates restored; malformed aggregation normalized",
  });
});

test("Overview graphics recovery after a lazy page cannot load", async ({
  page,
}) => {
  await login(page);
  await page.route("**/src/pages/AnalyticsPage.tsx*", (route) =>
    route.abort("failed"),
  );
  await page.goto("/#/analytics");
  await expect(
    page.getByRole("heading", { name: "This page couldn’t load" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload page", exact: true }),
  ).toBeVisible();
  await page.unroute("**/src/pages/AnalyticsPage.tsx*");
  await page
    .getByRole("button", { name: "Open overview", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.goto("/#/analytics");
  await expect(
    page.getByRole("heading", { name: "Analytics", exact: true }),
  ).toBeVisible();
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
    test.describe(`Overview graphics whole factory ${width}px ${theme}`, () => {
      test.skip(
        process.env.EXPERIENCE_E2E !== "true",
        "Requires guarded disposable factory",
      );
      test("renders all floor items and native references with summary graphs and item drill-down", async ({
        browser,
      }) => {
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
        const page = await context.newPage(),
          video = page.video();
        const errors: string[] = [],
          commands: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("request", (r) => {
          if (
            r.method() === "POST" &&
            /controlAda031|pulseIndicator|ota.deploy|simulate|importSnapshot/.test(
              r.url(),
            )
          )
            commands.push(r.url());
        });
        try {
          await login(page);
          await Promise.all([
            page.waitForEvent("load", { timeout: 30000 }),
            page
              .getByRole("combobox", { name: "Data workspace", exact: true })
              .selectOption("demo"),
          ]);
          await expect(
            page.getByRole("combobox", { name: "Data workspace", exact: true }),
          ).toHaveValue("demo", { timeout: 15000 });
          await setTheme(page, theme);
          const styles = await typography(page, width);
          const s = (
            await (await page.request.get("/api/trpc/system.showcase")).json()
          ).result.data.json;
          const snapshot = (
            await (await page.request.get("/api/trpc/factory.floor")).json()
          ).result.data.json;
          expect(snapshot.complete).toBe(true);
          expect(snapshot.items.length).toBeGreaterThan(50);
          expect(snapshot.total).toBe(snapshot.items.length);
          expect(snapshot.links.length).toBeGreaterThan(30);
          const count = String(snapshot.total),
            floor = page.getByTestId("factory-floor");
          await expect(floor).toHaveAttribute("data-total-items", count);
          await expect(floor).toHaveAttribute("data-visible-items", count);
          await expect(
            page.getByRole("img", {
              name: "Interactive 3D factory floor",
              exact: true,
            }),
          ).toHaveAttribute("data-floor-node-count", count);
          await expect
            .poll(
              async () => {
                const text = await floor.getByRole("status").textContent();
                return Number(
                  text?.match(/· (\d+) detailed models ready/)?.[1] ?? 0,
                );
              },
              { timeout: 30000 },
            )
            .toBeGreaterThan(5);
          await expect(
            page.getByRole("heading", {
              name: "Factory observations",
              exact: true,
            }),
          ).toBeVisible();
          const timingEvidence = page
            .locator("summary")
            .filter({ hasText: "Process and FX / TSN evidence" });
          await timingEvidence.click();
          await expect(
            page.getByRole("heading", { name: "FX / TSN health", exact: true }),
          ).toBeVisible();
          await timingEvidence.click();
          await capture(page, `factory-floor-${theme}-${width}`, {
            total: snapshot.total,
            complete: snapshot.complete,
            styles,
            source: s.anchor,
          });
          await page
            .locator("summary")
            .filter({ hasText: /^Find an item/ })
            .click();
          const list = page.getByRole("list", {
            name: "Factory floor items",
            exact: true,
          });
          await expect(list.getByRole("listitem")).toHaveCount(snapshot.total);
          const item = snapshot.items.find(
            (i: InventoryItem) =>
              i.identifier === "urn:smart-factory:showcase:floor:robot-01",
          );
          expect(item).toBeTruthy();
          await list
            .getByRole("button", { name: item.name, exact: true })
            .click();
          await expect(page.getByLabel("Selected floor item")).toContainText(
            item.name,
          );
          await expect(floor).toHaveAttribute("data-visible-items", count);
          const returnContext = new URL(page.url()).hash.slice(1);
          await page
            .getByRole("link", { name: "Open item", exact: true })
            .click();
          await expect(
            page.getByRole("heading", { name: item.name, exact: true }),
          ).toBeVisible();
          await expect(page).toHaveURL(
            new RegExp(
              "return=" +
                encodeURIComponent(returnContext).replace(
                  /[.*+?^$()|[\]{}\\]/g,
                  "\\$&",
                ),
            ),
          );
          await page.goto("/#" + returnContext);
          await expect(floor).toHaveAttribute("data-visible-items", count);
          await page
            .getByRole("button", { name: "Floor plan", exact: true })
            .click();
          await expect(
            page
              .getByRole("img", {
                name: "Accessible factory floor plan",
                exact: true,
              })
              .getByRole("button"),
          ).toHaveCount(snapshot.total);
          await capture(page, `factory-plan-${theme}-${width}`, {
            total: snapshot.total,
            selected: item.ref,
          });
          for (const [route, heading] of [
            ["/monitoring", "Monitoring"],
            ["/alerts", "Alerts"],
            ["/network", "FX & TSN"],
            ["/analytics", "Analytics"],
          ] as const) {
            await page.goto("/#" + route);
            await expect(
              page.getByRole("heading", { name: heading, exact: true }),
            ).toBeVisible();
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
          }
          expect(commands).toEqual([]);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
          if (video)
            await video.saveAs(
              `${directory}/factory-overview-${theme}-${width}.webm`,
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

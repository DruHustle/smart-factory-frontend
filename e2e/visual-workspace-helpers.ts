import { expect, type Page } from "@playwright/test";
import { resetDemoViewerFixtureLoginLimit } from "./fixture-auth";
export async function enterSimulation(
  page: Page,
  width = 1440,
  theme = "light",
) {
  await resetDemoViewerFixtureLoginLimit();
  await page.setViewportSize({ width, height: 960 });
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Demo Viewer", exact: true }).click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  // The landing page contains every item; details remain in each item's menu.
  await expect(
    page.getByRole("group", { name: "System item types", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Factory floor overview", exact: true }),
  ).toBeVisible();
  const floor = page.getByTestId("factory-floor");
  await expect(floor).toBeVisible();
  await expect
    .poll(async () => {
      const total = Number(await floor.getAttribute("data-total-items"));
      return (
        total > 0 &&
        total === Number(await floor.getAttribute("data-visible-items"))
      );
    })
    .toBe(true);
  return (await (await page.request.get("/api/trpc/system.showcase")).json())
    .result.data.json;
}
export const rpc = (name: string, input: unknown) =>
  "/api/trpc/" +
  name +
  "?input=" +
  encodeURIComponent(JSON.stringify({ json: input }));
export async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
}

import { expect, test } from "@playwright/test";

test("current hardware bench shows the Pi 5, WROVER/DHT11 and recorded gateway path", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Demo Admin", exact: true }).click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Current Pi + DHT11 setup" }),
  ).toBeVisible();
  await expect(page.getByText("Hardware topology: DHT11")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Interactive 3D factory floor" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/public-demo/pi-bench-3d.png",
    fullPage: true,
  });

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
});

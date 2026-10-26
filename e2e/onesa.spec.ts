import { test, expect } from "@playwright/test";
const privateRun = process.env.E2E_ONESA_PRIVATE === "true";
test.describe("private Onesa integration", () => {
  test.skip(
    !privateRun,
    "Run with the isolated individual-account walkthrough server",
  );
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ])
    test(`operator status, mappings and protected artifacts at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/#/integrations/onesa");
      await expect(
        page.getByRole("heading", { name: "Smart Factory IoT", exact: true }),
      ).toBeVisible();
      await page.getByLabel("Email").fill("onesa-fixture@example.test");
      await page
        .getByLabel("Password", { exact: true })
        .fill(
          process.env.ONESA_FIXTURE_PASSWORD ?? "Synthetic-fixture-only-2026!",
        );
      await page.getByRole("button", { name: /^sign in$/i }).click();
      await expect(
        page.getByRole("heading", { name: "Factory Overview", exact: true }),
      ).toBeVisible();
      await page.goto("/#/integrations/onesa");
      await expect(
        page.getByRole("heading", { name: "Onesa integration", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Proposed contract · consumer acceptance pending."),
      ).toBeVisible();
      if (process.env.E2E_ONESA_STATE === "disabled")
        await expect(page.getByText("Disabled", { exact: true })).toBeVisible();
      else {
        await expect(
          page.getByText("proposed-test-workspace", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: /Illustrative pump set 01/ }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: /Illustrative pump set 02/ }),
        ).toBeVisible();
        await expect(
          page.getByText(
            "Open in Onesa Digital Twin: unavailable until the consumer publishes a verified asset route.",
          ),
        ).toHaveCount(2);
        const input = page.getByLabel(
          "Illustrative pump set 01 Pump Onesa component ID",
        );
        await input.focus();
        await expect(input).toBeFocused();
        await page
          .getByRole("button", { name: "Preview mapping changes" })
          .first()
          .click();
        await expect(
          page.getByRole("heading", { name: "Review proposed changes" }),
        ).toBeVisible();
        if (process.env.E2E_ONESA_STATE === "error")
          await expect(
            page.getByText("Error", { exact: true }).first(),
          ).toBeVisible();
      }
      const download = page.waitForEvent("download");
      await page
        .getByRole("link", { name: "demonstrator.aasx", exact: true })
        .click();
      expect((await download).suggestedFilename()).toBe("demonstrator.aasx");
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: test.info().outputPath(`onesa-${viewport.width}.png`),
        fullPage: true,
      });
      await page.goto("/#/monitoring");
      await expect(
        page.getByRole("heading", { name: "Live Monitoring", exact: true }),
      ).toBeVisible();
      await page.goto("/#/assets");
      await expect(
        page.getByRole("heading", { name: "Industrial Assets", exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
});
test("public demo engineering identity cannot read private integration configuration", async ({
  page,
  request,
}) => {
  test.skip(
    privateRun,
    "Existing demo regression suite uses the public fixture server",
  );
  await page.goto("/#/login");
  await page
    .getByRole("button", { name: "Demo Engineer", exact: true })
    .click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Factory Overview", exact: true }),
  ).toBeVisible();
  await page.goto("/#/integrations/onesa");
  await expect(
    page.getByText(
      /Private integration settings require an individual engineering account/,
    ),
  ).toBeVisible();
  const response = await page.request.get(
    "/api/onesa/artifacts/equipment.json",
  );
  expect(response.status()).toBe(403);
});

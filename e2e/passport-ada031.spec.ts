import {
  navigate,
  addItem,
  openItem,
  finishGateway,
} from "./workspace-helpers";
import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

async function loginAsAdmin(page: Page) {
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Demo Admin", exact: true }).click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

async function mockBrowserPrint(context: BrowserContext) {
  await context.addInitScript(() => {
    const trackedWindow = window as typeof window & { __printCalls?: number };
    trackedWindow.__printCalls = 0;
    Object.defineProperty(window, "print", {
      configurable: true,
      value: () => {
        trackedWindow.__printCalls = (trackedWindow.__printCalls ?? 0) + 1;
      },
    });
  });
}

async function expectPrintCalled(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __printCalls?: number }).__printCalls ??
          0,
      ),
    )
    .toBe(1);
}

test("public EUDPP exposes a valid QR target and isolated print layout", async ({
  context,
  page,
}) => {
  await mockBrowserPrint(context);
  await page.route(/\/api\/trpc\/.*assets\.getPassport/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          result: {
            data: {
              json: {
                id: 1,
                assetId: "urn:e2e:passport:compressor-01",
                name: "Compressed Air Compressor 01",
                assetType: "compressor",
                manufacturer: "E2E Equipment GmbH",
                model: "E2E Compressor",
                serialNumber: "E2E-001",
                manufacturerStreet: "Test Bench 1",
                manufacturerZipcode: "10115",
                manufacturerCityTown: "Berlin",
                manufacturerNationalCode: "DE",
                manufacturerArticleNumber: "E2E-COMP-01",
                orderCodeOfManufacturer: "E2E-ORDER-01",
                ratedValue: "75",
                ratedUnit: "kW",
                lifecycleStage: "operational",
                aasVersion: 1,
                updatedAt: "2026-10-06T07:00:00.000Z",
              },
            },
          },
        },
      ]),
    }),
  );
  await page.goto("/?print=1#/passport/1");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Compressed Air Compressor 01",
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expectPrintCalled(page);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByLabel("Primary navigation")).toHaveCount(0);

  const publicUrl = await page.evaluate(
    () => `${window.location.origin}${window.location.pathname}#/passport/1`,
  );
  const qr = page.getByTestId("passport-qr");
  await expect(qr).toHaveAttribute("data-qr-value", publicUrl);
  await expect(
    qr.getByRole("img", {
      name: "Passport QR code for Compressed Air Compressor 01",
    }),
  ).toBeVisible();
  expect(await qr.locator("svg path").count()).toBeGreaterThan(0);
  await expect(page.getByText(publicUrl, { exact: true })).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("button", { name: "Print EUDPP and QR label" }),
  ).toBeHidden();
  await expect(page.getByLabel("Primary navigation")).toHaveCount(0);

  await page.emulateMedia({ media: "screen" });
  await loginAsAdmin(page);
  await page.goto("/#/passport/1");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Compressed Air Compressor 01",
    }),
  ).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByLabel("Primary navigation")).toHaveCount(0);
  await page.getByRole("button", { name: "Print EUDPP and QR label" }).click();
  await expectPrintCalled(page);
});

test("EUDPP distinguishes a service failure from a missing passport", async ({
  page,
}) => {
  await page.route(/\/api\/trpc\/.*assets\.getPassport/, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify([
        {
          error: {
            json: {
              message: "Passport service unavailable",
              code: -32603,
              data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 },
            },
          },
        },
      ]),
    }),
  );
  await page.goto("/#/passport/1");
  const alert = page.getByRole("alert");
  await expect(
    alert.getByRole("heading", { name: "Product passport unavailable" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("ADA031 controls stay interlocked and publish only to the safe E2E mock", async ({
  context,
  page,
}, testInfo) => {
  await mockBrowserPrint(context);
  await loginAsAdmin(page);

  // A failed late-stage assertion can leave records behind before Playwright
  // retries the test. Unique identities keep retries focused on the original
  // failure instead of colliding with that earlier setup data.
  const runId = `${Date.now()}-${testInfo.retry}`;
  const gatewayId = `e2e-ada031-gateway-${runId}`;
  const gatewayName = `E2E ADA031 Gateway ${runId}`;
  const assetName = `E2E ADA031 Safe Arm ${runId}`;

  await navigate(page, "Devices");
  await addItem(page, "gateway");
  await page.getByLabel("Gateway ID").fill(gatewayId);
  await page.getByLabel("Gateway name").fill(gatewayName);
  await finishGateway(page);
  await expect(
    page.getByText(gatewayName, { exact: true }).filter({ visible: true }),
  ).toBeVisible();

  await navigate(page, "Assets");
  await addItem(page, "asset");
  await page.getByLabel("Asset name").fill(assetName);
  await page.getByLabel("Asset type").click();
  await page.getByRole("option", { name: "Robotic arm", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Manufacturer", { exact: true }).fill("Adeept E2E");
  await page.getByLabel("Product designation").fill("ADA031 V4 E2E fixture");
  await page.getByLabel("Manufacturer street").fill("Test Bench 1");
  await page.getByLabel("Manufacturer postal code").fill("10115");
  await page.getByLabel("Manufacturer city").fill("Berlin");
  await page
    .getByLabel("Manufacturer country code (ISO 3166-1 alpha-2)")
    .fill("DE");
  await page.getByLabel("Manufacturer article number").fill("ADA031-E2E");
  await page.getByLabel("Manufacturer order code").fill("ADA031-E2E-ORDER");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Edge gateway").click();
  await page.getByRole("option").filter({ hasText: gatewayName }).click();
  await page.getByLabel("Protocol").click();
  await page.getByRole("option", { name: "ADA031 V4 USB control" }).click();
  await page
    .getByLabel("Machine endpoint")
    .fill("serial:///dev/serial/by-id/usb-e2e-ada031?baudrate=9600");
  await page.getByRole("button", { name: /register and provision/i }).click();
  await expect(
    page.getByText(assetName, { exact: true }).filter({ visible: true }),
  ).toBeVisible();

  const assetRow = page.getByRole("row").filter({ hasText: assetName });
  await page.getByRole("link", { name: /Open registered asset/ }).click();
  await page.getByRole("tab", { name: "Control", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "ADA031 operation control" }),
  ).toBeVisible();

  const operationCard = page
    .locator('[data-slot="card"]')
    .filter({
      has: page.getByRole("heading", { name: "ADA031 operation control" }),
    });
  const repeatButton = operationCard.getByRole("button", {
    name: "Run pick A → B → A repeatedly",
  });
  const neutralButton = operationCard.getByRole("button", {
    name: "Neutral: set all servos to 90°",
  });
  const stopButton = operationCard.getByRole("button", {
    name: "Stop after current pose",
  });
  const baseIncrease = operationCard.getByRole("button", {
    name: "Base increase",
  });
  await expect(repeatButton).toBeDisabled();
  await expect(neutralButton).toBeDisabled();
  await expect(baseIncrease).toBeDisabled();

  const safetyAcknowledgement = operationCard.getByRole("checkbox", {
    name: /cleared and secured the motion area/i,
  });
  await safetyAcknowledgement.click();
  await expect(safetyAcknowledgement).toHaveAttribute("aria-checked", "true");
  await expect(repeatButton).toBeEnabled();

  const commandBodies: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("assets.controlAda031"))
      commandBodies.push(request.postData() ?? "");
  });
  const sendCommand = async (button: Locator, acceptedLabel: RegExp) => {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("assets.controlAda031") &&
        response.request().method() === "POST",
    );
    await button.click();
    expect((await responsePromise).ok()).toBe(true);
    await expect(
      operationCard.getByRole("status").filter({ hasText: acceptedLabel }),
    ).toBeVisible();
  };

  await sendCommand(
    repeatButton,
    /repeat profile accepted by the gateway broker/i,
  );
  await sendCommand(
    neutralButton,
    /90° neutral pose accepted by the gateway broker/i,
  );
  await sendCommand(
    baseIncrease,
    /base increase accepted by the gateway broker/i,
  );
  await sendCommand(
    stopButton,
    /stop after the current pose accepted by the gateway broker/i,
  );

  const submittedCommands = commandBodies.join("\n");
  expect(submittedCommands).toContain("pick_and_place_repeat");
  expect(submittedCommands).toContain('"action":"neutral"');
  expect(submittedCommands).toContain('"joint":"base"');
  expect(submittedCommands).toContain('"action":"stop_program"');

  await page.route(/\/api\/trpc\/.*assets\.controlAda031/, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify([
        {
          error: {
            json: {
              message: "Safe mock rejection",
              code: -32603,
              data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 },
            },
          },
        },
      ]),
    }),
  );
  await operationCard
    .getByRole("button", { name: "Run pickup / rotate demonstration" })
    .click();
  await expect(
    operationCard
      .getByRole("alert")
      .filter({
        hasText: /demonstration profile was rejected: Safe mock rejection/i,
      }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "Print EUDPP" }).click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("heading", { level: 1, name: assetName }),
  ).toBeVisible();
  await expectPrintCalled(popup);
  await expect(popup.getByLabel("Primary navigation")).toHaveCount(0);
  await expect(popup.getByTestId("passport-qr")).toHaveAttribute(
    "data-qr-value",
    /#\/passport\/\d+$/,
  );
  await popup.close();
});

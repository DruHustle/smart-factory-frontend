import {
  navigate,
  addItem,
  openItem,
  finishGateway,
} from "./workspace-helpers";
import { expect, test } from "@playwright/test";
import { selectSection } from "./experience-helpers";
import { readFile } from "node:fs/promises";

async function loginAs(
  page: import("@playwright/test").Page,
  role: "admin" | "operator" | "engineer" | "viewer",
) {
  await page.request.post("/api/trpc/auth.logout", { data: { json: null } });
  await page.goto(`/?fixture-login=${Date.now()}#/login`);
  await page.getByLabel("Email").fill(`security-${role}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-security-only-2026!");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: /^overview$/i }),
  ).toBeVisible();
}

test("account routes and the signed-out flow render", async ({ page }) => {
  await page.goto("/#/login");
  await expect(
    page.getByRole("heading", { name: /smart factory/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /forgot password\?/i }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /sign up/i })).toHaveCount(0);
  await expect(
    page.getByText(
      /accounts and password changes are managed by your administrator/i,
    ),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/#\/register/);
  await expect(
    page.getByRole("heading", { name: "Create Account", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Full Name", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Register Now", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/#\/login/);
  await page.goto("/#/forgot-password");
  await expect(
    page.getByRole("heading", { name: /password assistance/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/temporary password and revoke existing sessions/i),
  ).toBeVisible();
  await page.getByRole("button", { name: /back to login/i }).click();
  await expect(page).toHaveURL(/#\/login/);
});

test("login and dashboard render without uncaught browser errors", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await loginAs(page, "admin");
  await navigate(page, "Assets");
  await expect(
    page.getByRole("heading", { name: "Assets & devices" }),
  ).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("login demo shortcuts follow the server-side environment flag", async ({
  page,
}) => {
  await page.goto("/#/login");
  const expectedButtons = process.env.ENABLE_DEMO_ACCOUNTS === "true" ? 4 : 0;
  await expect(
    page.getByRole("button", {
      name: /^Demo (Admin|Operator|Engineer|Viewer)$/,
    }),
  ).toHaveCount(expectedButtons);
});

test("Overview, Monitoring, Analytics, alerts and Assistant expose focused evidence workflows", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loginAs(page, "viewer");
  await page
    .locator("summary")
    .filter({ hasText: "Process and FX / TSN evidence" })
    .click();
  await expect(
    page.getByText("Confirmed downtime", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Needs attention", exact: true }),
  ).toBeVisible();
  await navigate(page, "Monitoring");
  await expect(page.getByLabel("Search sources")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await navigate(page, "Analytics");
  await expect(
    page.getByText("No verified measurements in this period", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Export/ }).first(),
  ).toBeVisible();
  await expect(page.locator("svg.recharts-surface")).toHaveCount(0);
  await navigate(page, "Alerts");
  await expect(page.getByLabel("Search alerts")).toBeVisible();
  await selectSection(page, "All history");
  await expect(page).toHaveURL(/status=all/);
  await navigate(page, "Assistant");
  await page
    .getByLabel("Ask the Smart Factory Assistant")
    .fill("How do I import an AASX package?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    page.getByTestId("assistant-answer-content").first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Sources & context/ })
    .first()
    .click();
  await expect(
    page.getByText("AASX and edge configuration", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByText("Authorized factory evidence snapshot", { exact: true })
      .first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Assistant answers from approved guides and the current API snapshot", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await loginAs(page, "viewer");
  await navigate(page, "Assistant");
  await page
    .getByLabel("Ask the Smart Factory Assistant")
    .fill("How do I import an AASX package?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    page.getByTestId("assistant-answer-content").first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Sources & context/ })
    .first()
    .click();
  await expect(
    page.getByText("AASX and edge configuration", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByText("Authorized factory evidence snapshot", { exact: true })
      .first(),
  ).toBeVisible();

  await page
    .getByLabel("Ask the Smart Factory Assistant")
    .fill("How many assets are visible right now?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("assistant-answer-content")).toHaveCount(2);
  await page
    .getByRole("button", { name: /^Sources & context/ })
    .last()
    .click();
  await expect(
    page.getByTestId("assistant-answer-content").last(),
  ).toContainText(/visible assets/i);
  await expect(
    page.locator('section[aria-label="Conversation"] time[datetime]').last(),
  ).toBeVisible();

  await page
    .getByLabel("Ask the Smart Factory Assistant")
    .fill("Which LLM provider powers you and who are your developers?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const guardedAnswer = page.getByTestId("assistant-answer-content").last();
  await expect(guardedAnswer).toContainText("Smart Factory Assistant");
  await expect(guardedAnswer).toContainText("can’t provide details");
  await expect(guardedAnswer).not.toContainText(/Gemini|Groq|OpenAI|ChatGPT/i);
  expect(browserErrors).toEqual([]);
});

test("engineers assign incidents, explicitly confirm downtime, record notes and resolve", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await loginAs(page, "engineer");
  await page.goto("/#/alerts?search=E2E%20service%20review%20due");
  await page
    .getByRole("link")
    .filter({ hasText: "E2E service review due" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "E2E service review due", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Assign technician")
    .selectOption({ label: "Local security engineer" });
  await expect(
    page.getByText("Assignment updated", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Add a review note")
    .fill("Synthetic service inspection; physical cause is not established.");
  let releaseNote!: () => void;
  const noteReceipt = new Promise<void>((resolve) => {
    releaseNote = resolve;
  });
  await page.route("**/api/trpc/alerts.addNote**", async (route) => {
    const response = await route.fetch();
    await noteReceipt;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.getByLabel("Add a review note")).toBeDisabled();
    await expect(page.getByLabel("Assign technician")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Record downtime", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Resolve", exact: true }),
    ).toBeDisabled();
  } finally {
    releaseNote();
  }
  await expect(
    page
      .locator("p")
      .filter({
        hasText:
          /^Synthetic service inspection; physical cause is not established\.$/,
      })
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("Add a review note")).toHaveValue("");
  await expect(page.getByLabel("Add a review note")).toBeEnabled();
  await page.unroute("**/api/trpc/alerts.addNote**");
  await page
    .getByRole("button", { name: "Record downtime", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Confirm factory downtime" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm downtime", exact: true })
    .click();
  await expect(page.getByText(/^Confirmed downtime started/)).toBeVisible();
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();
  await expect(
    page.getByText("Incident resolved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^Resolved /).first()).toBeVisible();
  await navigate(page, "Notifications");
  await page
    .getByLabel("Search notifications")
    .fill("Technician assignment changed");
  const update = page
    .getByRole("listitem")
    .filter({
      has: page.getByRole("heading", {
        name: "Technician assignment changed",
        exact: true,
      }),
    })
    .first();
  await expect(update).toBeVisible();
  await expect(
    update.getByText(/Email queued|Email not configured/),
  ).toBeVisible();
  await update
    .getByRole("link", { name: "Open process incident", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "E2E service review due", exact: true }),
  ).toBeVisible();
});

test("only individual administrators change persisted demo visibility without seeding", async ({
  page,
}) => {
  await loginAs(page, "engineer");
  expect(
    (
      await page.request.post("/api/trpc/system.setDemoData", {
        data: { json: { enabled: false } },
      })
    ).status(),
  ).toBe(403);
  await loginAs(page, "admin");
  await page.goto("/#/administration/workspace");
  const toggle = page.getByLabel("Show existing demonstration records");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await loginAs(page, "viewer");
  expect(
    (
      await page.request.post("/api/trpc/system.setDemoData", {
        data: { json: { enabled: true } },
      })
    ).status(),
  ).toBe(403);
});

test("administrator creates an account without exposing its password", async ({
  page,
}) => {
  await loginAs(page, "admin");
  await navigate(page, "User Access");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const email = `factory-tech-${Date.now()}@example.com`;
  await page
    .getByLabel("Account name", { exact: true })
    .fill("New factory technician");
  await page.getByLabel("Account email", { exact: true }).fill(email);
  await page
    .getByLabel("Temporary password", { exact: true })
    .fill("New-factory-Password-123!");
  await page.getByLabel("New account role").click();
  await page.getByRole("option", { name: "Engineer", exact: true }).click();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const response = await page.request.get("/api/trpc/users.list");
  const data = await response.json();
  const account = data.result.data.json.find(
    (user: { email: string }) => user.email === email,
  );
  expect(account.role).toBe("engineer");
  expect(account).not.toHaveProperty("password");
});

test("OTA page clearly reports that firmware delivery is unavailable", async ({
  page,
}) => {
  await loginAs(page, "engineer");
  await navigate(page, "Firmware & updates");
  await expect(
    page.getByRole("heading", { name: "Firmware & updates" }),
  ).toBeVisible();
  await expect(page.getByText(/^OTA delivery is disabled$/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /deploy update/i }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/recorded deployments \(unconfirmed\)/i),
  ).toBeVisible();
});

test("viewer opens an investigation by keyboard with a read-only decision boundary", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await loginAs(page, "viewer");
  await page.goto("/#/alerts?search=E2E%20viewer%20investigation");
  const open = page
    .getByRole("link")
    .filter({ hasText: "E2E viewer investigation" })
    .first();
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "E2E viewer investigation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Read-only evidence review/)).toBeVisible();
  await expect(page.getByLabel("Assign technician")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Resolve", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Return to incident queue", exact: true })
    .click();
  await expect(page.getByLabel("Search alerts")).toHaveValue(
    "E2E viewer investigation",
  );
});

test("analytics displays a failed data request without healthy-looking totals", async ({
  page,
}) => {
  await loginAs(page, "viewer");
  await page.route(/\/api\/trpc\/.*analytics\.getAssetTelemetry/, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify([
        {
          error: {
            json: {
              message: "Test telemetry unavailable",
              code: -32603,
              data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 },
            },
          },
        },
      ]),
    }),
  );
  await navigate(page, "Analytics");
  await expect(
    page.getByRole("alert").filter({ hasText: "Analytics unavailable" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByText("Telemetry samples", { exact: true }),
  ).toHaveCount(0);
});

test("gateway detail renders a current child environmental sample", async ({
  request,
  page,
}) => {
  const gatewayId = "e2e-environment-gateway-01";
  const childDeviceId = "e2e-environment-sensor-01";
  const sampleTimestamp = Date.now();

  await loginAs(page, "admin");
  await navigate(page, "Devices");
  await addItem(page, "gateway");
  await page.getByLabel("Gateway ID").fill(gatewayId);
  await page.getByLabel("Gateway name").fill("E2E Environmental Gateway");
  await finishGateway(page);
  await expect(
    page
      .getByText("E2E Environmental Gateway", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();

  for (const deviceId of [childDeviceId, "e2e-environment-sensor-read-error"]) {
    const registered = await page.request.post("/api/trpc/devices.create", {
      data: {
        json: {
          deviceId,
          name: deviceId,
          type: "sensor",
          route: "gateway",
          gatewayId,
          freshnessSeconds: 120,
        },
      },
    });
    expect(registered.ok()).toBe(true);
  }
  const payload = {
    units: { temperature: "°C", humidity: "%" },
    integration: {
      mode: "live",
      sourceQuality: "good",
      sourceConnection: "online",
      gatewayReceivedAt: new Date().toISOString(),
    },
    deviceId: childDeviceId,
    gatewayId,
    assetId: null,
    sensorType: "DHT11",
    sensorStatus: "ok",
    timestamp: sampleTimestamp,
    temperature: 23.7,
    humidity: 41.2,
    vibration: null,
    power: null,
    pressure: null,
    rpm: null,
  };
  const denied = await request.post("/api/internal/telemetry", {
    data: payload,
  });
  expect(denied.status()).toBe(401);

  const rejected = await request.post("/api/internal/telemetry", {
    headers: { Authorization: "Bearer local-e2e-ingestion-token" },
    data: {
      ...payload,
      integration: {
        mode: "simulated",
        scenarioRunId: "invalid".repeat(1000),
        gatewayReceivedAt: "bad",
      },
    },
  });
  expect(rejected.status()).toBe(400);
  const rejection = await rejected.text();
  expect(Buffer.byteLength(rejection)).toBeLessThan(2048);
  expect(JSON.parse(rejection)).toMatchObject({
    error: "Invalid telemetry payload",
  });
  expect(rejection).not.toContain("invalid".repeat(100));

  const accepted = await request.post("/api/internal/telemetry", {
    data: payload,
    headers: { Authorization: "Bearer local-e2e-ingestion-token" },
  });
  expect(accepted.status()).toBe(202);
  await expect(accepted.json()).resolves.toMatchObject({
    status: "accepted",
    deviceId: payload.deviceId,
  });

  const failedSensorId = "e2e-environment-sensor-read-error";
  const failedSample = await request.post("/api/internal/telemetry", {
    headers: { Authorization: "Bearer local-e2e-ingestion-token" },
    data: {
      ...payload,
      deviceId: failedSensorId,
      sensorStatus: "read_error",
      temperature: null,
      humidity: null,
    },
  });
  expect(failedSample.status()).toBe(202);

  await navigate(page, "Devices");
  await page.getByLabel("Search inventory", { exact: true }).fill(gatewayId);
  const gatewayRow = page.getByRole("row").filter({ hasText: gatewayId });
  await gatewayRow
    .getByRole("button", { name: "Actions for E2E Environmental Gateway" })
    .click();
  await page
    .getByRole("menuitem", { name: "Open workspace", exact: true })
    .click();
  await page.getByRole("tab", { name: "Connected items", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "E2E Environmental Gateway" }),
  ).toBeVisible();

  const childCard = page.getByRole("button", {
    name: `Open ${childDeviceId} details`,
  });
  await expect(childCard).toBeVisible();
  await expect(
    childCard.getByText("temperature", { exact: true }),
  ).toBeVisible();
  await expect(childCard.getByText("23.7 °C", { exact: true })).toBeVisible();
  await expect(childCard.getByText("humidity", { exact: true })).toBeVisible();
  await expect(childCard.getByText("41.2 %", { exact: true })).toBeVisible();
  await expect(childCard.locator("time").first()).toBeVisible();
  await expect(
    childCard.locator(
      `time[datetime="${new Date(sampleTimestamp).toISOString()}"]`,
    ),
  ).toBeVisible();

  const failedChildCard = page.getByRole("button", {
    name: `Open ${failedSensorId} details`,
  });
  await expect(
    failedChildCard.getByText("Sensor read error", { exact: true }),
  ).toBeVisible();
  await expect(
    failedChildCard.getByText(/latest sensor read failed/i),
  ).toBeVisible();

  await navigate(page, "Monitoring");
  await expect(
    page.getByRole("heading", { name: "Monitoring", exact: true }),
  ).toBeVisible();
  const monitoringSearch = page.getByLabel("Search sources");
  await monitoringSearch.fill(childDeviceId);
  const healthySensorRow = page
    .getByRole("article")
    .filter({ hasText: childDeviceId });
  await expect(
    healthySensorRow.getByText("23.7 °C", { exact: true }),
  ).toBeVisible();
  await expect(
    healthySensorRow.getByText("41.2 %", { exact: true }),
  ).toBeVisible();
  await monitoringSearch.fill(failedSensorId);
  const failedSensorRow = page
    .getByRole("article")
    .filter({ hasText: failedSensorId });
  await expect(
    failedSensorRow.getByText(/Sensor read unavailable/),
  ).toBeVisible();
  await expect(failedSensorRow.getByText("0 °C", { exact: true })).toHaveCount(
    0,
  );
});

test("AASX upload is private and role protected", async ({ request, page }) => {
  const file = {
    name: "unauthorized.aasx",
    mimeType: "application/aas+zip",
    buffer: Buffer.from("PK\x03\x04fixture"),
  };
  const anonymous = await request.post("/api/assets/import", {
    multipart: { file },
  });
  expect(anonymous.status()).toBe(401);

  await loginAs(page, "viewer");
  const forbidden = await page.evaluate(async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob(["PK\x03\x04fixture"], { type: "application/aas+zip" }),
      "viewer.aasx",
    );
    return (await fetch("/api/assets/import", { method: "POST", body: form }))
      .status;
  });
  expect(forbidden).toBe(403);
});

test("standard AAS gateway requires a session and rejects foreign cookie origins", async ({
  request,
}) => {
  const unauthenticated = await request.get("/api/aas/shells");
  expect(unauthenticated.status()).toBe(401);

  const forgedOrigin = await request.post("/api/trpc/auth.logout", {
    headers: { Origin: "https://attacker.example" },
    data: { json: null },
  });
  expect(forgedOrigin.status()).toBe(403);
});

test("engineer session reaches the IDTA API through the OAuth-backed gateway", async ({
  page,
}) => {
  await loginAs(page, "engineer");
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/aas/description");
    return {
      status: response.status,
      body: await response.json(),
      version: response.headers.get("aas-api-version"),
    };
  });
  expect(result.status).toBe(200);
  expect(result.version).toBe("3.2");
  expect(result.body.profiles).toContain(
    "https://admin-shell.io/aas/API/3/2/AssetAdministrationShellRepositoryServiceSpecification/SSP-001",
  );
});

test("admin can inspect demo AAS data and manage user access", async ({
  page,
}) => {
  await loginAs(page, "admin");
  await navigate(page, "Assets");
  await expect(
    page.getByRole("heading", { name: "Assets & devices" }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Compressed Air Compressor 01", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  const amlDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /export automationml/i }).click();
  const amlDownload = await amlDownloadPromise;
  expect(amlDownload.suggestedFilename()).toBe("smart-factory.aml");
  const amlXml = await readFile(await amlDownload.path(), "utf8");
  expect(amlXml).toContain("urn:demo:asset:compressor-01");

  const demoAssetRow = page
    .getByRole("row")
    .filter({ hasText: "Compressed Air Compressor 01" });
  await openItem(page, "Compressed Air Compressor 01", "AAS & submodels");
  await expect(page.getByText("Asset Administration Shell")).toBeVisible();
  await expect(page.getByText("Simulated engineering data.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "AAS submodels" }),
  ).toBeVisible();
  await page.locator("summary").getByText("Nameplate", { exact: true }).click();
  await expect(
    page
      .getByText(/Industrial Road 1/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /record lifecycle transition/i }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "AAS & submodels", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /export aas json/i }).click();
  expect((await download).suggestedFilename()).toMatch(
    /aas-environment\.json$/,
  );
});

test("individual administrator registers, versions, restores and imports AAS assets", async ({
  page,
}) => {
  await loginAs(page, "admin");
  await navigate(page, "Devices");
  await addItem(page, "gateway");
  await page.getByLabel("Gateway ID").fill("e2e-edge-gateway-01");
  await page.getByLabel("Gateway name").fill("E2E Edge Gateway");
  await finishGateway(page);
  await expect(
    page
      .getByText("E2E Edge Gateway", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();

  await navigate(page, "Assets");
  await addItem(page, "asset");
  await page.getByLabel("Asset name").fill("E2E Compressor 01");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByLabel("Manufacturer", { exact: true })
    .fill("E2E Equipment GmbH");
  await page.getByLabel("Product designation").fill("E2E Compressor Model");
  await page.getByLabel("Manufacturer street").fill("E2E Street 1");
  await page.getByLabel("Manufacturer postal code").fill("10115");
  await page.getByLabel("Manufacturer city").fill("Berlin");
  await page
    .getByLabel("Manufacturer country code (ISO 3166-1 alpha-2)")
    .fill("DE");
  await page.getByLabel("Manufacturer article number").fill("E2E-COMP-ART-001");
  await page.getByLabel("Manufacturer order code").fill("E2E-COMP-001");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Not connected yet").click();
  await page.getByRole("option", { name: /E2E Edge Gateway/ }).click();
  await page.getByLabel("Machine endpoint").fill("opc.tcp://127.0.0.1:4840");
  for (let step = 0; step < 2; step++)
    await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: /register and provision/i }).click();
  await expect(
    page
      .getByText("E2E Compressor 01", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText("AAS provisioned and registered")).toBeVisible();
  await expect(
    page.getByText(/profile was published to the edge gateway/i),
  ).toBeVisible();
  await page.getByRole("link", { name: /Open registered asset/ }).click();
  await page.getByRole("tab", { name: "AAS & submodels", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit asset data", exact: true })
    .click();
  // Keep this revision-1 form open while a second browser session commits
  // revision 2. Its later save must be rejected as stale.
  const stalePage = await page.context().newPage();
  await stalePage.goto(page.url());
  const concurrentAssetRow = stalePage
    .getByRole("row")
    .filter({ hasText: "E2E Compressor 01" });
  await stalePage
    .getByRole("button", { name: "Edit asset data", exact: true })
    .click();
  await stalePage
    .getByLabel("Manufacturer street")
    .fill("Modified E2E Street 2");
  await stalePage.getByRole("button", { name: "Save asset" }).click();
  await expect(
    stalePage.getByText("Asset details and AAS updated"),
  ).toBeVisible();
  await stalePage.close();

  await page.getByLabel("Manufacturer street").fill("Stale E2E Street 9");
  await page.getByRole("button", { name: "Save asset" }).click();
  await expect(page.getByText(/version conflict/i)).toBeVisible();
  await page.keyboard.press("Escape");
  await navigate(page, "Assets");
  const createdAssetRow = page
    .getByRole("row")
    .filter({ hasText: "E2E Compressor 01" });
  await openItem(page, "E2E Compressor 01", "Activity");
  await expect(page.getByText("AAS revision 2")).toBeVisible();
  await expect(page.getByText("Revision 2 · current · updated")).toBeVisible();
  await expect(page.getByText("Revision 1 · created")).toBeVisible();
  await expect(page.getByText(/SHA-256: [a-f0-9]{64}/).first()).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restore as new revision" }).click();
  await expect(
    page.getByText("Historical AAS restored as a new revision"),
  ).toBeVisible();
  await expect(page.getByText("AAS revision 3")).toBeVisible();
  await expect(page.getByText("Revision 3 · current · updated")).toBeVisible();
  await expect(page.getByText("Restored from version 1")).toBeVisible();
  await page.getByRole("tab", { name: "AAS & submodels", exact: true }).click();
  await page.locator("summary").getByText("Nameplate", { exact: true }).click();
  await expect(
    page
      .getByText(/E2E Street 1/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await navigate(page, "Assets");
  await addItem(page, "asset");
  await page.getByRole("tab", { name: "Import Package (.aasx)" }).click();
  await page.locator("#aasx-package").setInputFiles({
    name: "vendor-pump.aasx",
    mimeType: "application/aas+zip",
    buffer: Buffer.from("PK\x03\x04E2E fixture"),
  });
  const importResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/assets/import"),
  );
  await page.getByRole("button", { name: /import aasx package/i }).click();
  const importResponse = await importResponsePromise;
  expect(importResponse.status()).toBe(201);
  expect(await importResponse.json()).toMatchObject({
    assets: [{ name: "Vendor Pump 1" }],
  });
  await expect(
    page.getByText("Vendor Pump 1", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText("Imported 1 asset from AASX")).toBeVisible();
  const importedAssetRow = page
    .getByRole("row")
    .filter({ hasText: "Vendor Pump 1" });
  await page
    .getByRole("link", { name: "Open Vendor Pump 1", exact: true })
    .click();
  await page.getByRole("tab", { name: "AAS & submodels", exact: true }).click();
  const importedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /export aas json/i }).click();
  const importedFile = await importedDownload;
  const importedEnvironment = JSON.parse(
    await readFile(await importedFile.path(), "utf8"),
  ) as { conceptDescriptions: Array<{ id: string }> };
  expect(importedEnvironment.conceptDescriptions).toEqual([
    { modelType: "ConceptDescription", id: "urn:e2e:concept:pump" },
  ]);
  await navigate(page, "Assets");
  await addItem(page, "asset");
  await page.getByRole("tab", { name: "Import Package (.aasx)" }).click();
  await page.locator("#aasx-package").setInputFiles({
    name: "vendor-pump-copy.aasx",
    mimeType: "application/aas+zip",
    buffer: Buffer.from("PK\x03\x04duplicate E2E fixture"),
  });
  const duplicateImportResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/assets/import"),
  );
  await page.getByRole("button", { name: /import aasx package/i }).click();
  const duplicateResponse = await duplicateImportResponse;
  expect(duplicateResponse.status()).toBe(409);
  await expect(
    page.getByText(/already exists.*preserve the existing asset/i),
  ).toBeVisible();
  await page.getByRole("button", { name: /close/i }).click();
  await expect(
    page.getByText("Vendor Pump 1", { exact: true }).filter({ visible: true }),
  ).toHaveCount(1);
  await navigate(page, "Devices");
  await page
    .getByLabel("Search inventory", { exact: true })
    .fill("e2e-edge-gateway-01");
  const gatewayRow = page
    .getByRole("row")
    .filter({ hasText: "e2e-edge-gateway-01" });
  await gatewayRow
    .getByRole("link", { name: "E2E Edge Gateway", exact: true })
    .click();
  await page.getByRole("tab", { name: "Connected items", exact: true }).click();
  await navigate(page, "Assets");
  await openItem(page, "E2E Compressor 01", "Connections");
  await expect(page.getByText("Asset Administration Shell")).toBeVisible();
  await expect(page.getByText("opc.tcp://127.0.0.1:4840")).toBeVisible();
  await page.getByRole("tab", { name: "AAS & submodels", exact: true }).click();
  await page.locator("summary").getByText("Nameplate", { exact: true }).click();
  await expect(
    page
      .getByText(/E2E Street 1/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByLabel("Move to stage").click();
  await page.getByRole("option", { name: "Engineered" }).click();
  await page.getByLabel("Change note").fill("E2E commissioning preparation");
  await page
    .getByRole("button", { name: /record lifecycle transition/i })
    .click();
  await expect(page.getByText("engineered", { exact: true })).toBeVisible();

  await navigate(page, "User Access");
  await expect(
    page.getByRole("heading", { name: "Users & access", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("security-engineer@example.test")).toBeVisible();
});

test("viewer sees asset summaries while engineering and admin screens stay hidden", async ({
  page,
}) => {
  await loginAs(page, "viewer");
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /^overview$/i }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Assets & devices", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Firmware & updates" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Users & access" })).toHaveCount(
    0,
  );
  await navigate(page, "Assets");
  await expect(
    page
      .getByText("Compressed Air Compressor 01", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  const assetRow = page
    .getByRole("row")
    .filter({ hasText: "Compressed Air Compressor 01" });
  await expect(
    assetRow.getByRole("button", { name: "Open Compressed Air Compressor 01" }),
  ).toHaveCount(0);
  const aasAccess = await page.evaluate(
    async () => (await fetch("/api/aas/shells")).status,
  );
  expect(aasAccess).toBe(403);
});

test("operator can acknowledge alerts but cannot open AAS or user administration", async ({
  page,
}) => {
  await loginAs(page, "operator");
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Assets & devices", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Firmware & updates" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Users & access" })).toHaveCount(
    0,
  );
  await navigate(page, "Assets");
  await expect(
    page
      .getByText("Compressed Air Compressor 01", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  const assetRow = page
    .getByRole("row")
    .filter({ hasText: "Compressed Air Compressor 01" });
  await expect(
    assetRow.getByRole("button", { name: "Open Compressed Air Compressor 01" }),
  ).toHaveCount(0);
});

test("engineer can open AAS while user administration remains admin-only", async ({
  page,
}) => {
  await loginAs(page, "engineer");
  await expect(page.getByRole("link", { name: "Users & access" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "Firmware & updates" }),
  ).toBeVisible();
  await navigate(page, "Assets");
  await openItem(
    page,
    "Windformer Wind Turbine Generator 01",
    "AAS & submodels",
  );
  await expect(page.getByText("Asset Administration Shell")).toBeVisible();
  await expect(
    page.locator("summary").getByText("Nameplate", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("summary").getByText("TechnicalData", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Windformer Wind Turbine Generator 01", { exact: true }),
  ).toBeVisible();
  const aasCollection = await page.evaluate(async () => {
    const response = await fetch("/api/aas/shells");
    return { status: response.status, body: await response.json() };
  });
  expect(aasCollection).toEqual({
    status: 200,
    body: { result: [], paging_metadata: {} },
  });
});

test("administrator recovery enforces first password change, revocation and disablement", async ({
  page,
  browser,
  baseURL,
}) => {
  // This multi-account journey signs in repeatedly, now starting automatic 3D
  // previews each time. Keep the complete recovery workflow bounded separately
  // from the individual action and access assertions.
  test.setTimeout(60000);
  await loginAs(page, "admin");
  const email = `recovery-${Date.now()}@example.test`,
    temporary = "Synthetic-initial-only-2026!",
    own = "Synthetic-owner-password-2026!",
    reset = "Synthetic-reset-only-2026!";
  const created = await page.request.post("/api/trpc/users.create", {
    data: {
      json: {
        email,
        name: "Synthetic recovery account",
        password: temporary,
        role: "viewer",
      },
    },
  });
  expect(created.ok()).toBe(true);
  const userContext = await browser.newContext({ baseURL }),
    person = await userContext.newPage();
  const signIn = async (password: string) => {
    await person.goto(`/?recovery-login=${Date.now()}#/login`);
    await person.getByLabel("Email").fill(email);
    await person.getByLabel("Password", { exact: true }).fill(password);
    await person.getByRole("button", { name: /^sign in$/i }).click();
  };
  await signIn(temporary);
  await expect(
    person.getByRole("heading", { name: "Change your password", exact: true }),
  ).toBeVisible();
  expect((await person.request.get("/api/trpc/assets.list")).status()).toBe(
    403,
  );
  await person.getByLabel("New password", { exact: true }).fill(own);
  await person
    .getByLabel("Confirm new password", { exact: true })
    .fill(own + "different");
  await person
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await expect(
    person.getByText("Passwords do not match.", { exact: true }),
  ).toBeVisible();
  await person.getByLabel("Confirm new password", { exact: true }).fill(own);
  await person
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await expect(
    person.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.goto("/#/administration/users");
  await page.getByLabel("Search accounts").fill(email);
  const manage = async (action: string) => {
    await page
      .getByRole("button", { name: `Manage ${email}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
  };
  await manage("Reset password");
  await expect(
    page.getByRole("button", { name: "Confirm reset", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I verified this person's identity/ })
    .check();
  await page.getByLabel("Temporary password", { exact: true }).fill(reset);
  await page
    .getByRole("button", { name: "Confirm reset", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await person.request.get("/api/trpc/assets.list")).status()).toBe(
    401,
  );
  await signIn(reset);
  await expect(
    person.getByRole("heading", { name: "Change your password", exact: true }),
  ).toBeVisible();
  const reused = await person.request.post("/api/trpc/auth.login", {
    data: { json: { email, password: reset } },
  });
  expect(reused.status()).toBe(401);
  await person.getByLabel("New password", { exact: true }).fill(own);
  await person.getByLabel("Confirm new password", { exact: true }).fill(own);
  await person
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await expect(
    person.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await manage("Revoke sessions");
  await page
    .getByRole("button", { name: "Confirm revoke", exact: true })
    .click();
  await expect(
    page.getByText("Account access changed. Refresh and review it again.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByLabel("Search accounts").fill(email);
  await manage("Revoke sessions");
  await page
    .getByRole("button", { name: "Confirm revoke", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await person.request.get("/api/trpc/assets.list")).status()).toBe(
    401,
  );
  await signIn(own);
  await expect(
    person.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await manage("Disable account");
  await page
    .getByRole("button", { name: "Confirm disable", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await person.request.get("/api/trpc/assets.list")).status()).toBe(
    401,
  );
  expect(
    (
      await person.request.post("/api/trpc/auth.login", {
        data: { json: { email, password: own } },
      })
    ).status(),
  ).toBe(401);
  await manage("Enable account");
  await page
    .getByRole("button", { name: "Confirm enable", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await signIn(own);
  await expect(
    person.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await userContext.close();
});

test("individual Demo/Live switch scopes data without changing factory settings", async ({
  page,
}) => {
  await loginAs(page, "admin");
  const input = encodeURIComponent(
    JSON.stringify({ json: { page: 0, pageSize: 50 } }),
  );
  await Promise.all([
    page.waitForEvent("load", { timeout: 30000 }),
    page
      .getByRole("combobox", { name: "Data workspace", exact: true })
      .selectOption("demo"),
  ]);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("combobox", { name: "Data workspace", exact: true }),
  ).toHaveValue("demo");
  let data = (
    await (
      await page.request.get("/api/trpc/inventory.list?input=" + input)
    ).json()
  ).result.data.json;
  expect(data.items.length).toBeGreaterThan(0);
  expect(data.items.every((i: any) => i.isDemo)).toBe(true);
  expect(
    (
      await page.request.post("/api/trpc/devices.update", {
        data: { json: { id: 1, name: "Denied by preview" } },
      })
    ).status(),
  ).toBe(403);
  expect((await page.request.get("/api/trpc/users.list")).status()).toBe(403);
  await Promise.all([
    page.waitForEvent("load", { timeout: 30000 }),
    page
      .getByRole("combobox", { name: "Data workspace", exact: true })
      .selectOption("live"),
  ]);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("combobox", { name: "Data workspace", exact: true }),
  ).toHaveValue("live");
  data = (
    await (
      await page.request.get("/api/trpc/inventory.list?input=" + input)
    ).json()
  ).result.data.json;
  expect(data.items.length).toBeGreaterThan(0);
  expect(data.items.every((i: any) => !i.isDemo)).toBe(true);
  const audit = (
    await (
      await page.request.get(
        "/api/trpc/system.audit?input=" +
          encodeURIComponent(
            JSON.stringify({ json: { page: 0, search: "demo" } }),
          ),
      )
    ).json()
  ).result.data.json;
  expect(JSON.stringify(audit)).not.toContain("Denied by preview");
});

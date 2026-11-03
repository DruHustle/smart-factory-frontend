import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  operationScenarioLabels,
  operationScenarios,
  type OperationsSummary,
} from "../shared/operations";
import { enterSimulation, noOverflow, rpc } from "./visual-workspace-helpers";

// The public demo runner seeds only disposable, synthetic accounts and records.
// These journeys exercise the real HTTP service; they do not mock authorization.
test.setTimeout(150_000);
const evidenceDirectory =
  process.env.OT_OPERATIONS_EVIDENCE_DIR ?? "test-results/ot-operations";
const panel = (page: Page) => page.getByTestId("ot-operations");
const scenarioEvidence = (page: Page) =>
  page.getByTestId("ot-scenario-evidence");
async function summary(page: Page, input: Record<string, unknown>) {
  const response = await page.request.get(rpc("operations.summary", input));
  expect(response.ok()).toBe(true);
  return (await response.json()).result.data.json as OperationsSummary;
}
async function liveLogin(page: Page, role: "engineer" | "operator" | "viewer") {
  await page.request.post("/api/trpc/auth.logout", { data: { json: null } });
  await page.goto(`/?fixture-login=${Date.now()}#/login`);
  await page.getByLabel("Email").fill(`security-${role}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-security-only-2026!");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const workspace = page.getByRole("combobox", { name: "Data workspace" });
  if ((await workspace.inputValue()) !== "live")
    await workspace.selectOption("live");
  await expect(workspace).toHaveValue("live");
}
async function screenshot(page: Page, name: string) {
  mkdirSync(evidenceDirectory, { recursive: true });
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await page.screenshot({
    path: join(evidenceDirectory, name + ".png"),
    fullPage: true,
  });
  const box = await panel(page).boundingBox();
  expect(box).not.toBeNull();
  // Clip the original page at scroll position zero so its sticky navigation
  // does not cover content in an element screenshot taller than the viewport.
  await page.screenshot({
    path: join(evidenceDirectory, name + "-operations.png"),
    fullPage: true,
    clip: box!,
  });
}

test("six recorded scenarios retain their evidence, explicit simulation and honest outage gaps", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enterSimulation(page);
  const operations = panel(page);
  await expect(operations).toBeVisible();
  await expect(
    operations.getByRole("button", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  for (const scenario of operationScenarios) {
    await operations.getByLabel("OT scenario").selectOption(scenario);
    await expect(page).toHaveURL(new RegExp("otScenario=" + scenario));
    await expect(
      scenarioEvidence(page).getByRole("heading", {
        name: operationScenarioLabels[scenario],
        exact: true,
      }),
    ).toBeVisible();
    await expect(scenarioEvidence(page)).toContainText(
      "Recorded simulation · separate from baseline telemetry",
    );
    const data = await summary(page, { scenario });
    expect(data.demo).toBe(true);
    expect(
      data.records.every((record) => record.provenance === "simulated"),
    ).toBe(true);
    for (const [term, value] of [
      ["Operating state", data.evidence!.operatingState],
      ["Asset condition", data.evidence!.condition],
      ["Gateway connection", data.evidence!.connectivity],
    ]) {
      await expect(
        scenarioEvidence(page)
          .locator("dl > div")
          .filter({ has: page.locator("dt", { hasText: term }) }),
      ).toContainText(value);
    }
    if (scenario === "gateway-outage") {
      await expect(
        operations.getByRole("button", { name: /^OEE / }),
      ).toContainText("Unavailable");
      await expect(
        operations.getByRole("button", { name: /^Recorded coverage / }),
      ).toContainText("50%");
      await expect(scenarioEvidence(page)).toContainText(
        "no machine stop is inferred",
      );
      expect(
        data.evidence!.signals.some((point) => point.pressureBar == null),
      ).toBe(true);
    } else {
      await expect(
        operations.getByRole("button", { name: /^OEE / }),
      ).not.toContainText("Unavailable");
    }
    await scenarioEvidence(page)
      .getByLabel("Scenario signal")
      .selectOption("vibrationMmS");
    await expect(
      scenarioEvidence(page).getByRole("img", {
        name: "Vibration scenario trend in mm/s; missing readings remain gaps",
      }),
    ).toBeVisible();
    const limit = scenarioEvidence(page).locator(
      ".recharts-reference-line-line",
    );
    await expect(limit).toHaveCount(1);
    await expect
      .poll(async () =>
        limit.evaluate((element) => {
          const y = Number(element.getAttribute("y1"));
          const svg = element.closest("svg")!;
          return (
            y > 0 &&
            y < svg.viewBox.baseVal.height &&
            Number(element.getAttribute("x2")) >
              Number(element.getAttribute("x1"))
          );
        }),
      )
      .toBe(true);
    await screenshot(page, "desktop-" + scenario);
  }
  await operations
    .getByRole("button", { name: "Handover", exact: true })
    .click();
  await expect(operations).toContainText("Verify stable measurements");
  await expect(
    operations.getByRole("link", { name: "Related equipment", exact: true }),
  ).toHaveAttribute("href", /otScenario=recovery/);
  await expect(
    operations.getByRole("button", { name: "Record handover", exact: true }),
  ).toHaveCount(0);
  const write = await page.request.post("/api/trpc/operations.addHandover", {
    data: {
      json: {
        expectedVersion: 1,
        at: Date.now() - 60000,
        text: "Synthetic demo write must be denied",
        nextStep: "Review permissions",
        assetRefs: [],
        incidentIds: [],
      },
    },
  });
  expect(write.status()).toBe(403);
  expect(errors).toEqual([]);
});

test("mobile scenario investigation preserves the same equipment references and exact historical window through Assistant", async ({
  page,
}) => {
  const showcase = await enterSimulation(page, 390);
  const endTime = Date.parse(showcase.anchor),
    startTime = endTime - 3600000;
  const query = new URLSearchParams({
    otScenario: "utility-loss",
    from: new Date(startTime).toISOString(),
    to: new Date(endTime).toISOString(),
  });
  await page.goto("/#/?" + query);
  await expect(
    scenarioEvidence(page).getByRole("heading", {
      name: "Utility loss and slowdown",
      exact: true,
    }),
  ).toBeVisible();
  await noOverflow(page);
  await screenshot(page, "mobile-utility-loss");
  const related = scenarioEvidence(page).getByRole("link", {
    name: "Open related equipment",
  });
  const equipmentHref = (await related.getAttribute("href"))!;
  expect(decodeURIComponent(equipmentHref)).toContain(showcase.assetRef);
  await related.click();
  await expect(page).toHaveURL(/otScenario=utility-loss/);
  await expect(scenarioEvidence(page)).toContainText(
    "Utility loss and slowdown",
  );
  await noOverflow(page);
  await scenarioEvidence(page)
    .getByRole("link", { name: "Ask about this scenario" })
    .click();
  await expect(page).toHaveURL(/#\/assistant\?/);
  const assistantQuery = new URLSearchParams(
    new URL(page.url()).hash.split("?")[1],
  );
  expect(Object.fromEntries(assistantQuery)).toMatchObject({
    otScenario: "utility-loss",
    scope: "simulated",
    from: String(startTime),
    to: String(endTime),
  });
  expect(assistantQuery.has("asset")).toBe(false);
  expect(assistantQuery.has("device")).toBe(false);
  await expect(page.getByLabel("Investigation context")).toContainText(
    "simulated",
  );
  const answerResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/trpc/assistant.askInContext") &&
      response.request().method() === "POST",
  );
  await page
    .getByLabel("Ask the Smart Factory Assistant")
    .fill(
      "Explain the pressure drop and production loss in this recorded scenario.",
    );
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const response = await answerResponse;
  expect(response.ok()).toBe(true);
  const body = await response.json();
  const answer = (Array.isArray(body) ? body[0] : body).result.data.json;
  expect(answer.investigation.snapshot).toMatchObject({
    startTime,
    endTime,
    scope: "simulated",
    metric: "pressure",
    unit: "Pa",
  });
  expect(answer.investigation.snapshot.buckets).toHaveLength(13);
  expect(answer.investigation.snapshot.buckets.at(-1).value).toBe(480000);
  expect(
    answer.sources.some((source: { excerpt: string }) =>
      source.excerpt.includes("separate from stored baseline telemetry"),
    ),
  ).toBe(true);
  await expect(page.getByTestId("assistant-answer-content")).toContainText(
    "Utility loss and slowdown",
  );
  await noOverflow(page);
  mkdirSync(evidenceDirectory, { recursive: true });
  await page.screenshot({
    path: join(evidenceDirectory, "mobile-scenario-assistant.png"),
    fullPage: true,
  });
});

test("Analytics exposes the selected scenario inputs and downtime reasons on desktop and mobile", async ({
  page,
}) => {
  const showcase = await enterSimulation(page);
  const endTime = Date.parse(showcase.anchor),
    startTime = endTime - 3600000;
  const query = new URLSearchParams({
    otScenario: "utility-loss",
    from: new Date(startTime).toISOString(),
    to: new Date(endTime).toISOString(),
  });
  await page.goto("/#/analytics?" + query);
  await expect(
    page.getByRole("heading", { name: "Analytics", exact: true }),
  ).toBeVisible();
  await expect(scenarioEvidence(page)).toContainText(
    "Utility loss and slowdown",
  );
  await screenshot(page, "analytics-desktop-scenario");
  await panel(page)
    .getByRole("button", { name: "Inputs and losses", exact: true })
    .click();
  await expect(panel(page)).toContainText("Downtime reasons by duration");
  await expect(panel(page)).toContainText(
    "Low compressed-air pressure — cause under investigation",
  );
  await panel(page)
    .locator("summary")
    .filter({ hasText: "Demo product A" })
    .click();
  await expect(panel(page)).toContainText(
    "Boundary: Demonstration production line",
  );
  await expect(panel(page)).toContainText(
    "simulated counts and meter values over this exact boundary and interval",
  );
  await expect(panel(page)).toContainText("10 min");
  await screenshot(page, "analytics-desktop-inputs");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await screenshot(page, "analytics-mobile-inputs");
});

test("live factory settings and complete manual periods persist; operator handover carries forward and viewers cannot write", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await liveLogin(page, "engineer");
  const factoryName = "OT acceptance " + Date.now();
  await page
    .getByRole("button", { name: "Create factory", exact: true })
    .click();
  await page.getByLabel("Factory name", { exact: true }).fill(factoryName);
  await page.getByLabel("Floor width (m)", { exact: true }).fill("20");
  await page.getByLabel("Floor depth (m)", { exact: true }).fill("20");
  await page
    .getByRole("button", { name: "Create factory", exact: true })
    .last()
    .click();
  await expect(page.getByTestId("named-factory-workspace")).toBeVisible();
  const factoryId = await page
    .getByLabel("Active factory", { exact: true })
    .inputValue();
  expect(factoryId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(panel(page)).toContainText(
    "Production boundary and shifts are not configured.",
  );
  await panel(page).getByRole("button", { name: "Change factory timezone, current UTC" }).click();
  const timezone = page.getByRole("dialog", { name: "Factory timezone" });
  await timezone.getByLabel("Site timezone").fill("Europe/Berlin");
  await timezone.getByRole("button", { name: "Save timezone" }).click();
  await expect(timezone).toBeHidden();
  await expect(panel(page)).toContainText("Production boundary and shifts are not configured.");
  expect((await summary(page, { factoryId })).configuration.timeZone).toBe("Europe/Berlin");
  await page.reload();
  await expect(panel(page).getByRole("button", { name: "Change factory timezone, current Europe/Berlin" })).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const boundary = factoryName + " production line";
  await panel(page)
    .getByLabel("Production boundary", { exact: true })
    .fill(boundary);
  await panel(page)
    .getByLabel("Site timezone", { exact: true })
    .fill("Africa/Harare");
  await panel(page)
    .getByLabel("Default ideal cycle (seconds per unit)", { exact: true })
    .fill("6");
  await panel(page)
    .getByLabel("Energy meter boundary", { exact: true })
    .fill(boundary);
  await panel(page)
    .getByRole("button", { name: "Save operations settings" })
    .click();
  await expect(panel(page)).toContainText("Africa/Harare");
  await expect(panel(page)).not.toContainText(
    "Production boundary and shifts are not configured.",
  );
  await panel(page)
    .getByRole("button", { name: "Previous shift", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Inputs and losses", exact: true })
    .click();
  await expect(panel(page).getByLabel("Period start (UTC)")).toBeVisible();
  const periodStart = Date.parse(
    (await panel(page).getByLabel("Period start (UTC)").inputValue()) + "Z",
  );
  const periodEnd = Date.parse(
    (await panel(page).getByLabel("Period end (UTC)").inputValue()) + "Z",
  );
  expect(periodEnd - periodStart).toBe(8 * 3600000);
  await panel(page)
    .getByLabel("Product / batch", { exact: true })
    .fill("Acceptance batch A");
  await panel(page)
    .getByLabel("Total units produced", { exact: true })
    .fill("4000");
  await panel(page)
    .getByLabel("Good units produced", { exact: true })
    .fill("3900");
  await panel(page)
    .getByLabel("Meter at start (kWh)", { exact: true })
    .fill("1000");
  await panel(page)
    .getByLabel("Meter at end (kWh)", { exact: true })
    .fill("1100");
  await panel(page)
    .getByLabel("Evidence / source record", { exact: true })
    .fill(
      "Synthetic acceptance shift sheet A; manually entered in the disposable browser database.",
    );
  await panel(page)
    .getByLabel(
      "The state and count records cover the complete entered period.",
      { exact: true },
    )
    .check();
  await panel(page)
    .getByRole("button", { name: "Record production evidence", exact: true })
    .click();
  await expect(
    panel(page).locator("summary").filter({ hasText: "Acceptance batch A" }),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Shift summary", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", { name: /^OEE / }),
  ).toContainText("81.3%");
  await expect(
    panel(page).getByRole("button", { name: /^Recorded coverage / }),
  ).toContainText("100%");
  const recorded = await summary(page, { factoryId, at: periodStart });
  expect(recorded.records[0]).toMatchObject({
    product: "Acceptance batch A",
    provenance: "manual",
    totalCount: 4000,
    goodCount: 3900,
    complete: true,
  });
  expect(recorded.analysis.energyKwh).toBe(100);
  await screenshot(page, "live-manual-production");

  await liveLogin(page, "operator");
  await page.goto("/#/?factory=" + factoryId);
  await expect(panel(page)).toContainText("Africa/Harare");
  await expect(
    panel(page).getByRole("button", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await panel(page)
    .getByRole("button", { name: "Previous shift", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Handover", exact: true })
    .click();
  const note =
    "Synthetic acceptance: inspect compressed-air delivery next shift.";
  await panel(page)
    .getByLabel("What happened / current limitations", { exact: true })
    .fill(note);
  await panel(page)
    .getByLabel("Next investigation step", { exact: true })
    .fill(
      "Compare source pressure evidence and record the inspection outcome.",
    );
  await panel(page)
    .getByRole("button", { name: "Record handover", exact: true })
    .click();
  await expect(panel(page).getByRole("article")).toContainText(note);
  const operatorConfigure = await page.request.post(
    "/api/trpc/operations.configure",
    {
      data: {
        json: {
          factoryId,
          expectedVersion: recorded.version,
          configuration: recorded.configuration,
        },
      },
    },
  );
  expect(operatorConfigure.status()).toBe(403);
  await page.reload();
  await panel(page)
    .getByRole("button", { name: "Handover", exact: true })
    .click();
  await expect(panel(page).getByRole("article")).toContainText(note);
  const current = await summary(page, { factoryId });
  expect(current.notes[0]).toMatchObject({
    text: note,
    shiftStartTime: periodStart,
    timeZone: "Africa/Harare",
  });
  expect(current.notes[0].shiftKey).not.toBe(current.shift.key);
  await screenshot(page, "live-prior-shift-handover");

  await liveLogin(page, "viewer");
  await page.goto("/#/?factory=" + factoryId);
  await panel(page)
    .getByRole("button", { name: "Handover", exact: true })
    .click();
  await expect(panel(page).getByRole("article")).toContainText(note);
  await expect(
    panel(page).getByRole("button", { name: "Record handover", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  const viewerWrite = await page.request.post(
    "/api/trpc/operations.addHandover",
    {
      data: {
        json: {
          factoryId,
          expectedVersion: current.version,
          at: periodStart,
          text: "Viewer must not write",
          nextStep: "Review",
          assetRefs: [],
          incidentIds: [],
        },
      },
    },
  );
  expect(viewerWrite.status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await screenshot(page, "mobile-live-handover");
});

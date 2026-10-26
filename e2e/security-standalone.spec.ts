import { execFileSync } from "node:child_process";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
const password = "Synthetic-security-only-2026!";
async function call(
  r: APIRequestContext,
  path: string,
  input?: unknown,
  query = false,
) {
  const response = query
    ? await r.get(
        `/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
      )
    : await r.post(`/api/trpc/${path}`, { data: { json: input } });
  const body = await response.json();
  return { response, body, data: body.result?.data?.json };
}
async function login(r: APIRequestContext, role = "admin") {
  const result = await call(r, "auth.login", {
    email: `security-${role}@example.test`,
    password,
  });
  expect(result.response.ok(), JSON.stringify(result.body)).toBe(true);
  return result.data.user;
}
async function browserLogin(page: Page, role = "admin") {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill(`security-${role}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Factory Overview", exact: true }),
  ).toBeVisible();
}
function event(
  namespace: string,
  id: string,
  attributes = {
    service: "browser-fixture",
    outcome: "denied",
    reasonCode: "INVALID_CREDENTIALS",
  },
) {
  return {
    schemaVersion: "ot-security-evidence/v1",
    producerNamespace: namespace,
    sourceEventId: id,
    occurredAt: new Date(Date.now() - 100).toISOString(),
    mode: "simulated",
    scenarioRunId: "browser-import",
    eventType: "auth.authentication_failed",
    assetRef: null,
    summary: "Explicit browser simulation; no plant incident asserted.",
    quality: "good",
    producerVersion: "browser-fixture-1",
    attributes,
  };
}
test.describe("independent cybersecurity workspace", () => {
  test.skip(
    process.env.SECURITY_E2E !== "true",
    "Run with the isolated security fixture server",
  );
  test("actual failed-login and role-denial decisions traverse the durable outbox", async ({
    request,
    playwright,
    baseURL,
  }) => {
    for (let n = 0; n < 5; n++) {
      const result = await call(request, "auth.login", {
        email: "security-viewer@example.test",
        password: "Deliberately-wrong-password!",
      });
      expect(result.response.status()).toBe(401);
    }
    const viewer = await playwright.request.newContext({ baseURL });
    await login(viewer, "viewer");
    for (let n = 0; n < 3; n++) {
      const r = await call(viewer, "security.retention", {
        days: 30,
        reason: "Actual denied request in isolated test",
      });
      expect(r.response.status()).toBe(403);
    }
    await login(request);
    await expect
      .poll(
        async () => {
          const r = await call(
            request,
            "security.findings",
            { mode: "simulated", search: "Repeated" },
            true,
          );
          return r.data.items
            .filter((f: any) => f.source_name === "node-app")
            .map((f: any) => f.rule_id)
            .sort();
        },
        { timeout: 30000 },
      )
      .toEqual(["authentication-burst", "authorization-burst"]);
    const ev = await call(
      request,
      "security.events",
      { search: "sign-in", mode: "simulated" },
      true,
    );
    expect(JSON.stringify(ev.data)).not.toContain(
      "Deliberately-wrong-password",
    );
    expect(JSON.stringify(ev.data)).not.toContain(
      "security-viewer@example.test",
    );
    const redacted = await call(
      viewer,
      "security.events",
      { mode: "simulated" },
      true,
    );
    expect(
      redacted.data.items.every(
        (e: any) => e.envelope.summary === "Redacted security evidence",
      ),
    ).toBe(true);
    expect(
      (
        await call(viewer, "security.export", { format: "json" }, true)
      ).response.status(),
    ).toBe(403);
    await viewer.dispose();
  });
  test("source setup, import, evidence, assignment, resolution, recurrence and reload", async ({
    page,
    request,
    playwright,
    baseURL,
  }, testInfo) => {
    await browserLogin(page);
    await page.goto("/#/cybersecurity");
    await page
      .getByRole("button", { name: "Sources and policies", exact: true })
      .click();
    await page
      .getByLabel("Security source name")
      .fill("Browser simulated source");
    await page
      .getByLabel("Security producer namespace")
      .fill("browser-simulated");
    await page.getByLabel("New source mode").selectOption("simulated");
    await page.getByLabel("Security source interval").fill("0");
    await page
      .getByLabel("Configured security connections")
      .fill("supplied-certificate");
    const pending = page.waitForResponse(
      (r) =>
        r.url().includes("security.createSource") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create security source", exact: true })
      .click();
    const result = (await (await pending).json())[0].result.data.json;
    const sourceId = result.id;
    await expect(
      page.getByText("One-time ingestion credential", { exact: true }),
    ).toBeVisible();
    const sourceClient = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${result.token}` },
    });
    expect(
      (
        await call(sourceClient, "security.overview", undefined, true)
      ).response.status(),
    ).toBe(401);
    expect(
      (
        await sourceClient.post("/api/security/evidence", {
          data: "x".repeat(1048577),
          headers: { "Content-Type": "application/json" },
        })
      ).status(),
    ).toBe(413);
    await sourceClient.dispose();
    await page
      .getByRole("button", { name: "Hide credential", exact: true })
      .click();
    await page.getByLabel("Evidence file source").selectOption(sourceId);
    const batch = {
      events: Array.from({ length: 5 }, (_, n) =>
        event("browser-simulated", `browser-${n}`),
      ),
    };
    await page.getByLabel("Security evidence file").setInputFiles({
      name: "evidence.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(batch)),
    });
    await page
      .getByRole("button", { name: "Import reviewed evidence", exact: true })
      .click();
    await expect(page.getByText(/5 event receipts stored/)).toBeVisible();
    await page.getByRole("button", { name: "Findings", exact: true }).click();
    await page.getByLabel("Filter security source").selectOption(sourceId);
    await page
      .getByRole("button", { name: /^Repeated rejected sign-ins/ })
      .click();
    await page
      .getByText(/^Evidence [a-f0-9-]+ · SHA-256/)
      .first()
      .click();
    await expect(
      page
        .getByText(/Explicit browser simulation; no plant incident asserted/)
        .first(),
    ).toBeVisible();
    for (const decision of [
      "acknowledge",
      "assign",
      "investigate",
      "resolve",
    ]) {
      await page.getByLabel("Investigation decision").selectOption(decision);
      await page
        .getByLabel("Investigation reason")
        .fill(`Browser verifies ${decision} with original evidence.`);
      const saved = page.waitForResponse(
        (r) =>
          r.url().includes("security.action") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", {
          name: "Save investigation decision",
          exact: true,
        })
        .click();
      expect((await saved).ok()).toBe(true);
      await expect(
        page.getByText(`investigation_${decision}`, { exact: true }),
      ).toBeVisible();
    }
    await page.reload();
    await expect(
      page.getByText("investigation_resolve", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("investigation-light.png"),
      fullPage: true,
    });
    await login(request);
    const fs = (await call(request, "security.findings", { sourceId }, true))
      .data.items;
    expect(fs[0].status).toBe("resolved");
    await call(request, "security.importEvidence", {
      sourceId,
      ndjson: true,
      raw: JSON.stringify(event("browser-simulated", "browser-recurrence")),
    });
    const d = (await call(request, "security.finding", { id: fs[0].id }, true))
      .data;
    expect(d.status).toBe("open");
    expect(d.recurrences).toBe(1);
    expect(d.condition_active).toBe(true);
  });
  test("reviewed component mapping enables 3D focus and list fallback", async ({
    page,
    request,
  }, testInfo) => {
    await login(request);
    const template = (
      await call(request, "equipment.template", undefined, true)
    ).data;
    const created = await call(request, "equipment.create", {
      name: "Security mapped fixture pump",
      serialNumber: "SECURITY-FIXTURE-001",
      kind: "simulated",
      templateRevision: template.revision,
    });
    expect(created.response.ok(), JSON.stringify(created.body)).toBe(true);
    const workspace = (
      await call(request, "equipment.get", { id: created.data.id }, true)
    ).data;
    const assets = (await call(request, "assets.list", undefined, true)).data;
    const asset = assets.find(
      (a: any) => a.assetId === workspace.externalAssetId,
    );
    const component = workspace.components.find(
      (c: any) => c.name === "Volute casing",
    );
    expect(component).toBeTruthy();
    const src = await call(request, "security.createSource", {
      name: "Explicit mapped fixture",
      namespace: "component-simulation",
      targets: [{ kind: "asset", id: asset.id }],
      modes: ["simulated"],
      types: ["auth.authentication_failed"],
      expectedIntervalSeconds: 0,
    });
    expect(src.response.ok(), JSON.stringify(src.body)).toBe(true);
    await browserLogin(page);
    await page.goto("/#/cybersecurity");
    await page
      .getByRole("button", { name: "Sources and policies", exact: true })
      .click();
    await page.getByLabel("Evidence file source").selectOption(src.data.id);
    await page.getByLabel("Mapping namespace").fill("reviewed-local");
    await page.getByLabel("Mapping asset reference").fill("pump-1");
    await page.getByLabel("Mapping component reference").fill("pump-body");
    await page
      .getByLabel("Mapping registered target")
      .selectOption(`asset:${asset.id}`);
    await page
      .getByLabel("Mapping installed component ID")
      .fill(component.installedComponentId);
    await page
      .getByRole("button", {
        name: "Save reviewed identity mapping",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Reviewed security change saved.", { exact: true }),
    ).toBeVisible();
    const batch = Array.from({ length: 5 }, (_, n) => ({
      ...event("component-simulation", `mapped-${n}`),
      assetRef: {
        namespace: "reviewed-local",
        assetId: "pump-1",
        componentId: "pump-body",
      },
    }));
    expect(
      (
        await call(request, "security.importEvidence", {
          sourceId: src.data.id,
          ndjson: false,
          raw: JSON.stringify({ events: batch }),
        })
      ).response.ok(),
    ).toBe(true);
    const fs = (
      await call(request, "security.findings", { sourceId: src.data.id }, true)
    ).data.items;
    const location = await call(
      request,
      "security.equipmentForFinding",
      { id: fs[0].id },
      true,
    );
    expect(location.data, JSON.stringify(location.body)).toEqual({
      equipmentId: created.data.id,
      componentId: component.installedComponentId,
    });
    await page.goto(`/#/cybersecurity?finding=${fs[0].id}`);
    await page
      .getByRole("link", {
        name: "Focus mapped equipment component",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Security mapped fixture pump",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("[data-state=ready]")).toBeVisible();
    await expect(page.getByLabel("Equipment security overlay")).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Volute casing", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText(
        "Blue rings identify mapped security findings for review.",
        { exact: false },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("mapped-equipment-security.png"),
      fullPage: true,
    });
    await page.route("**/security.equipmentOverlay*", (route) => route.abort());
    await page.goto(`/#/cybersecurity?finding=${fs[0].id}`);
    await expect(
      page.getByRole("heading", { name: "Cybersecurity", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Original normalized evidence", { exact: true }),
    ).toBeVisible();
  });
  test("optional real edge delivery survives outage and reopen", async ({
    request,
    baseURL,
  }) => {
    test.skip(
      !process.env.SECURITY_EDGE_CHECKOUT,
      "Companion-independent standalone suite; enable the local cross-repository acceptance separately",
    );
    await login(request);
    const source = (
      await call(request, "security.createSource", {
        name: "Disposable Pi collector",
        namespace: "actual-local-pi",
        targets: [{ kind: "application", id: null }],
        modes: ["simulated"],
        types: [
          "collector.health",
          "config.changed",
          "integrity.change_observed",
        ],
        expectedIntervalSeconds: 0,
      })
    ).data;
    const output = JSON.parse(
      execFileSync(
        process.env.SECURITY_EDGE_PYTHON ?? "python3",
        [
          `${process.env.SECURITY_EDGE_CHECKOUT}/raspberry-pi/scripts/security-workspace-smoke.py`,
        ],
        {
          input: JSON.stringify({
            origin: baseURL,
            token: source.token,
            namespace: "actual-local-pi",
          }),
          encoding: "utf8",
        },
      ),
    );
    expect(output.telemetryQueuePreserved).toBe(true);
    expect(output.restartPreservedIdentity).toBe(true);
    const ev = (
      await call(request, "security.events", { sourceId: source.id }, true)
    ).data.items;
    expect(ev.some((e: any) => e.source_event_id === output.eventId)).toBe(
      true,
    );
    expect(ev.every((e: any) => e.mode === "simulated")).toBe(true);
    const fs = (
      await call(request, "security.findings", { sourceId: source.id }, true)
    ).data.items;
    expect(fs.some((f: any) => f.rule_id === "collector-coverage")).toBe(true);
    expect(fs.some((f: any) => f.rule_id === "integrity-change")).toBe(true);
  });
  test("role changes clear cached evidence and credentials in the same browser", async ({
    page,
    request,
  }) => {
    await login(request);
    const fs = (
      await call(request, "security.findings", { mode: "simulated" }, true)
    ).data.items;
    await browserLogin(page);
    await page.goto(`/#/cybersecurity?finding=${fs[0].id}`);
    await expect(
      page.getByText(/^Evidence [a-f0-9-]+ · SHA-256/).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await browserLogin(page, "viewer");
    await page.goto(`/#/cybersecurity?finding=${fs[0].id}`);
    await expect(
      page.getByText("Detailed evidence is unavailable to this role.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(/^Evidence [a-f0-9-]+ · SHA-256/)).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", {
        name: "Save investigation decision",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        Object.values(localStorage).some((v) => v.includes("sfsec.")),
      ),
    ).toBe(false);
  });
  for (const width of [1440, 390])
    test(`themes and all sections at ${width}px without peer or provider access`, async ({
      browser,
      baseURL,
    }, testInfo) => {
      const context = await browser.newContext({
          viewport: { width, height: 900 },
        }),
        outside: string[] = [],
        errors: string[] = [];
      await context.route("**/*", (route) => {
        const u = new URL(route.request().url());
        if (u.origin !== new URL(baseURL!).origin) {
          outside.push(u.hostname);
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await browserLogin(page);
      await page.goto("/#/cybersecurity");
      for (const theme of ["light", "dark"]) {
        const switcher = page.getByRole("button", {
          name: `Switch to ${theme} theme`,
          exact: true,
        });
        if (await switcher.count()) await switcher.click();
        await expect
          .poll(() =>
            page.evaluate(() =>
              document.documentElement.classList.contains("dark"),
            ),
          )
          .toBe(theme === "dark");
        await expect
          .poll(() =>
            page.evaluate(() =>
              getComputedStyle(document.documentElement)
                .getPropertyValue("--background")
                .trim(),
            ),
          )
          .toBe(theme === "dark" ? "#0a0e27" : "#f3f6fb");
        for (const tab of [
          "Overview",
          "Asset posture",
          "Events",
          "Findings",
          "Incidents",
          "Sources and policies",
        ]) {
          await page.getByRole("button", { name: tab, exact: true }).click();
          await expect(
            page.getByRole("heading", { name: "Cybersecurity", exact: true }),
          ).toBeVisible();
          await expect
            .poll(() =>
              page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            )
            .toBe(true);
        }
        await page
          .getByRole("button", { name: "Overview", exact: true })
          .click();
        await page.screenshot({
          path: testInfo.outputPath(`overview-${theme}-${width}.png`),
          fullPage: true,
        });
      }
      expect(outside).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();
    });
});

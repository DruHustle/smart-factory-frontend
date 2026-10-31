import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import superjson from "superjson";
import {
  demoPassportPath,
  decodeDemoPassport,
  MAX_DEMO_PASSPORT_TOKEN_LENGTH,
} from "../shared/demo-passport";
import { seedDemoSandbox, sandboxItem } from "../shared/demo-sandbox";
import { PASSPORT_DISCLAIMER } from "../shared/passport";
import {
  requiredCapabilities,
  runtimeContractVersion,
} from "../shared/runtime-contract";

const identity = {
  assetId: "urn:smart-factory:demo:passport:pump-01",
  name: "Umwälzpumpe · Circulation pump 01",
  assetType: "pump",
  manufacturer: "Smart Factory Demo Works",
  model: "SF-P100 · Illustrative pump",
  serialNumber: "DEMO-PASSPORT-001",
  zone: "Process utilities",
};

async function apiFixture(
  page: Page,
  mode: "anonymous" | "private" | "demo" = "anonymous",
) {
  const requests: { procedure: string; method: string }[] = [];
  await page.route("**/api/runtime/contract", (route) =>
    route.fulfill({
      json: {
        contractVersion: runtimeContractVersion,
        capabilities: requiredCapabilities,
        schema: { ready: true },
        versioned: true,
      },
    }),
  );
  await page.route("**/api/trpc/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const batch = url.searchParams.get("batch") === "1";
    const names = decodeURIComponent(url.pathname.split("/trpc/")[1]).split(
      ",",
    );
    const responses = names.map((procedure) => {
      requests.push({ procedure, method: request.method() });
      const values: Record<string, unknown> = {
        "auth.me":
          mode === "anonymous"
            ? null
            : {
                id: 90001,
                name: "Passport fixture user",
                role: "engineer",
                email:
                  mode === "demo" ? "tech@dev.local" : "engineer@example.test",
                openId:
                  mode === "demo" ? "demo-engineer" : "individual-engineer",
                access: {
                  demoOnly: mode === "demo",
                  canSwitchData: mode !== "demo",
                  workspaceView: mode === "demo" ? "demo" : "live",
                  canOperate: mode !== "demo",
                  canEngineer: mode !== "demo",
                  canAdminister: false,
                },
              },
        "auth.demoAccounts": [],
        "notifications.summary": { unread: 0 },
        "system.showcase": null,
        "factory.floor": {
          items: [],
          links: [],
          groups: [],
          total: 0,
          complete: true,
          sampledAt: "2026-10-31T12:00:00.000Z",
        },
        "factories.list": [],
        "assets.getPassport": {
          title: "Private pump",
          fields: [
            { key: "name", label: "Product", value: "Private pump" },
            { key: "assetType", label: "Product type", value: "pump" },
            {
              key: "manufacturer",
              label: "Manufacturer",
              value: "Private manufacturer",
            },
            { key: "model", label: "Model", value: "Private model" },
            {
              key: "serialNumber",
              label: "Serial number",
              value: "PRIVATE-SERIAL-DO-NOT-PUBLISH",
            },
            {
              key: "ratedValue",
              label: "Rated value",
              value: "PRIVATE-RATING",
            },
          ],
          reviewedGuidance: null,
          disclaimer: PASSPORT_DISCLAIMER,
          publishedAt: null,
          assetVersion: 1,
          assetId: 7,
          isDemo: false,
        },
        "assets.passportPublications": [],
        "assets.getPublishedPassport": {
          title: "Reviewed public pump",
          fields: [
            { key: "name", label: "Product", value: "Reviewed public pump" },
            {
              key: "manufacturer",
              label: "Manufacturer",
              value: "Approved manufacturer",
            },
          ],
          reviewedGuidance: null,
          disclaimer: PASSPORT_DISCLAIMER,
          publishedAt: "2026-10-31T12:00:00.000Z",
        },
      };
      return {
        result: { data: superjson.serialize(values[procedure] ?? null) },
      };
    });
    await route.fulfill({ json: batch ? responses : responses[0] });
  });
  return requests;
}

async function decodeRenderedQr(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}-qr.png`);
  await page
    .getByTestId("passport-qr")
    .getByRole("img", { name: /Passport QR code for/ })
    .screenshot({ path });
  return execFileSync(
    process.env.QR_DECODER_PYTHON ?? "python3",
    ["scripts/showcase/decode-qr.py", path],
    { encoding: "utf8" },
  ).trim();
}

test("the rendered demo QR opens the same complete AAS identity in a fresh browser", async ({
  page,
  browser,
}, testInfo) => {
  const requests = await apiFixture(page);
  await page.goto(`/#${demoPassportPath(identity)}`);
  await expect(
    page.getByRole("heading", { name: identity.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("demo-aas-submodel")).toHaveCount(11);
  const scanned = await decodeRenderedQr(page, testInfo, "portable");
  expect(new URL(scanned).hash).toBe(`#${demoPassportPath(identity)}`);
  const other = await browser.newContext();
  try {
    const fresh = await other.newPage();
    await fresh.route("**/api/**", (route) => route.abort());
    await fresh.goto(scanned);
    await expect(
      fresh.getByRole("heading", { name: identity.name, exact: true }),
    ).toBeVisible();
    await expect(
      fresh.getByText(identity.serialNumber, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      fresh.getByText("Materials & circularity", { exact: true }),
    ).toBeVisible();
    await expect(fresh.getByLabel("Primary navigation")).toHaveCount(0);
    // Leaving the bundled demonstration must restore the runtime compatibility
    // boundary, even though the QR itself needs no API.
    await fresh.goto(new URL("/#/inventory", scanned).href);
    await expect(fresh.getByRole("alert")).toContainText(
      "application service is unavailable",
    );
  } finally {
    await other.close();
  }
  expect(
    requests.filter(
      (request) =>
        request.procedure.startsWith("assets.") || request.method === "POST",
    ),
  ).toEqual([]);
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download AAS JSON", exact: true })
    .click();
  const download = await downloadEvent;
  const downloaded = JSON.parse(
    await readFile((await download.path())!, "utf8"),
  );
  expect(download.suggestedFilename()).toMatch(/\.aas\.json$/);
  expect(
    downloaded.assetAdministrationShells[0].assetInformation.globalAssetId,
  ).toBe(identity.assetId);
  expect(downloaded.submodels).toHaveLength(11);
  expect(downloaded.conceptDescriptions.length).toBeGreaterThan(20);
  const ids = new Set(downloaded.submodels.map((submodel: any) => submodel.id));
  for (const reference of downloaded.assetAdministrationShells[0].submodels)
    expect(ids.has(reference.keys[0].value)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("passport-desktop.png"),
    fullPage: true,
  });
});

test("mobile passport QR remains scannable and print output excludes controls", async ({
  page,
}, testInfo) => {
  await apiFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const longIdentity = {
    ...identity,
    name: "Demonstration circulation pump for the northern process utility line and heat recovery loop",
    model: "SF-P100 extended model identity with replaceable motor coupling",
  };
  await page.goto(`/#${demoPassportPath(longIdentity)}`);
  await expect(
    page.getByRole("heading", { name: longIdentity.name, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(new URL(await decodeRenderedQr(page, testInfo, "mobile")).hash).toBe(
    `#${demoPassportPath(longIdentity)}`,
  );
  await page.screenshot({
    path: testInfo.outputPath("passport-mobile.png"),
    fullPage: true,
  });
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("button", { name: "Download AAS JSON", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Print demo passport", exact: true }),
  ).toBeHidden();
  await expect(page.getByTestId("passport-qr")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("passport-print.png"),
    fullPage: true,
  });
});

test("editable demo passport updates the QR without serializing other workspace data", async ({
  page,
}, testInfo) => {
  const state = seedDemoSandbox([], "2026-10-31T12:00:00.000Z");
  state.items = [
    sandboxItem.parse({
      ref: "asset:7",
      identifier: identity.assetId,
      name: identity.name,
      kind: "asset",
      itemType: "pump",
      zone: identity.zone,
      manufacturer: identity.manufacturer,
      model: identity.model,
      serial: identity.serialNumber,
    }),
    sandboxItem.parse({
      ref: "asset:8",
      identifier: "urn:demo:other",
      name: "My simulated conveyor",
      kind: "asset",
      itemType: "conveyor",
      zone: "Packaging",
      manufacturer: "Example Works",
      model: "CONV-01",
      serial: "DEMO-CONV-002",
    }),
  ];
  state.settings.name = "PRIVATE-SANDBOX-SETTING-SENTINEL";
  await page.addInitScript(
    (saved) =>
      localStorage.setItem(
        "smart-factory:editable-demo:v2",
        JSON.stringify(saved),
      ),
    state,
  );
  const requests = await apiFixture(page, "demo");
  await page.goto("/#/sandbox?tab=passport&item=asset%3A7");
  await expect(
    page.getByRole("heading", { name: identity.name, exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Demo equipment", { exact: true })
    .selectOption("asset:8");
  await expect(
    page.getByRole("heading", { name: "My simulated conveyor", exact: true }),
  ).toBeVisible();
  const scanned = await decodeRenderedQr(page, testInfo, "editable");
  const snapshot = decodeDemoPassport(
    new URL(scanned).hash.split("/passport/demo/")[1],
  );
  expect(snapshot?.serialNumber).toBe("DEMO-CONV-002");
  expect(JSON.stringify(snapshot)).not.toContain("PRIVATE-SANDBOX");
  expect(JSON.stringify(snapshot)).not.toContain(identity.serialNumber);
  expect(requests.filter((request) => request.method === "POST")).toEqual([]);
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("button", { name: "Download AAS JSON", exact: true }),
  ).toBeHidden();
  await expect(page.getByTestId("passport-qr")).toBeVisible();
});

test("private preview never adds a QR or unchecked fields, published snapshot stays allowlisted", async ({
  page,
}, testInfo) => {
  const requests = await apiFixture(page, "private");
  await page.goto("/#/passport/7");
  await expect(
    page.getByRole("heading", { name: "Private pump", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("passport-qr")).toHaveCount(0);
  await expect(
    page.getByText("PRIVATE-SERIAL-DO-NOT-PUBLISH", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("PRIVATE-RATING", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("checkbox", { name: "Product", exact: true }).uncheck();
  await expect(
    page.getByRole("heading", { name: "Product passport", exact: true }),
  ).toBeVisible();
  await page.goto("/#/passport/published/00000000-0000-4000-8000-000000000001");
  await expect(
    page.getByRole("heading", { name: "Reviewed public pump", exact: true }),
  ).toBeVisible();
  expect(
    new URL(await decodeRenderedQr(page, testInfo, "published")).hash,
  ).toBe("#/passport/published/00000000-0000-4000-8000-000000000001");
  await expect(page.getByText("Serial number", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Technical characteristics", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("PRIVATE-SERIAL-DO-NOT-PUBLISH", { exact: true }),
  ).toHaveCount(0);
  expect(requests.filter((request) => request.method === "POST")).toEqual([]);
});

test("malformed and oversized demo links show a bounded error without a QR", async ({
  page,
}) => {
  await apiFixture(page);
  for (const token of [
    "not-a-passport",
    "A".repeat(MAX_DEMO_PASSPORT_TOKEN_LENGTH + 1),
  ]) {
    await page.goto(`/#/passport/demo/${token}`);
    await expect(
      page.getByText("Demo passport unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("passport-qr")).toHaveCount(0);
  }
});

test("an imported or legacy demo preview is never replaced with generated specifications", async ({
  page,
}) => {
  await apiFixture(page, "private");
  await page.route("**/api/trpc/assets.getPassport*", async (route) => {
    const result = {
      result: {
        data: superjson.serialize({
          title: "Imported vendor example",
          fields: [
            { key: "name", label: "Product", value: "Imported vendor example" },
            { key: "model", label: "Model", value: "VENDOR-PRESERVED-001" },
          ],
          reviewedGuidance: null,
          disclaimer: PASSPORT_DISCLAIMER,
          publishedAt: null,
          assetVersion: 1,
          assetId: 7,
          isDemo: true,
          authoredDemo: false,
        }),
      },
    };
    await route.fulfill({
      json:
        new URL(route.request().url()).searchParams.get("batch") === "1"
          ? [result]
          : result,
    });
  });
  await page.goto("/#/passport/7");
  await expect(
    page.getByRole("heading", { name: "Imported vendor example", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("VENDOR-PRESERVED-001", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("passport-qr")).toHaveCount(0);
  await expect(page.getByTestId("demo-aas-submodel")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download AAS JSON", exact: true }),
  ).toHaveCount(0);
});

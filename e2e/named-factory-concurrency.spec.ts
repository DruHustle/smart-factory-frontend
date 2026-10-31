import { test, expect, type Page } from "@playwright/test";
import superjson from "superjson";
import {
  requiredCapabilities,
  runtimeContractVersion,
} from "../shared/runtime-contract";
const id = "00000000-0000-4000-8000-000000000032";
const draft = (name: string) => ({
  document: { name, width: 30, depth: 20, zones: [], placements: [] },
  dimensions: {},
  tags: {},
});
const snapshot = (name: string, version = 1) => ({
  id,
  name,
  width: 30,
  depth: 20,
  version,
  updatedAt: new Date().toISOString(),
  ...draft(name),
  items: [],
  total: 0,
  unavailableItems: 0,
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}
async function fixture(page: Page) {
  const control = {
    saved: snapshot("Team factory"),
    saves: [] as any[],
    gate: undefined as ReturnType<typeof gate> | undefined,
  };
  await page.route("**/api/runtime/contract", (r) =>
    r.fulfill({
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
      url = new URL(request.url()),
      batch = url.searchParams.has("batch"),
      inputs = JSON.parse(
        url.searchParams.get("input") ?? request.postData() ?? "{}",
      );
    const responses = await Promise.all(
      decodeURIComponent(url.pathname.split("/trpc/")[1])
        .split(",")
        .map(async (procedure, index) => {
          const input =
            (batch ? inputs[String(index)]?.json : inputs.json) ?? {};
          let value: unknown;
          switch (procedure) {
            case "auth.me":
              value = {
                id: 90001,
                name: "Review engineer",
                email: "review@example.test",
                openId: "review-engineer",
                role: "engineer",
                access: {
                  demoOnly: false,
                  workspaceView: "live",
                  canSwitchData: true,
                  canOperate: true,
                  canEngineer: true,
                  canAdminister: false,
                },
              };
              break;
            case "auth.demoAccounts":
              value = [];
              break;
            case "auth.registrationPolicy":
              value = { enabled: false };
              break;
            case "notifications.summary":
              value = { unread: 0 };
              break;
            case "factories.list":
              value = [{ ...control.saved, items: 0 }];
              break;
            case "factories.get":
              value = control.saved;
              break;
            case "factories.save":
              control.saves.push(input);
              await control.gate?.promise;
              control.saved = {
                ...snapshot(
                  input.draft.document.name,
                  input.expectedVersion + 1,
                ),
                ...input.draft,
              };
              value = control.saved;
              break;
            default:
              throw Error("Unexpected named factory request: " + procedure);
          }
          return { result: { data: superjson.serialize(value) } };
        }),
    );
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(batch ? responses : responses[0]),
    });
  });
  await page.goto("/#/?factory=" + id);
  await page
    .getByRole("button", { name: "Edit factory floor", exact: true })
    .click();
  await expect(
    page.getByLabel("Saved factory name", { exact: true }),
  ).toHaveValue("Team factory");
  return control;
}
test("a late team save keeps later browser edits and a newer teammate version cannot overwrite them", async ({
  page,
}) => {
  const c = await fixture(page),
    name = page.getByLabel("Saved factory name", { exact: true });
  await name.fill("Submitted name");
  c.gate = gate();
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect.poll(() => c.saves.length).toBe(1);
  await name.fill("Newer browser draft");
  c.gate.release();
  await expect(
    page.getByRole("heading", { name: "Submitted name", exact: true }),
  ).toBeVisible();
  await expect(name).toHaveValue("Newer browser draft");
  await expect(
    page.getByRole("button", { name: "Save layout", exact: true }),
  ).toBeEnabled();
  c.saved = snapshot("Teammate update", 3);
  await page
    .getByRole("button", { name: "Refresh factory", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("teammate saved a newer");
  await expect(name).toHaveValue("Newer browser draft");
  await expect(
    page.getByRole("button", { name: "Save layout", exact: true }),
  ).toBeDisabled();
});
test("corrupt stored draft is retained for recovery instead of being overwritten", async ({
  page,
}) => {
  const key = "smart-factory:named-factory-draft:v1:90001:live:" + id;
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "{unrecoverable-test-draft"),
    { key },
  );
  await fixture(page);
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(
    "{unrecoverable-test-draft",
  );
  await expect(
    page.getByRole("button", { name: "Download draft", exact: true }),
  ).toBeVisible();
});

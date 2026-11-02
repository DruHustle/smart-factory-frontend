import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import superjson from "superjson";
import {
  requiredCapabilities,
  runtimeContractVersion,
} from "../shared/runtime-contract";

// Synthetic UI contracts only. Real authorization/bootstrap remains server-tested.
async function accessFixture(
  page: Page,
  options: {
    admin?: boolean;
    demo?: boolean;
    registrationEnabled?: boolean;
    showDemo?: boolean;
  } = {},
) {
  const calls: {
    procedure: string;
    input: Record<string, unknown>;
    mutation: boolean;
  }[] = [];
  const applicant = {
    id: "00000000-0000-4000-8000-000000000071",
    kind: "registration",
    name: "Synthetic Applicant",
    email: "applicant@example.test",
    organization: "Example Factory",
    jobTitle: "Engineer",
    createdAt: new Date("2026-11-01T12:00:00Z"),
    recoveryDelivery: null,
  };
  let pending = true;
  const account = {
    id: 88,
    openId: options.demo ? "demo-admin" : "synthetic-personal-admin",
    name: "Synthetic Administrator",
    email: options.demo ? "demo-admin@example.test" : "admin@example.test",
    role: "admin",
    disabledAt: null,
    passwordChangeRequired: false,
    accessVersion: 1,
    access: {
      demoOnly: !!options.demo,
      canSwitchData: !options.demo,
      workspaceView: options.demo ? "demo" : "live",
      canOperate: !options.demo,
      canEngineer: !options.demo,
      canAdminister: !options.demo,
    },
  };
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
    const inputs = JSON.parse(
      url.searchParams.get("input") ?? request.postData() ?? "{}",
    );
    const responses = names.map((procedure, index) => {
      const input = (batch ? inputs[String(index)]?.json : inputs.json) ?? {};
      calls.push({ procedure, input, mutation: request.method() === "POST" });
      if (procedure === "users.approveRegistration") pending = false;
      const data: Record<string, unknown> = {
        "auth.me": options.admin ? account : null,
        "auth.demoAccounts": options.showDemo
          ? ["Admin", "Engineer", "Operator", "Viewer"].map((role) => ({
              label: `Demo ${role}`,
              role: role.toLowerCase(),
              email: `${role.toLowerCase()}@example.test`,
              password: "Synthetic-demo-only-2026!",
              description: "Synthetic demo fixture",
            }))
          : [],
        "auth.registrationPolicy": {
          enabled: options.registrationEnabled !== false,
          requiresApproval: true,
        },
        "auth.requestRegistration": { submitted: true },
        "users.list": [account],
        "users.pendingRequests": pending ? [applicant] : [],
        "users.approveRegistration": {
          id: 89,
          email: applicant.email,
          name: applicant.name,
          role: input.role,
        },
        "notifications.summary": { unread: 0 },
        "system.showcase": { chapters: [] },
      };
      return { result: { data: superjson.serialize(data[procedure] ?? null) } };
    });
    await route.fulfill({ json: batch ? responses : responses[0] });
  });
  return calls;
}

for (const width of [320, 1440])
  test(`sign-in keeps registration and demo choices concise at ${width}px`, async ({
    page,
  }) => {
    const calls = await accessFixture(page, { showDemo: true });
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/login");
    await expect(
      page.getByText(
        "Need personal access? Register for administrator approval.",
      ),
    ).toHaveCount(0);
    await expect(page.getByText(/Shared demo accounts explore/)).toHaveCount(0);
    const demoButtons = page
      .getByRole("group", { name: "Demo accounts" })
      .getByRole("button");
    await expect(demoButtons).toHaveText([
      "Admin",
      "Engineer",
      "Operator",
      "Viewer",
    ]);
    // Wait for the login card's entrance transform before measuring touch targets.
    await demoButtons.first().scrollIntoViewIfNeeded();
    const boxes = await demoButtons.evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          top: rect.top,
          width: rect.width,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          clipped: button.scrollWidth > button.clientWidth,
        };
      }),
    );
    expect(new Set(boxes.map((box) => box.top)).size).toBe(1);
    expect(
      boxes.every(
        (box) =>
          box.width > 0 &&
          box.height >= 44 &&
          box.left >= 0 &&
          box.right <= width &&
          !box.clipped,
      ),
    ).toBe(true);
    const evidence = process.env.LOGIN_EVIDENCE_DIR;
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({
        path: join(evidence, `login-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.getByRole("link", { name: "Register", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Choose a role" }),
    ).toBeVisible();
    if (evidence)
      await page.screenshot({
        path: join(evidence, `role-selection-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    await page
      .getByRole("button", { name: "Administrator", exact: true })
      .click();
    await expect(
      page.getByText(
        "Need personal access? Register for administrator approval.",
      ),
    ).toBeVisible();
    const help = page.getByText("Setting up the first administrator?", {
      exact: true,
    });
    await help.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText(
        /The installation operator sets up the first individual Administrator/,
      ),
    ).toBeVisible();
    await expect(
      page.getByText(/Administrator is the highest application role/),
    ).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /claim|bootstrap|create administrator/i,
      }),
    ).toHaveCount(0);
    expect(calls.filter((call) => call.mutation)).toEqual([]);
    expect(calls.some((call) => /bootstrap|users\./.test(call.procedure))).toBe(
      false,
    );
  });

test("mobile registration conveys the requested role without granting access", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await accessFixture(page);
  await page.goto("/#/register");
  await page.getByRole("button", { name: "Engineer", exact: true }).click();
  await expect(
    page.getByText("Requested role:", { exact: false }),
  ).toContainText("Engineer");
  await expect(
    page.getByText(
      "Need personal access? Register for administrator approval.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await page.getByLabel("Full Name").fill("Synthetic Applicant");
  await page
    .getByLabel("Email", { exact: true })
    .fill(" Applicant@Example.Test ");
  await page.getByLabel("Factory or organization").fill("Example Factory");
  await page.getByLabel("Job title (optional)").fill("Maintenance lead");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-personal-2026!");
  await page.getByRole("button", { name: "Request approval" }).click();
  await expect(
    page.getByRole("heading", { name: "Request received" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Your administrator can approve access without knowing your password/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/This confirmation does not mean your account is active/),
  ).toContainText("original account request");
  await page
    .getByText("Setting up the first administrator?", { exact: true })
    .click();
  await expect(
    page.getByText(/Registration alone does not grant administrator access/),
  ).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  const mutations = calls.filter((call) => call.mutation);
  expect(mutations).toEqual([
    {
      procedure: "auth.requestRegistration",
      mutation: true,
      input: {
        email: "applicant@example.test",
        name: "Synthetic Applicant",
        organization: "Example Factory",
        jobTitle: "Requested role: Engineer · Job title: Maintenance lead",
        password: "Synthetic-personal-2026!",
      },
    },
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("registration-disabled state still explains the private first-admin path", async ({
  page,
}) => {
  const calls = await accessFixture(page, { registrationEnabled: false });
  await page.goto("/#/register");
  await page
    .getByRole("button", { name: "Administrator", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Account access" }),
  ).toBeVisible();
  await page
    .getByText("Setting up the first administrator?", { exact: true })
    .click();
  await expect(page.getByText(/trusted deployment setup/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request approval" }),
  ).toHaveCount(0);
  expect(calls.filter((call) => call.mutation)).toEqual([]);
});

test("administrator reviews the role implication without collecting the applicant password", async ({
  page,
}) => {
  const calls = await accessFixture(page, { admin: true });
  await page.goto("/#/administration/users");
  await page.getByText("How account approval works", { exact: true }).click();
  await expect(
    page.getByText(/You do not need their password to approve a request/),
  ).toBeVisible();
  await expect(
    page.getByText(/this page does not confirm email delivery/),
  ).toBeVisible();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Account approval: Synthetic Applicant" })
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Approve account request" });
  await expect(dialog.getByLabel("Approved account role")).toHaveText("Viewer");
  const verified = dialog.getByRole("checkbox", {
    name: /I verified this person's identity/,
  });
  await verified.check();
  await dialog.getByLabel("Approved account role").click();
  await page.getByRole("option", { name: "Admin", exact: true }).click();
  await expect(dialog.getByText(/Highest application role/)).toBeVisible();
  await expect(
    dialog.getByText(/Administrator access includes approving other accounts/),
  ).toBeVisible();
  await expect(verified).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Approve admin access" }),
  ).toBeDisabled();
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await verified.check();
  await dialog.getByRole("button", { name: "Approve admin access" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/No requests awaiting review/)).toBeVisible();
  expect(calls.filter((call) => call.mutation)).toEqual([
    {
      procedure: "users.approveRegistration",
      mutation: true,
      input: { id: "00000000-0000-4000-8000-000000000071", role: "admin" },
    },
  ]);
});

test("a shared demo administrator does not receive the personal approval workflow", async ({
  page,
}) => {
  const calls = await accessFixture(page, { admin: true, demo: true });
  await page.goto("/#/administration/users");
  await expect(
    page.getByText(
      "Read-only examples of access, integration and audit workflows.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("How account approval works", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
  expect(calls.some((call) => call.procedure.startsWith("users."))).toBe(false);
});

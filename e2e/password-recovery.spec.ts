import { expect, test, type Page } from "@playwright/test";
import superjson from "superjson";
import {
  requiredCapabilities,
  runtimeContractVersion,
} from "../shared/runtime-contract";

// These synthetic UI checks complement the real database token lifecycle and
// worker delivery tests; no real recovery email or account is used.
const token = "a".repeat(43);
async function recoveryFixture(
  page: Page,
  rejectReset = false,
  signedIn = false,
  options: {
    rejectRequest?: boolean;
    rejectRegistration?: boolean;
    pendingLogin?: boolean;
  } = {},
) {
  const mutations: { procedure: string; input: any }[] = [];
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
    const request = route.request();
    const url = new URL(request.url());
    const batch = url.searchParams.get("batch") === "1";
    const names = decodeURIComponent(url.pathname.split("/trpc/")[1]).split(
      ",",
    );
    const inputs = JSON.parse(
      url.searchParams.get("input") ?? request.postData() ?? "{}",
    );
    const responses = names.map((procedure, index) => {
      const input = (batch ? inputs[String(index)]?.json : inputs.json) ?? {};
      if (request.method() === "POST") mutations.push({ procedure, input });
      if (
        (procedure === "auth.requestPasswordReset" && options.rejectRequest) ||
        (procedure === "auth.requestRegistration" &&
          options.rejectRegistration) ||
        (procedure === "auth.login" && options.pendingLogin)
      ) {
        const pending = procedure === "auth.login";
        return {
          error: superjson.serialize({
            message: pending
              ? "Your account request is awaiting administrator approval. You can sign in after it is approved."
              : "Account requests are temporarily unavailable. Try again.",
            code: pending ? -32003 : -32603,
            data: {
              code: pending ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
              httpStatus: pending ? 403 : 500,
            },
          }),
        };
      }
      if (procedure === "auth.resetPassword" && rejectReset)
        return {
          error: superjson.serialize({
            message:
              "This reset link is invalid or expired. Request a new link.",
            code: -32600,
            data: { code: "BAD_REQUEST", httpStatus: 400 },
          }),
        };
      if (procedure === "auth.resetPassword") signedIn = false;
      const values: Record<string, unknown> = {
        "auth.me": signedIn
          ? {
              id: 88,
              openId: "fixture-admin",
              email: "admin@example.test",
              name: "Fixture administrator",
              role: "admin",
              passwordChangeRequired: true,
            }
          : null,
        "auth.demoAccounts": [],
        "auth.registrationPolicy": { enabled: true, requiresApproval: true },
        "auth.passwordResetPolicy": { delivery: "email" },
        "auth.requestPasswordReset": { submitted: true },
        "auth.requestRegistration": { submitted: true },
        "auth.resetPassword": { reset: true },
      };
      return {
        result: { data: superjson.serialize(values[procedure] ?? null) },
      };
    });
    await route.fulfill({ json: batch ? responses : responses[0] });
  });
  return mutations;
}

test("forgot password is reachable from sign-in and confirms requests generically", async ({
  page,
}) => {
  const mutations = await recoveryFixture(page);
  await page.goto("/admin#/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.getByLabel("Account email").fill(" Person@Example.Test ");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If this address belongs to an active individual account",
  );
  await expect(page.getByRole("status")).toContainText(
    "does not confirm email delivery",
  );
  await expect(
    page.getByText("Recently requested an account?", { exact: false }),
  ).toContainText("does not activate a pending registration");
  expect(mutations).toEqual([
    {
      procedure: "auth.requestPasswordReset",
      input: { email: "person@example.test" },
    },
  ]);
  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Account email")).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("failed recovery requests stay on the form with persistent feedback", async ({
  page,
}) => {
  await recoveryFixture(page, false, false, { rejectRequest: true });
  await page.goto("/#/forgot-password");
  await page.getByLabel("Account email").fill("person@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Account requests are temporarily unavailable. Try again.",
  );
  await expect(page.getByLabel("Account email")).toHaveValue(
    "person@example.test",
  );
  await expect(
    page.getByRole("button", { name: "Send reset link" }),
  ).toBeEnabled();
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("sign-in keeps approval guidance visible and normalizes the email", async ({
  page,
}) => {
  const mutations = await recoveryFixture(page, false, false, {
    pendingLogin: true,
  });
  await page.goto("/admin#/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill(" Applicant@Example.Test ");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-request-2026!");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByRole("alert")).toContainText(
    "awaiting administrator approval",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Password reset does not approve a pending registration",
  );
  await expect(page.getByRole("button", { name: /^sign in$/i })).toBeEnabled();
  expect(mutations).toEqual([
    {
      procedure: "auth.login",
      input: {
        email: "applicant@example.test",
        password: "Synthetic-request-2026!",
      },
    },
  ]);
});

test("registration validates password bytes before submission and explains approval", async ({
  page,
}) => {
  const mutations = await recoveryFixture(page);
  await page.goto("/#/register");
  await page.getByLabel("Full Name").fill(" Synthetic Applicant ");
  await page
    .getByLabel("Email", { exact: true })
    .fill(" Applicant@Example.Test ");
  await page.getByLabel("Factory or organization").fill(" Example Factory ");
  await page.getByLabel("Job title (optional)").fill(" Operator ");
  await page.getByLabel("Password", { exact: true }).fill("🔐".repeat(19));
  await page.getByRole("button", { name: "Request approval" }).click();
  await expect(page.getByRole("alert")).toContainText("password is too long");
  expect(mutations).toHaveLength(0);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-request-2026!");
  await page.getByRole("button", { name: "Request approval" }).click();
  await expect(
    page.getByRole("heading", { name: "Request received" }),
  ).toBeVisible();
  await expect(
    page.getByText("This confirmation does not mean", { exact: false }),
  ).toContainText("After approval");
  await expect(
    page.getByRole("link", { name: "Forgot password", exact: true }),
  ).toBeVisible();
  expect(mutations).toEqual([
    {
      procedure: "auth.requestRegistration",
      input: {
        email: "applicant@example.test",
        password: "Synthetic-request-2026!",
        name: "Synthetic Applicant",
        organization: "Example Factory",
        jobTitle: "Operator",
      },
    },
  ]);
});

test("a rejected registration submission preserves the entered details for retry", async ({
  page,
}) => {
  await recoveryFixture(page, false, false, { rejectRegistration: true });
  await page.goto("/#/register");
  await page.getByLabel("Full Name").fill("Synthetic Applicant");
  await page.getByLabel("Email", { exact: true }).fill("person@example.test");
  await page.getByLabel("Factory or organization").fill("Example Factory");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-request-2026!");
  await page.getByRole("button", { name: "Request approval" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Account requests are temporarily unavailable. Try again.",
  );
  await expect(page.getByLabel("Full Name")).toHaveValue("Synthetic Applicant");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "person@example.test",
  );
  await expect(
    page.getByRole("button", { name: "Request approval" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Request received" }),
  ).toHaveCount(0);
});

test("a reset link validates matching passwords, clears the URL and returns to sign-in", async ({
  page,
}) => {
  const mutations = await recoveryFixture(page);
  await page.goto(`/#/reset-password?token=${token}`);
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/reset-password$/);
  await page
    .getByLabel("New password", { exact: true })
    .fill("Synthetic-recovered-2026!");
  await page
    .getByLabel("Confirm new password")
    .fill("Synthetic-different-2026!");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "The passwords do not match.",
  );
  expect(mutations).toHaveLength(0);
  await page
    .getByLabel("Confirm new password")
    .fill("Synthetic-recovered-2026!");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Password reset", exact: true }),
  ).toBeVisible();
  expect(mutations).toEqual([
    {
      procedure: "auth.resetPassword",
      input: { token, newPassword: "Synthetic-recovered-2026!" },
    },
  ]);
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
});

test("expired links can request a replacement even from a temporary-password session", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await recoveryFixture(page, true, true);
  await page.goto(`/#/reset-password?token=${token}`);
  await page
    .getByLabel("New password", { exact: true })
    .fill("Synthetic-recovered-2026!");
  await page
    .getByLabel("Confirm new password")
    .fill("Synthetic-recovered-2026!");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Request a new reset link" }).click();
  await expect(
    page.getByRole("heading", { name: "Forgot password?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Account email")).toBeVisible();
});

test("a missing reset token cannot submit a password change", async ({
  page,
}) => {
  const mutations = await recoveryFixture(page);
  await page.goto("/#/reset-password");
  await expect(page.getByRole("alert")).toContainText("missing or invalid");
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  expect(mutations).toHaveLength(0);
});

test("a replacement link in the same tab clears the old form and uses the new token", async ({
  page,
}) => {
  const mutations = await recoveryFixture(page);
  await page.goto(`/#/reset-password?token=${token}`);
  await page
    .getByLabel("New password", { exact: true })
    .fill("Synthetic-old-draft-2026!");
  const replacement = "b".repeat(43);
  await page.evaluate((value) => {
    window.location.hash = `/reset-password?token=${value}`;
  }, replacement);
  await expect(page).toHaveURL(/#\/reset-password$/);
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByLabel("New password", { exact: true })
    .fill("Synthetic-new-draft-2026!");
  await page
    .getByLabel("Confirm new password")
    .fill("Synthetic-new-draft-2026!");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Password reset", exact: true }),
  ).toBeVisible();
  expect(mutations[0].input.token).toBe(replacement);
});

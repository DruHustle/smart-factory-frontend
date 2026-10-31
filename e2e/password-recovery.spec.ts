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
  await page.goto("/#/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.getByLabel("Account email").fill("person@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If this address belongs to an active individual account",
  );
  expect(mutations).toEqual([
    {
      procedure: "auth.requestPasswordReset",
      input: { email: "person@example.test" },
    },
  ]);
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

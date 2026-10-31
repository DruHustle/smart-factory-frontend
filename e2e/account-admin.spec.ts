import { expect, test } from "@playwright/test";

test("an individual administrator reviews signup roles, rejects requests and handles password recovery", async ({
  browser,
}) => {
  const email = "requested-operator@example.test";
  const password = "Synthetic-request-2026!";
  const temporary = "Synthetic-temporary-2026!";
  const applicant = await browser.newPage();
  await applicant.goto("/#/register");
  await applicant.getByLabel("Full Name").fill("Requested Operator");
  await applicant.getByLabel("Email", { exact: true }).fill(email);
  await applicant.getByLabel("Factory or organization").fill("Example Factory");
  await applicant.getByLabel("Password", { exact: true }).fill(password);
  await applicant.getByRole("button", { name: "Request approval" }).click();
  await expect(
    applicant.getByRole("heading", { name: "Request received" }),
  ).toBeVisible();
  await applicant.goto("/#/login");
  await applicant.getByLabel("Email", { exact: true }).fill(email);
  await applicant.getByLabel("Password", { exact: true }).fill(password);
  await applicant.getByRole("button", { name: /^sign in$/i }).click();
  await expect(applicant.getByRole("alert")).toContainText(
    "awaiting administrator approval",
  );

  const rejected = await browser.newPage();
  const rejectedEmail = "rejected-applicant@example.test";
  const rejectionRequest = await rejected.request.post(
    "/api/trpc/auth.requestRegistration",
    {
      data: {
        json: {
          name: "Rejected Applicant",
          email: rejectedEmail,
          organization: "Example Factory",
          password,
          role: "admin",
        },
      },
    },
  );
  expect(rejectionRequest.ok()).toBe(true);

  const admin = await browser.newPage();
  await admin.goto("/#/login");
  await admin
    .getByLabel("Email", { exact: true })
    .fill("security-admin@example.test");
  await admin
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-security-only-2026!");
  await admin.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    admin.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await admin.goto("/#/administration/users");
  await expect(
    admin.getByText("Account approval: Requested Operator"),
  ).toBeVisible();
  await admin
    .getByRole("listitem")
    .filter({ hasText: "Account approval: Requested Operator" })
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(
    admin.getByRole("heading", { name: "Approve account request" }),
  ).toBeVisible();
  await expect(admin.getByLabel("Approved account role")).toHaveText("Viewer");
  await expect(
    admin.getByRole("button", { name: "Approve viewer access" }),
  ).toBeDisabled();
  await admin
    .getByRole("checkbox", { name: /I verified this person's identity/ })
    .check();
  await admin.getByLabel("Approved account role").click();
  await admin.getByRole("option", { name: "Operator", exact: true }).click();
  await expect(
    admin.getByText("Read factory observations and acknowledge incidents."),
  ).toBeVisible();
  await expect(
    admin.getByRole("checkbox", { name: /I verified this person's identity/ }),
  ).not.toBeChecked();
  await expect(
    admin.getByRole("button", { name: "Approve operator access" }),
  ).toBeDisabled();
  await admin
    .getByRole("checkbox", { name: /I verified this person's identity/ })
    .check();
  await admin.getByRole("button", { name: "Approve operator access" }).click();
  await expect(
    admin.getByText("Account approval: Requested Operator"),
  ).toHaveCount(0);
  await expect(
    admin.getByRole("combobox", { name: `Role for ${email}` }),
  ).toHaveText("Operator");

  const rejectedRow = admin
    .getByRole("listitem")
    .filter({ hasText: "Account approval: Rejected Applicant" });
  await rejectedRow
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(admin.getByLabel("Approved account role")).toHaveText("Viewer");
  await expect(
    admin.getByRole("checkbox", { name: /I verified this person's identity/ }),
  ).not.toBeChecked();
  await admin
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await rejectedRow
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  await expect(admin.getByRole("dialog")).toContainText(rejectedEmail);
  await admin.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(rejectedRow).toBeVisible();
  await rejectedRow
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  await admin
    .getByRole("button", { name: "Reject request", exact: true })
    .click();
  await expect(rejectedRow).toHaveCount(0);
  const rejectedLogin = await rejected.request.post("/api/trpc/auth.login", {
    data: { json: { email: rejectedEmail, password } },
  });
  expect(rejectedLogin.status()).toBe(401);

  await applicant.reload();
  await applicant.getByLabel("Email", { exact: true }).fill(email);
  await applicant.getByLabel("Password", { exact: true }).fill(password);
  await applicant.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    applicant.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const session = await applicant.request.get("/api/trpc/auth.me");
  expect(session.ok()).toBe(true);
  expect((await session.json()).result.data.json).toMatchObject({
    email,
    role: "operator",
    access: { canOperate: true, canEngineer: false, canAdminister: false },
  });

  const help = await browser.newPage();
  await help.goto("/#/login");
  await help.getByRole("link", { name: "Forgot password?" }).click();
  await help.getByLabel("Account email").fill(email);
  await help.getByRole("button", { name: "Request password help" }).click();
  await expect(help.getByRole("status")).toContainText(
    "administrator can review your request",
  );
  await admin.reload();
  await expect(admin.getByText(`Password help: ${email}`)).toBeVisible();
  await admin.getByRole("button", { name: "Verify & reset" }).click();
  await admin
    .getByRole("checkbox", { name: /I verified this person's identity/ })
    .check();
  await admin.getByLabel("Temporary password").fill(temporary);
  await admin.getByRole("button", { name: "Confirm reset" }).click();
  await expect(admin.getByText(`Password help: ${email}`)).toHaveCount(0);

  const recovered = await browser.newPage();
  await recovered.goto("/#/login");
  await recovered.getByLabel("Email", { exact: true }).fill(email);
  await recovered.getByLabel("Password", { exact: true }).fill(temporary);
  await recovered.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    recovered.getByRole("heading", { name: "Change your password" }),
  ).toBeVisible();
  const chosen = "Synthetic-personally-chosen-2026!";
  await recovered.getByLabel("New password", { exact: true }).fill(chosen);
  await recovered.getByLabel("Confirm new password").fill(chosen);
  await recovered.getByRole("button", { name: "Save password" }).click();
  await expect(
    recovered.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const recoveredSession = await recovered.request.get("/api/trpc/auth.me");
  expect((await recoveredSession.json()).result.data.json).toMatchObject({
    email,
    role: "operator",
    passwordChangeRequired: false,
  });
  // A recovery is complete only after the user's own replacement password can
  // establish a fresh session and the temporary credential no longer works.
  await recovered.getByRole("button", { name: "Open account menu" }).click();
  await recovered.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(
    recovered.getByRole("button", { name: /^sign in$/i }),
  ).toBeVisible();
  const consumedTemporary = await recovered.request.post(
    "/api/trpc/auth.login",
    {
      data: { json: { email, password: temporary } },
    },
  );
  expect(consumedTemporary.status()).toBe(401);
  await recovered.getByLabel("Email", { exact: true }).fill(email);
  await recovered.getByLabel("Password", { exact: true }).fill(chosen);
  await recovered.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    recovered.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await applicant.close();
  await rejected.close();
  await admin.close();
  await help.close();
  await recovered.close();
});

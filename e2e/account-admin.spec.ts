import { expect, test } from "@playwright/test";

test("an individual administrator approves a request and handles password recovery", async ({
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
  await expect(applicant.getByText("Invalid email or password")).toBeVisible();

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
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    admin.getByRole("heading", { name: "Approve account request" }),
  ).toBeVisible();
  await admin
    .getByRole("checkbox", { name: /I verified this person's identity/ })
    .check();
  await admin.getByRole("button", { name: "Approve viewer access" }).click();
  await expect(
    admin.getByText("Account approval: Requested Operator"),
  ).toHaveCount(0);

  await applicant.reload();
  await applicant.getByLabel("Email", { exact: true }).fill(email);
  await applicant.getByLabel("Password", { exact: true }).fill(password);
  await applicant.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    applicant.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();

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
  await applicant.close();
  await admin.close();
  await help.close();
  await recovered.close();
});

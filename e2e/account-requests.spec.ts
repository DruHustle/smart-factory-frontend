import { expect, test } from "@playwright/test";

test("registration requests approval and password help is reachable from login", async ({
  page,
}) => {
  await page.goto("/#/login");
  await page.getByRole("link", { name: "Register" }).click();
  await expect(
    page.getByRole("heading", { name: "Request an account" }),
  ).toBeVisible();
  await page.getByLabel("Full Name").fill("Synthetic Applicant");
  await page
    .getByLabel("Email", { exact: true })
    .fill("synthetic-applicant@example.test");
  await page.getByLabel("Factory or organization").fill("Example Factory");
  await page.getByLabel("Job title (optional)").fill("Operator");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-request-2026!");
  await page.getByRole("button", { name: "Request approval" }).click();
  await expect(
    page.getByRole("heading", { name: "Request received" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Back to login" }).click();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Forgot password?" }),
  ).toBeVisible();
  await page.getByLabel("Account email").fill("unknown@example.test");
  await page.getByRole("button", { name: "Request password help" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If this address belongs to an active individual account",
  );
});

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const password = "Synthetic-security-only-2026!";
async function login(page: Page, role: string) {
  await page.request.post("/api/trpc/auth.logout", { data: { json: null } });
  await page.goto(`/?fixture-login=${Date.now()}#/login`);
  await page.getByLabel("Email").fill(`security-${role}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible({ timeout: 15000 });
}

test("an operator assigns an alert and the technician receives and can manage its notification", async ({
  page,
}) => {
  test.skip(
    process.env.WORKSPACE_E2E !== "true",
    "Requires the isolated workspace database",
  );
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.endsWith("_e2e")
  )
    throw new Error("Disposable local database required");
  const sql = postgres(url.toString(), { max: 1 });
  const title = `Assignment verification ${Date.now()}`;
  let id: number | undefined;
  try {
    const [device] =
      await sql`select id from devices where "deviceId"='workspace-gateway'`;
    const [alert] =
      await sql`insert into alerts("deviceId",type,severity,message,"errorCode") values(${device.id},'system_error','warning',${title},'SF-ASSIGN-TEST') returning id`;
    id = Number(alert.id);
    await login(page, "operator");
    await page.goto(`/#/alerts/${id}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page
      .getByLabel("Assign technician or engineer")
      .selectOption({ label: "Local security engineer" });
    await expect(
      page.getByText("Assignment updated", { exact: true }),
    ).toBeVisible();
    await login(page, "engineer");
    await page.goto("/#/notifications");
    await page.getByLabel("Search notifications").fill(title);
    const assigned = page
      .getByRole("listitem")
      .filter({
        has: page.getByRole("heading", {
          name: "Technician assignment changed",
        }),
      })
      .first();
    await expect(assigned).toContainText(title);
    await assigned
      .getByRole("button", { name: "Assign technician or engineer" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Assign technician or engineer",
    });
    await expect(dialog.getByLabel("Technician or engineer")).toHaveValue(
      /\d+/,
    );
    await dialog.getByLabel("Technician or engineer").selectOption("");
    await dialog.getByRole("button", { name: "Save assignment" }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(
        async () =>
          (await sql`select "assignedToId" from alerts where id=${id!}`)[0]
            .assignedToId,
      )
      .toBeNull();
    await login(page, "viewer");
    const denied = await page.request.post("/api/trpc/alerts.assign", {
      data: { json: { id, assignedToId: null } },
    });
    expect(denied.status()).toBe(403);
  } finally {
    if (id) await sql`delete from alerts where id=${id}`;
    await sql.end();
  }
});

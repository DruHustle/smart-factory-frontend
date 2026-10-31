import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { sharedDemoIdentity } from "../shared/access-policy";
import { isDemoAccount } from "../shared/demo-accounts";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { audit } from "./security/store";
import { individualSecurityUser } from "./security/users";

/** Private deployment task only. Never expose this through an application router. */
export async function bootstrapAdministrator(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<number> {
  const email = input.email.trim().toLowerCase();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 320 ||
    input.password.length < 12 ||
    Buffer.byteLength(input.password, "utf8") > 72
  )
    throw new Error(
      "Set BOOTSTRAP_ADMIN_EMAIL and a password of at least 12 characters and at most 72 UTF-8 bytes in the private task environment.",
    );
  if (isDemoAccount(email))
    throw new Error(
      "A shared demonstration identity cannot become an individual administrator.",
    );
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const passwordHash = await sdk.hashPassword(input.password);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(20261006)`);
    // Serialize with administrative demotion/disable operations as well.
    await tx.execute(sql`select pg_advisory_xact_lock(2026102801)`);
    const [administrator] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), individualSecurityUser()))
      .limit(1);
    if (administrator)
      throw new Error(
        "An individual administrator already exists. Use User access or the explicit administrator recovery procedure.",
      );
    const [existing] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .for("update")
      .limit(1);
    let id: number;
    if (existing) {
      if (existing.disabledAt || sharedDemoIdentity(existing))
        throw new Error(
          "Bootstrap cannot reactivate a disabled account or promote a shared demonstration identity.",
        );
      if (!existing.password)
        throw new Error(
          "The existing account must recover its local password before administrator bootstrap.",
        );
      // Keep the existing credential and activation requirements. Revoke old
      // sessions so privilege changes require a fresh, explicit sign-in.
      await tx
        .update(users)
        .set({
          role: "admin",
          authVersion: sql`${users.authVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id));
      id = existing.id;
    } else {
      const [created] = await tx
        .insert(users)
        .values({
          email,
          name: input.name?.trim() || "Factory administrator",
          password: passwordHash,
          openId: randomUUID(),
          role: "admin",
        })
        .returning({ id: users.id });
      id = created.id;
    }
    await audit(tx, "account_administrator_bootstrapped", null, {
      userId: id,
      created: !existing,
      source: "private_deployment_task",
    });
    return id;
  });
}

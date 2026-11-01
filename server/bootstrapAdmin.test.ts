import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users, type InsertUser } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import { bootstrapAdministrator } from "./bootstrapAdmin";
import { getDb } from "./db";
import { disposableDatabase } from "./test/disposableDatabase";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "private administrator bootstrap",
  () => {
    disposableDatabase("bootstrap_admin");
    const password = "Private-bootstrap-test-2026!";
    let passwordHash: string;
    beforeAll(async () => {
      passwordHash = await sdk.hashPassword(password);
    });
    beforeEach(async () => {
      await (await getDb())!.execute(sql`truncate table users cascade`);
    });
    async function account(overrides: Partial<InsertUser> = {}) {
      const [user] = await (await getDb())!
        .insert(users)
        .values({
          email: `${randomUUID()}@example.test`,
          openId: randomUUID(),
          password: passwordHash,
          role: "viewer",
          ...overrides,
        })
        .returning();
      return user;
    }

    it("creates the first individual admin even when a read-only demo admin exists", async () => {
      const demo = await account({
        email: "admin@dev.local",
        openId: "demo-admin",
        role: "admin",
      });
      const id = await bootstrapAdministrator({
        email: "  Owner@Example.Test  ",
        password,
      });
      const [created] = await (await getDb())!
        .select()
        .from(users)
        .where(eq(users.id, id));
      expect(created).toMatchObject({
        email: "owner@example.test",
        role: "admin",
        disabledAt: null,
      });
      expect(await sdk.comparePassword(password, created.password!)).toBe(true);
      expect(
        (
          await (await getDb())!
            .select()
            .from(users)
            .where(eq(users.id, demo.id))
        )[0],
      ).toEqual(demo);
      expect(
        await (await getDb())!.execute(
          sql`select actor_id,detail from security_audit where action='account_administrator_bootstrapped'`,
        ),
      ).toEqual([
        {
          actor_id: null,
          detail: {
            userId: id,
            created: true,
            source: "private_deployment_task",
          },
        },
      ]);
      await expect(
        bootstrapAdministrator({ email: "second@example.test", password }),
      ).rejects.toThrow("administrator already exists");
    });

    it("promotes a case-insensitive existing identity while preserving its password and activation requirements", async () => {
      const existing = await account({
        email: "Existing@Example.Test",
        authVersion: 3,
        passwordChangeRequired: true,
        temporaryCredentialExpiresAt: new Date(Date.now() + 20 * 60_000),
      });
      expect(
        await bootstrapAdministrator({
          email: "  EXISTING@example.test ",
          password: "Unused-private-bootstrap-2026!",
        }),
      ).toBe(existing.id);
      const rows = await (await getDb())!.select().from(users);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: existing.id,
        email: existing.email,
        password: passwordHash,
        passwordChangeRequired: true,
        temporaryCredentialExpiresAt: existing.temporaryCredentialExpiresAt,
        role: "admin",
        authVersion: 4,
      });
    });

    it("refuses to reactivate a disabled target or promote a disguised demo identity", async () => {
      const disabled = await account({ disabledAt: new Date() });
      const disguised = await account({ openId: "demo-renamed" });
      for (const target of [disabled, disguised]) {
        await expect(
          bootstrapAdministrator({ email: target.email!, password }),
        ).rejects.toThrow("Bootstrap cannot reactivate");
        expect(
          (
            await (await getDb())!
              .select()
              .from(users)
              .where(eq(users.id, target.id))
          )[0],
        ).toEqual(target);
      }
      await expect(
        bootstrapAdministrator({ email: "  ADMIN@DEV.LOCAL ", password }),
      ).rejects.toThrow("shared demonstration identity");
    });

    it("does not bypass explicit account recovery when an individual administrator is disabled", async () => {
      const disabled = await account({ role: "admin", disabledAt: new Date() });
      await expect(
        bootstrapAdministrator({
          email: "replacement@example.test",
          password,
        }),
      ).rejects.toThrow("administrator already exists");
      expect(await (await getDb())!.select().from(users)).toHaveLength(1);
      expect(
        (
          await (await getDb())!
            .select()
            .from(users)
            .where(eq(users.id, disabled.id))
        )[0],
      ).toEqual(disabled);
    });

    it("refuses to replace an existing account's missing local credential", async () => {
      const existing = await account({ password: null });
      await expect(
        bootstrapAdministrator({ email: existing.email!, password }),
      ).rejects.toThrow("must recover its local password");
      expect((await (await getDb())!.select().from(users))[0]).toEqual(
        existing,
      );
    });

    it("rolls back the privilege grant when its audit record cannot be stored", async () => {
      const database = (await getDb())!;
      const [usage] = await database.execute(
        sql`select bytes from security_usage where singleton=true`,
      );
      await database.execute(
        sql`update security_usage set bytes=268435456 where singleton=true`,
      );
      try {
        await expect(
          bootstrapAdministrator({ email: "owner@example.test", password }),
        ).rejects.toThrow("security_storage_capacity");
        expect(await database.select().from(users)).toHaveLength(0);
      } finally {
        await database.execute(
          sql`update security_usage set bytes=${usage.bytes} where singleton=true`,
        );
      }
    });

    it("serializes concurrent bootstrap attempts so only one individual administrator is created", async () => {
      const results = await Promise.allSettled([
        bootstrapAdministrator({ email: "first@example.test", password }),
        bootstrapAdministrator({ email: "second@example.test", password }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      expect(await (await getDb())!.select().from(users)).toHaveLength(1);
    });
  },
);

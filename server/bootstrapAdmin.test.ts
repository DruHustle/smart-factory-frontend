import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accountRequests, users, type InsertUser } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import {
  pendingRegistrationCredential,
  requestRegistration,
} from "./accountRequests";
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
          password,
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

    it("requires the existing identity's current password before promotion", async () => {
      const existing = await account({ email: "existing@example.test" });
      await expect(
        bootstrapAdministrator({
          email: existing.email!,
          password: "Someone-elses-private-2026!",
        }),
      ).rejects.toThrow("current password is required");
      expect((await (await getDb())!.select().from(users))[0]).toEqual(
        existing,
      );
    });

    it("supersedes only the matching pending registration without adopting its credential or profile", async () => {
      const database = (await getDb())!;
      const untrustedPassword = "Untrusted-applicant-2026!";
      const untrustedHash = await sdk.hashPassword(untrustedPassword);
      await requestRegistration({
        email: "owner@example.test",
        name: "Unverified applicant name",
        organization: "Unverified applicant organization",
        passwordHash: untrustedHash,
      });
      const [request] = await database.select().from(accountRequests);
      const untouched = await database
        .insert(accountRequests)
        .values([
          {
            kind: "registration",
            email: "other@example.test",
            name: "Other applicant",
            organization: "Other factory",
            passwordHash: untrustedHash,
          },
          { kind: "password_reset", email: "owner@example.test" },
          {
            kind: "registration",
            email: "owner@example.test",
            status: "dismissed",
            reviewedAt: new Date(),
          },
        ])
        .returning();
      expect(await database.select().from(users)).toHaveLength(0);

      const id = await bootstrapAdministrator({
        email: "  OWNER@Example.Test ",
        password,
        name: "Trusted factory owner",
      });
      const [created] = await database.select().from(users);
      expect(created).toMatchObject({
        id,
        email: "owner@example.test",
        name: "Trusted factory owner",
        role: "admin",
      });
      expect(await sdk.comparePassword(password, created.password!)).toBe(true);
      expect(
        await sdk.comparePassword(untrustedPassword, created.password!),
      ).toBe(false);
      const [closed] = await database
        .select()
        .from(accountRequests)
        .where(eq(accountRequests.id, request.id));
      expect(closed).toMatchObject({
        status: "dismissed",
        passwordHash: null,
        reviewedBy: null,
        reviewedAt: expect.any(Date),
      });
      const remaining = await database.select().from(accountRequests);
      for (const row of untouched) {
        expect(remaining.find((item) => item.id === row.id)).toEqual(row);
      }
      expect(
        await database.execute(
          sql`select actor_id,detail from security_audit where action='account_registration_superseded' and detail->>'requestId'=${request.id}`,
        ),
      ).toEqual([
        {
          actor_id: null,
          detail: {
            requestId: request.id,
            userId: id,
            source: "private_deployment_task",
            reason: "administrator_bootstrap",
          },
        },
      ]);
      expect(await pendingRegistrationCredential("owner@example.test")).toBe(
        null,
      );
      await requestRegistration({
        email: "owner@example.test",
        name: "Another unverified name",
        organization: "Another organization",
        passwordHash: untrustedHash,
      });
      expect(await database.select().from(accountRequests)).toHaveLength(4);
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
      await requestRegistration({
        email: "owner@example.test",
        name: "Pending applicant",
        organization: "Example factory",
        passwordHash,
      });
      const before = await database.select().from(accountRequests);
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
        expect(await database.select().from(accountRequests)).toEqual(before);
      } finally {
        await database.execute(
          sql`update security_usage set bytes=${usage.bytes} where singleton=true`,
        );
      }
    });

    it("serializes a signup paused before insertion with bootstrap so no stale request can appear afterward", async () => {
      const database = (await getDb())!;
      // This fixture gate deterministically pauses the INSERT after the public
      // signup's user lookup. Without the shared identity lock, bootstrap can
      // commit first and leave a new pending request for the active owner.
      await database.execute(sql`
        create function pause_signup_for_bootstrap_test() returns trigger
        language plpgsql as $$ begin
          perform pg_advisory_xact_lock(2026110199);
          return new;
        end $$`);
      await database.execute(sql`
        create trigger pause_signup_for_bootstrap_test before insert on account_requests
        for each row execute function pause_signup_for_bootstrap_test()`);
      const control = postgres(process.env.DATABASE_URL!, { max: 2 });
      const gate = await control.reserve();
      let signup: Promise<void> | undefined;
      let bootstrap: Promise<number> | undefined;
      try {
        await gate`select pg_advisory_lock(2026110199)`;
        signup = requestRegistration({
          email: "racing-owner@example.test",
          name: "Unverified racing applicant",
          organization: "Unverified organization",
          passwordHash,
        });
        await expect
          .poll(async () => {
            const [row] = await control`
            select count(*)::integer as waiting from pg_locks
            where locktype='advisory' and classid=0 and objid=2026110199 and not granted`;
            return row.waiting;
          })
          .toBe(1);
        bootstrap = bootstrapAdministrator({
          email: "RACING-OWNER@example.test",
          password,
        });
        await expect
          .poll(async () => {
            const [row] = await control`
            select count(*)::integer as waiting from pg_locks
            where locktype='advisory' and classid=20261101
              and objid=(hashtext('racing-owner@example.test')::bigint & 4294967295)::oid
              and not granted`;
            return row.waiting;
          })
          .toBe(1);
        await gate`select pg_advisory_unlock(2026110199)`;
        await signup;
        await bootstrap;
        expect(await database.select().from(users)).toHaveLength(1);
        expect(
          await pendingRegistrationCredential("racing-owner@example.test"),
        ).toBe(null);
        expect(await database.select().from(accountRequests)).toMatchObject([
          { status: "dismissed", passwordHash: null },
        ]);
      } finally {
        await gate`select pg_advisory_unlock_all()`;
        await Promise.allSettled([signup, bootstrap]);
        gate.release();
        await control.end();
        await database.execute(
          sql`drop trigger pause_signup_for_bootstrap_test on account_requests`,
        );
        await database.execute(
          sql`drop function pause_signup_for_bootstrap_test()`,
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

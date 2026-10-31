import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { sdk } from "./_core/sdk";
import { appRouter } from "./routers";
import * as db from "./db";
import * as requests from "./accountRequests";
import * as security from "./security/runtime";
import { disposableDatabase } from "./test/disposableDatabase";
import { dataWorkspaceCookie } from "../shared/data-workspace";

const caller = (user: TrpcContext["user"] = null) =>
  appRouter.createCaller({
    user,
    req: {
      protocol: "http",
      headers: { cookie: `${dataWorkspaceCookie}=live` },
    },
    res: { cookie: () => {}, clearCookie: () => {} },
  } as unknown as TrpcContext);

describe("account approval role boundary", () => {
  const administrator = {
    id: 900,
    openId: "individual-reviewer",
    email: "reviewer@example.test",
    name: "Reviewer",
    role: "admin",
  } as NonNullable<TrpcContext["user"]>;
  beforeEach(() => {
    vi.spyOn(db, "enqueueWelcomeEmail").mockResolvedValue(undefined);
    vi.spyOn(security, "nativeEvent").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("does not accept a role chosen by the applicant", async () => {
    const save = vi
      .spyOn(requests, "requestRegistration")
      .mockResolvedValue(undefined);
    vi.spyOn(sdk, "hashPassword").mockResolvedValue("synthetic-password-hash");
    const submission = {
      email: "applicant@example.test",
      name: "Applicant",
      organization: "Example Works",
      password: "Synthetic-private-2026!",
      role: "admin",
    };
    await expect(
      caller().auth.requestRegistration(submission),
    ).resolves.toEqual({
      submitted: true,
    });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toMatchObject({
      email: submission.email,
      passwordHash: "synthetic-password-hash",
    });
    expect(save.mock.calls[0][0]).not.toHaveProperty("role");
  });

  it.each([undefined, "viewer", "operator", "engineer", "admin"] as const)(
    "passes the administrator's %s choice to the approval transaction, defaulting to viewer",
    async (role) => {
      const id = randomUUID();
      const chosenRole = role ?? "viewer";
      const user = {
        id: 901,
        email: "applicant@example.test",
        name: "Applicant",
        role: chosenRole,
      };
      const approve = vi
        .spyOn(requests, "approveRegistration")
        .mockResolvedValue(user);
      await expect(
        caller(administrator).users.approveRegistration({ id, role }),
      ).resolves.toEqual(user);
      expect(approve).toHaveBeenCalledExactlyOnceWith(
        id,
        administrator.id,
        chosenRole,
      );
      expect(db.enqueueWelcomeEmail).toHaveBeenCalledExactlyOnceWith(user);
      expect(security.nativeEvent).toHaveBeenCalledWith(
        "config.changed",
        expect.objectContaining({
          changedKeys: ["users.approval", "users.role"],
        }),
        `An administrator approved an account request with ${chosenRole} access.`,
      );
    },
  );

  it("rejects an unsupported approval role before the transaction", async () => {
    const approve = vi.spyOn(requests, "approveRegistration");
    await expect(
      caller(administrator).users.approveRegistration({
        id: randomUUID(),
        role: "owner" as "admin",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(approve).not.toHaveBeenCalled();
    expect(db.enqueueWelcomeEmail).not.toHaveBeenCalled();
  });

  it.each([null, "user", "viewer", "operator", "engineer"] as const)(
    "prevents %s from approving or assigning a role",
    async (role) => {
      const approve = vi.spyOn(requests, "approveRegistration");
      await expect(
        caller(
          role ? { ...administrator, role } : null,
        ).users.approveRegistration({
          id: randomUUID(),
          role: "admin",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(approve).not.toHaveBeenCalled();
      expect(db.enqueueWelcomeEmail).not.toHaveBeenCalled();
    },
  );
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "account approval and password help",
  () => {
    disposableDatabase("requests");

    it("requires administrator approval before a requested account can sign in", async () => {
      const administrator = await db.createUser({
        openId: randomUUID(),
        email: "reviewer@example.test",
        name: "Reviewer",
        role: "admin",
        password: "unused-test-hash",
      });
      const applicant = "applicant@example.test";
      const password = "Synthetic-private-2026!";
      const submission = {
        email: applicant,
        name: "Factory Applicant",
        organization: "Example Works",
        jobTitle: "Engineer",
        password,
        role: "admin",
      };
      await expect(
        caller().auth.requestRegistration(submission),
      ).resolves.toEqual({ submitted: true });
      expect(await db.getUserByEmail(applicant)).toBeUndefined();
      await expect(
        caller().auth.login({ email: applicant, password }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const pending = await caller(administrator).users.pendingRequests();
      expect(pending).toMatchObject([
        {
          kind: "registration",
          email: applicant,
          name: "Factory Applicant",
          organization: "Example Works",
          jobTitle: "Engineer",
        },
      ]);
      await expect(
        caller(administrator).users.approveRegistration({ id: pending[0].id }),
      ).resolves.toMatchObject({ role: "viewer" });
      await expect(
        caller().auth.login({ email: applicant, password }),
      ).resolves.toMatchObject({ user: { email: applicant, role: "viewer" } });
      expect(await caller(administrator).users.pendingRequests()).toEqual([]);
    });

    it("keeps password requests generic and requires a verified admin reset", async () => {
      const administrator = await db.getUserByEmail("reviewer@example.test");
      const applicant = await db.getUserByEmail("applicant@example.test");
      expect(administrator && applicant).toBeTruthy();
      expect(
        await caller().auth.requestPasswordReset({
          email: "unknown@example.test",
        }),
      ).toEqual({ submitted: true });
      expect(
        await caller().auth.requestPasswordReset({ email: applicant!.email! }),
      ).toEqual({ submitted: true });
      const pending = await caller(administrator).users.pendingRequests();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        kind: "password_reset",
        email: applicant!.email,
      });
      const temporaryPassword = "Synthetic-once-2026!";
      await caller(administrator).users.resetPassword({
        id: applicant!.id,
        expectedVersion: applicant!.authVersion,
        temporaryPassword,
      });
      expect(await caller(administrator).users.pendingRequests()).toEqual([]);
      await expect(
        caller().auth.login({
          email: applicant!.email!,
          password: "Synthetic-private-2026!",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        caller().auth.login({
          email: applicant!.email!,
          password: temporaryPassword,
        }),
      ).resolves.toHaveProperty("user.passwordChangeRequired", true);
    });

    async function pendingRegistration() {
      const administrator = await db.createUser({
        openId: randomUUID(),
        email: `reviewer-${randomUUID()}@example.test`,
        name: "Approval reviewer",
        role: "admin",
        password: "unused-test-hash",
      });
      const email = `applicant-${randomUUID()}@example.test`;
      const password = "Synthetic-private-2026!";
      await caller().auth.requestRegistration({
        email,
        name: "Role Applicant",
        organization: "Example Works",
        password,
      });
      const request = (
        await caller(administrator).users.pendingRequests()
      ).find((request) => request.email === email);
      expect(administrator && request).toBeTruthy();
      return {
        administrator: administrator!,
        request: request!,
        email,
        password,
      };
    }

    it.each(["viewer", "operator", "engineer", "admin"] as const)(
      "creates the reviewed %s role and records the approval atomically",
      async (role) => {
        const { administrator, request, email, password } =
          await pendingRegistration();
        const user = await caller(administrator).users.approveRegistration({
          id: request.id,
          role,
        });
        expect(user).toMatchObject({ email, role });
        expect(await db.getUserByEmail(email)).toMatchObject({
          id: user.id,
          role,
        });
        await expect(
          caller().auth.login({ email, password }),
        ).resolves.toMatchObject({ user: { role } });
        const database = (await db.getDb())!;
        const [review] = await database.execute(
          sql`select status,password_hash,reviewed_by from account_requests where id=${request.id}`,
        );
        expect(review).toMatchObject({
          status: "approved",
          password_hash: null,
          reviewed_by: administrator.id,
        });
        const audit = await database.execute(
          sql`select actor_id,detail from security_audit where action='account_registration_approved' and detail->>'requestId'=${request.id}`,
        );
        expect(audit).toEqual([
          {
            actor_id: administrator.id,
            detail: { requestId: request.id, userId: user.id, role },
          },
        ]);
      },
    );

    it("allows only one concurrent approval and preserves the winning role and reviewer", async () => {
      const { administrator, request, email } = await pendingRegistration();
      const other = await db.createUser({
        openId: randomUUID(),
        email: `reviewer-${randomUUID()}@example.test`,
        name: "Second reviewer",
        role: "admin",
        password: "unused-test-hash",
      });
      const results = await Promise.allSettled([
        caller(administrator).users.approveRegistration({
          id: request.id,
          role: "operator",
        }),
        caller(other).users.approveRegistration({
          id: request.id,
          role: "engineer",
        }),
      ]);
      const successes = results.filter(
        (result) => result.status === "fulfilled",
      );
      const failures = results.filter((result) => result.status === "rejected");
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toMatchObject({ code: "CONFLICT" });
      const user = successes[0].value;
      const reviewer = user.role === "operator" ? administrator.id : other!.id;
      expect(await db.getUserByEmail(email)).toMatchObject({
        id: user.id,
        role: user.role,
      });
      const database = (await db.getDb())!;
      const [review] = await database.execute(
        sql`select status,reviewed_by from account_requests where id=${request.id}`,
      );
      expect(review).toMatchObject({
        status: "approved",
        reviewed_by: reviewer,
      });
      const audit = await database.execute(
        sql`select actor_id,detail from security_audit where action='account_registration_approved' and detail->>'requestId'=${request.id}`,
      );
      expect(audit).toEqual([
        {
          actor_id: reviewer,
          detail: { requestId: request.id, userId: user.id, role: user.role },
        },
      ]);
      await expect(
        caller(administrator).users.dismissRequest({ id: request.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await db.getUserByEmail(email)).toMatchObject({ role: user.role });
    });

    it("cannot approve a rejected request or create an account from it", async () => {
      const { administrator, request, email } = await pendingRegistration();
      await caller(administrator).users.dismissRequest({ id: request.id });
      await expect(
        caller(administrator).users.approveRegistration({
          id: request.id,
          role: "admin",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await db.getUserByEmail(email)).toBeUndefined();
      const database = (await db.getDb())!;
      const [review] = await database.execute(
        sql`select status,password_hash,reviewed_by from account_requests where id=${request.id}`,
      );
      expect(review).toMatchObject({
        status: "dismissed",
        password_hash: null,
        reviewed_by: administrator.id,
      });
      expect(
        await database.execute(
          sql`select id from security_audit where action='account_registration_approved' and detail->>'requestId'=${request.id}`,
        ),
      ).toHaveLength(0);
    });

    it("keeps the request pending and creates no account if the approval audit cannot be saved", async () => {
      const { administrator, request, email } = await pendingRegistration();
      const database = (await db.getDb())!;
      const [usage] = await database.execute(
        sql`select bytes from security_usage where singleton=true`,
      );
      await database.execute(
        sql`update security_usage set bytes=268435456 where singleton=true`,
      );
      try {
        await expect(
          caller(administrator).users.approveRegistration({
            id: request.id,
            role: "admin",
          }),
        ).rejects.toThrow("security_storage_capacity");
        expect(await db.getUserByEmail(email)).toBeUndefined();
        const [review] = await database.execute(
          sql`select status,password_hash,reviewed_by from account_requests where id=${request.id}`,
        );
        expect(review).toMatchObject({
          status: "pending",
          password_hash: expect.any(String),
          reviewed_by: null,
        });
        expect(
          await database.execute(
            sql`select id from security_audit where action='account_registration_approved' and detail->>'requestId'=${request.id}`,
          ),
        ).toHaveLength(0);
      } finally {
        await database.execute(
          sql`update security_usage set bytes=${usage.bytes} where singleton=true`,
        );
      }
    });
  },
);

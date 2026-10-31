import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { sdk } from "./_core/sdk";
import { appRouter } from "./routers";
import * as db from "./db";
import * as requests from "./accountRequests";
import * as recovery from "./passwordRecovery";
import * as security from "./security/runtime";
import { disposableDatabase } from "./test/disposableDatabase";
import { dataWorkspaceCookie } from "../shared/data-workspace";
import { passwordResetTokens, users } from "../drizzle/schema";

const caller = (user: TrpcContext["user"] = null) =>
  appRouter.createCaller({
    user,
    req: {
      protocol: "http",
      headers: { cookie: `${dataWorkspaceCookie}=live` },
    },
    res: { cookie: () => {}, clearCookie: () => {} },
  } as unknown as TrpcContext);

describe("account identity normalization and pending approval guidance", () => {
  beforeEach(() => {
    vi.spyOn(security, "nativeEvent").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("normalizes pasted email addresses before registration and recovery validation", async () => {
    const registration = vi
      .spyOn(requests, "requestRegistration")
      .mockResolvedValue(undefined);
    const reset = vi
      .spyOn(recovery, "issuePasswordReset")
      .mockResolvedValue(undefined);
    vi.spyOn(sdk, "hashPassword").mockResolvedValue("synthetic-password-hash");
    const email = "  Applicant@Example.Test  ";
    await caller().auth.requestRegistration({
      email,
      name: "Applicant",
      organization: "Example Works",
      password: "Synthetic-private-2026!",
    });
    await caller().auth.requestPasswordReset({ email });
    expect(registration).toHaveBeenCalledWith(
      expect.objectContaining({ email: "applicant@example.test" }),
    );
    expect(reset).toHaveBeenCalledExactlyOnceWith("applicant@example.test");
  });

  it("reveals pending approval only after verifying the submitted credential and never grants a session", async () => {
    const lookup = vi.spyOn(db, "getUserByEmail").mockResolvedValue(undefined!);
    const pending = vi
      .spyOn(requests, "pendingRegistrationCredential")
      .mockResolvedValue("synthetic-pending-hash");
    const compare = vi.spyOn(sdk, "comparePassword").mockResolvedValue(true);
    const session = vi.spyOn(sdk, "createSessionToken");
    await expect(
      caller().auth.login({
        email: "  Applicant@Example.Test  ",
        password: "Synthetic-private-2026!",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "Your account request is awaiting administrator approval. You can sign in after it is approved.",
    });
    expect(lookup).toHaveBeenCalledExactlyOnceWith("applicant@example.test");
    expect(pending).toHaveBeenCalledExactlyOnceWith("applicant@example.test");
    expect(compare).toHaveBeenCalledExactlyOnceWith(
      "Synthetic-private-2026!",
      "synthetic-pending-hash",
    );
    expect(session).not.toHaveBeenCalled();
    compare.mockResolvedValue(false);
    await expect(
      caller().auth.login({
        email: "applicant@example.test",
        password: "wrong",
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
    });
    expect(session).not.toHaveBeenCalled();
  });
});

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

  it.each([
    null,
    "user",
    "viewer",
    "operator",
    "engineer",
    "shared-admin",
  ] as const)(
    "keeps recovery delivery metadata unavailable to %s",
    async (role) => {
      const read = vi.spyOn(requests, "pendingAccountRequests");
      const user =
        role === "shared-admin"
          ? { ...administrator, openId: "demo-admin", email: "admin@dev.local" }
          : role
            ? { ...administrator, role }
            : null;
      await expect(caller(user).users.pendingRequests()).rejects.toMatchObject({
        code: role ? "FORBIDDEN" : "UNAUTHORIZED",
      });
      expect(read).not.toHaveBeenCalled();
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
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message:
          "Your account request is awaiting administrator approval. You can sign in after it is approved.",
      });
      await expect(
        caller().auth.login({ email: applicant, password: "Incorrect-2026!" }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: "Invalid email or password",
      });
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

    it("shows only sanitized latest reset delivery state to an administrator", async () => {
      const administrator = await db.getUserByEmail("reviewer@example.test");
      const email = `recovery-state-${randomUUID()}@example.test`;
      const user = await db.createUser({
        openId: randomUUID(),
        email,
        password: "private-password-hash-marker",
        role: "viewer",
      });
      await requests.requestPasswordReset(email);
      const database = (await db.getDb())!;
      const expiresAt = new Date(Date.now() + 30 * 60_000);
      const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
      await database.insert(passwordResetTokens).values({
        userId: user!.id,
        email,
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        authVersion: 0,
        deliveryStatus: "accepted",
        expiresAt,
      });
      const [latest] = await database
        .insert(passwordResetTokens)
        .values({
          userId: user!.id,
          email,
          tokenHash,
          authVersion: 0,
          deliveryPayload: "private-encrypted-token-payload-marker",
          deliveryStatus: "failed",
          attempts: 2,
          expiresAt,
          lastError: "private-provider-error-marker",
        })
        .returning({ id: passwordResetTokens.id });
      const read = async () =>
        (await caller(administrator).users.pendingRequests()).find(
          (item) => item.email === email,
        )!;
      const visible = await read();
      expect(visible.recoveryDelivery).toEqual({
        status: "failed",
        failureCode: "unknown",
        attempts: 2,
        expiresAt,
      });
      expect(Object.keys(visible.recoveryDelivery!).sort()).toEqual([
        "attempts",
        "expiresAt",
        "failureCode",
        "status",
      ]);
      const serialized = JSON.stringify(visible);
      for (const secret of [
        tokenHash,
        "private-password-hash-marker",
        "private-encrypted-token-payload-marker",
        "private-provider-error-marker",
      ])
        expect(serialized).not.toContain(secret);
      await database
        .update(passwordResetTokens)
        .set({ deliveryStatus: "blocked", lastError: "recipient_not_allowed" })
        .where(eq(passwordResetTokens.id, latest.id));
      expect((await read()).recoveryDelivery).toMatchObject({
        status: "blocked",
        failureCode: "recipient_not_allowed",
      });
      await database
        .update(users)
        .set({ authVersion: 1 })
        .where(eq(users.id, user!.id));
      expect((await read()).recoveryDelivery).toMatchObject({
        status: "blocked",
        failureCode: "account_changed",
      });
      await database
        .update(passwordResetTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(passwordResetTokens.id, latest.id));
      expect((await read()).recoveryDelivery).toMatchObject({
        status: "expired",
        failureCode: "expired",
      });
    });

    it("does not attribute an older completed recovery email to a new help request", async () => {
      const administrator = await db.getUserByEmail("reviewer@example.test");
      const email = `new-recovery-${randomUUID()}@example.test`;
      const user = await db.createUser({
        openId: randomUUID(),
        email,
        password: "unused",
        role: "viewer",
      });
      const database = (await db.getDb())!;
      await database.insert(passwordResetTokens).values({
        userId: user!.id,
        email,
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        authVersion: 0,
        deliveryStatus: "accepted",
        createdAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      });
      await requests.requestPasswordReset(email);
      const request = (
        await caller(administrator).users.pendingRequests()
      ).find((item) => item.email === email);
      expect(request?.recoveryDelivery).toBeNull();
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
        email: `  ${email.toUpperCase()}  `,
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

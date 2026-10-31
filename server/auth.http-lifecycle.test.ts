import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { desc, eq, sql } from "drizzle-orm";
import express from "express";
import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import superjson from "superjson";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  accountRequests,
  loginRateLimits,
  passwordResetTokens,
  users,
} from "../drizzle/schema";
import { COOKIE_NAME } from "../shared/const";
import { dataWorkspaceCookie } from "../shared/data-workspace";
import { installBrowserOriginPolicy } from "./_core/browserOriginPolicy";
import { createContext } from "./_core/context";
import { createLoginRateLimit } from "./_core/loginRateLimit";
import { sdk } from "./_core/sdk";
import { createUser, getDb } from "./db";
import { appRouter } from "./routers";
import { disposableDatabase } from "./test/disposableDatabase";

// Real HTTP adapter, origin policy, persistent rate limits, sessions and database.
// The encrypted queue is the mail-worker boundary: these tests do NOT establish
// SMTP delivery, recipient acceptance, a production mailbox or the C# identity API.
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "authentication HTTP lifecycle",
  () => {
    disposableDatabase("auth_http");
    const initialPassword = "Synthetic-initial-2026!";
    const nextPassword = "Synthetic-chosen-2026!";
    const temporaryPassword = "Synthetic-temporary-2026!";
    const serviceSecret = "synthetic-http-recovery-envelope-key-2026";
    let server: Server;
    let origin = "";
    let passwordHash = "";

    beforeAll(async () => {
      passwordHash = await sdk.hashPassword(initialPassword);
      const app = express();
      const allowedOrigins = new Set<string>();
      installBrowserOriginPolicy(app, allowedOrigins);
      app.use(express.json({ limit: "2mb" }));
      app.use("/api/trpc", createLoginRateLimit());
      app.use(
        "/api/trpc",
        createExpressMiddleware({ router: appRouter, createContext }),
      );
      server = createServer(app);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw Error("No local auth test listener");
      origin = `http://127.0.0.1:${address.port}`;
      allowedOrigins.add(origin);
    });

    beforeEach(async () => {
      vi.stubEnv("BACKEND_DEPLOYMENT_MODE", "standalone");
      vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "false");
      vi.stubEnv("ENABLE_DEMO_DATA", "false");
      vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "false");
      vi.stubEnv("SECURITY_ENABLED", "false");
      vi.stubEnv("EMAIL_PROVIDER", "smtp");
      vi.stubEnv("EMAIL_DELIVERY_CONFIGURED", "true");
      vi.stubEnv("PASSWORD_RESET_ORIGIN", origin);
      vi.stubEnv("DASHBOARD_SERVICE_TOKEN", serviceSecret);
      const db = (await getDb())!;
      await db.execute(sql`truncate table users cascade`);
      await db.delete(accountRequests);
      await db.delete(loginRateLimits);
    });

    afterAll(async () => {
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    function client(initialCookie = "") {
      let cookie = initialCookie;
      const request = async (
        procedure: string,
        input?: unknown,
        mutation = false,
      ) => {
        const url = new URL(`/api/trpc/${procedure}`, origin);
        url.searchParams.set("batch", "1");
        const payload = { "0": superjson.serialize(input ?? {}) };
        if (!mutation) url.searchParams.set("input", JSON.stringify(payload));
        const response = await fetch(url, {
          method: mutation ? "POST" : "GET",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Cookie: `${dataWorkspaceCookie}=live${cookie ? `; ${cookie}` : ""}`,
          },
          body: mutation ? JSON.stringify(payload) : undefined,
        });
        const setCookie = response.headers.get("set-cookie");
        if (setCookie?.startsWith(`${COOKIE_NAME}=`))
          cookie = setCookie.split(";", 1)[0];
        const [envelope] = await response.json();
        return {
          status: response.status,
          setCookie,
          data: envelope.result
            ? superjson.deserialize<any>(envelope.result.data)
            : undefined,
          error: envelope.error
            ? superjson.deserialize<any>(envelope.error)
            : undefined,
        };
      };
      return {
        cookie: () => cookie,
        query: (procedure: string, input?: unknown) =>
          request(procedure, input),
        mutate: (procedure: string, input?: unknown) =>
          request(procedure, input, true),
      };
    }

    async function individual(
      email: string,
      role: "admin" | "viewer" = "viewer",
    ) {
      return (await createUser({
        openId: randomUUID(),
        email,
        name: "Synthetic HTTP account",
        role,
        password: passwordHash,
      }))!;
    }

    async function signIn(
      person: ReturnType<typeof client>,
      email: string,
      password = initialPassword,
    ) {
      const result = await person.mutate("auth.login", { email, password });
      expect(result.status).toBe(200);
      expect(result.data.user.email).toBe(email.trim().toLowerCase());
      expect(result.setCookie).toContain("HttpOnly");
      expect(result.data.user).not.toHaveProperty("password");
      return result.data.user;
    }

    async function queueReset(
      person: ReturnType<typeof client>,
      email: string,
      userId: number,
    ) {
      // Enable the real queue path for issuance; other requests use standalone
      // identity reads because this fixture intentionally has no C# API worker.
      vi.stubEnv("BACKEND_DEPLOYMENT_MODE", "compose");
      try {
        expect((await person.query("auth.passwordResetPolicy")).data).toEqual({
          delivery: "email",
        });
        const submitted = await person.mutate("auth.requestPasswordReset", {
          email,
        });
        expect(submitted.status).toBe(200);
        expect(submitted.data).toEqual({ submitted: true });
        expect(submitted.setCookie).toBeNull();
      } finally {
        vi.stubEnv("BACKEND_DEPLOYMENT_MODE", "standalone");
      }
      const [row] = await (await getDb())!
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, userId))
        .orderBy(desc(passwordResetTokens.id))
        .limit(1);
      expect(row.deliveryStatus).toBe("pending");
      const envelope = JSON.parse(row.deliveryPayload);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        createHash("sha256")
          .update(`smart-factory:password-reset:key:v1:${serviceSecret}`)
          .digest(),
        Buffer.from(envelope.iv, "base64"),
      );
      decipher.setAAD(
        Buffer.from(
          `smart-factory:password-reset:v1:${row.id}:${row.userId}:${row.authVersion}:${row.email}`,
        ),
      );
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const delivery = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(envelope.data, "base64")),
          decipher.final(),
        ]).toString("utf8"),
      );
      expect(delivery.resetUrl).toBe(
        `${origin}/#/reset-password?token=${delivery.token}`,
      );
      expect(row.tokenHash).toBe(
        createHash("sha256").update(delivery.token).digest("hex"),
      );
      expect(row.deliveryPayload).not.toContain(delivery.token);
      return { row, token: delivery.token as string };
    }

    it("registers, requires approval, preserves the original password on duplicate requests, signs in and revokes logout", async () => {
      const email = "applicant-http@example.test";
      const visitor = client();
      const registration = {
        email: `  ${email.toUpperCase()}  `,
        name: "HTTP Applicant",
        organization: "Synthetic Factory",
        password: initialPassword,
        role: "admin",
      };
      const submitted = await visitor.mutate(
        "auth.requestRegistration",
        registration,
      );
      expect(submitted.status).toBe(200);
      expect(submitted.data).toEqual({ submitted: true });
      expect(submitted.setCookie).toBeNull();
      const [request] = await (await getDb())!
        .select()
        .from(accountRequests)
        .where(eq(accountRequests.email, email));
      expect(request.status).toBe("pending");
      expect((await visitor.query("auth.me")).data).toBeNull();
      const incorrect = await visitor.mutate("auth.login", {
        email,
        password: "Synthetic-incorrect-2026!",
      });
      expect(incorrect.status).toBe(401);
      expect(incorrect.error.message).toBe("Invalid email or password");
      const pending = await visitor.mutate("auth.login", {
        email,
        password: initialPassword,
      });
      expect(pending.status).toBe(403);
      expect(pending.error.message).toMatch(/approval/i);
      expect(pending.setCookie).toBeNull();
      const pendingHelp = await visitor.mutate("auth.requestPasswordReset", {
        email,
      });
      expect(pendingHelp.data).toEqual({ submitted: true });
      expect(pendingHelp.setCookie).toBeNull();
      expect(await (await getDb())!.select().from(passwordResetTokens)).toEqual(
        [],
      );
      expect(
        (
          await visitor.mutate("auth.requestRegistration", {
            ...registration,
            password: nextPassword,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await visitor.mutate("users.approveRegistration", {
            id: request.id,
            role: "admin",
          })
        ).status,
      ).toBe(403);

      await individual("reviewer-http@example.test", "admin");
      const administrator = client();
      await signIn(administrator, "reviewer-http@example.test");
      const approval = await administrator.mutate("users.approveRegistration", {
        id: request.id,
        role: "viewer",
      });
      expect(approval.status).toBe(200);
      expect(approval.data).toMatchObject({ email, role: "viewer" });
      expect(
        (await visitor.mutate("auth.login", { email, password: nextPassword }))
          .status,
      ).toBe(401);
      await signIn(visitor, `  ${email.toUpperCase()}  `);
      expect((await visitor.query("auth.me")).data).toMatchObject({
        email,
        role: "viewer",
        passwordChangeRequired: false,
      });
      const replay = client(visitor.cookie());
      expect((await visitor.mutate("auth.logout")).data).toEqual({
        success: true,
      });
      expect((await replay.query("auth.me")).data).toBeNull();
      expect((await visitor.query("auth.me")).data).toBeNull();
    }, 20_000);

    it("recovers after repeated failed sign-ins, invalidates replaced/expired links and old sessions, and signs in with the chosen password", async () => {
      const email = "recovery-http@example.test";
      const user = await individual(email);
      const signedIn = client();
      await signIn(signedIn, email);
      const oldSession = client(signedIn.cookie());
      const recovery = client();
      // These failures must not consume a different flow's lower reset allowance.
      for (let attempt = 0; attempt < 6; attempt++)
        expect(
          (
            await recovery.mutate("auth.login", {
              email,
              password: "Synthetic-wrong-2026!",
            })
          ).status,
        ).toBe(401);

      const first = await queueReset(
        recovery,
        `  ${email.toUpperCase()}  `,
        user.id,
      );
      const replacement = await queueReset(recovery, email, user.id);
      const superseded = await recovery.mutate("auth.resetPassword", {
        token: first.token,
        newPassword: nextPassword,
      });
      expect(superseded.status).toBe(400);
      expect(superseded.error.message).toMatch(/invalid|expired/i);
      await (await getDb())!
        .update(passwordResetTokens)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(passwordResetTokens.id, replacement.row.id));
      const expired = await recovery.mutate("auth.resetPassword", {
        token: replacement.token,
        newPassword: nextPassword,
      });
      expect(expired.status).toBe(400);
      expect(expired.error.message).toBe(superseded.error.message);
      const current = await queueReset(recovery, email, user.id);
      const reset = await recovery.mutate("auth.resetPassword", {
        token: current.token,
        newPassword: nextPassword,
      });
      expect(reset.status).toBe(200);
      expect(reset.data).toEqual({ reset: true });
      expect(reset.setCookie).toContain(`${COOKIE_NAME}=;`);
      expect((await oldSession.query("auth.me")).data).toBeNull();
      expect(
        (
          await recovery.mutate("auth.resetPassword", {
            token: current.token,
            newPassword: temporaryPassword,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await recovery.mutate("auth.login", {
            email,
            password: initialPassword,
          })
        ).status,
      ).toBe(401);
      await signIn(recovery, email, nextPassword);
      expect((await recovery.query("auth.me")).data).toMatchObject({
        email,
        passwordChangeRequired: false,
      });
      const [persisted] = await (await getDb())!
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.id, current.row.id));
      expect(persisted.usedAt).not.toBeNull();
      expect(persisted.deliveryPayload).toBe("");
      const requests = await (await getDb())!
        .select()
        .from(accountRequests)
        .where(eq(accountRequests.email, email));
      expect(requests.every((request) => request.status === "approved")).toBe(
        true,
      );
    }, 20_000);

    it("completes administrator recovery, restricts the temporary session, and accepts only the user's replacement password afterwards", async () => {
      const email = "manual-http@example.test";
      const user = await individual(email);
      await individual("manual-reviewer@example.test", "admin");
      const administrator = client();
      await signIn(administrator, "manual-reviewer@example.test");
      const recovery = client();
      expect((await recovery.query("auth.passwordResetPolicy")).data).toEqual({
        delivery: "administrator",
      });
      expect(
        (await recovery.mutate("auth.requestPasswordReset", { email })).data,
      ).toEqual({ submitted: true });
      expect(
        (
          await administrator.mutate("users.resetPassword", {
            id: user.id,
            expectedVersion: user.authVersion,
            temporaryPassword,
          })
        ).status,
      ).toBe(200);
      const restricted = await signIn(recovery, email, temporaryPassword);
      expect(restricted.passwordChangeRequired).toBe(true);
      expect((await recovery.query("inventory.list", {})).status).toBe(403);
      const temporarySession = client(recovery.cookie());
      const chosen = await recovery.mutate("auth.changePassword", {
        newPassword: nextPassword,
      });
      expect(chosen.status).toBe(200);
      expect(chosen.data.user.passwordChangeRequired).toBe(false);
      expect((await temporarySession.query("auth.me")).data).toBeNull();
      expect((await recovery.query("auth.me")).data).toMatchObject({
        email,
        passwordChangeRequired: false,
      });
      expect(
        (
          await client().mutate("auth.login", {
            email,
            password: temporaryPassword,
          })
        ).status,
      ).toBe(401);
      await recovery.mutate("auth.logout");
      await signIn(recovery, email, nextPassword);
    }, 20_000);
  },
);

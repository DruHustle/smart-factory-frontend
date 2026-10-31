import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import { createUser, getUserByEmail } from "./db";
import { disposableDatabase } from "./test/disposableDatabase";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "account approval and password help",
  () => {
    disposableDatabase("requests");
    const caller = (user: TrpcContext["user"] = null) =>
      appRouter.createCaller({
        user,
        req: { protocol: "http", headers: {} },
        res: { cookie: () => {}, clearCookie: () => {} },
      } as unknown as TrpcContext);

    it("requires administrator approval before a requested account can sign in", async () => {
      const administrator = await createUser({
        openId: randomUUID(),
        email: "reviewer@example.test",
        name: "Reviewer",
        role: "admin",
        password: "unused-test-hash",
      });
      const applicant = "applicant@example.test";
      const password = "Synthetic-private-2026!";
      await expect(
        caller().auth.requestRegistration({
          email: applicant,
          name: "Factory Applicant",
          organization: "Example Works",
          jobTitle: "Engineer",
          password,
        }),
      ).resolves.toEqual({ submitted: true });
      expect(await getUserByEmail(applicant)).toBeUndefined();
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
      await caller(administrator).users.approveRegistration({
        id: pending[0].id,
      });
      await expect(
        caller().auth.login({ email: applicant, password }),
      ).resolves.toHaveProperty("user.email", applicant);
      expect(await caller(administrator).users.pendingRequests()).toEqual([]);
    });

    it("keeps password requests generic and requires a verified admin reset", async () => {
      const administrator = await getUserByEmail("reviewer@example.test");
      const applicant = await getUserByEmail("applicant@example.test");
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
  },
);

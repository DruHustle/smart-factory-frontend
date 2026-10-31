import express from "express";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initTRPC } from "@trpc/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { createLoginRateLimit } from "./_core/loginRateLimit";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  vi.restoreAllMocks();
});

async function fixture(fail = false) {
  const counts = new Map<string, number>();
  const record = vi.fn(async (key: string, _window: number) => {
    if (fail) throw new Error("private database connection string");
    const attempts = (counts.get(key) ?? 0) + 1;
    counts.set(key, attempts);
    return { attempts, resetAt: new Date(Date.now() + 900_000) };
  });
  const app = express();
  app.set("trust proxy", "loopback"); // Isolated test clients can vary their source IP.
  app.use(express.json());
  app.use("/trpc", createLoginRateLimit({ record, prune: vi.fn() }));
  const checked = vi.fn(() => ({ success: true }));
  const t = initTRPC.create({ transformer: superjson });
  const router = t.router({
    auth: t.router({
      login: t.procedure.mutation(checked),
      changePassword: t.procedure.mutation(checked),
      requestRegistration: t.procedure.mutation(checked),
      requestPasswordReset: t.procedure.mutation(checked),
    }),
  });
  app.use("/trpc", createExpressMiddleware({ router }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test listener");
  const url = `http://127.0.0.1:${address.port}/trpc`;
  const post = (path: string, body: unknown, ip = "192.0.2.1") =>
    fetch(`${url}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify(body),
    });
  return { record, counts, checked, url, post, router };
}

describe("credential throttling at the HTTP tRPC boundary", () => {
  it("throttles public registration and recovery requests by account", async () => {
    const { post, checked } = await fixture();
    for (let attempt = 0; attempt < 5; attempt++) {
      const path =
        attempt % 2 ? "auth.requestRegistration" : "auth.requestPasswordReset";
      expect(
        (
          await post(
            path,
            { json: { email: "person@example.test" } },
            `192.0.2.${attempt + 1}`,
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await post(
          "auth.requestPasswordReset",
          { json: { email: "PERSON@example.test" } },
          "192.0.2.9",
        )
      ).status,
    ).toBe(429);
    expect(checked).toHaveBeenCalledTimes(5);
  });
  it("charges the account in real single-operation client batches across source IPs", async () => {
    const { url, record, checked, router } = await fixture();
    let ip = 1;
    const client = createTRPCClient<typeof router>({
      links: [
        httpBatchLink({
          url,
          transformer: superjson,
          fetch(input, init) {
            return fetch(input, {
              ...init,
              headers: {
                ...init?.headers,
                "X-Forwarded-For": `192.0.2.${ip++}`,
              },
            });
          },
        }),
      ],
    });
    // These inputs are passed through the wire just like the browser auth client.
    const login = client.auth.login as unknown as {
      mutate(input: unknown): Promise<unknown>;
    };
    for (let attempt = 0; attempt < 20; attempt++)
      await login.mutate({
        email: attempt % 2 ? "Engineer@example.com" : "engineer@example.com",
        password: "test",
      });
    await expect(
      login.mutate({ email: "engineer@example.com", password: "test" }),
    ).rejects.toMatchObject({
      message: "Too many login attempts. Try again later.",
      data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 },
    });
    expect(checked).toHaveBeenCalledTimes(20);
    const emailHash = createHash("sha256")
      .update("email:engineer@example.com")
      .digest("hex");
    expect(record.mock.calls.filter(([key]) => key === emailHash)).toHaveLength(
      21,
    );
  });

  it.each(["auth%2Elogin", "nested/auth.login", "auth.changePassword"])(
    "throttles adapter-compatible %s paths and unbatched inputs",
    async (path) => {
      const { post, checked, record } = await fixture();
      record.mockResolvedValue({
        attempts: 101,
        resetAt: new Date(Date.now() + 5000),
      });
      const response = await post(path, {
        json: { email: "engineer@example.com" },
      });
      expect(response.status).toBe(429);
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(checked).not.toHaveBeenCalled();
    },
  );

  it("uses tRPC's first batch query value when a key is repeated", async () => {
    const { post, counts } = await fixture();
    const response = await post("auth.login?batch=1&batch=0", {
      0: { json: { email: "engineer@example.com" } },
    });
    expect(response.status).toBe(200);
    const emailHash = createHash("sha256")
      .update("email:engineer@example.com")
      .digest("hex");
    expect(counts.get(emailHash)).toBe(1);
  });

  it.each(["auth.login,auth.login", "auth%2Elogin%2Cauth.changePassword"])(
    "rejects multiple credential checks in %s before any check executes",
    async (path) => {
      const { post, checked, record } = await fixture();
      const response = await post(`${path}?batch=1`, {
        0: { json: { email: "one@example.com" } },
        1: { json: { email: "two@example.com" } },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveLength(2);
      expect(record).not.toHaveBeenCalled();
      expect(checked).not.toHaveBeenCalled();
    },
  );

  it("fails closed with an actionable tRPC response when the shared store fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { post, checked } = await fixture(true);
    const response = await post("auth.login?batch=1", {
      0: { json: { email: "one@example.com" } },
    });
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("Authentication is temporarily unavailable");
    expect(body).not.toContain("connection string");
    expect(checked).not.toHaveBeenCalled();
  });
});

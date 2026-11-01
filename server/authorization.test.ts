import * as fixtureBoundary from "./demoTarget";
import * as accounts from "./accountAccess";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "../drizzle/schema";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import * as assistantKnowledge from "./assistantKnowledge";

function contextFor(role?: User["role"]): TrpcContext {
  const user = role
    ? ({
        id: 4,
        openId: `test-${role}`,
        email: `${role}@example.test`,
        name: `Test ${role}`,
        loginMethod: "password",
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      } satisfies User)
    : null;

  return {
    user,
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  };
}

describe("role based access control", () => {
  beforeEach(() => {
    vi.spyOn(fixtureBoundary, "rejectFixtureMutation").mockResolvedValue(
      undefined,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("requires a signed-in account before reading devices", async () => {
    const caller = appRouter.createCaller(contextFor());
    await expect(caller.devices.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.assistant.ask({ question: "How do I import an AASX package?" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.assistant.providers()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.assistant.askSelected({
        question: "Review the source",
        selection: { provider: "local" },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("allows viewers to use the documentation assistant", async () => {
    const caller = appRouter.createCaller(contextFor("viewer"));
    const result = await caller.assistant.ask({
      question: "How do I import an AASX package?",
    });
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("provider");
    expect(result).not.toHaveProperty("model");
  });

  it.each(["ask", "askSelected"] as const)(
    "forwards request cancellation through assistant.%s",
    async (endpoint) => {
      const controller = new AbortController();
      const answer = vi.spyOn(assistantKnowledge, "answerFactoryQuestion");
      const caller = appRouter.createCaller(contextFor("viewer"), {
        signal: controller.signal,
      });
      await caller.assistant[endpoint]({
        question: "What is your name?",
        selection: { provider: "local" },
      });
      expect(answer).toHaveBeenCalledWith(
        "What is your name?",
        expect.objectContaining({ signal: controller.signal }),
      );
      answer.mockClear();
      controller.abort();
      await expect(
        caller.assistant[endpoint]({
          question: "What is your name?",
          selection: { provider: "local" },
        }),
      ).rejects.toThrow();
      expect(answer).not.toHaveBeenCalled();
    },
  );

  it("validates provider and model choices before loading or sending factory evidence", async () => {
    vi.stubEnv("ASSISTANT_PROVIDER", "disabled");
    try {
      const caller = appRouter.createCaller(contextFor("viewer"));
      const answer = vi.spyOn(assistantKnowledge, "answerFactoryQuestion");
      expect(
        (await caller.assistant.providers()).providers.map((p) => p.id),
      ).toEqual(["auto", "local"]);
      await expect(
        caller.assistant.ask({
          question: "Review the pump",
          selection: { provider: "openai", model: "unapproved-model" },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller.assistant.askSelected({
          question: "Review the pump",
          selection: { provider: "openai", model: "unapproved-model" },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(answer).not.toHaveBeenCalled();
      const result = await caller.assistant.askSelected({
        question: "What is your name?",
        selection: { provider: "local" },
      });
      expect(result.execution).toEqual({ provider: "local", model: null });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lets viewers read the asset catalog but prevents shell and lifecycle access", async () => {
    const caller = appRouter.createCaller(contextFor("viewer"));
    await expect(caller.assets.getShell({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.assets.exportAas({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.assets.getLifecycle({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("limits operational mutations to operators and above", async () => {
    const caller = appRouter.createCaller(contextFor("viewer"));
    await expect(
      caller.alerts.updateStatus({ id: 1, status: "acknowledged" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.readings.create({
        deviceId: 1,
        temperature: 42,
        timestamp: Date.now(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const operator = appRouter.createCaller(contextFor("operator"));
    await expect(operator.alerts.resolve({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("limits engineering procedures to engineers and admins", async () => {
    const operator = appRouter.createCaller(contextFor("operator"));
    const engineer = appRouter.createCaller(contextFor("engineer"));
    await expect(
      operator.thresholds.getForDevice({ deviceId: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      operator.assets.create({
        assetId: "asset-test",
        name: "Test asset",
        assetType: "compressor",
        manufacturer: "Test manufacturer",
        model: "Test model",
        manufacturerArticleNumber: "TEST-ART-001",
        orderCodeOfManufacturer: "TEST-001",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(engineer.users.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(engineer.assets.delete({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(engineer.devices.delete({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      operator.assets.controlAda031({
        id: 1,
        command: { action: "jog", joint: "base", direction: "increase" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows operators to invoke the commissioned LED control while viewers remain blocked", async () => {
    const viewer = appRouter.createCaller(contextFor("viewer"));
    await expect(
      viewer.devices.pulseIndicator({ id: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    vi.spyOn(db, "getDeviceById").mockResolvedValue(undefined);
    const operator = appRouter.createCaller(contextFor("operator"));
    await expect(operator.devices.pulseIndicator({ id: 1 })).rejects.toThrow(
      "A live gateway-connected WROVER edge device is required",
    );
  });

  it("reserves user and notification administration for admins", async () => {
    const engineer = appRouter.createCaller(contextFor("engineer"));
    await expect(engineer.users.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(engineer.notifications.getConfigs()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      engineer.users.create({
        email: "unauthorized@example.com",
        name: "Blocked",
        password: "Blocked-password-123!",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows only admins to provision user roles", async () => {
    const operator = appRouter.createCaller(contextFor("operator"));
    await expect(
      operator.users.setRole({ id: 7, role: "engineer" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const updateUserRole = vi
      .spyOn(accounts, "changeUserAccess")
      .mockResolvedValue(contextFor("engineer").user!);
    const admin = appRouter.createCaller(contextFor("admin"));
    await expect(
      admin.users.setRole({ id: 7, role: "engineer" }),
    ).resolves.toMatchObject({ role: "engineer" });
    expect(updateUserRole).toHaveBeenCalledWith(7, {
      role: "engineer",
      expectedVersion: undefined,
    });
  });

  it("allows engineers, but not operators, to control demo data", async () => {
    const operator = appRouter.createCaller(contextFor("operator"));
    await expect(
      operator.system.setDemoData({ enabled: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

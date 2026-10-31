import { it, expect, vi, afterEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { dataWorkspaceCookie } from "../../shared/data-workspace";
afterEach(() => vi.unstubAllEnvs());
it.each([
  { email: "admin@dev.local", workspace: "live" },
  { email: "individual@example.test", workspace: "demo" },
])(
  "isolates equipment for $email selecting $workspace",
  async ({ email, workspace }) => {
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
    const ctx = {
      user: {
        id: 2,
        role: "admin",
        email,
        openId: "individual",
      },
      req: { headers: { cookie: `${dataWorkspaceCookie}=${workspace}` } },
      res: {},
    } as TrpcContext;
    const caller = appRouter.createCaller(ctx);
    expect(await caller.equipment.access()).toEqual({
      canWrite: false,
      demoOnly: true,
    });
    await expect(
      caller.equipment.create({
        name: "Denied",
        serialNumber: "test",
        kind: "real",
        templateRevision: "x",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.equipment.bindingTemplate({ revision: "local-import:private" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const models = await caller.equipment.models();
    expect(models.imported).toEqual([]);
  },
);

it("allows an individual Live engineer to use model mapping on a demo-enabled origin", async () => {
  vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
  const caller = appRouter.createCaller({
    user: {
      id: 2,
      role: "engineer",
      email: "mapping@example.test",
      openId: "mapping-engineer",
    },
    req: { headers: { cookie: `${dataWorkspaceCookie}=live` } },
    res: {},
  } as TrpcContext);
  expect(await caller.equipment.access()).toEqual({
    canWrite: true,
    demoOnly: false,
  });
  const t = await caller.equipment.template();
  const mapping = await caller.equipment.bindingTemplate({
    revision: t.revision,
  });
  expect(mapping.components.map((c) => c.templateComponentId)).toEqual(
    t.components.map((c) => c.templateComponentId),
  );
  expect(mapping.bindings).toEqual(t.bindings);
});

it.each(["viewer", "operator"])(
  "retains the equipment engineering boundary for an individual Live %s",
  async (role) => {
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
    const caller = appRouter.createCaller({
      user: {
        id: 2,
        role,
        email: "individual@example.test",
        openId: "individual",
      },
      req: { headers: { cookie: `${dataWorkspaceCookie}=live` } },
      res: {},
    } as TrpcContext);
    expect(await caller.equipment.access()).toEqual({
      canWrite: false,
      demoOnly: false,
    });
    await expect(
      caller.equipment.bindingTemplate({ revision: "local-import:private" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);

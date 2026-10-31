/** Disposable fixtures for the real protocol -> MQTT -> .NET -> Node qualification. */
import { readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import {
  getDb,
  closeDatabase,
  createUser,
  getUserByOpenId,
  getDeviceByDeviceId,
} from "../../server/db";
import { registerDevice } from "../../server/deviceRegistration";
import { appRouter } from "../../server/routers";
import { sdk } from "../../server/_core/sdk";
import type { TrpcContext } from "../../server/_core/context";
import { industrialConfigurationSchema } from "../../shared/industrial-connectivity";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/smart_factory_connectivity"
)
  throw Error(
    "Only the disposable connectivity qualification database is allowed",
  );
const gatewayDeviceId = "connectivity-e2e",
  assetIdentity = "urn:qualification:connectivity:pump";
try {
  const db = (await getDb())!;
  let user = await getUserByOpenId("connectivity-qualification-engineer");
  if (process.argv[2] === "seed") {
    user ??= await createUser({
      openId: "connectivity-qualification-engineer",
      name: "Connectivity qualification engineer",
      email: "connectivity-qualification@example.test",
      role: "engineer",
    });
    const gateway =
      (await getDeviceByDeviceId(gatewayDeviceId)) ??
      (await registerDevice(
        {
          deviceId: gatewayDeviceId,
          name: "Disposable protocol qualification gateway",
          type: "gateway",
          route: "direct",
          freshnessSeconds: 120,
        },
        user!.id,
      ));
    const [asset] = await db.execute<{ id: number }>(
      sql`insert into assets("assetId",name,"assetType","aasShell") values(${assetIdentity},'Disposable protocol qualification pump','pump','{}'::json) on conflict("assetId") do update set name=excluded.name returning id`,
    );
    await db.execute(
      sql`insert into asset_devices("assetId","deviceId",protocol) select ${asset.id},${gateway.id},'mqtt' where not exists(select 1 from asset_devices where "assetId"=${asset.id} and "deviceId"=${gateway.id})`,
    );
    if (process.env.CONNECTIVITY_BROWSER_SESSION_FILE) {
      const token = await sdk.createSessionToken(user!, {
        expiresInMs: 3600000,
      });
      writeFileSync(
        process.env.CONNECTIVITY_BROWSER_SESSION_FILE,
        JSON.stringify({
          cookies: [
            {
              name: "app_session_id",
              value: token,
              url: "http://127.0.0.1:3126",
              httpOnly: true,
              sameSite: "Lax",
            },
            {
              name: "smart_factory_data_workspace",
              value: "live",
              url: "http://127.0.0.1:3126",
              sameSite: "Lax",
            },
          ],
          gatewayDeviceId,
          assetId: assetIdentity,
        }),
        { mode: 0o600 },
      );
    }
    console.log(
      JSON.stringify({
        registered: gatewayDeviceId,
        assetId: assetIdentity,
        physicalEquipment: false,
      }),
    );
  } else {
    if (!user) throw Error("Seed the disposable engineer first");
    const caller = appRouter.createCaller({
      user,
      req: { headers: { cookie: "smart_factory_data_workspace=live" } },
      res: {},
      visibility: Promise.resolve({ demoOnly: false, includeDemo: false }),
    } as unknown as TrpcContext);
    if (process.argv[2] === "publish") {
      const configuration = industrialConfigurationSchema.parse(
        JSON.parse(readFileSync(process.argv[3], "utf8")),
      );
      if (configuration.gatewayDeviceId !== gatewayDeviceId)
        throw Error("Qualification gateway mismatch");
      const browser = JSON.parse(
        readFileSync(process.env.CONNECTIVITY_BROWSER_SESSION_FILE!, "utf8"),
      ) as { cookies: Array<{ name: string; value: string }> };
      const http = createTRPCClient<typeof appRouter>({
        links: [
          httpBatchLink({
            url: "http://127.0.0.1:3126/api/trpc",
            transformer: superjson,
            headers: {
              cookie: browser.cookies
                .map((c) => `${c.name}=${c.value}`)
                .join("; "),
              origin: "http://127.0.0.1:3126",
            },
          }),
        ],
      });
      const current = await http.connectivity.get.query({ gatewayDeviceId });
      const saved = await http.connectivity.save.mutate({
        gatewayDeviceId,
        expectedRevision: current.revision,
        connections: configuration.connections,
      });
      console.log(
        JSON.stringify(
          await http.connectivity.publish.mutate({
            gatewayDeviceId,
            expectedRevision: saved.revision,
          }),
        ),
      );
    } else {
      const state = await caller.connectivity.get({ gatewayDeviceId });
      const assetTags = await caller.connectivity.assetTags({
        assetId: assetIdentity,
      });
      console.log(JSON.stringify({ state, assetTags }));
    }
  }
} finally {
  await closeDatabase();
}

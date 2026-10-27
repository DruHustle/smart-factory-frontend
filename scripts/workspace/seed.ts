import { sql } from "drizzle-orm";
import {
  getDb,
  closeDatabase,
  ingestTelemetryByDeviceId,
} from "../../server/db";
import { registerDevice } from "../../server/deviceRegistration";
import { createEquipment, template } from "../../server/equipment/local";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_e2e")
)
  throw Error("Workspace fixtures require a disposable local _e2e database");
const db = (await getDb())!;
const gateway = await registerDevice({
  name: "Workspace gateway",
  deviceId: "workspace-gateway",
  type: "gateway",
  route: "direct",
  freshnessSeconds: 120,
});
for (const [id, name, type, route] of [
  ["workspace-direct", "Workspace direct sensor", "sensor", "direct"],
  ["workspace-child-a", "Workspace child A", "sensor", "gateway"],
  ["workspace-child-b", "Workspace child B", "controller", "gateway"],
  ["workspace-never", "Workspace never configured", "actuator", "unconfigured"],
] as const)
  await registerDevice({
    deviceId: id,
    name,
    type,
    route,
    gatewayId: route === "gateway" ? gateway.deviceId : undefined,
    freshnessSeconds: route === "unconfigured" ? undefined : 120,
  });
await ingestTelemetryByDeviceId({
  deviceId: "workspace-direct",
  timestamp: Date.now() - 1000,
  temperature: 23,
  units: { temperature: "°C" },
  integration: {
    mode: "live",
    sourceQuality: "good",
    sourceConnection: "online",
    gatewayReceivedAt: new Date().toISOString(),
  },
});
await ingestTelemetryByDeviceId({
  deviceId: "workspace-child-a",
  gatewayId: gateway.deviceId,
  timestamp: Date.now() - 3600000,
  temperature: 20,
  units: { temperature: "°C" },
  integration: {
    mode: "live",
    sourceQuality: "good",
    sourceConnection: "online",
    gatewayReceivedAt: new Date().toISOString(),
  },
});
await ingestTelemetryByDeviceId({
  deviceId: gateway.deviceId,
  gatewayId: gateway.deviceId,
  timestamp: Date.now() - 1000,
  units: { temperature: "°C" },
  integration: {
    mode: "live",
    sourceQuality: "good",
    sourceConnection: "online",
    gatewayReceivedAt: new Date().toISOString(),
  },
});
await registerDevice({
  name: "Workspace observed offline",
  deviceId: "workspace-offline",
  type: "sensor",
  route: "direct",
  freshnessSeconds: 120,
});
await ingestTelemetryByDeviceId({
  deviceId: "workspace-offline",
  timestamp: Date.now() - 3600000,
  temperature: 18,
  units: { temperature: "°C" },
  integration: {
    mode: "live",
    sourceQuality: "good",
    sourceConnection: "online",
    gatewayReceivedAt: new Date().toISOString(),
  },
});
await db.execute(
  sql`update devices set status='offline' where "deviceId"='workspace-offline'`,
);
const shell = {
  modelType: "AssetAdministrationShell",
  id: "urn:workspace:vendor:shell",
  assetInformation: {
    assetKind: "Instance",
    globalAssetId: "urn:workspace:imported",
  },
};
const submodels = [
  {
    modelType: "Submodel",
    id: "urn:workspace:vendor:nameplate:" + "long-identifier-".repeat(12),
    idShort: "VendorNameplate",
    submodelElements: [
      {
        modelType: "Property",
        idShort: "ManufacturerName",
        valueType: "xs:string",
        value: "Isolated fixture manufacturer",
      },
    ],
  },
];
const a = await db.execute(
  sql`insert into assets("assetId",name,"assetType","aasxImported","aasShell","aasSubmodels") values('urn:workspace:imported','Workspace imported asset','pump',true,${JSON.stringify(shell)}::json,${JSON.stringify(submodels)}::json),('urn:workspace:linked','Workspace linked asset','pump',false,'{}'::json,'[]'::json) returning id`,
);
for (const row of a)
  await db.execute(
    sql`insert into asset_devices("assetId","deviceId",protocol) values(${row.id},${gateway.id},'mqtt')`,
  );
const t = await template();
await createEquipment(
  {
    name: "Workspace linked pump",
    serialNumber: "UI-LINKED",
    kind: "real",
    templateRevision: t.revision,
    existingAssetId: Number(a[1].id),
    sourceBindings: t.bindings,
  },
  1,
);
await createEquipment(
  {
    name: "Workspace standalone pump",
    serialNumber: "UI-STANDALONE",
    kind: "real",
    templateRevision: t.revision,
  },
  1,
);
console.log("Isolated workspace inventory ready");
await closeDatabase();

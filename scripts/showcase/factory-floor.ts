/** Explicit, additive authored factory. Never runs from application startup. */
import { sql } from "drizzle-orm";
import { getDb, ingestTelemetryByDeviceId } from "../../server/db";
import { createEquipment, template } from "../../server/equipment/local";
import { referenceModels } from "../../shared/factory-models";
import type { Showcase } from "../../shared/showcase";
import { showcaseUuid as uuid } from "./basic";

export const floorSpec = [
  [
    "tank-03",
    "Finished product buffer tank",
    "storage-tank",
    "Process utilities",
  ],
  ["cabinet-04", "Quality inspection cabinet", "control-cabinet", "Assembly"],
  ["conveyor-04", "Pallet dispatch conveyor", "conveyor", "Packaging"],
  ["robot-04", "Case packing robot", "robot-arm", "Packaging"],
  ["tank-01", "Feed storage tank", "storage-tank", "Process utilities"],
  ["tank-02", "Buffer storage tank", "storage-tank", "Process utilities"],
  ["valve-01", "Feed isolation valve", "valve", "Process utilities"],
  ["pump-02", "Transfer pump and motor", "pump-motor", "Process utilities"],
  ["mixer-01", "Mixing vessel", "storage-tank", "Process utilities"],
  ["conveyor-01", "Assembly infeed conveyor", "conveyor", "Assembly"],
  ["conveyor-02", "Assembly transfer conveyor", "conveyor", "Assembly"],
  ["robot-01", "Assembly pick and place robot", "robot-arm", "Assembly"],
  ["robot-02", "Assembly finishing robot", "robot-arm", "Assembly"],
  ["cabinet-01", "Assembly control cabinet", "control-cabinet", "Assembly"],
  ["conveyor-03", "Packaging outfeed conveyor", "conveyor", "Packaging"],
  ["robot-03", "Packaging palletizing robot", "robot-arm", "Packaging"],
  ["valve-02", "Packaging pneumatic valve", "valve", "Packaging"],
  ["cabinet-02", "Packaging control cabinet", "control-cabinet", "Packaging"],
  [
    "pi-02",
    "Raspberry Pi inspection gateway",
    "raspberry-pi-4b",
    "Edge and network",
  ],
  [
    "cabinet-03",
    "Network control cabinet",
    "control-cabinet",
    "Edge and network",
  ],
] as const;
const zones = [
  "Process utilities",
  "Assembly",
  "Packaging",
  "Edge and network",
];
const gateways = ["process", "assembly", "packaging", "network"].map(
  (key, i) => ({
    deviceId: `showcase.gateway:${key}`,
    name: `${zones[i]} gateway`,
    type: "gateway" as const,
    zone: zones[i],
  }),
);
const controllers = [
  ["showcase.fx.plc:process", "FX Process PLC", "Process utilities"],
  ["showcase.fx.plc:assembly", "FX Assembly PLC", "Assembly"],
  ["showcase.fx.robot:01", "FX Robot controller", "Assembly"],
  ["showcase.fx.plc:packaging", "FX Packaging PLC", "Packaging"],
].map(([deviceId, name, zone]) => ({
  deviceId,
  name,
  zone,
  type: "controller" as const,
}));
const sensors = [
  ["feed-temperature", "Feed temperature sensor", "Process utilities"],
  ["feed-pressure", "Feed pressure sensor", "Process utilities"],
  ["pump-vibration", "Transfer pump vibration sensor", "Process utilities"],
  ["assembly-infeed", "Assembly infeed photoelectric sensor", "Assembly"],
  ["assembly-vision", "Assembly vision inspection sensor", "Assembly"],
  ["robot-vibration", "Robot vibration sensor", "Assembly"],
  ["packaging-count", "Packaging count sensor", "Packaging"],
  ["packaging-pressure", "Packaging air pressure sensor", "Packaging"],
  ["cabinet-environment", "Cabinet environment sensor", "Edge and network"],
  ["energy-meter", "Factory energy meter", "Edge and network"],
].map(([key, name, zone]) => ({
  deviceId: `showcase.floor:${key}`,
  name,
  zone,
  type: "sensor" as const,
}));
const networkDevices = [
  {
    deviceId: "showcase.floor:tsn-switch",
    name: "TSN distribution switch",
    zone: "Edge and network",
    type: "edge_device" as const,
  },
  {
    deviceId: "showcase.floor:grandmaster",
    name: "PTP grandmaster clock",
    zone: "Edge and network",
    type: "edge_device" as const,
  },
];
export const floorDevices = [
  ...gateways,
  ...controllers,
  ...sensors,
  ...networkDevices,
];
export const floorEquipmentId = (key: string) => uuid(`floor-v4:${key}`);

export async function planFactoryFloor() {
  const db = (await getDb())!;
  const collisions = await db.execute(sql`
    select "deviceId" as identity from devices where "deviceId" in (${sql.join(
      floorDevices.map((d) => sql`${d.deviceId}`),
      sql`,`,
    )}) and "isDemo"=false
    union all select id::text from equipment_workspaces where id in (${sql.join(
      floorSpec.map(([key]) => sql`${floorEquipmentId(key)}::uuid`),
      sql`,`,
    )}) and is_demo=false`);
  if (collisions.length)
    throw Error(
      "Reserved factory demo identity collides with non-demo data. Nothing was changed.",
    );
  const expected = floorSpec.map(
    ([key, , slug]) =>
      sql`(${floorEquipmentId(key)}::uuid,${`urn:smart-factory:showcase:floor:${key}`}::text,${referenceModels.find((m) => m.slug === slug)!.revision}::text)`,
  );
  const mismatched = await db.execute(sql`
    select w.id from (values ${sql.join(expected, sql`,`)}) as e(id,asset,revision)
    join equipment_workspaces w on w.id=e.id join assets a on a.id=w.asset_id
    where w.template_revision<>e.revision or a."assetId"<>e.asset or w.is_demo=false or a."isDemo"=false`);
  if (mismatched.length)
    throw Error(
      "Reserved factory model identity has incompatible retained content. Nothing was changed.",
    );
}

export async function addFactoryFloorShowcase(
  base: Showcase,
): Promise<Showcase> {
  await planFactoryFloor();
  if (base.version >= 4) return base;
  const db = (await getDb())!;
  const [actor] = await db.execute<{ id: number }>(
    sql`select id from users where email in ('admin@dev.local','tech@dev.local','security-admin@example.test') order by id limit 1`,
  );
  if (!actor)
    throw Error("An existing demo owner is required for the authored factory.");
  const anchor = Date.parse(base.anchor);
  const deviceIds = new Map<string, number>();
  for (const spec of floorDevices) {
    const gateway = gateways.find((g) => g.zone === spec.zone)!;
    const [device] = await db.execute<{ id: number }>(sql`
      insert into devices("deviceId",name,type,location,zone,"isDemo",metadata)
      values(${spec.deviceId},${spec.name},${spec.type}::device_type,${`${spec.zone} · illustrative floor`},${spec.zone},true,${JSON.stringify(
        {
          showcaseVersion: 4,
          connectionMode: "gateway",
          gatewayId: spec.type === "gateway" ? null : gateway.deviceId,
          commissioning: {
            route: "gateway",
            gatewayId: gateway.deviceId,
            revision: 1,
            maxLatenessSeconds: 120,
            clockSkewSeconds: 30,
            freshnessSeconds: 60,
            legacyCurrent: false,
            legacyUnits: {},
            reviewedAt: base.anchor,
            reviewedBy: actor.id,
          },
        },
      )}::jsonb) on conflict("deviceId") do nothing returning id`);
    const retained =
      device ??
      (
        await db.execute<{ id: number }>(
          sql`select id from devices where "deviceId"=${spec.deviceId} and "isDemo"=true`,
        )
      )[0];
    deviceIds.set(spec.deviceId, retained.id);
  }
  const [simulator] = await db.execute<{ id: number }>(
    sql`select id from devices where "deviceId"='smart-factory-public-simulator' and "isDemo"=true`,
  );
  for (const [index, [key, name, slug, zone]] of floorSpec.entries()) {
    const revision = referenceModels.find((m) => m.slug === slug)!.revision;
    const t = await template(revision),
      id = floorEquipmentId(key);
    const assetId = `urn:smart-factory:showcase:floor:${key}`;
    await createEquipment(
      {
        name,
        serialNumber: `SIM-FLOOR-${key}`,
        kind: "simulated",
        templateRevision: revision,
        zone,
      },
      actor.id,
      {
        id,
        assetId,
        isDemo: true,
        components: t.components.map((c) =>
          uuid(`floor:${key}:${c.templateComponentId}`),
        ),
      },
    );
    const [asset] = await db.execute<{ id: number }>(
      sql`update assets set location=${`${zone} · illustrative floor`},zone=${zone} where "assetId"=${assetId} and "isDemo"=true returning id`,
    );
    // One authoritative asset on the floor, with its native inspection workspace attached.
    await db.execute(
      sql`update equipment_workspaces set is_standalone=false where id=${id} and is_demo=true`,
    );
    const gateway = gateways.find((g) => g.zone === zone)!;
    for (const source of [simulator.id, deviceIds.get(gateway.deviceId)!])
      await db.execute(
        sql`insert into asset_devices("assetId","deviceId",protocol,"tagMappings") select ${asset.id},${source},'simulator','[]'::jsonb where not exists(select 1 from asset_devices where "assetId"=${asset.id} and "deviceId"=${source})`,
      );
    const run = uuid(`floor:${key}:run`);
    await db.execute(
      sql`insert into equipment_scenario_runs(id,equipment_id,scenario,started_at) values(${run},${id},'normal',${new Date(anchor - 3600000).toISOString()}::timestamptz) on conflict(id) do nothing`,
    );
    for (let n = 0; n <= 60; n += 2) {
      // A short recorded gap demonstrates honest missing-data treatment in charts.
      if (index % 5 === 0 && n >= 24 && n <= 28) continue;
      await ingestTelemetryByDeviceId({
        deviceId: "smart-factory-public-simulator",
        gatewayId: "smart-factory-public-simulator",
        assetId,
        timestamp: anchor - 3600000 + n * 60000,
        temperature: 30 + index + Math.sin(n / 7) * 2,
        power: 0.5 + index * 0.13 + Math.sin(n / 8) * 0.08,
        pressure: 2 + index * 0.1 + Math.sin(n / 9) * 0.08,
        vibration: 1 + index * 0.05 + Math.sin(n / 6) * 0.12,
        rpm: 1200 + index * 20 + Math.sin(n / 7) * 12,
        humidity: 45 + Math.sin(n / 9) * 4,
        units: {
          temperature: "Cel",
          power: "kW",
          pressure: "bar",
          vibration: "mm/s",
          rpm: "rpm",
          humidity: "%",
        },
        integration: {
          mode: "simulated",
          scenarioRunId: run,
          sessionId: run,
          sequence: n,
          sourceQuality: "good",
          sourceConnection: "online",
          gatewayReceivedAt: base.anchor,
        },
      });
    }
  }
  // createEquipment shares the simulator; keep its established identity unchanged.
  await db.execute(
    sql`update devices set name='Showcase gateway 01' where id=${simulator.id} and "isDemo"=true`,
  );
  const full: Showcase = {
    ...base,
    version: 4,
    chapters: [
      ...(base.chapters ?? []).filter(
        (c) =>
          !["Whole factory floor", "FX and TSN diagnostics"].includes(c.title),
      ),
      {
        title: "Whole factory floor",
        description:
          "All registered equipment, controllers, sensors and gateways across process, assembly, packaging and network zones, with a 3D floor and factory-wide trend.",
        href: "/",
        state: "available",
      },
      {
        title: "FX and TSN diagnostics",
        description:
          "Authored AutomationComponents, PubSub connections, clock quality, timing charts, late-delivery, clock-loss and recovery scenarios. No physical timing or conformance claim.",
        href: "/network",
        state: "available",
      },
    ],
  };
  await db.execute(
    sql`update system_settings set value=${JSON.stringify(full)}::jsonb where key='showcase_v1'`,
  );
  return full;
}

/** Explicit authoring command only. Never runs at application startup. */
import { sql, eq } from "drizzle-orm";
import { getDb, ingestTelemetryByDeviceId } from "../../server/db";
import {
  createEquipment,
  template,
  workSchema,
} from "../../server/equipment/local";
import { ownedEnvelope, ownedEventTypes } from "../../server/security/contract";
import {
  securityTransaction,
  ingestInTransaction,
  audit,
} from "../../server/security/store";
import {
  assets,
  devices,
  alerts,
  alertThresholds,
  systemSettings,
  notificationInbox,
} from "../../drizzle/schema";
import { buildAasDocuments } from "../../server/aasModel";
import { DEMO_ACCOUNTS } from "../../shared/demo-accounts";
import { PASSPORT_DISCLAIMER } from "../../shared/passport";
import type { Showcase } from "../../shared/showcase";
import { seedBasicShowcase, showcaseUuid as uuid } from "./basic";

const standaloneId = uuid("standalone-v2");
const ids = [
  "showcase.motor:02",
  "showcase.vibration:02",
  "showcase.environment:01",
  "showcase.compressor:01",
];
export async function planShowcase() {
  const db = (await getDb())!;
  // Fail closed rather than updating any colliding operational record.
  const collisions = await db.execute(
    sql`select "deviceId" as identity from devices where "deviceId" in ('smart-factory-public-simulator','showcase.temp:01','showcase-disconnected',${sql.join(
      ids.map((id) => sql`${id}`),
      sql`,`,
    )}) and "isDemo"=false union all select "assetId" from assets where "assetId" like 'urn:smart-factory:showcase:%' and "isDemo"=false union all select id::text from equipment_workspaces where id in(${uuid("pump")}::uuid,${standaloneId}::uuid) and is_demo=false`,
  );
  const protectedCollisions = await db.execute(
    sql`select id::text from security_sources where (id=${uuid("mapped-security")}::uuid or namespace='smart-factory-showcase-components' or system_key='showcase-components-v2') and (is_demo=false or id<>${uuid("mapped-security")}::uuid) union all select p.id::text from asset_passport_publications p join assets a on a.id=p.asset_id where p.id=${uuid("public-passport")}::uuid and a."isDemo"=false`,
  );
  if (protectedCollisions.length)
    throw Error(
      "Reserved demo source/publication identity is already in use. Nothing was changed.",
    );
  if (collisions.length)
    throw Error(
      "Reserved showcase identity collides with non-demo data. Nothing was changed.",
    );
  const [current] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "showcase_v1"));
  if (
    current &&
    (current.value as Showcase).assetId !== "urn:smart-factory:showcase:pump-01"
  )
    throw Error(
      "Unrecognized showcase metadata. Review it without replacing it.",
    );
  return {
    version: 2,
    installedVersion: (current?.value as Showcase | undefined)?.version ?? 0,
    isolated: true,
    operationalWrites: false,
    emailRequests: false,
    visibilityChange: false,
    equipment: 2,
    telemetryMetrics: 6,
    evidenceModes: ["simulated", "replay"],
    chapters: 12,
  };
}
export async function seedCompleteShowcase(persistDemoVisibility = false) {
  await planShowcase();
  const base = (await seedBasicShowcase(persistDemoVisibility)) as Showcase;
  const db = (await getDb())!;
  if (base.version >= 2) {
    await seedInboxes(base);
    return base;
  }
  const anchor = Date.parse(base.anchor),
    at = (offset: number) => new Date(anchor + offset),
    t = await template();
  const [pump] = await db
    .select()
    .from(assets)
    .where(eq(assets.assetId, base.assetId));
  const [gateway] = await db
    .select()
    .from(devices)
    .where(eq(devices.deviceId, "smart-factory-public-simulator"));
  const [actor] = await db.execute<{ id: number }>(
    sql`select id from users where email in (${sql.join(
      DEMO_ACCOUNTS.map((a) => sql`${a.email}`),
      sql`,`,
    )},'security-admin@example.test') order by case when email='admin@dev.local' then 0 else 1 end,id limit 1`,
  );
  if (!actor)
    throw Error(
      "An existing demonstration owner is required; this installer never creates or changes accounts.",
    );
  await createEquipment(
    {
      name: "Showcase standalone inspection pump",
      serialNumber: "SIM-STANDALONE-02",
      kind: "simulated",
      templateRevision: t.revision,
    },
    actor.id,
    {
      id: standaloneId,
      assetId: "urn:smart-factory:showcase:standalone-02",
      components: t.components.map((c) =>
        uuid("standalone:" + c.templateComponentId),
      ),
      isDemo: true,
    },
  );
  const [standalone] = await db
    .select()
    .from(assets)
    .where(eq(assets.assetId, "urn:smart-factory:showcase:standalone-02"));
  const [run] = await db.execute<{ id: string }>(
    sql`select id from equipment_scenario_runs where equipment_id=${base.equipmentId} order by started_at desc limit 1`,
  );
  const standaloneRun = uuid("standalone-run");
  await db.execute(
    sql`insert into equipment_scenario_runs(id,equipment_id,scenario,started_at) values(${standaloneRun},${standaloneId},'normal',${at(-3600000).toISOString()}::timestamptz) on conflict(id) do nothing`,
  );
  const specimens = [
    {
      deviceId: ids[0],
      name: "Showcase motor 02",
      type: "controller" as const,
      route: "gateway",
      assetId: "urn:smart-factory:showcase:motor-02",
      assetType: "motor" as const,
    },
    {
      deviceId: ids[1],
      name: "Showcase direct vibration sensor",
      type: "sensor" as const,
      route: "direct",
    },
    {
      deviceId: ids[2],
      name: "Showcase environment sensor",
      type: "sensor" as const,
      route: "direct",
    },
    {
      deviceId: ids[3],
      name: "Showcase compressor 01",
      type: "controller" as const,
      route: "gateway",
      assetId: "urn:smart-factory:showcase:compressor-01",
      assetType: "compressor" as const,
    },
  ];
  const created = [];
  for (const spec of specimens) {
    const [device] = await db
      .insert(devices)
      .values({
        deviceId: spec.deviceId,
        name: spec.name,
        type: spec.type,
        isDemo: true,
        location: "Simulation line A",
        zone: "Showcase",
        metadata: {
          showcaseVersion: 2,
          connectionMode: spec.route,
          gatewayId: spec.route === "gateway" ? gateway.deviceId : null,
          commissioning: {
            route: spec.route,
            gatewayId: spec.route === "gateway" ? gateway.deviceId : undefined,
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
      })
      .onConflictDoUpdate({
        target: devices.deviceId,
        set: { name: spec.name },
      })
      .returning();
    if (spec.assetId) {
      const [asset] = await db
        .insert(assets)
        .values({
          assetId: spec.assetId,
          name: spec.name,
          assetType: spec.assetType!,
          manufacturer: "Synthetic example manufacturer",
          aasShell: buildAasDocuments({
            assetId: spec.assetId,
            name: spec.name,
            assetType: spec.assetType!,
            manufacturer: "Synthetic example manufacturer",
            model: "Illustrative example",
            manufacturerStreet: "Example 1",
            manufacturerZipcode: "00000",
            manufacturerCityTown: "Simulation",
            manufacturerNationalCode: "DE",
            manufacturerArticleNumber: "SIM-02",
            orderCodeOfManufacturer: "SIM-02",
          }).shell,
          aasSubmodels: buildAasDocuments({
            assetId: spec.assetId,
            name: spec.name,
            assetType: spec.assetType!,
            manufacturer: "Synthetic example manufacturer",
            model: "Illustrative example",
            manufacturerStreet: "Example 1",
            manufacturerZipcode: "00000",
            manufacturerCityTown: "Simulation",
            manufacturerNationalCode: "DE",
            manufacturerArticleNumber: "SIM-02",
            orderCodeOfManufacturer: "SIM-02",
          }).submodels,
          serialNumber: "SIM-" + spec.deviceId,
          location: "Simulation line A",
          zone: "Showcase",
          isDemo: true,
        })
        .onConflictDoUpdate({
          target: assets.assetId,
          set: { name: spec.name },
        })
        .returning();
      await db.execute(
        sql`insert into asset_devices("assetId","deviceId",protocol,"tagMappings") select ${asset.id},${device.id},'simulator','[]'::jsonb where not exists(select 1 from asset_devices where "assetId"=${asset.id} and "deviceId"=${device.id})`,
      );
      if (spec.route === "gateway")
        await db.execute(
          sql`insert into asset_devices("assetId","deviceId",protocol,"tagMappings") select ${asset.id},${gateway.id},'simulator','[]'::jsonb where not exists(select 1 from asset_devices where "assetId"=${asset.id} and "deviceId"=${gateway.id})`,
        );
    }
    created.push({ ...spec, id: device.id });
    for (let n = 0; n <= 60; n++) {
      if (n >= 24 && n <= 29) continue;
      await ingestTelemetryByDeviceId({
        deviceId: spec.deviceId,
        gatewayId: spec.route === "gateway" ? gateway.deviceId : undefined,
        assetId: spec.assetId,
        timestamp: anchor - 3600000 + n * 60000,
        temperature:
          spec.deviceId === ids[0]
            ? n === 60
              ? 82
              : 48 + n * 0.14
            : 23 + Math.sin(n / 5),
        humidity: 46 + Math.sin(n / 4) * 3,
        power: spec.deviceId === ids[0] ? 1.8 + Math.sin(n / 7) * 0.2 : 0.7,
        pressure: 6.3 + Math.sin(n / 9) * 0.1,
        vibration: 2.1 + Math.sin(n / 8) * 0.2,
        rpm: 1450 + Math.sin(n / 6) * 8,
        units: {
          temperature: "Cel",
          humidity: "%",
          power: "kW",
          pressure: "bar",
          vibration: "mm/s",
          rpm: "rpm",
        },
        integration: {
          mode: "simulated",
          scenarioRunId: run.id,
          sessionId: uuid(spec.deviceId),
          sequence: n,
          sourceQuality:
            spec.deviceId === ids[2] && n === 60 ? "uncertain" : "good",
          sourceConnection: "online",
          gatewayReceivedAt: base.anchor,
        },
      });
    }
    await ingestTelemetryByDeviceId({
      deviceId: spec.deviceId,
      gatewayId: spec.route === "gateway" ? gateway.deviceId : undefined,
      assetId: spec.assetId,
      timestamp: anchor - 7200000,
      temperature: 18,
      units: { temperature: "Cel" },
      integration: {
        mode: "replay",
        replayRunId: uuid("historical-replay"),
        sourceQuality: "good",
        sourceConnection: "offline",
        gatewayReceivedAt: base.anchor,
      },
    });
  }
  // Explicit component associations use the template's compatible metric bindings.
  for (let n = 0; n <= 60; n++) {
    if (n >= 24 && n <= 29) continue;
    await ingestTelemetryByDeviceId({
      deviceId: gateway.deviceId,
      gatewayId: gateway.deviceId,
      assetId: standalone.assetId,
      timestamp: anchor - 3600000 + n * 60000,
      temperature: 36 + Math.sin(n / 8),
      pressure: 2.1,
      rpm: 1450,
      vibration: 1.2,
      units: {
        temperature: "Cel",
        pressure: "bar",
        rpm: "rpm",
        vibration: "mm/s",
      },
      integration: {
        mode: "simulated",
        scenarioRunId: standaloneRun,
        sessionId: standaloneRun,
        sequence: n,
        sourceQuality: "good",
        sourceConnection: "online",
        gatewayReceivedAt: base.anchor,
      },
    });
  }
  await db
    .update(devices)
    .set({ name: "Showcase gateway 01" })
    .where(eq(devices.id, gateway.id));
  const motor = created[0];
  for (const d of [gateway, motor]) {
    const old = await db
      .select()
      .from(alertThresholds)
      .where(eq(alertThresholds.deviceId, d.id));
    if (!old.length)
      await db.insert(alertThresholds).values({
        deviceId: d.id,
        metric: "temperature",
        unit: "°C",
        warningMax: 80,
        maxValue: 90,
      });
  }
  const incidents = [base.incidentId];
  for (const [n, status] of (["acknowledged", "resolved"] as const).entries()) {
    const evidence = {
      readingId: 0,
      occurredAt: anchor - 1800000,
      receivedAt: base.anchor,
      sourceDeviceId: motor.deviceId,
      gatewayId: gateway.deviceId,
      mode: "simulated",
      quality: "good",
      metric: "temperature",
      value: 82,
      threshold: 80,
      unit: "°C",
    };
    const [reading] = await db.execute<{ id: number; measurements: any }>(
      sql`select id,measurements from sensor_readings where "deviceId"=${motor.id} and integration->>'mode'='simulated' order by timestamp desc limit 1`,
    );
    evidence.readingId = Number(reading.id);
    const message = `Authored ${status} simulation: motor temperature review`;
    let [incident] = await db
      .select()
      .from(alerts)
      .where(eq(alerts.message, message));
    if (!incident)
      [incident] = await db
        .insert(alerts)
        .values({
          deviceId: motor.id,
          assetId: motor.assetId,
          type: "threshold_exceeded",
          severity: n ? "info" : "critical",
          status,
          metric: "temperature",
          value: 82,
          threshold: 80,
          message,
          errorCode: "SF-THR-TEMP-WARN",
          evidenceSnapshot: {
            ...evidence,
            measurement: reading.measurements.temperature,
          },
          latestEvidenceSnapshot: {
            ...evidence,
            measurement: reading.measurements.temperature,
          },
          createdAt: at(-1800000),
          lastObservedAt: at(-1500000),
          acknowledgedBy: actor.id,
          acknowledgedAt: at(-1400000),
          resolvedAt: n ? at(-300000) : null,
          resolvedById: n ? actor.id : null,
          occurrences: 3,
        })
        .returning();
    incidents.push(incident.id);
    const old = await db.execute(
      sql`select 1 from incident_activity where alert_id=${incident.id} limit 1`,
    );
    if (!old.length)
      for (const [kind, offset, text] of [
        [
          "note",
          -1200000,
          "Authored simulation: inspect the trend and source quality; no physical cause established.",
        ],
        ["acknowledged", -1400000, "Simulation review acknowledged."],
        ...(n
          ? [
              [
                "resolved",
                -300000,
                "Authored resolved workflow example; no physical repair asserted.",
              ],
            ]
          : []),
      ] as const)
        await db.execute(
          sql`insert into incident_activity(alert_id,actor_id,kind,detail,created_at) values(${incident.id},${actor.id},${kind},${JSON.stringify({ text })}::jsonb,${at(offset).toISOString()}::timestamptz)`,
        );
  }
  const [storedPump] = await db.execute<{
    components: Array<{ name: string; installedComponentId: string }>;
  }>(
    sql`select components from equipment_workspaces where id=${base.equipmentId} and is_demo=true`,
  );
  const components = storedPump.components,
    selected =
      components.find((c) => c.name.toLowerCase().includes("terminal")) ??
      components.find((c) => c.name.toLowerCase().includes("motor"))!;
  const views = [
    {
      id: uuid("assembled-view"),
      name: "Assembled overview",
      eye: [2, 1.4, 2],
      target: [0, 0, 0],
      viewer: {
        explode: 0,
        scope: null,
        section: "off" as const,
        cut: 50,
        flip: false,
        ghost: false,
        covers: false,
        guides: true,
        hidden: [],
        isolated: null,
        selected: null,
      },
    },
    {
      id: uuid("internal-view"),
      name: "Internal inspection",
      eye: [1.5, 1, 1.8],
      target: [0, 0, 0],
      viewer: {
        explode: 35,
        scope: null,
        section: "Z" as const,
        cut: 50,
        flip: false,
        ghost: true,
        covers: false,
        guides: true,
        hidden: [],
        isolated: null,
        selected: selected.installedComponentId,
      },
    },
  ];
  workSchema.parse({
    id: base.equipmentId,
    expectedVersion: 1,
    selectedComponent: null,
    annotations: [],
    viewpoints: views,
  });
  await db.execute(
    sql`update equipment_workspaces set viewpoints=${JSON.stringify(views)}::jsonb,annotations=${JSON.stringify([{ id: uuid("inspection-note"), componentId: selected.installedComponentId, text: "Illustrative inspection point. Linked simulated configuration evidence does not establish physical damage." }])}::jsonb where id=${base.equipmentId} and is_demo=true`,
  );
  const sourceId = uuid("mapped-security"),
    namespace = "smart-factory-showcase-components",
    target = { kind: "asset", id: pump.id };
  await securityTransaction(async (tx) => {
    await tx.execute(
      sql`insert into security_sources(id,name,namespace,system_key,is_demo,policy) values(${sourceId},'Showcase component evidence',${namespace},'showcase-components-v2',true,${JSON.stringify({ targets: [target], modes: ["simulated"], types: ownedEventTypes, connections: [], inputs: [], expectedIntervalSeconds: 0 })}::jsonb) on conflict(id) do nothing`,
    );
    await tx.execute(
      sql`insert into security_mappings(id,source_id,namespace,asset_ref,component_ref,target,installed_component_id,reviewed_by) values(${uuid("component-mapping")},${sourceId},${namespace},${base.assetId},'terminal-configuration',${JSON.stringify(target)}::jsonb,${selected.installedComponentId},${actor.id}) on conflict(source_id,namespace,asset_ref,component_ref) do nothing`,
    );
    await ingestInTransaction(
      tx,
      sourceId,
      [
        ownedEnvelope.parse({
          schemaVersion: "ot-security-evidence/v1",
          producerNamespace: namespace,
          sourceEventId: "showcase-integrity-001",
          occurredAt: at(-60000).toISOString(),
          mode: "simulated",
          scenarioRunId: "showcase-components-v2",
          eventType: "integrity.change_observed",
          assetRef: {
            namespace,
            assetId: base.assetId,
            componentId: "terminal-configuration",
          },
          summary:
            "Authored simulation: configuration integrity change at the mapped terminal inspection point. No physical attack is asserted.",
          quality: "good",
          producerVersion: "showcase-2",
          attributes: {
            previousSha256: "a".repeat(64),
            currentSha256: "b".repeat(64),
            evidenceBasis: "self_reported",
          },
        }),
      ],
      target,
    );
    await audit(
      tx,
      "showcase_component_mapping_authored",
      actor.id,
      { basis: "explicit synthetic fixture association; no live approval" },
      null,
      sourceId,
    );
  });
  const [finding] = await db.execute<{ id: string }>(
    sql`select id from security_findings where source_id=${sourceId} order by last_seen desc limit 1`,
  );
  if (finding)
    await securityTransaction((tx) =>
      audit(
        tx,
        "note_added",
        actor.id,
        {
          reason:
            "Authored investigation: compare supplied hashes and the mapped inspection point. This simulated evidence does not establish an intrusion or compliance.",
        },
        finding.id,
        sourceId,
      ),
    );
  const passportId = uuid("public-passport");
  await db.execute(
    sql`insert into asset_passport_publications(id,asset_id,document,published_by,published_at) values(${passportId},${pump.id},${JSON.stringify(
      {
        title: "Showcase pump 01 · simulated product passport",
        publicId: passportId,
        publishedAt: base.anchor,
        fields: [
          { key: "name", label: "Name", value: pump.name },
          { key: "model", label: "Model", value: "Illustrative pump/motor" },
          {
            key: "manufacturer",
            label: "Manufacturer",
            value: "Synthetic example manufacturer",
          },
        ],
        reviewedGuidance: null,
        disclaimer: PASSPORT_DISCLAIMER,
      },
    )}::jsonb,${actor.id},${base.anchor}::timestamptz) on conflict(id) do nothing`,
  );
  const full: Showcase = {
    ...base,
    version: 2,
    standaloneRef: `equipment:${standaloneId}`,
    securityFindingId: finding?.id,
    passportId,
    firmware: [
      {
        id: -201,
        version: "SIM-2.0.0",
        deviceType: "gateway",
        releaseNotes:
          "Synthetic release catalog example. No binary is supplied; OTA delivery remains disabled.",
        isStable: false,
        artifactAvailable: false,
        createdAt: base.anchor,
      },
    ],
    rollouts: [
      {
        id: -201,
        deviceId: gateway.id,
        firmwareVersionId: -201,
        status: "simulation_not_delivered",
        errorMessage:
          "Authored history example: stopped before transfer. No device installation or rollback is asserted.",
        createdAt: base.anchor,
      },
    ],
    integrations: [
      {
        name: "MQTT gateway",
        state: "Recorded simulation",
        detail:
          "Explicit gateway and child source links; no live broker delivery asserted.",
        href: `/inventory/${base.gatewayRef}/connectivity`,
      },
      {
        name: "AAS engineering",
        state: "Authored shell",
        detail: "Synthetic manufacturer identity and submodels.",
        href: `/inventory/${base.assetRef}/aas`,
      },
      {
        name: "Onesa exchange",
        state: "Consumer required",
        detail:
          "Local native 3D works independently. External consumer acceptance needs a configured private installation.",
        href: `/inventory/${base.assetRef}/3d`,
      },
      {
        name: "Email notifications",
        state: "Not sent",
        detail: "Demonstration inbox only. No email request is queued.",
        href: "/notifications",
      },
    ],
    audit: [
      {
        at: base.anchor,
        action: "Demonstration authored",
        detail:
          "Read-only synthetic catalog; no factory settings or account roles changed.",
      },
      {
        at: at(-60000).toISOString(),
        action: "Component association recorded",
        detail:
          "Explicit synthetic equipment/component mapping retained with evidence.",
      },
    ],
  };
  full.chapters = [
    {
      title: "Equipment and AAS",
      description: "Identity, submodels and explicitly configured connections.",
      href: `/inventory/${base.assetRef}/overview`,
      state: "available",
    },
    {
      title: "Native 3D inspection",
      description:
        "87 components, explosion, sections, ghost housings and authored saved views.",
      href: `/inventory/${base.assetRef}/3d`,
      state: "available",
    },
    {
      title: "Standalone equipment",
      description: "Independent native workspace without an external twin.",
      href: `/inventory/equipment:${standaloneId}/3d`,
      state: "available",
    },
    {
      title: "Sensors and gateway",
      description:
        "Direct and gateway routes; uncertain quality, historical replay and canonical units.",
      href: `/inventory/${base.gatewayRef}/connected`,
      state: "available",
    },
    {
      title: "Observed analytics",
      description:
        "Six metrics, comparisons and an intentional missing-data interval.",
      href: `/analytics?scope=simulated&from=${base.from.slice(0, 16)}&to=${base.anchor.slice(0, 16)}`,
      state: "available",
    },
    {
      title: "Process investigations",
      description: "Active, acknowledged and resolved incident histories.",
      href: "/alerts?status=all",
      state: "available",
    },
    {
      title: "Security investigation",
      description:
        "Simulated evidence mapped to a specific installed component.",
      href: finding
        ? `/cybersecurity?finding=${finding.id}&mode=simulated`
        : "/cybersecurity?mode=simulated",
      state: "available",
    },
    {
      title: "Notification inbox",
      description: "Owner-scoped demonstration updates; email is not sent.",
      href: "/notifications",
      state: "available",
    },
    {
      title: "Product passport",
      description:
        "Explicitly published synthetic identity with reviewed field allowlist.",
      href: `/passport/published/${passportId}`,
      state: "available",
    },
    {
      title: "Firmware history",
      description:
        "Authored catalog and rollout history. Verified updater required for delivery.",
      href: "/ota",
      state: "prerequisite",
    },
    {
      title: "Administration",
      description:
        "Read-only access, integration and audit examples. Individual accounts manage private installations.",
      href: "/administration",
      state: "available",
    },
    {
      title: "Assistant and external actions",
      description:
        "Grounded local guidance. Physical controls, remote delivery and external consumer acceptance require commissioning.",
      href: "/assistant",
      state: "prerequisite",
    },
  ];
  await db
    .update(systemSettings)
    .set({ value: full })
    .where(eq(systemSettings.key, "showcase_v1"));
  await seedInboxes(full);
  return full;
}
async function seedInboxes(s: Showcase) {
  const db = (await getDb())!;
  const owners = await db.execute<{ id: number }>(
    sql`select id from users where email in(${sql.join(
      DEMO_ACCOUNTS.map((a) => sql`${a.email}`),
      sql`,`,
    )})`,
  );
  for (const user of owners)
    for (const [kind, alertId, securityFindingId, title] of [
      [
        "showcase_process",
        s.incidentId,
        null,
        "Simulated process incident ready for review",
      ],
      [
        "showcase_security",
        null,
        s.securityFindingId ?? null,
        "Simulated component evidence ready for investigation",
      ],
    ] as const) {
      if (!alertId && !securityFindingId) continue;
      const old = await db.execute(
        sql`select 1 from notification_inbox where "userId"=${user.id} and kind=${kind} limit 1`,
      );
      if (!old.length)
        await db.insert(notificationInbox).values({
          userId: user.id,
          kind,
          alertId,
          securityFindingId,
          title,
          body: "Authored read-only demonstration. Open the linked evidence; no physical condition or email delivery is asserted.",
          emailStatus: "demo_only",
          createdAt: new Date(s.anchor),
        });
    }
}

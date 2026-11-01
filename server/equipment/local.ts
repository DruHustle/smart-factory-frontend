import { evidenceSql } from "../evidenceScope";
import type { Measurements } from "../../shared/measurements";
/** App-owned equipment setup, state and history. No peer dependency. */
import { z } from "zod";
import {
  component,
  importedTemplate,
  importedBytes,
  localBindingSchema,
} from "./packages";
import { inspectGlb } from "./model-budget";
import { sql, eq } from "drizzle-orm";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDb, ingestTelemetryByDeviceId } from "../db";
import { assets, devices, assetDevices } from "../../drizzle/schema";
import { visibleRecordSql } from "../demoData";
import { factoryModels, referenceModels } from "../../shared/factory-models";
import { authoredAssets } from "../../shared/authored-assets";
import { buildDemoAasDocuments, demoAasIdentity } from "../../shared/demo-aas";
const root = new URL("../../fixtures/equipment/", import.meta.url);
const componentSchema = component.extend({ installedComponentId: z.uuid() });
const viewerStateSchema = z
  .object({
    opacity: z.number().min(0.05).max(1).optional(),
    labels: z.boolean().optional(),
    immediate: z.boolean().optional(),
    explode: z.number().min(0).max(100),
    scope: z.uuid().nullable(),
    section: z.enum(["off", "X", "Y", "Z"]),
    cut: z.number().min(0).max(100),
    flip: z.boolean(),
    ghost: z.boolean(),
    covers: z.boolean(),
    guides: z.boolean(),
    hidden: z.array(z.uuid()).max(128),
    isolated: z.uuid().nullable(),
    selected: z.uuid().nullable(),
  })
  .strict();
export const workSchema = z
  .object({
    id: z.uuid(),
    expectedVersion: z.number().int().positive(),
    selectedComponent: z.uuid().nullable(),
    annotations: z
      .array(
        z
          .object({
            id: z.uuid(),
            componentId: z.uuid(),
            text: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .max(100),
    viewpoints: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().trim().min(1).max(80),
            viewer: viewerStateSchema.optional(),
            eye: z.array(z.number().finite().min(-1000).max(1000)).length(3),
            target: z.array(z.number().finite().min(-1000).max(1000)).length(3),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export async function database() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db;
}
async function query<T = Record<string, unknown>>(q: ReturnType<typeof sql>) {
  return (await (await database()).execute(q)) as unknown as T[];
}
export type LocalTemplate = {
  name?: string;
  assetType?: string;
  assetTypeId?: string;
  initialViewDirection?: [number, number, number];
  revision: string;
  status: string;
  sha256: string;
  components: Array<
    Omit<z.infer<typeof componentSchema>, "installedComponentId">
  >;
  bindings: z.infer<typeof localBindingSchema>[];
} & { maintenanceText?: string | null };
export const raspberryPiRevision =
  "smart-factory-illustrative-raspberry-pi-4b-1";
export async function bundledModelCatalog() {
  const models = await Promise.all(
    referenceModels.map((model) => template(model.revision)),
  );
  return models.map((m) => ({
    revision: m.revision,
    name: m.name ?? "Illustrative pump and motor",
  }));
}
export async function template(revision?: string) {
  const authored = authoredAssets.find(
    (asset) => asset.models.compact.revision === revision,
  );
  if (authored) {
    const model = authored.models.compact;
    return {
      ...model.manifest,
      revision: model.revision,
      sha256: model.sha256,
      assetType: authored.assetType,
      assetTypeId: `urn:smart-factory:type:${authored.slug}-illustrative`,
      status:
        "Original Blender illustrative reference; not manufacturer CAD or an installed-asset attestation",
    } as LocalTemplate;
  }
  const factory = factoryModels.find(
    (model) => revision === `smart-factory-illustrative-${model.slug}-1`,
  );
  if (factory)
    return JSON.parse(
      await readFile(
        new URL(`factory/${factory.slug}/template.json`, root),
        "utf8",
      ),
    ) as LocalTemplate;
  if (revision === raspberryPiRevision)
    return JSON.parse(
      await readFile(new URL("raspberry-pi-4b/template.json", root), "utf8"),
    ) as LocalTemplate;
  if (
    [
      "smart-factory-illustrative-pump-motor-1",
      "smart-factory-illustrative-pump-motor-2",
      "smart-factory-illustrative-pump-motor-3",
    ].includes(revision ?? "")
  )
    return JSON.parse(
      await readFile(
        new URL(`revisions/${revision!.split("-").at(-1)}/template.json`, root),
        "utf8",
      ),
    ) as LocalTemplate;
  if (revision?.startsWith("local-import:"))
    return importedTemplate(revision) as Promise<LocalTemplate>;
  const m = JSON.parse(
    await readFile(new URL("local-template.json", root), "utf8"),
  );
  if (revision && revision !== m.revision)
    throw new Error("Unsupported model revision");
  return m as LocalTemplate;
}
export async function createEquipment(
  input: {
    name: string;
    serialNumber: string;
    kind: "real" | "simulated";
    templateRevision: string;
    existingAssetId?: number;
    sourceBindings?: z.infer<typeof localBindingSchema>[];
    zone?: string;
  },
  actor: number,
  fixed?: {
    id: string;
    assetId: string;
    components: string[];
    isDemo: boolean;
  },
) {
  const t = await template(input.templateRevision);
  if (input.templateRevision !== t.revision)
    throw new Error("Unsupported template revision");
  await modelBytes(t.revision);
  const db = await database();
  const id = fixed?.id ?? randomUUID(),
    externalAssetId = fixed?.assetId ?? "urn:smart-factory:equipment:" + id;
  const demoIdentity = fixed?.isDemo
    ? demoAasIdentity({
        assetId: externalAssetId,
        name: input.name,
        assetType:
          t.assetType ??
          (t.revision === raspberryPiRevision
            ? "gateway"
            : t.revision.startsWith("local-import:")
              ? "other"
              : "pump"),
        model: t.name,
        serialNumber: input.serialNumber,
        zone: input.zone,
      })
    : undefined;
  const demoAas = demoIdentity
    ? buildDemoAasDocuments(demoIdentity)
    : undefined;
  if (
    input.existingAssetId &&
    (!input.sourceBindings?.length ||
      input.sourceBindings.some(
        (b) =>
          !t.components.some(
            (c) => c.templateComponentId === b.templateComponentId,
          ),
      ))
  )
    throw new Error("Explicit compatible source metric bindings are required");
  const bindings =
    input.sourceBindings ?? (input.kind === "simulated" ? t.bindings : []);
  if (new Set(bindings.map((b) => b.sourceKey)).size !== bindings.length)
    throw new Error("Ambiguous source metric bindings");
  const components = t.components.map((c, index) => ({
    ...c,
    installedComponentId: fixed?.components[index] ?? randomUUID(),
  }));
  return db.transaction(async (tx) => {
    const [existing] = await tx.execute(
      sql`select id from equipment_workspaces where id=${id}`,
    );
    if (existing) return { id };
    // No remote AAS service or peer account is required to create local equipment.
    const [existingAsset] = input.existingAssetId
      ? await tx
          .select()
          .from(assets)
          .where(eq(assets.id, input.existingAssetId))
      : [];
    if (
      input.existingAssetId &&
      (!existingAsset || existingAsset.isDemo || input.kind !== "real")
    )
      throw new Error("Select a registered real asset for acquisition binding");
    const [asset] = existingAsset
      ? [existingAsset]
      : await tx
          .insert(assets)
          .values({
            assetId: externalAssetId,
            name: input.name,
            assetType:
              t.assetType ??
              (t.revision === raspberryPiRevision
                ? "gateway"
                : t.revision.startsWith("local-import:")
                  ? "other"
                  : "pump"),
            serialNumber: input.serialNumber,
            model:
              t.name ??
              (t.revision === raspberryPiRevision
                ? "Raspberry Pi 4 Model B · illustrative"
                : t.revision.startsWith("local-import:")
                  ? "Locally imported model"
                  : "Illustrative pump/motor"),
            isDemo: fixed?.isDemo ?? false,
            aasShell: demoAas?.shell ?? {
              modelType: "AssetAdministrationShell",
              id: "urn:smart-factory:aas:" + id,
              assetInformation: {
                assetKind: "Instance",
                globalAssetId: externalAssetId,
                assetType:
                  t.assetTypeId ??
                  (t.revision === raspberryPiRevision
                    ? "urn:smart-factory:type:raspberry-pi-4b-illustrative"
                    : t.revision.startsWith("local-import:")
                      ? "urn:smart-factory:type:unspecified"
                      : "urn:smart-factory:type:pump-motor-v1"),
              },
            },
            ...(demoIdentity && demoAas
              ? {
                  ...demoIdentity,
                  aasSubmodels: demoAas.submodels,
                  aasConceptDescriptions: demoAas.conceptDescriptions,
                }
              : {}),
          })
          .onConflictDoUpdate({
            target: assets.assetId,
            set: { name: input.name },
          })
          .returning();
    await tx.execute(
      sql`insert into equipment_workspaces (id,asset_id,template_revision,components,kind,is_demo,updated_by,source_device_id,bindings,is_standalone) values (${id},${asset.id},${t.revision},${JSON.stringify(components)}::jsonb,${input.kind},${fixed?.isDemo ?? false},${actor},${input.kind === "simulated" ? (fixed?.isDemo ? "smart-factory-public-simulator" : "local-sim-" + id) : null},${JSON.stringify(bindings)}::jsonb,${!input.existingAssetId})`,
    );
    if (input.kind === "simulated") {
      const sourceDeviceId = fixed?.isDemo
        ? "smart-factory-public-simulator"
        : "local-sim-" + id;
      const [createdDevice] = await tx
        .insert(devices)
        .values({
          deviceId: sourceDeviceId,
          name: "Local equipment simulator",
          type: "gateway",
          isDemo: fixed?.isDemo ?? false,
          status: "offline",
          metadata: {
            connectionMode: "gateway",
            commissioning: {
              route: "direct",
              revision: 1,
              maxLatenessSeconds: 120,
              clockSkewSeconds: 30,
              legacyCurrent: false,
              legacyUnits: {},
              reviewedAt: new Date().toISOString(),
              reviewedBy: actor,
            },
          },
        })
        .onConflictDoNothing({
          target: devices.deviceId,
        })
        .returning();
      const [device] = createdDevice
        ? [createdDevice]
        : await tx
            .select()
            .from(devices)
            .where(eq(devices.deviceId, sourceDeviceId));
      if (!device || device.isDemo !== (fixed?.isDemo ?? false))
        throw new Error(
          "Simulation source identity is already in use outside this scope",
        );
      await tx.insert(assetDevices).values({
        assetId: asset.id,
        deviceId: device.id,
        protocol: "simulator",
        tagMappings: [],
      });
    }
    return { id };
  });
}
export async function listEquipment() {
  return query<{
    id: string;
    name: string;
    serialNumber: string;
    kind: string;
    is_demo: boolean;
    version: number;
  }>(
    sql`select w.id,a.name,a."serialNumber",w.kind,w.is_demo,w.version from equipment_workspaces w join assets a on a.id=w.asset_id where ${visibleRecordSql(sql`w.is_demo`)} order by a.name`,
  );
}
export async function workspace(id: string, mode?: "live" | "simulated") {
  const [w] = await query(
    sql`select w.*,a.name,a."assetId" as external_asset_id,a."serialNumber" as serial_number from equipment_workspaces w join assets a on a.id=w.asset_id where w.id=${id} and ${visibleRecordSql(sql`w.is_demo`)}`,
  );
  if (!w) throw new Error("Equipment not found");
  const components = z.array(componentSchema).parse(w.components);
  let t: LocalTemplate,
    modelMetadataAvailable = true;
  try {
    t = await template(w.template_revision as string);
    if (w.template_revision !== t.revision)
      throw new Error("Model revision mismatch");
  } catch {
    modelMetadataAvailable = false;
    t = {
      revision: w.template_revision as string,
      status: "Missing model metadata",
      sha256: "",
      components: components.map(({ installedComponentId, ...c }) => c),
      bindings: w.bindings ? z.array(localBindingSchema).parse(w.bindings) : [],
      maintenanceText: null,
    };
  }
  const history = await query<{
    id: number;
    timestamp: string;
    integration: Record<string, unknown> | null;
    measurements: Measurements | null;
    temperature: number | null;
    pressure: number | null;
    rpm: number | null;
    vibration: number | null;
  }>(
    sql`select id,timestamp,integration,measurements,temperature,pressure,rpm,vibration from sensor_readings where exists(select 1 from devices visible_source where visible_source.id=sensor_readings."deviceId" and ${visibleRecordSql(sql`visible_source."isDemo"`)}) and "assetId"=${w.external_asset_id as string} order by "createdAt" desc,id desc limit 100`,
  );
  const [run] = await query(
    sql`select id,scenario from equipment_scenario_runs where equipment_id=${id} order by started_at desc,id desc limit 1`,
  );
  const stream = mode ?? (w.kind === "real" ? "live" : "simulated");
  // Apply mode/run scope in SQL before selecting a latest observation; history remains separately bounded.
  const [selected] = await query<(typeof history)[number]>(
    sql`select id,timestamp,integration,measurements,temperature,pressure,rpm,vibration from sensor_readings where exists(select 1 from devices visible_source where visible_source.id=sensor_readings."deviceId" and ${visibleRecordSql(sql`visible_source."isDemo"`)}) and "assetId"=${w.external_asset_id as string} and ${evidenceSql(stream)} and timestamp<=${Date.now()} and (${stream !== "simulated" || !run} or integration->>'scenarioRunId'=${run?.id ?? ""}) order by timestamp desc,id desc limit 1`,
  );
  const observations = (sample: (typeof history)[number] | undefined) => {
    const bindings = w.bindings
      ? z.array(localBindingSchema).parse(w.bindings)
      : t.bindings;
    return bindings.map(
      ({
        sourceKey: key,
        templateComponentId,
        unit,
        sourceUnit,
        expectedIntervalMs,
      }) => {
        const component = components.find(
          (c) => c.templateComponentId === templateComponentId,
        );
        if (!component)
          throw new Error("Missing explicit metric/component binding");
        const measurement = sample?.measurements?.[key];
        const aliases: Record<string, string> = {
          Cel: "°C",
          C: "°C",
          "1/min": "rpm",
          "r/min": "rpm",
        };
        const sameUnit = (
          a: string | undefined | null,
          b: string | undefined | null,
        ) => !!a && !!b && (aliases[a] ?? a) === (aliases[b] ?? b);
        const sourceVerified =
          !!measurement &&
          measurement.conversionVersion === "sf-units-v1" &&
          measurement.quality === "good" &&
          (!sourceUnit ||
            sameUnit(sourceUnit, measurement.sourceUnit) ||
            sameUnit(sourceUnit, measurement.canonicalUnit));
        const rawValue = sourceVerified ? measurement.canonicalValue : null;
        const factor =
          measurement?.canonicalUnit === "Pa" && unit === "bar"
            ? 0.00001
            : sameUnit(measurement?.canonicalUnit, unit)
              ? 1
              : null;
        const scaled =
          rawValue == null || factor == null ? null : rawValue * factor;
        const value =
          scaled == null || !Number.isFinite(scaled) ? null : scaled;
        const observed = sample ? Number(sample.timestamp) : null;
        return {
          componentId: component.installedComponentId,
          templateComponentId: component.templateComponentId,
          metric: key,
          unit,
          value,
          rawValue,
          sourceUnit: measurement?.canonicalUnit ?? null,
          originalValue: measurement?.sourceValue ?? sample?.[key] ?? null,
          originalUnit: measurement?.sourceUnit ?? null,
          unitVerified: sourceVerified && factor !== null,
          conversion:
            factor == null
              ? null
              : { factor, offset: 0, version: "sf-units-v1" },
          observedAt: observed ? new Date(observed).toISOString() : null,
          sourceQuality: sample?.integration?.sourceQuality ?? "unknown",
          alarmActive:
            Array.isArray(sample?.integration?.sourceEvents) &&
            sample!.integration!.sourceEvents.some(
              (event: any) =>
                event.componentId === component.installedComponentId &&
                event.state === "active",
            ),
          mode: sample?.integration?.mode ?? "unknown",
          scenarioRunId: sample?.integration?.scenarioRunId ?? null,
          replayRunId: sample?.integration?.replayRunId ?? null,
          freshness:
            value === null
              ? "unavailable"
              : sample?.integration?.sourceConnection === "offline"
                ? "disconnected"
                : Date.now() - observed! > expectedIntervalMs * 3
                  ? "stale"
                  : "fresh",
          expectedIntervalMs,
        };
      },
    );
  };
  return {
    id: w.id as string,
    name: w.name as string,
    serialNumber: w.serial_number as string,
    externalAssetId: w.external_asset_id as string,
    sourceDeviceId: (w.source_device_id ??
      "smart-factory-local-simulator") as string,
    stream,
    kind: w.kind as string,
    isDemo: Boolean(w.is_demo),
    version: Number(w.version),
    templateRevision: w.template_revision as string,
    components,
    selectedComponent: w.selected_component as string | null,
    annotations: w.annotations as z.infer<typeof workSchema>["annotations"],
    viewpoints: w.viewpoints as z.infer<typeof workSchema>["viewpoints"],
    observations: observations(selected),
    history: history.flatMap((h) => observations(h)),
    scenario: run?.scenario ?? null,
    modelUrl:
      "/api/equipment/" +
      id +
      "/model?revision=" +
      encodeURIComponent(t.revision),
    documentUrl:
      t.maintenanceText === null ? null : "/api/equipment/" + id + "/document",
    renderer: {
      available: modelMetadataAvailable,
      initialViewDirection: t.initialViewDirection,
      version: "smart-factory-local-three-1",
    },
  };
}
/** File delivery authorizes identity without computing telemetry/history again. */
export async function modelIdentity(id: string) {
  z.uuid().parse(id);
  const [row] = await query<{ template_revision: string }>(
    sql`select w.template_revision from equipment_workspaces w join assets a on a.id=w.asset_id where w.id=${id} and ${visibleRecordSql(sql`w.is_demo`)} and ${visibleRecordSql(sql`a."isDemo"`)}`,
  );
  if (!row) throw new Error("Equipment not found");
  return { templateRevision: row.template_revision };
}
export async function saveWork(
  input: z.infer<typeof workSchema>,
  actor: number,
) {
  const w = await workspace(input.id);
  if (w.isDemo) throw new Error("Public demonstration is read-only");
  const ids = new Set(w.components.map((c) => c.installedComponentId));
  if (
    (input.selectedComponent && !ids.has(input.selectedComponent)) ||
    input.annotations.some((a) => !ids.has(a.componentId)) ||
    input.viewpoints.some(
      (v) =>
        v.viewer &&
        [
          v.viewer.scope,
          v.viewer.isolated,
          v.viewer.selected,
          ...v.viewer.hidden,
        ].some((id) => id && !ids.has(id)),
    ) ||
    new Set(input.annotations.map((a) => a.id)).size !==
      input.annotations.length ||
    new Set(input.viewpoints.map((a) => a.id)).size !== input.viewpoints.length
  )
    throw new Error("Unknown or ambiguous component/work identity");
  const result = await query(
    sql`update equipment_workspaces set selected_component=${input.selectedComponent},annotations=${JSON.stringify(input.annotations)}::jsonb,viewpoints=${JSON.stringify(input.viewpoints)}::jsonb,version=version+1,updated_by=${actor} where id=${input.id} and version=${input.expectedVersion} returning version`,
  );
  if (!result.length) throw new Error("Workspace revision conflict");
  return { version: Number(result[0].version) };
}
export async function simulate(
  id: string,
  scenario: "normal" | "alarm" | "recovery" | "stale",
  actor: number,
  allowDemo = false,
) {
  const w = await workspace(id);
  if (w.kind !== "simulated" || (w.isDemo && !allowDemo))
    throw new Error(
      "Only an individually managed simulated instance can run scenarios",
    );
  const currentTemplate = await template(w.templateRevision);
  if (!currentTemplate.bindings.length)
    throw new Error(
      "This illustrative model has no configured simulation measurements.",
    );
  const alarmTemplateId = currentTemplate.bindings.find(
    (b) => b.sourceKey === "temperature",
  )?.templateComponentId;
  const alarmComponent = w.components.find(
    (c) => c.templateComponentId === alarmTemplateId,
  );
  const runId = randomUUID(),
    now = Date.now(),
    at = scenario === "stale" ? now - 120000 : now;
  const values =
    scenario === "alarm"
      ? { temperature: 90, pressure: 7, vibration: 9, rpm: 1450 }
      : scenario === "recovery"
        ? { temperature: 46, pressure: 2, vibration: 1, rpm: 1450 }
        : { temperature: 45, pressure: 2, vibration: 1, rpm: 1450 };
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`insert into equipment_scenario_runs (id,equipment_id,scenario) values (${runId},${id},${scenario})`,
    );
    await tx.execute(
      sql`update devices set metadata=coalesce(metadata::jsonb,'{}'::jsonb)||${JSON.stringify({ connectionMode: "gateway", commissioning: { route: "direct", revision: 1, maxLatenessSeconds: 120, clockSkewSeconds: 30, legacyCurrent: false, legacyUnits: {}, reviewedAt: new Date(now).toISOString(), reviewedBy: actor } })}::jsonb where "deviceId"=${w.sourceDeviceId} and "isDemo"=${w.isDemo}`,
    );

    await ingestTelemetryByDeviceId(
      {
        deviceId: w.sourceDeviceId,
        gatewayId: w.sourceDeviceId,
        assetId: w.externalAssetId,
        timestamp: at,
        ...values,
        units: {
          temperature: "Cel",
          pressure: "bar",
          vibration: "mm/s",
          rpm: "1/min",
        },
        integration: {
          sourceEvents:
            alarmComponent && (scenario === "alarm" || scenario === "recovery")
              ? [
                  {
                    id: runId + ":bearing-temperature",
                    origin: "source",
                    code: "simulated-bearing-temperature",
                    state: scenario === "alarm" ? "active" : "cleared",
                    componentId: alarmComponent!.installedComponentId,
                  },
                ]
              : [],
          mode: "simulated",
          scenarioRunId: runId,
          sessionId: runId,
          sequence: 0,
          sourceQuality: "good",
          sourceConnection: "online",
          timestampOrigin: "gateway",
          retained: scenario === "stale",
          gatewayReceivedAt: new Date(now).toISOString(),
        },
      },
      tx,
    );
  });
  return { runId, mode: "simulated", scenario };
}
export async function initializeLocalEquipmentDemos() {
  const regs = JSON.parse(
    await readFile(new URL("equipment.json", root), "utf8"),
  );
  const t = await template();
  for (const r of regs) {
    const demoId =
      "41a00000-0000-4000-8000-" +
      String(regs.indexOf(r) + 1).padStart(12, "0");
    const [exists] = await query(
      sql`select id from equipment_workspaces where id=${demoId}`,
    );
    if (exists) continue;
    const created = await createEquipment(
      {
        name: r.name,
        serialNumber: r.serialNumber,
        kind: "simulated",
        templateRevision: t.revision,
      },
      0,
      {
        id: demoId,
        assetId: "urn:smart-factory:local-demo:" + demoId,
        components: r.components.map(() => randomUUID()),
        isDemo: true,
      },
    );
    await simulate(created.id, "normal", 0, true);
  }
}

export async function modelBytes(revision: string) {
  const t = await template(revision);
  const authored = authoredAssets.find(
    (asset) => asset.models.compact.revision === revision,
  )?.models.compact;
  const factory = factoryModels.find(
    (model) => revision === `smart-factory-illustrative-${model.slug}-1`,
  );
  const bytes = revision.startsWith("local-import:")
    ? await importedBytes(revision)
    : authored
      ? await readFile(
          new URL(`../../client/public${authored.url}`, import.meta.url),
        )
      : await readFile(
          new URL(
            factory
              ? `factory/${factory.slug}/model.glb`
              : revision === raspberryPiRevision
                ? "raspberry-pi-4b/model.glb"
                : [
                      "smart-factory-illustrative-pump-motor-1",
                      "smart-factory-illustrative-pump-motor-2",
                      "smart-factory-illustrative-pump-motor-3",
                    ].includes(revision)
                  ? `revisions/${revision.split("-").at(-1)}/model.glb`
                  : "pump-motor.glb",
            root,
          ),
        );
  if (createHash("sha256").update(bytes).digest("hex") !== t.sha256)
    throw new Error("Model revision hash mismatch");
  inspectGlb(bytes);
  return bytes;
}
function stablePartId(equipment: string, part: string) {
  const h = createHash("sha256")
    .update(equipment + ":" + part)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function modelChange(
  id: string,
  revision: string,
  expectedVersion: number,
) {
  const w = await workspace(id);
  if (w.isDemo) throw new Error("Demonstration model is read-only");
  if (w.version !== expectedVersion) throw new Error("Model revision conflict");
  const t = await template(revision);
  await modelBytes(revision);
  if (
    w.components.some(
      (old) =>
        !t.components.some(
          (c) => old.templateComponentId === c.templateComponentId,
        ),
    )
  )
    throw new Error(
      "Ambiguous replacement: preserve every stable template component ID and provide explicit per-revision scene mappings",
    );
  const components = t.components.map((c) => ({
    ...c,
    installedComponentId:
      w.components.find(
        (old) => old.templateComponentId === c.templateComponentId,
      )?.installedComponentId ?? stablePartId(id, c.templateComponentId),
  }));
  const token = createHash("sha256")
    .update(JSON.stringify([id, expectedVersion, revision, components]))
    .digest("hex");
  return {
    before: w.templateRevision,
    after: t.revision,
    components,
    reviewToken: token,
  };
}
export async function replaceModel(
  id: string,
  revision: string,
  expectedVersion: number,
  reviewToken: string,
  actor: number,
) {
  const p = await modelChange(id, revision, expectedVersion);
  if (p.reviewToken !== reviewToken)
    throw new Error("Model change must match the reviewed mapping");
  const r = await query(
    sql`update equipment_workspaces set template_revision=${revision},components=${JSON.stringify(p.components)}::jsonb,version=version+1,updated_by=${actor} where id=${id} and version=${expectedVersion} returning version`,
  );
  if (!r.length) throw new Error("Model revision conflict");
  return { version: Number(r[0].version) };
}

export async function renameEquipment(
  id: string,
  name: string,
  expectedVersion: number,
  actor: number,
) {
  const w = await workspace(id);
  if (w.isDemo) throw new Error("Demonstration is read-only");
  const db = await database();
  return db.transaction(async (tx) => {
    const r = await tx.execute(
      sql`update equipment_workspaces set version=version+1,updated_by=${actor} where id=${id} and version=${expectedVersion} returning asset_id`,
    );
    if (!r.length) throw new Error("Equipment revision conflict");
    await tx
      .update(assets)
      .set({ name })
      .where(eq(assets.id, Number(r[0].asset_id)));
    return { version: expectedVersion + 1 };
  });
}

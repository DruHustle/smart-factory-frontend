import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, stableJson } from "./db";
import {
  devices,
  assets,
  assetDevices,
  sensorReadings,
  alertThresholds,
  alerts,
} from "../drizzle/schema";
import { edgeTelemetrySchema } from "./telemetrySchema";
import {
  normalizeMeasurements,
  currentObservation,
  TelemetryPolicyError,
  type Commissioning,
} from "./observationPolicy";
import { evaluateAlertThreshold } from "../shared/alert-thresholds";
import { getAlertErrorCode } from "../shared/alert-codes";
import type { Metric } from "../shared/measurements";
import { capture, recordCaptureFailure } from "./onesa/store";
export type TelemetryInput = {
  deviceId: string;
  gatewayId?: string;
  assetId?: string | null;
  assetSignals?: Record<string, number>;
  sensorType?: string;
  sensorStatus?: "ok" | "read_error";
  ingestionId?: string;
  integration?: unknown;
  transportRetained?: boolean;
  units?: Partial<Record<Metric, string>>;
  mapping?: Partial<
    Record<Metric, import("../shared/measurements").MappingEvidence>
  >;
  temperature?: number | null;
  humidity?: number | null;
  vibration?: number | null;
  power?: number | null;
  pressure?: number | null;
  rpm?: number | null;
  timestamp: number;
};
export type IngestionTransaction = Parameters<
  Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
>[0];
export async function ingestTelemetryByDeviceId(
  raw: TelemetryInput,
  transaction?: IngestionTransaction,
) {
  const parsed = edgeTelemetrySchema.safeParse(raw);
  if (!parsed.success || raw.timestamp > Date.now() + 300_000)
    throw new TelemetryPolicyError("invalid_payload");
  const input = { ...parsed.data, timestamp: raw.timestamp };
  const canonicalInput = { ...input, ingestionId: undefined };
  if (canonicalInput.integration === undefined)
    delete canonicalInput.integration;
  if (canonicalInput.units === undefined) delete canonicalInput.units;
  if (canonicalInput.mapping === undefined) delete canonicalInput.mapping;
  delete canonicalInput.transportRetained; // Delivery metadata never changes an acquisition retry identity.
  const ingestionId =
    input.ingestionId ??
    createHash("sha256").update(stableJson(canonicalInput)).digest("hex");
  const receivedAt = new Date(),
    db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const persist = async (tx: IngestionTransaction) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.deviceId}))`,
    );
    const [device] = await tx
      .select()
      .from(devices)
      .where(eq(devices.deviceId, input.deviceId))
      .limit(1);
    const reject = async (reason: string) => {
      const fingerprint = createHash("sha256")
        .update(reason + stableJson(canonicalInput))
        .digest("hex");
      await tx.execute(
        sql`insert into ingestion_rejection_counters(reason,total) values(${reason},1) on conflict(reason) do update set total=ingestion_rejection_counters.total+1,last_received_at=now()`,
      );
      // Bound retained rejected payloads; counters continue even at capacity. Never delete operational evidence to make room.
      await tx.execute(sql`select pg_advisory_xact_lock(2026102704)`);
      await tx.execute(
        sql`insert into telemetry_rejections(fingerprint,device_id,reason,occurred_at,evidence) select ${fingerprint},${input.deviceId},${reason},${input.timestamp},${JSON.stringify(input)}::jsonb where (select count(*) from telemetry_rejections)<10000 or exists(select 1 from telemetry_rejections where fingerprint=${fingerprint}) on conflict(fingerprint) do update set occurrences=telemetry_rejections.occurrences+1,last_received_at=now()`,
      );
      return { rejection: reason };
    };
    if (!device) return reject("unknown_device");
    const [previous] = await tx
      .select({ deviceId: sensorReadings.deviceId })
      .from(sensorReadings)
      .where(eq(sensorReadings.ingestionId, ingestionId))
      .limit(1);
    if (previous)
      return previous.deviceId === device.id
        ? {
            deviceId: device.deviceId,
            receivedAt,
            occurredAt: new Date(input.timestamp),
            duplicate: true,
          }
        : reject("ingestion_identity_conflict");
    const policy = device.metadata?.commissioning as Commissioning | undefined;
    const configuredRoute =
      policy?.route ??
      (device.metadata?.connectionMode === "direct_mqtt"
        ? "direct"
        : device.metadata?.connectionMode === "gateway"
          ? device.type === "gateway"
            ? "direct"
            : "gateway"
          : "unconfigured");
    const gateway = policy?.gatewayId ?? device.metadata?.gatewayId;
    const matches =
      configuredRoute === "gateway"
        ? input.gatewayId === gateway
        : configuredRoute === "direct"
          ? device.type === "gateway"
            ? !input.gatewayId || input.gatewayId === device.deviceId
            : !input.gatewayId
          : false;
    if (!matches)
      return reject(
        configuredRoute === "unconfigured"
          ? "route_not_commissioned"
          : "route_mismatch",
      );
    let normalized: ReturnType<typeof normalizeMeasurements>;
    try {
      normalized = normalizeMeasurements(input, policy);
    } catch (error) {
      return reject(
        error instanceof TelemetryPolicyError
          ? error.code
          : "unsupported_or_incompatible_unit",
      );
    }
    let attributedAssetId = input.assetId ?? null;
    const publishingId =
      configuredRoute === "gateway" ? String(gateway) : device.deviceId;
    const publishingDevice =
      configuredRoute === "direct"
        ? device
        : (
            await tx
              .select({ id: devices.id, isDemo: devices.isDemo })
              .from(devices)
              .where(eq(devices.deviceId, publishingId))
              .limit(1)
          )[0];
    if (!publishingDevice || publishingDevice.isDemo !== device.isDemo)
      return reject("source_scope_mismatch");
    if (attributedAssetId) {
      const [link] = await tx
        .select({ id: assets.id })
        .from(assetDevices)
        .innerJoin(assets, eq(assets.id, assetDevices.assetId))
        .where(
          and(
            eq(assetDevices.deviceId, publishingDevice.id),
            eq(assets.assetId, attributedAssetId),
            eq(assets.isDemo, device.isDemo),
          ),
        )
        .limit(1);
      if (!link) return reject("asset_link_mismatch");
    } else if (configuredRoute === "direct") {
      const links = await tx
        .select({ assetId: assets.assetId })
        .from(assetDevices)
        .innerJoin(assets, eq(assets.id, assetDevices.assetId))
        .where(
          and(
            eq(assetDevices.deviceId, device.id),
            eq(assets.isDemo, device.isDemo),
          ),
        )
        .limit(2);
      attributedAssetId = links.length === 1 ? links[0].assetId : null;
    }
    if (attributedAssetId) {
      const [configuration] = await tx
        .select({
          connectionId: assetDevices.id,
          tagMappings: assetDevices.tagMappings,
          aasVersion: assets.aasVersion,
        })
        .from(assetDevices)
        .innerJoin(assets, eq(assets.id, assetDevices.assetId))
        .where(
          and(
            eq(assetDevices.deviceId, publishingDevice.id),
            eq(assets.assetId, attributedAssetId),
          ),
        )
        .limit(1);
      const aliases: Record<string, string> = {
        C: "Cel",
        "°C": "Cel",
        F: "°F",
        "r/min": "rpm",
        "1/min": "rpm",
      };
      for (const metric of [
        "temperature",
        "humidity",
        "vibration",
        "power",
        "pressure",
        "rpm",
      ] as Metric[]) {
        const context = input.mapping?.[metric],
          unit = input.units?.[metric];
        if (!context && !unit) continue;
        const configured =
          configuration?.tagMappings?.filter(
            (m: any) => String(m.metric).toLowerCase() === metric,
          ) ?? [];
        if (configured.length > 1)
          return reject("mapping_configuration_ambiguous");
        const expected = configured[0];
        if (
          expected &&
          unit &&
          (aliases[String(expected.unit)] ?? expected.unit) !==
            (aliases[unit] ?? unit)
        )
          return reject("unit_configuration_mismatch");
        if (
          expected &&
          unit &&
          (Number(expected.scale ?? 1) !== 1 ||
            Number(expected.offset ?? 0) !== 0) &&
          !context
        )
          return reject("mapping_evidence_missing");
        if (context) {
          if (
            !configuration ||
            !expected ||
            Number(expected.scale ?? 1) !== context.scale ||
            Number(expected.offset ?? 0) !== context.offset
          )
            return reject("mapping_configuration_mismatch");
          const measurement = normalized.measurements[metric];
          if (measurement)
            measurement.reviewedMapping = {
              connectionId: configuration.connectionId,
              aasVersion: configuration.aasVersion,
            };
        }
      }
    } else if (input.mapping && Object.keys(input.mapping).length)
      return reject("mapping_requires_reviewed_asset");
    const eligibility = currentObservation(
      input,
      policy,
      device.lastSeen?.getTime() ?? null,
      receivedAt.getTime(),
    );
    const operational = eligibility.eligible && !device.isDemo;
    const [inserted] = await tx
      .insert(sensorReadings)
      .values({
        deviceId: device.id,
        assetId: attributedAssetId,
        assetSignals: input.assetSignals ?? null,
        ingestionId,
        integration: {
          ...(input.integration ?? {}),
          mode:
            (input.integration as { mode?: string } | undefined)?.mode ??
            "unknown",
          evidence: eligibility,
          acquisition: {
            sensorType: input.sensorType ?? null,
            sensorStatus: input.sensorStatus ?? null,
          },
          observedRoute: {
            gatewayId: input.gatewayId ?? null,
            receivedAt: receivedAt.toISOString(),
            transportRetained: !!input.transportRetained,
          },
        },
        measurements: normalized.measurements,
        ...normalized.values,
        timestamp: input.timestamp,
      })
      .onConflictDoNothing({ target: sensorReadings.ingestionId })
      .returning({ id: sensorReadings.id });
    if (!inserted)
      return {
        deviceId: device.deviceId,
        receivedAt,
        occurredAt: new Date(input.timestamp),
        duplicate: true,
      };
    if (operational) {
      await tx
        .update(devices)
        .set({
          status: ["maintenance", "error"].includes(device.status)
            ? device.status
            : "online",
          lastSeen: new Date(input.timestamp),
          updatedAt: receivedAt,
          metadata: {
            ...device.metadata,
            observedRoute: {
              gatewayId: input.gatewayId ?? null,
              occurredAt: new Date(input.timestamp).toISOString(),
              receivedAt: receivedAt.toISOString(),
            },
            ...(input.sensorType ? { sensorType: input.sensorType } : {}),
            ...(input.sensorStatus ? { sensorStatus: input.sensorStatus } : {}),
          },
        })
        .where(eq(devices.id, device.id));
      if (attributedAssetId)
        await tx.execute(
          sql`update asset_devices set "lastSeen"=greatest("lastSeen",${new Date(input.timestamp).toISOString()}::timestamptz) where "deviceId"=${publishingDevice.id} and "assetId"=(select id from assets where "assetId"=${attributedAssetId})`,
        );
    }
    if (process.env.ONESA_ENABLED === "true" && !device.isDemo) {
      try {
        await tx.transaction((savepoint) =>
          capture(savepoint, {
            ...input,
            measurements: normalized.measurements,
            assetId: attributedAssetId,
            ingestionId,
          }),
        );
      } catch {
        recordCaptureFailure();
      }
    }
    if (operational) {
      const thresholds = await tx
        .select()
        .from(alertThresholds)
        .where(eq(alertThresholds.deviceId, device.id));
      for (const threshold of thresholds) {
        const metric = threshold.metric as Metric,
          measurement = normalized.measurements[metric],
          value = normalized.values[metric];
        if (
          !threshold.enabled ||
          !threshold.unit ||
          threshold.unit !== measurement?.canonicalUnit ||
          measurement.quality !== "good"
        )
          continue;
        const breach = evaluateAlertThreshold(value, threshold);
        if (!breach || value == null) continue;
        const [open] = await tx
          .select()
          .from(alerts)
          .where(
            and(
              eq(alerts.deviceId, device.id),
              attributedAssetId
                ? eq(alerts.assetId, attributedAssetId)
                : isNull(alerts.assetId),
              eq(alerts.metric, threshold.metric),
              inArray(alerts.status, ["active", "acknowledged"]),
            ),
          )
          .limit(1);
        const message = `${metric} reported ${value} ${threshold.unit} ${breach.direction} configured ${breach.severity} threshold ${breach.threshold}`;
        const errorCode = getAlertErrorCode({
          type: "threshold_exceeded",
          metric: threshold.metric,
          severity: breach.severity,
        });
        const evidence = {
          readingId: inserted.id,
          occurredAt: input.timestamp,
          receivedAt: receivedAt.toISOString(),
          sourceDeviceId: device.deviceId,
          gatewayId: input.gatewayId ?? null,
          mode: String(
            (input.integration as { mode?: string })?.mode ?? "unknown",
          ),
          quality: measurement.quality,
          metric,
          value,
          threshold: breach.threshold,
          unit: threshold.unit,
          measurement,
        };
        if (open) {
          const severity =
            open.severity === "critical" ? "critical" : breach.severity;
          await tx
            .update(alerts)
            .set({
              severity,
              value,
              threshold: breach.threshold,
              message,
              errorCode,
              latestEvidenceSnapshot: evidence,
              lastObservedAt: new Date(input.timestamp),
              occurrences: sql`${alerts.occurrences}+1`,
              updatedAt: receivedAt,
            })
            .where(eq(alerts.id, open.id));
        } else
          await tx.insert(alerts).values({
            deviceId: device.id,
            assetId: attributedAssetId,
            type: "threshold_exceeded",
            severity: breach.severity,
            metric,
            value,
            threshold: breach.threshold,
            message,
            errorCode,
            evidenceSnapshot: evidence,
            latestEvidenceSnapshot: evidence,
            lastObservedAt: new Date(input.timestamp),
            createdAt: new Date(input.timestamp),
            updatedAt: receivedAt,
          });
      }
    }
    return {
      deviceId: device.deviceId,
      receivedAt,
      occurredAt: new Date(input.timestamp),
      currentEligible: operational,
      currentReason: eligibility.reason,
    };
  };
  const outcome = transaction
    ? await persist(transaction)
    : await db.transaction(persist);
  if ("rejection" in outcome) throw new TelemetryPolicyError(outcome.rejection);
  return outcome;
}

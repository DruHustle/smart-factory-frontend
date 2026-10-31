import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb, type Device } from "../db";
import type { ApplicationDatabase } from "../database-scope";
import type { IngestionTransaction, TelemetryInput } from "../ingestion";
import {
  industrialConfigurationSchema,
  connectivityObservationSchema,
  type IndustrialConfiguration,
  type IndustrialConnection,
  type ConnectivityObservation,
} from "../../shared/industrial-connectivity";
import {
  publishIndustrialConfiguration,
  publishConnectivityProbe,
} from "../aasProvisioningClient";

type Publication = {
  requestId: string;
  configuration: IndustrialConfiguration;
  startedAt: number;
  status: "pending" | "unconfirmed";
};
type Stored = {
  revision: string | number;
  configuration: IndustrialConfiguration | null;
  published_configuration: IndustrialConfiguration | null;
  pending_publication: Publication | null;
  published_revision: string | number | null;
  published_at: Date | string | null;
  reported_revision: string | number | null;
  last_received_at: Date | string | null;
  last_error: string | null;
  pending_probe: Probe | null;
  probe_result: ConnectivityObservation | null;
};
type Probe = {
  commandId: string;
  expiresAt: number;
  connection: IndustrialConnection;
  status: "pending" | "published" | "failed" | "unconfirmed";
};
const iso = (v: Date | string | null | undefined) =>
  v ? new Date(v).toISOString() : null;
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Connectivity storage is unavailable.",
    });
  return db;
}
async function gateway(db: ApplicationDatabase, id: string) {
  const [row] = await db.execute<{
    id: number;
    deviceId: string;
    name: string;
    metadata: Record<string, unknown> | null;
  }>(
    sql`select id,"deviceId",name,metadata from devices where "deviceId"=${id} and type='gateway' and "isDemo"=false`,
  );
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Select a registered operational gateway.",
    });
  return row;
}
const lock = (db: ApplicationDatabase, id: number) =>
  db.execute(sql`select pg_advisory_xact_lock(20261031,${id})`);
async function state(db: ApplicationDatabase, id: number) {
  return (
    await db.execute<Stored>(
      sql`select * from industrial_gateway_configurations where gateway_id=${id}`,
    )
  )[0];
}
async function assetBindings(db: ApplicationDatabase, gatewayId: number) {
  return [
    ...(await db.execute<{ assetId: string; name: string }>(
      sql`select distinct a."assetId",a.name from assets a join asset_devices ad on ad."assetId"=a.id where ad."deviceId"=${gatewayId} and a."isDemo"=false order by a.name limit 500`,
    )),
  ];
}
async function validateBindings(
  db: ApplicationDatabase,
  id: number,
  connections: IndustrialConnection[],
) {
  const linked = new Set((await assetBindings(db, id)).map((a) => a.assetId));
  if (
    connections.some((c) =>
      c.tags.some((t) => t.assetId && !linked.has(t.assetId)),
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Bind tags only to operational assets already linked to this gateway.",
    });
}
export async function listConnectivityGateways() {
  const db = await database();
  return [
    ...(await db.execute<{
      gatewayDeviceId: string;
      name: string;
      status: string;
    }>(
      sql`select "deviceId" as "gatewayDeviceId",name,status from devices where type='gateway' and "isDemo"=false order by name,id limit 200`,
    )),
  ];
}
export async function getConnectivity(
  gatewayDeviceId: string,
  canConfigure: boolean,
) {
  const db = await database(),
    g = await gateway(db, gatewayDeviceId),
    row = await state(db, g.id);
  const current = Number(row?.revision ?? 0),
    active = Number(row?.published_revision ?? 0);
  const status = await db.execute<{ report: ConnectivityObservation }>(
    sql`select report from industrial_connection_latest where gateway_id=${g.id} and revision=${active} order by connection_id limit 16`,
  );
  const tags = await db.execute<{ report: ConnectivityObservation }>(
    sql`select report from industrial_tag_latest where gateway_id=${g.id} and revision=${active} order by connection_id,tag_id limit 1600`,
  );
  const observations = [...status, ...tags]
    .map((r) => connectivityObservationSchema.safeParse(r.report))
    .filter((r) => r.success)
    .map((r) => r.data!);
  const pending = row?.pending_probe;
  return {
    configuration: row?.configuration
      ? industrialConfigurationSchema.parse(row.configuration)
      : null,
    activeConfiguration: row?.published_configuration
      ? industrialConfigurationSchema.parse(row.published_configuration)
      : null,
    publication: row?.pending_publication
      ? {
          revision: row.pending_publication.configuration.revision,
          status: row.pending_publication.status,
          startedAt: row.pending_publication.startedAt,
        }
      : null,
    revision: current,
    reportedRevision:
      row?.reported_revision == null ? null : Number(row.reported_revision),
    publishedRevision:
      row?.published_revision == null ? null : Number(row.published_revision),
    publishedAt: iso(row?.published_at),
    lastReceivedAt: iso(row?.last_received_at),
    lastError: row?.last_error ?? null,
    observations,
    canConfigure,
    synthetic: false,
    assets: await assetBindings(db, g.id),
    probe: pending
      ? {
          commandId: pending.commandId,
          expiresAt: pending.expiresAt,
          connectionId: pending.connection.connectionId,
          status: row?.probe_result
            ? "completed"
            : pending.expiresAt < Date.now()
              ? "expired"
              : pending.status,
          ...(row?.probe_result ? { result: row.probe_result } : {}),
        }
      : null,
  };
}
export async function saveConnectivity(
  input: {
    gatewayDeviceId: string;
    expectedRevision: number;
    connections: IndustrialConnection[];
  },
  actor: number,
) {
  const db = await database(),
    g = await gateway(db, input.gatewayDeviceId);
  return db.transaction(async (tx) => {
    await lock(tx, g.id);
    const previous = await state(tx, g.id),
      next = Number(previous?.revision ?? 0) + 1;
    if (Number(previous?.revision ?? 0) !== input.expectedRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The gateway configuration changed. Reload before saving.",
      });
    const configuration = industrialConfigurationSchema.parse({
      schemaVersion: "industrial-connectivity/v1",
      gatewayDeviceId: input.gatewayDeviceId,
      revision: next,
      connections: input.connections,
    });
    await validateBindings(tx, g.id, configuration.connections);
    await tx.execute(
      sql`insert into industrial_gateway_configurations(gateway_id,revision,configuration,updated_by) values(${g.id},${next},${JSON.stringify(configuration)}::jsonb,${actor}) on conflict(gateway_id) do update set revision=excluded.revision,configuration=excluded.configuration,updated_by=excluded.updated_by,updated_at=now()`,
    );
    return { saved: true as const, revision: next };
  });
}
export async function publishConnectivity(
  gatewayDeviceId: string,
  expectedRevision: number,
) {
  const db = await database(),
    g = await gateway(db, gatewayDeviceId);
  const attempt = await db.transaction(async (tx) => {
    await lock(tx, g.id);
    const row = await state(tx, g.id);
    if (!row?.configuration || Number(row.revision) !== expectedRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Save and review the current configuration before applying it.",
      });
    await validateBindings(tx, g.id, row.configuration.connections);
    const policy = g.metadata?.commissioning as { route?: string } | undefined;
    if (policy?.route !== "direct")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Commission this gateway's direct telemetry route before applying connections.",
      });
    if (
      row.pending_publication?.status === "pending" &&
      Date.now() - row.pending_publication.startedAt < 20000
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Configuration delivery is already pending. Wait for its result before retrying.",
      });
    const pending: Publication = {
      requestId: randomUUID(),
      configuration: row.configuration,
      startedAt: Date.now(),
      status: "pending",
    };
    await tx.execute(
      sql`update industrial_gateway_configurations set pending_publication=${JSON.stringify(pending)}::jsonb where gateway_id=${g.id}`,
    );
    return pending;
  });
  let result: { published: boolean; reason?: string };
  try {
    result = await publishIndustrialConfiguration(attempt.configuration);
  } catch {
    result = { published: false, reason: "delivery_unconfirmed" };
  }
  await db.transaction(async (tx) => {
    await lock(tx, g.id);
    const row = await state(tx, g.id);
    if (row?.pending_publication?.requestId !== attempt.requestId) return;
    if (result.published)
      await tx.execute(
        sql`update industrial_gateway_configurations set published_revision=${expectedRevision},published_configuration=${JSON.stringify(attempt.configuration)}::jsonb,published_at=now(),pending_publication=null,last_error=null where gateway_id=${g.id}`,
      );
    else if (result.reason === "provisioner_not_configured")
      await tx.execute(
        sql`update industrial_gateway_configurations set pending_publication=null,last_error='provisioner_not_configured' where gateway_id=${g.id}`,
      );
    else
      await tx.execute(
        sql`update industrial_gateway_configurations set pending_publication=${JSON.stringify({ ...attempt, status: "unconfirmed" })}::jsonb,last_error='delivery_unconfirmed' where gateway_id=${g.id}`,
      );
  });
  return { ...result, revision: expectedRevision };
}
export async function probeConnectivity(
  input: {
    gatewayDeviceId: string;
    expectedRevision: number;
    connection: IndustrialConnection;
  },
  actor: number,
) {
  const db = await database(),
    g = await gateway(db, input.gatewayDeviceId);
  const pending = await db.transaction(async (tx) => {
    await lock(tx, g.id);
    const row = await state(tx, g.id);
    if (Number(row?.revision ?? 0) !== input.expectedRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Reload the current gateway configuration before testing.",
      });
    if (
      row?.pending_probe &&
      row.pending_probe.status !== "failed" &&
      row.pending_probe.expiresAt > Date.now() &&
      !row.probe_result
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "A gateway test is already pending. Wait for its result or expiry.",
      });
    if ((g.metadata?.commissioning as { route?: string })?.route !== "direct")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Commission the gateway telemetry route before testing a connection.",
      });
    await validateBindings(tx, g.id, [input.connection]);
    const commandId = randomUUID(),
      expiresAt = Date.now() + 60000;
    const pending: Probe = {
      commandId,
      expiresAt,
      connection: input.connection,
      status: "pending",
    };
    await tx.execute(
      sql`insert into industrial_gateway_configurations(gateway_id,pending_probe,updated_by) values(${g.id},${JSON.stringify(pending)}::jsonb,${actor}) on conflict(gateway_id) do update set pending_probe=excluded.pending_probe,probe_result=null`,
    );
    return pending;
  });
  let result: { published: boolean; reason?: string };
  try {
    result = await publishConnectivityProbe({
      gatewayDeviceId: input.gatewayDeviceId,
      commandId: pending.commandId,
      expiresAt: pending.expiresAt,
      connection: pending.connection,
    });
  } catch {
    result = { published: false, reason: "delivery_unconfirmed" };
  }
  pending.status = result.published
    ? "published"
    : result.reason === "provisioner_not_configured"
      ? "failed"
      : "unconfirmed";
  await db.execute(
    sql`update industrial_gateway_configurations set pending_probe=${JSON.stringify(pending)}::jsonb where gateway_id=${g.id} and pending_probe->>'commandId'=${pending.commandId}`,
  );
  return {
    commandId: pending.commandId,
    expiresAt: pending.expiresAt,
    published: result.published,
    reason: result.reason,
  };
}

/** Called inside the existing ingestion transaction, after canonical gateway/route checks. */
export async function ingestConnectivity(
  tx: IngestionTransaction,
  device: Device,
  input: TelemetryInput,
  currentEligible: boolean,
) {
  const report = connectivityObservationSchema.parse(input.connectivity);
  if (
    device.type !== "gateway" ||
    device.isDemo ||
    input.assetId ||
    (input.gatewayId && input.gatewayId !== device.deviceId)
  )
    return { rejection: "connectivity_gateway_mismatch" };
  if (Math.abs(Date.parse(report.observedAt) - input.timestamp) > 1000)
    return { rejection: "connectivity_timestamp_mismatch" };
  await lock(tx, device.id);
  const row = await state(tx, device.id),
    mode = (input.integration as { mode?: string })?.mode;
  if (!row) return { rejection: "connectivity_not_configured" };
  const recent =
    input.transportRetainVerified === true &&
    !input.transportRetained &&
    !(input.integration as { retained?: boolean })?.retained &&
    Date.now() - input.timestamp <= 120000 &&
    input.timestamp <= Date.now() + 30000;
  // A retry of an acknowledged write stays idempotent after a later configuration change.
  const [existing] = await tx.execute<{ report: ConnectivityObservation }>(
    sql`select report from industrial_observation_history where gateway_id=${device.id} and event_id=${report.eventId}::uuid`,
  );
  if (existing) {
    const { stableJson } = await import("../db");
    if (stableJson(existing.report) !== stableJson(report))
      return { rejection: "connectivity_event_identity_conflict" };
    return { deviceId: device.deviceId, connectivity: true, duplicate: true };
  }
  const publication = row.pending_publication?.configuration;
  const fromAttempt = publication?.revision === report.configurationRevision;
  const active = fromAttempt
    ? publication
    : row.published_configuration?.revision === report.configurationRevision
      ? row.published_configuration
      : null;
  const confirmAttempt = async () => {
    if (fromAttempt && recent)
      await tx.execute(
        sql`update industrial_gateway_configurations set published_revision=${report.configurationRevision},published_configuration=${JSON.stringify(publication)}::jsonb,published_at=now(),pending_publication=null,last_error=null where gateway_id=${device.id}`,
      );
  };
  if (report.connectionId === "gateway-configuration") {
    if (
      !active ||
      report.commandId ||
      report.tags.length ||
      report.fx ||
      report.tsn ||
      report.discoveredTags ||
      report.errorCode ||
      !recent ||
      mode !== "live"
    )
      return { rejection: "connectivity_configuration_ack_mismatch" };
    await confirmAttempt();
    await tx.execute(
      sql`update industrial_gateway_configurations set reported_revision=${report.configurationRevision},last_received_at=now() where gateway_id=${device.id}`,
    );
    return {
      deviceId: device.deviceId,
      connectivity: true,
      configurationApplied: true,
    };
  }
  let connection: IndustrialConnection | undefined;
  if (report.commandId) {
    const pending = row.pending_probe;
    if (
      !pending ||
      pending.commandId !== report.commandId ||
      pending.connection.connectionId !== report.connectionId ||
      Date.parse(report.observedAt) > pending.expiresAt ||
      Date.now() > pending.expiresAt + 120000
    )
      return { rejection: "connectivity_probe_mismatch" };
    connection = pending.connection;
  } else {
    if (!active) return { rejection: "connectivity_revision_mismatch" };
    connection = active.connections.find(
      (c) => c.connectionId === report.connectionId,
    );
  }
  if (!connection) return { rejection: "connectivity_connection_unknown" };
  if (!report.commandId && !connection.enabled && report.state !== "disabled")
    return { rejection: "connectivity_disabled_connection" };
  if (mode !== (connection.mode ?? "live"))
    return { rejection: "connectivity_mode_mismatch" };
  const configured = new Map(connection.tags.map((t) => [t.tagId, t]));
  if (
    report.tags.some(
      (t) =>
        !configured.has(t.tagId) ||
        configured.get(t.tagId)!.dataType !== t.dataType ||
        configured.get(t.tagId)!.unit !== t.unit,
    )
  )
    return { rejection: "connectivity_tag_mismatch" };
  if (
    (report.fx &&
      (connection.protocol !== "opcua_fx" ||
        connection.fx?.mode !== report.fx.mode)) ||
    (report.tsn && report.tsn.interface !== connection.tsn?.interface)
  )
    return { rejection: "connectivity_diagnostics_mismatch" };
  const unsecuredUdp =
    connection.protocol === "opcua_fx" && connection.fx?.mode === "udp_uadp";
  if (unsecuredUdp && connection.fx?.mode === "udp_uadp") {
    const fx = connection.fx;
    if (
      report.tags.some(
        (tag) =>
          tag.quality === "good" || tag.qualityBasis !== "unauthenticated_udp",
      )
    )
      return { rejection: "connectivity_udp_evidence_mismatch" };
    if (
      report.fx &&
      (report.fx.publisherId !== fx.publisherId ||
        report.fx.writerGroupId !== fx.writerGroupId ||
        report.fx.dataSetWriterId !== fx.dataSetWriterId)
    )
      return { rejection: "connectivity_udp_publisher_mismatch" };
    currentEligible = false;
  }
  currentEligible = currentEligible && recent && report.state === "connected";
  if (report.commandId) {
    if (!recent) return { rejection: "connectivity_probe_not_current" };
    await tx.execute(
      sql`update industrial_gateway_configurations set probe_result=${JSON.stringify(report)}::jsonb,last_received_at=now() where gateway_id=${device.id} and (probe_result is null or (probe_result->>'observedAt')::timestamptz<=${report.observedAt}::timestamptz)`,
    );
    return { deviceId: device.deviceId, connectivity: true, probe: true };
  }
  await confirmAttempt();
  await tx.execute(
    sql`insert into industrial_observation_history(gateway_id,event_id,connection_id,revision,observed_at,current_eligible,report) values(${device.id},${report.eventId}::uuid,${report.connectionId},${report.configurationRevision},${report.observedAt}::timestamptz,${currentEligible},${JSON.stringify(report)}::jsonb)`,
  );
  // Old/retained/replayed transport cannot become a new current connection state.
  if (recent) {
    const status = { ...report, tags: [] };
    await tx.execute(
      sql`insert into industrial_connection_latest(gateway_id,connection_id,revision,observed_at,report) values(${device.id},${report.connectionId},${report.configurationRevision},${report.observedAt}::timestamptz,${JSON.stringify(status)}::jsonb) on conflict(gateway_id,connection_id) do update set revision=excluded.revision,observed_at=excluded.observed_at,received_at=now(),report=(case when industrial_connection_latest.revision=excluded.revision then industrial_connection_latest.report else '{}'::jsonb end)||excluded.report where industrial_connection_latest.revision<excluded.revision or industrial_connection_latest.observed_at<=excluded.observed_at`,
    );
    for (const tag of report.tags) {
      const single = { ...report, tags: [tag] };
      delete single.fx;
      delete single.tsn;
      delete single.discoveredTags;
      await tx.execute(
        sql`insert into industrial_tag_latest(gateway_id,connection_id,tag_id,revision,observed_at,current_eligible,report) values(${device.id},${report.connectionId},${tag.tagId},${report.configurationRevision},${report.observedAt}::timestamptz,${currentEligible && tag.quality === "good"},${JSON.stringify(single)}::jsonb) on conflict(gateway_id,connection_id,tag_id) do update set revision=excluded.revision,observed_at=excluded.observed_at,current_eligible=excluded.current_eligible,report=excluded.report where industrial_tag_latest.revision<excluded.revision or industrial_tag_latest.observed_at<=excluded.observed_at`,
      );
    }
    await tx.execute(
      sql`update industrial_gateway_configurations set reported_revision=${report.configurationRevision},last_received_at=now(),last_error=${report.errorCode ?? null} where gateway_id=${device.id}`,
    );
  }
  // Bounded diagnostic history: seven days and at most 1,000 envelopes per gateway.
  await tx.execute(
    sql`delete from industrial_observation_history where gateway_id=${device.id} and (observed_at<now()-interval '7 days' or event_id in (select event_id from industrial_observation_history where gateway_id=${device.id} order by observed_at desc,event_id desc offset 1000))`,
  );
  return { deviceId: device.deviceId, connectivity: true, currentEligible };
}
export async function connectivityHistory(input: {
  gatewayDeviceId: string;
  connectionId: string;
  tagId: string;
  limit: number;
}) {
  const db = await database(),
    g = await gateway(db, input.gatewayDeviceId),
    row = await state(db, g.id);
  if (
    ![row?.configuration, row?.published_configuration].some((config) =>
      config?.connections.some(
        (c) =>
          c.connectionId === input.connectionId &&
          c.tags.some((t) => t.tagId === input.tagId),
      ),
    )
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Tag not found in the saved or published gateway configuration.",
    });
  const rows = await db.execute<{
    report: ConnectivityObservation;
    current_eligible: boolean;
  }>(
    sql`select report,current_eligible from industrial_observation_history where gateway_id=${g.id} and connection_id=${input.connectionId} and report->'tags' @> ${JSON.stringify([{ tagId: input.tagId }])}::jsonb order by observed_at desc,event_id desc limit ${input.limit}`,
  );
  return rows.map((r) => {
    const tag = r.report.tags.find((t) => t.tagId === input.tagId)!;
    return {
      eventId: r.report.eventId,
      observedAt: r.report.observedAt,
      configurationRevision: r.report.configurationRevision,
      currentEligible: r.current_eligible && tag.quality === "good",
      ...tag,
    };
  });
}

/** Read the explicit current gateway/asset bindings; removed links cannot retain attribution. */
export async function connectivityAssetTags(assetId: string) {
  const db = await database();
  const rows = await db.execute<{
    gatewayDeviceId: string;
    configuration: IndustrialConfiguration;
    metadata: Record<string, unknown> | null;
    report: ConnectivityObservation | null;
    current_eligible: boolean | null;
    connection_id: string | null;
    tag_id: string | null;
  }>(sql`
    select d."deviceId" as "gatewayDeviceId",coalesce(c.published_configuration,c.configuration) as configuration,d.metadata,t.report,t.current_eligible,t.connection_id,t.tag_id
    from assets a join asset_devices ad on ad."assetId"=a.id
    join devices d on d.id=ad."deviceId" and d.type='gateway' and d."isDemo"=false
    join industrial_gateway_configurations c on c.gateway_id=d.id
    left join industrial_tag_latest t on t.gateway_id=d.id and t.revision=c.published_revision
    where a."assetId"=${assetId} and a."isDemo"=false and c.configuration is not null
    order by d.id,t.connection_id,t.tag_id limit 16000`);
  const gateways = new Map<
    string,
    {
      configuration: IndustrialConfiguration;
      freshnessMs: number;
      reports: Map<
        string,
        { report: ConnectivityObservation; eligible: boolean }
      >;
    }
  >();
  for (const row of rows) {
    if (!gateways.has(row.gatewayDeviceId)) {
      const parsed = industrialConfigurationSchema.safeParse(row.configuration);
      if (!parsed.success) continue;
      const freshness = (
        row.metadata?.commissioning as { freshnessSeconds?: number }
      )?.freshnessSeconds;
      gateways.set(row.gatewayDeviceId, {
        configuration: parsed.data,
        freshnessMs: (freshness ?? 120) * 1000,
        reports: new Map(),
      });
    }
    const report = connectivityObservationSchema.safeParse(row.report);
    if (report.success && row.connection_id && row.tag_id)
      gateways
        .get(row.gatewayDeviceId)!
        .reports.set(`${row.connection_id}/${row.tag_id}`, {
          report: report.data,
          eligible: row.current_eligible === true,
        });
  }
  const now = Date.now();
  return [...gateways]
    .flatMap(([gatewayDeviceId, gateway]) =>
      gateway.configuration.connections.flatMap((connection) =>
        connection.tags
          .filter((tag) => tag.assetId === assetId)
          .map((tag) => {
            const latest = gateway.reports.get(
              `${connection.connectionId}/${tag.tagId}`,
            );
            const observed = latest?.report.tags.find(
              (t) => t.tagId === tag.tagId,
            );
            return {
              gatewayDeviceId,
              connectionId: connection.connectionId,
              tagId: tag.tagId,
              name: tag.name,
              property: tag.property,
              unit: tag.unit,
              dataType: tag.dataType,
              value: observed?.value ?? null,
              quality: observed?.quality ?? ("unknown" as const),
              observedAt: latest?.report.observedAt ?? null,
              currentEligible: !!(
                connection.enabled &&
                latest?.eligible &&
                observed?.quality === "good" &&
                now - Date.parse(latest.report.observedAt) <=
                  gateway.freshnessMs &&
                Date.parse(latest.report.observedAt) <= now + 30000
              ),
              mode: connection.mode ?? ("live" as const),
              configurationRevision: gateway.configuration.revision,
            };
          }),
      ),
    )
    .slice(0, 1600);
}

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { getDb } from "../db";
import {
  industrialConfigurationSchema,
  connectivityObservationSchema,
} from "../../shared/industrial-connectivity";
import { connectivityNetworkEvidence } from "../connectivity/network-evidence";
import {
  networkSnapshot,
  type NetworkSnapshot,
  type NetworkView,
} from "../../shared/network-diagnostics";

const key = (gateway: string) =>
  `network-diagnostics:${createHash("sha256").update(gateway).digest("hex").slice(0, 48)}`;
export async function saveNetworkSnapshot(
  value: NetworkSnapshot,
  actor: number | null,
) {
  const report = networkSnapshot.parse(value),
    observed = Date.parse(report.observedAt),
    now = Date.now();
  if (observed > now + 300000 || observed < now - 7 * 86400000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A diagnostics snapshot must have a valid timestamp within the past seven days.",
    });
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Diagnostics storage is unavailable.",
    });
  const [gateway] = await db.execute<{ id: number }>(
    sql`select id from devices where "deviceId"=${report.gatewayId} and type='gateway' and "isDemo"=false limit 1`,
  );
  if (!gateway)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Select a registered operational gateway for this diagnostics report.",
    });
  const stored = { report, importedAt: new Date(now).toISOString(), actor };
  const rows = await db.execute(
    sql`insert into system_settings(key,value) values(${key(report.gatewayId)},${JSON.stringify(stored)}::jsonb) on conflict(key) do update set value=excluded.value where (system_settings.value->'report'->>'observedAt')::timestamptz <= ${report.observedAt}::timestamptz returning key`,
  );
  if (!rows.length)
    throw new TRPCError({
      code: "CONFLICT",
      message: "A newer diagnostics snapshot is already stored.",
    });
  return {
    accepted: true,
    gatewayId: report.gatewayId,
    observedAt: report.observedAt,
  };
}
export async function networkView(): Promise<NetworkView> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Diagnostics storage is unavailable.",
    });
  const rows = await db.execute<{
    value: { report: unknown; importedAt: string };
    total: number;
  }>(
    sql`select s.value,count(*) over()::int as total from system_settings s join devices d on s.value->'report'->>'gatewayId'=d."deviceId" where s.key like 'network-diagnostics:%' and d."isDemo"=false and d.type='gateway' order by d.id limit 128`,
  );
  const snapshots = rows
    .map((r) => networkSnapshot.safeParse(r.value.report))
    .filter((r) => r.success)
    .map((r) => r.data!);
  const collected = await db.execute<{
    configuration: unknown;
    reports: unknown[];
    receivedAt: string;
  }>(sql`
    select c.published_configuration as configuration,jsonb_agg(l.report) as reports,max(l.received_at)::text as "receivedAt"
    from industrial_gateway_configurations c join devices d on d.id=c.gateway_id and d.type='gateway' and d."isDemo"=false
    join industrial_connection_latest l on l.gateway_id=c.gateway_id and l.revision=c.published_revision
    where c.published_configuration is not null and (l.report ? 'fx' or l.report ? 'tsn')
    group by c.gateway_id,c.published_configuration order by c.gateway_id limit 128`);
  for (const row of collected) {
    const configuration = industrialConfigurationSchema.safeParse(
      row.configuration,
    );
    if (!configuration.success) continue;
    const reports = row.reports
      .map((r) => connectivityObservationSchema.safeParse(r))
      .filter((r) => r.success)
      .map((r) => r.data!);
    const snapshot = connectivityNetworkEvidence(configuration.data, reports);
    if (!snapshot) continue;
    const previous = snapshots.findIndex(
      (s) => s.gatewayId === snapshot.gatewayId,
    );
    if (previous < 0) snapshots.push(snapshot);
    else if (
      Date.parse(snapshots[previous].observedAt) <=
      Date.parse(snapshot.observedAt)
    )
      snapshots[previous] = snapshot;
  }
  const importedAt =
    [
      ...rows.map((r) => r.value.importedAt),
      ...collected.map((r) => new Date(r.receivedAt).toISOString()),
    ]
      .sort()
      .at(-1) ?? null;
  const selected = snapshots
    .sort((a, b) => a.gatewayId.localeCompare(b.gatewayId))
    .slice(0, 128);
  return {
    synthetic: false,
    coverage: {
      returned: selected.length,
      total: Math.max(snapshots.length, rows[0]?.total ?? 0),
    },
    scenario: "operational",
    snapshots: selected,
    importedAt,
    stale:
      snapshots.length > 0 &&
      snapshots.some((s) => Date.now() - Date.parse(s.observedAt) > 120000),
    provenance: !snapshots.length
      ? "unavailable"
      : snapshots.some((s) => s.source === "operator-import")
        ? "operator-import"
        : "service-collector",
  };
}

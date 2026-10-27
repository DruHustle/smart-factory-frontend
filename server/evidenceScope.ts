import { sql, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { demoOnlyRead } from "./demoData";
import { canonicalUnits, type Metric } from "../shared/measurements";
export const evidenceScope = z.enum([
  "operational",
  "live",
  "simulated",
  "replay",
  "unknown",
  "all",
]);
export type EvidenceScope = z.infer<typeof evidenceScope>;
export const defaultEvidenceScope = (): EvidenceScope =>
  demoOnlyRead() ? "simulated" : "operational";
export function evidenceSql(
  scope: EvidenceScope = defaultEvidenceScope(),
  integration: SQLWrapper = sql`integration`,
) {
  const mode = sql`coalesce(${integration}->>'mode','unknown')`;
  return scope === "all"
    ? sql`true`
    : scope === "unknown"
      ? sql`${mode} not in ('live','simulated','replay')`
      : scope === "operational"
        ? sql`(${mode}='live' or (${mode} not in ('live','simulated','replay') and ${integration}->'evidence'->>'legacyReviewed'='true'))`
        : sql`${mode}=${scope}`;
}
/** Only verified, compatible engineering measurements enter numeric aggregates. */
export function metricSql(metric: Metric, alias = "r") {
  const row = sql.identifier(alias),
    field = sql.identifier(metric);
  return sql`case when ${row}.measurements->${metric}->>'canonicalUnit'=${canonicalUnits[metric]} and ${row}.measurements->${metric}->>'conversionVersion'='sf-units-v1' and ${row}.measurements->${metric}->>'quality'='good' then coalesce((${row}.measurements->${metric}->>'canonicalValue')::double precision,${row}.${field}) else null end`;
}

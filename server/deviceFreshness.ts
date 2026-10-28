import { sql, type SQL } from "drizzle-orm";

/** Bound legacy metadata exactly as the commissioned input policy does. */
export function deviceFreshness(
  metadata: Record<string, unknown> | null | undefined,
): number | null {
  const policy = metadata?.commissioning as
    | { freshnessSeconds?: unknown }
    | undefined;
  const seconds = policy?.freshnessSeconds;
  const hasSeconds = seconds !== null && seconds !== undefined;
  const raw = hasSeconds ? seconds : metadata?.freshnessMs;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (!(hasSeconds ? /^[0-9]{1,5}$/ : /^[0-9]{4,8}$/).test(String(raw)))
    return null;
  const value = Number(raw) * (hasSeconds ? 1000 : 1);
  return value >= 5000 && value <= 86400000 ? value : null;
}

export function deviceFreshnessSql(metadata: SQL): SQL {
  const seconds = sql`${metadata}->'commissioning'->>'freshnessSeconds'`;
  const legacy = sql`${metadata}->>'freshnessMs'`;
  const candidate = sql`case when ${seconds} is not null then case when ${seconds} ~ '^[0-9]{1,5}$' then (${seconds})::bigint*1000 else null end when ${legacy} ~ '^[0-9]{4,8}$' then (${legacy})::bigint else null end`;
  return sql`case when (${candidate}) between 5000 and 86400000 then (${candidate}) else null end`;
}

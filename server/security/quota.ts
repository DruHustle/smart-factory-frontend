import { sql } from "drizzle-orm";
import { SecurityError } from "./contract";
import type { Conn } from "./store";
/** Transactional logical-content accounting; production database overhead is separate. */
export async function reserve(
  c: Conn,
  bytes: number,
  events = 0,
  reports = 0,
  findings = 0,
) {
  const changed = await c.execute(
    sql`update security_usage set bytes=bytes+${bytes},events=events+${events},reports=reports+${reports},findings=findings+${findings} where singleton=true and bytes+${bytes}<=268435456 and events+${events}<=200000 and reports+${reports}<=100 and findings+${findings}<=10000 returning singleton`,
  );
  if (!changed.length)
    throw new SecurityError(429, "security_storage_capacity");
}

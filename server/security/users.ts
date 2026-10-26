import { sql, type SQL } from "drizzle-orm";
import { DEMO_ACCOUNTS } from "../../shared/demo-accounts";
/** Fixed application-owned account policy; alias is internal SQL, never caller input. */
export const individualSecurityUser = (alias: SQL = sql`users`) =>
  sql`${alias}."openId" not like 'demo-%' and lower(coalesce(${alias}.email,'')) not in (${sql.join(
    DEMO_ACCOUNTS.map((a) => sql`${a.email.toLowerCase()}`),
    sql`,`,
  )})`;

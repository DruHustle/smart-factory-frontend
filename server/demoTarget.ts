import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { TRPCError } from "@trpc/server";
/** Read-only fixture protection also applies to individually authenticated operators. */
export async function rejectFixtureMutation(path: string, raw: unknown) {
  if (!raw || typeof raw !== "object") return;
  const input = raw as Record<string, unknown>,
    domain = path.split(".")[0],
    id = domain === "thresholds" ? input.deviceId : input.id;
  if (
    !["assets", "devices", "thresholds", "alerts"].includes(domain) ||
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0
  )
    return;
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const target =
    domain === "assets"
      ? sql`select "isDemo" as fixture from assets where id=${id}`
      : domain === "alerts"
        ? sql`select d."isDemo" as fixture from alerts a join devices d on d.id=a."deviceId" where a.id=${id}`
        : sql`select "isDemo" as fixture from devices where id=${id}`;
  const [row] = await db.execute(target);
  if (row?.fixture)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Approved simulation fixtures are read-only. Create an individually managed operational or simulated item for changes.",
    });
}

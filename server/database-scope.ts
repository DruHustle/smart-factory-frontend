import { AsyncLocalStorage } from "node:async_hooks";
import type { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

export type ApplicationDatabase = Omit<ReturnType<typeof drizzle>, "$client">;
const requestDatabase = new AsyncLocalStorage<{
  db: ApplicationDatabase;
  active: boolean;
}>();
export const currentRequestDatabase = () => {
  const scope = requestDatabase.getStore();
  return scope?.active ? scope.db : undefined;
};
export async function withRequestDatabase<T>(
  db: ApplicationDatabase,
  run: () => Promise<T>,
): Promise<T> {
  const scope = { db, active: true };
  try {
    return await requestDatabase.run(scope, run);
  } finally {
    scope.active = false;
  }
}

/** Keep the authenticated audit actor on the same connection as the changed rows. */
export async function withMutationActor<T>(
  actor: {
    id: number;
    name: string | null;
    email: string | null;
    role: string;
  },
  run: () => Promise<T>,
): Promise<T> {
  const { getDb } = await import("./db");
  const db = await getDb();
  // Existing handlers report storage unavailability; a missing database cannot write audit-less rows.
  if (!db) return run();
  return db.transaction(async (tx) => {
    const identity = JSON.stringify({
      id: actor.id,
      name: (actor.name?.trim() || actor.email || `Account ${actor.id}`).slice(
        0,
        320,
      ),
      role: actor.role,
    });
    await tx.execute(
      sql`select set_config('smart_factory.actor',${identity},true)`,
    );
    // Domain helpers retain their existing transaction/savepoint and error semantics.
    return withRequestDatabase(tx, run);
  });
}

import { createHash } from "node:crypto";
import postgres from "postgres";

/** Independent visual cases share one public identity in disposable storage. */
export async function resetDemoViewerFixtureLoginLimit() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.PUBLIC_DEMO_E2E !== "true" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.endsWith("_e2e")
  )
    throw Error(
      "Demo login isolation requires the explicit disposable local browser runner.",
    );
  const connection = postgres(url.toString(), {
    max: 1,
    connect_timeout: 5,
    ssl: false,
  });
  try {
    const key = createHash("sha256")
      .update("email:demo@dev.local")
      .digest("hex");
    await connection`delete from login_rate_limits where key_hash=${key}`;
  } finally {
    await connection.end({ timeout: 5 });
  }
}

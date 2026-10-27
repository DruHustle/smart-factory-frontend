import { telemetryWorkerReceipt } from "./operatingEvidence";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  requiredCapabilities,
  runtimeContractVersion,
  type RuntimeContract,
} from "../shared/runtime-contract";
const revision = (v: string | undefined) =>
  v && /^[a-f0-9]{40}$/.test(v) ? v : null;
let manifest:
  | Promise<{ revision: string; digest: string; hashes: string[] }>
  | undefined;
export function migrationManifest() {
  return (manifest ??= (async () => {
    const journal = JSON.parse(
      await readFile("drizzle/meta/_journal.json", "utf8"),
    ) as { entries: { tag: string }[] };
    const hashes = await Promise.all(
      journal.entries.map(async (e) =>
        createHash("sha256")
          .update(await readFile(`drizzle/${e.tag}.sql`, "utf8"))
          .digest("hex"),
      ),
    );
    return {
      revision: journal.entries.at(-1)!.tag,
      hashes,
      digest: createHash("sha256").update(hashes.join("\n")).digest("hex"),
    };
  })());
}
export async function getRuntimeContract(): Promise<RuntimeContract> {
  const expected = await migrationManifest();
  const db = await getDb();
  const rows = db
    ? await db.execute<{ hash: string }>(
        sql`select hash from drizzle.__drizzle_migrations order by created_at`,
      )
    : [];
  // All expected migration contents must have been applied. A newer additive schema
  // is compatible; readiness alone and a latest timestamp cannot prove this.
  const applied = new Set(rows.map((r) => r.hash));
  const source = revision(process.env.SOURCE_REVISION),
    backendSource = revision(process.env.BACKEND_SOURCE_REVISION),
    edgeSource = revision(process.env.EDGE_SOURCE_REVISION);
  const bundle = process.env.BACKEND_DEPLOYMENT_MODE === "render-bundle";
  const worker = bundle ? await telemetryWorkerReceipt() : null;
  let workerDigest: string | null = null;
  if (bundle) {
    const directory =
      process.env.TELEMETRY_MIGRATIONS_DIR ?? "telemetry-migrations";
    const names = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ) as string[];
    const hashes = await Promise.all(
      names.map(async (name) =>
        createHash("sha256")
          .update(await readFile(join(directory, name)))
          .digest("hex"),
      ),
    );
    workerDigest = createHash("sha256").update(hashes.join("\n")).digest("hex");
  }
  return {
    worker: worker
      ? {
          fresh: worker.fresh,
          compatible:
            worker.source === backendSource &&
            worker.contractVersion === runtimeContractVersion &&
            worker.migrationsDigest === workerDigest,
        }
      : null,
    contractVersion: runtimeContractVersion,
    source,
    backendSource,
    edgeSource,
    schema: {
      ready: expected.hashes.every((h) => applied.has(h)),
      revision: expected.revision,
      digest: expected.digest,
    },
    capabilities: [...requiredCapabilities],
    deployment: bundle ? "bundle" : "standalone",
    versioned: !!source && (!bundle || (!!backendSource && !!edgeSource)),
  };
}

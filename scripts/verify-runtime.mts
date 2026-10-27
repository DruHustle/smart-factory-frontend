import { writeFile } from "node:fs/promises";
import { runtimeCompatibility } from "../shared/runtime-contract";
import { migrationManifest } from "../server/runtimeContract";
const origin = new URL(process.env.API_ORIGIN ?? "");
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw Error("API_ORIGIN must be a plain HTTPS origin");
const response = await fetch(new URL("/api/runtime/contract", origin), {
  redirect: "error",
  signal: AbortSignal.timeout(10000),
  cache: "no-store",
});
if (!response.ok) throw Error("API runtime contract is unavailable");
const contract = await response.json(),
  error = runtimeCompatibility(contract, true);
if (error) throw Error(error);
if (
  contract.deployment !== "bundle" ||
  !contract.worker?.fresh ||
  !contract.worker?.compatible
)
  throw Error(
    "A compatible current singleton telemetry-worker receipt is required for promotion",
  );
const expected = await migrationManifest();
if (contract.schema.digest !== expected.digest)
  throw Error(
    "API migration manifest differs from the reviewed UI source; qualify compatibility before release",
  );
if (!contract.backendSource || !contract.edgeSource)
  throw Error("Coordinated backend and edge source identities are required");
if (process.env.RUNTIME_EVIDENCE_FILE)
  await writeFile(
    process.env.RUNTIME_EVIDENCE_FILE,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        origin: origin.origin,
        ...contract,
      },
      null,
      2,
    ) + "\n",
  );
console.log(
  `Compatible runtime: API ${contract.source}, backend ${contract.backendSource}, edge ${contract.edgeSource}; schema ${contract.schema.revision}`,
);

import { readFile, writeFile } from "node:fs/promises";
import { promotionCompatibility } from "../shared/runtime-contract";
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
const contract = await response.json();
const expected = await migrationManifest();
const sources = JSON.parse(
  await readFile("deploy/qualification-sources.json", "utf8"),
);
if (
  ![sources.backend, sources.edge].every(
    (sha) => typeof sha === "string" && /^[a-f0-9]{40}$/.test(sha),
  )
)
  throw Error("Qualified immutable companion source revisions are required");
const error = promotionCompatibility(contract, {
  schemaDigest: expected.digest,
  ...sources,
});
if (error) throw Error(error);
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

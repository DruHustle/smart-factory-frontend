import { z } from "zod";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  batchSchema,
  receiptSchema,
  registrationSchema,
  CONTRACT,
} from "../../server/onesa/contract";
const schemas = {
  Batch: z.toJSONSchema(batchSchema),
  Receipt: z.toJSONSchema(receiptSchema),
  Registration: z.toJSONSchema(registrationSchema),
};
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const files: Record<string, string> = {
  "contracts/onesa/batch.schema.json": json({
    ...schemas.Batch,
    $id: CONTRACT,
  }),
  "contracts/onesa/receipt.schema.json": json({
    ...schemas.Receipt,
    $id: CONTRACT + ":receipt",
  }),
  "contracts/onesa/registration.schema.json": json({
    ...schemas.Registration,
    $id: CONTRACT + ":registration",
  }),
  "contracts/onesa/openapi.json": json({
    openapi: "3.1.0",
    info: {
      title: "PROPOSED Smart Factory → Onesa contract-test receiver",
      version: "1.0.0",
      description:
        "Not implemented by inspected Onesa. Paths and bearer auth are proposals for consumer review.",
    },
    paths: {
      "/proposed/v1/batches": {
        post: {
          security: [{ ServiceToken: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Batch" },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Per-event durable receipts; only accepted/duplicate acknowledge",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Receipt" },
                },
              },
            },
            "401": {
              description:
                "Credential expired/invalid; suspend until operator rotation",
            },
            "403": { description: "Credential scope mismatch" },
            "422": { description: "Invalid batch/version; quarantine" },
            "429": { description: "Retry-After, no acceptance" },
            "503": { description: "Transient, retry unchanged" },
          },
        },
      },
    },
    components: {
      schemas,
      securitySchemes: {
        ServiceToken: {
          type: "http",
          scheme: "bearer",
          description:
            "Proposed token-bound installation/workspace; not Onesa session auth",
        },
      },
    },
  }),
};
const hashes = Object.fromEntries(
  Object.entries(files).map(([p, s]) => [
    p,
    createHash("sha256").update(s).digest("hex"),
  ]),
);
files["contracts/onesa/contract.lock.json"] = json({
  schema: CONTRACT,
  status: "proposed",
  consumer: {
    repository: "DruHustle/onesa-ai-platform",
    main: "65d9346f297ee8869595b38634fda020bf9607f9",
    dev: "4e434433b415315ce00b5c2e577492dd605ee7de",
    staging: "b4a453bdc8dc3c8e95a9253adfe9b5b5d387941b",
    files: [
      "onesa-ai-platform-backend/app/industrial.py",
      "onesa-ai-platform-backend/app/industrial_evidence.py",
      "docs/api/openapi.json",
    ],
    finding:
      "No Digital Twin ingestion/registration/AAS/3D contract. Existing importer is synthetic evidence only.",
  },
  hashes,
});
for (const [p, s] of Object.entries(files)) {
  if (process.argv.includes("--check")) {
    if ((await readFile(p, "utf8")) !== s)
      throw new Error("Contract drift: " + p);
  } else await writeFile(p, s);
}
console.log(
  process.argv.includes("--check")
    ? "Contract snapshots match source"
    : "Generated proposed contract snapshots",
);

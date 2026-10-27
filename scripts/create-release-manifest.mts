import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { migrationManifest } from "../server/runtimeContract";
const image = process.env.QUALIFIED_IMAGE,
  output = process.env.RELEASE_MANIFEST_OUTPUT;
if (!image || !output)
  throw Error("QUALIFIED_IMAGE and RELEASE_MANIFEST_OUTPUT are required");
function source(path: string) {
  if (
    execFileSync("git", ["status", "--porcelain"], {
      cwd: path,
      encoding: "utf8",
    }).trim()
  )
    throw Error("Release sources must be clean");
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: path,
    encoding: "utf8",
  }).trim();
}
const sources = {
  frontend: source(resolve(".")),
  backend: source(resolve("../smart-factory-iot-backend")),
  edge: source(resolve("../smart-factory-iot-edge")),
};
const [inspection] = JSON.parse(
  execFileSync("docker", ["image", "inspect", image], { encoding: "utf8" }),
);
for (const [key, label] of [
  ["frontend", "org.opencontainers.image.revision"],
  ["backend", "io.smartfactory.backend.revision"],
  ["edge", "io.smartfactory.edge.revision"],
] as const)
  if (inspection.Config.Labels?.[label] !== sources[key])
    throw Error("Image source labels differ from reviewed sources");
if (inspection.Architecture !== "arm64" || inspection.Os !== "linux")
  throw Error("Oracle qualification requires Linux ARM64");
await writeFile(
  output,
  JSON.stringify(
    {
      format: "sf-qualified-release-v1",
      generatedAt: new Date().toISOString(),
      sources,
      image: {
        reference: image,
        id: inspection.Id,
        registryDigests: inspection.RepoDigests,
        platform: "linux/arm64",
      },
      dashboardSchema: await migrationManifest(),
      acceptance:
        "Refer to recorded qualification evidence; this manifest does not assert deployment or hardware acceptance.",
    },
    null,
    2,
  ) + "\n",
);
console.log("Immutable candidate identity written.");

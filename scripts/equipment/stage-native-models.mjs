/** Package only hash-verified compact references used by the native model API. */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function stageNativeModels(root, destination) {
  const catalog = JSON.parse(
    await readFile(
      resolve(root, "shared/authored-assets.catalog.json"),
      "utf8",
    ),
  );
  const packages = [];
  const seen = new Set();
  for (const asset of catalog.assets) {
    const model = asset.models.compact;
    if (
      !/^[a-z]+(?:-[a-z]+)*$/.test(asset.slug) ||
      !/^[a-f0-9]{64}$/.test(model.sha256) ||
      model.url !==
        `/models/authored/${asset.slug}/compact.${model.sha256.slice(0, 16)}.glb` ||
      !Number.isInteger(model.bytes) ||
      model.bytes <= 0 ||
      model.bytes > 20 * 1024 * 1024 ||
      seen.has(model.url)
    )
      throw new Error(
        "Invalid or duplicate native compact model in reviewed catalog",
      );
    seen.add(model.url);
    const source = resolve(root, "client/public" + model.url);
    if (!(await lstat(source)).isFile())
      throw new Error(`Native model must be a regular file: ${model.url}`);
    const bytes = await readFile(source);
    if (
      bytes.length !== model.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== model.sha256
    )
      throw new Error(`Native model integrity mismatch: ${model.url}`);
    const licenseUrl = `/models/authored/${asset.slug}/LICENSE.txt`;
    const receiptUrl = `/models/authored/${asset.slug}/SOURCE.json`;
    if (
      asset.license !== "MIT" ||
      asset.licenseFileUrl !== licenseUrl ||
      asset.sourceReceiptUrl !== receiptUrl
    )
      throw new Error("Native model license/provenance paths are invalid");
    const metadata = [];
    for (const url of [licenseUrl, receiptUrl]) {
      const path = resolve(root, "client/public" + url);
      if (!(await lstat(path)).isFile())
        throw new Error(`Native provenance must be a regular file: ${url}`);
      const data = await readFile(path);
      if (!data.length || data.length > 128 * 1024)
        throw new Error(`Native provenance exceeds byte budget: ${url}`);
      metadata.push({
        url,
        bytes: data,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
    }
    const receipt = JSON.parse(metadata[1].bytes.toString("utf8"));
    if (
      !metadata[0].bytes.toString("utf8").includes("MIT License") ||
      receipt.license !== "MIT" ||
      receipt.generatorSha256 !== asset.sourceRevision ||
      receipt.models.compact.sha256 !== model.sha256 ||
      receipt.models.compact.bytes !== model.bytes
    )
      throw new Error(`Native model provenance mismatch: ${asset.slug}`);
    packages.push({ model, bytes, metadata });
  }
  if (!packages.length)
    throw new Error("Native compact model catalog is empty");
  // Validate the complete allowlist before writing any runtime assets.
  for (const { model, bytes, metadata } of packages) {
    for (const file of [{ url: model.url, bytes }, ...metadata]) {
      const target = resolve(destination, file.url.slice(1));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.bytes, { mode: 0o644 });
    }
  }
  return packages.map(({ model, metadata }) => ({
    url: model.url,
    bytes: model.bytes,
    sha256: model.sha256,
    provenance: metadata.map(({ url, bytes, sha256 }) => ({
      url,
      bytes: bytes.length,
      sha256,
    })),
  }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3)
    throw new Error(
      "Usage: node scripts/equipment/stage-native-models.mjs /absolute/runtime/client/public",
    );
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  console.log(
    JSON.stringify({
      nativeCompactModels: await stageNativeModels(
        root,
        resolve(process.argv[2]),
      ),
    }),
  );
}

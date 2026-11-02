import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  cp,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { stageNativeModels } from "../../scripts/equipment/stage-native-models.mjs";
import { authoredAssets } from "../../shared/authored-assets";

const root = resolve(import.meta.dirname, "../..");
const owned: string[] = [];
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "factory-native-models-"));
  owned.push(path);
  return path;
}
afterEach(async () => {
  for (const path of owned.splice(0))
    await rm(path, { recursive: true, force: true });
});

it("packages only native compact GLBs and their license/provenance, excluding static detail models and previews", async () => {
  const destination = await temporary();
  const result = await stageNativeModels(root, destination);
  expect(result).toHaveLength(3);
  for (const asset of authoredAssets) {
    const model = asset.models.compact;
    const folder = join(destination, "models/authored", asset.slug);
    expect((await readdir(folder)).sort()).toEqual(
      ["LICENSE.txt", "SOURCE.json", model.url.split("/").at(-1)].sort(),
    );
    const bytes = await readFile(join(destination, model.url.slice(1)));
    expect(bytes.length).toBe(model.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(model.sha256);
    expect(await readFile(join(folder, "LICENSE.txt"), "utf8")).toContain(
      "MIT License",
    );
    const receipt = JSON.parse(
      await readFile(join(folder, "SOURCE.json"), "utf8"),
    );
    expect(receipt.models.compact.sha256).toBe(model.sha256);
  }
});

it("rejects a corrupt package before writing any staged model", async () => {
  const fixture = await temporary(),
    destination = await temporary();
  await mkdir(join(fixture, "shared"));
  await cp(
    join(root, "shared/authored-assets.catalog.json"),
    join(fixture, "shared/authored-assets.catalog.json"),
  );
  await cp(
    join(root, "client/public/models/authored"),
    join(fixture, "client/public/models/authored"),
    { recursive: true },
  );
  const path = join(
    fixture,
    "client/public",
    authoredAssets.at(-1)!.models.compact.url.slice(1),
  );
  const bytes = await readFile(path);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(path, bytes);
  await expect(stageNativeModels(fixture, destination)).rejects.toThrow(
    /integrity mismatch/,
  );
  expect(await readdir(destination)).toEqual([]);
});

it("rejects catalog traversal or a missing required file instead of silently packaging an incomplete image", async () => {
  const fixture = await temporary(),
    destination = await temporary();
  await mkdir(join(fixture, "shared"));
  const catalog = JSON.parse(
    await readFile(join(root, "shared/authored-assets.catalog.json"), "utf8"),
  );
  const file = join(fixture, "shared/authored-assets.catalog.json");
  await writeFile(file, JSON.stringify(catalog));
  await expect(stageNativeModels(fixture, destination)).rejects.toThrow(
    /ENOENT/,
  );
  catalog.assets[0].models.compact.url = "/../../private/model.glb";
  await writeFile(file, JSON.stringify(catalog));
  await expect(stageNativeModels(fixture, destination)).rejects.toThrow(
    /Invalid/,
  );
  expect(await readdir(destination)).toEqual([]);
});

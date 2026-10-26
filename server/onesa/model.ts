import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
const root = new URL("../../fixtures/equipment/", import.meta.url);
const matrix = z.array(z.number().finite()).length(16);
const manifestSchema = z.object({
  revision: z.string(),
  file: z.literal("pump-motor.glb"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  units: z.literal("m"),
  handedness: z.literal("right"),
  upAxis: z.literal("+Y"),
  forwardAxis: z.literal("+Z"),
  modelToEquipmentTransform: matrix,
  equipment: z.array(
    z.object({
      equipmentId: z.uuid(),
      modelRevision: z.string(),
      nodes: z.array(
        z.object({
          componentId: z.uuid(),
          scene: z.number().int(),
          nodeIndex: z.number().int(),
          nodePath: z.string(),
        }),
      ),
      documentComponents: z.array(z.uuid()),
    }),
  ),
  documents: z.array(
    z.object({
      file: z.literal("maintenance.txt"),
      revision: z.string(),
      sha256: z.string(),
    }),
  ),
});
export function validateModel(
  bytes: Buffer,
  manifest: unknown,
  document: Buffer,
  equipment: unknown,
) {
  const m = manifestSchema.parse(manifest);
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  if (
    sha(bytes) !== m.sha256 ||
    bytes.toString("ascii", 0, 4) !== "glTF" ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw new Error("Model revision hash or GLB header invalid");
  const gltf = JSON.parse(
    bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
  );
  const registrations = z
    .array(
      z.object({
        equipmentId: z.uuid(),
        components: z.array(z.object({ componentId: z.uuid() })),
      }),
    )
    .parse(equipment);
  for (const r of registrations) {
    const map = m.equipment.find((e) => e.equipmentId === r.equipmentId);
    if (
      !map ||
      map.modelRevision !== m.revision ||
      map.nodes.length !== r.components.length
    )
      throw new Error("Model/component mapping missing");
    for (const c of r.components) {
      const node = map.nodes.find((n) => n.componentId === c.componentId);
      if (!node || node.scene !== 0 || !gltf.nodes[node.nodeIndex])
        throw new Error("Explicit scene mapping invalid");
      const parts = node.nodePath.split("/").filter(Boolean);
      let index = gltf.scenes[0].nodes.find(
        (i: number) => gltf.nodes[i].name === parts[0],
      );
      for (const name of parts.slice(1)) {
        index = gltf.nodes[index]?.children?.find(
          (i: number) => gltf.nodes[i].name === name,
        );
      }
      if (index !== node.nodeIndex)
        throw new Error("Scene path and node disagree");
    }
    if (
      map.documentComponents.some(
        (c) => !r.components.some((x) => x.componentId === c),
      )
    )
      throw new Error("Document/component association invalid");
  }
  if (m.documents.some((d) => sha(document) !== d.sha256))
    throw new Error("Document revision hash invalid");
  return m;
}
export async function artifactStatus() {
  try {
    const [model, manifest, doc, equipment] = await Promise.all(
      [
        "pump-motor.glb",
        "model-manifest.json",
        "maintenance.txt",
        "equipment.json",
      ].map((p) => readFile(new URL(p, root))),
    );
    validateModel(
      model,
      JSON.parse(manifest.toString()),
      doc,
      JSON.parse(equipment.toString()),
    );
    return "Available · illustrative revision verified";
  } catch {
    return "Missing or invalid model/document revision";
  }
}

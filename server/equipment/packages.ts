import { z } from "zod";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
async function database() {
  return (await import("./local")).database();
}
import { inspectGlb } from "./model-budget";
export const component = z
  .object({
    templateComponentId: z.uuid(),
    name: z.string().trim().min(1).max(80),
    parentTemplateComponentId: z.uuid().nullable(),
    designation: z.string().max(80).optional(),
    quantity: z.number().int().min(1).max(10000).optional(),
    material: z.string().max(80).optional(),
    description: z.string().max(500).optional(),
    role: z
      .enum(["group", "housing", "cover", "internal", "structural"])
      .optional(),
    solid: z.boolean().optional(),
    inventoryKind: z
      .enum(["assembly", "individual part", "repeated part set"])
      .optional(),
    source: z.string().max(160).optional(),
    explode: z
      .object({
        translation: z.array(z.number().finite().min(-10).max(10)).length(3),
        rotation: z.array(z.number().finite().min(-6.29).max(6.29)).length(3),
        pivot: z.array(z.number().finite().min(-10).max(10)).length(3),
      })
      .strict()
      .optional(),
    nodeIndex: z.number().int().min(0).max(1999),
    nodePath: z
      .string()
      .regex(/^\/[A-Za-z0-9 _.-]+(?:\/[A-Za-z0-9 _.-]+)*$/)
      .max(500),
  })
  .strict();
export const localBindingSchema = z
  .object({
    sourceKey: z.enum(["temperature", "pressure", "rpm", "vibration"]),
    templateComponentId: z.uuid(),
    meaning: z.enum([
      "temperature",
      "pressure",
      "rotational_speed",
      "vibration_velocity",
    ]),
    unit: z.enum(["Cel", "bar", "1/min", "mm/s"]),
    sourceUnit: z
      .enum(["Cel", "bar", "Pa", "1/min", "mm/s", "m/s2"])
      .optional(),
    expectedIntervalMs: z.number().int().min(100).max(86400000),
  })
  .strict()
  .refine(
    (b) =>
      ({
        temperature: "temperature:Cel",
        pressure: "pressure:bar",
        rpm: "rotational_speed:1/min",
        vibration: "vibration_velocity:mm/s",
      })[b.sourceKey] === `${b.meaning}:${b.unit}`,
    "Incompatible signal meaning/unit",
  )
  .refine(
    (b) =>
      !b.sourceUnit ||
      b.sourceUnit === b.unit ||
      (b.sourceUnit === "Pa" && b.unit === "bar"),
    "Incompatible source/target engineering units",
  );
export const packageManifestSchema = z
  .object({
    schemaVersion: z.literal("smart-factory-model-1"),
    name: z.string().trim().min(1).max(100),
    provenance: z.string().trim().min(1).max(500),
    license: z.string().trim().min(1).max(200),
    units: z.literal("m"),
    handedness: z.literal("right"),
    upAxis: z.literal("+Y"),
    components: z.array(component).min(1).max(128),
    bindings: z.array(localBindingSchema).max(32),
    maintenanceText: z.string().max(4000).nullable(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const ids = new Set(m.components.map((c) => c.templateComponentId));
    if (
      ids.size !== m.components.length ||
      new Set(m.components.map((c) => c.nodeIndex)).size !==
        m.components.length ||
      new Set(m.components.map((c) => c.nodePath)).size !==
        m.components.length ||
      new Set(m.bindings.map((b) => b.sourceKey)).size !== m.bindings.length ||
      m.bindings.some((b) => !ids.has(b.templateComponentId))
    )
      ctx.addIssue({
        code: "custom",
        message: "Ambiguous component or tag binding",
      });
    for (const c of m.components) {
      const seen = new Set([c.templateComponentId]);
      let p = c.parentTemplateComponentId;
      while (p) {
        if (seen.has(p) || !ids.has(p)) {
          ctx.addIssue({
            code: "custom",
            message: "Invalid component hierarchy",
          });
          break;
        }
        seen.add(p);
        p =
          m.components.find((c) => c.templateComponentId === p)
            ?.parentTemplateComponentId ?? null;
      }
    }
  });
export function validateModelPackage(bytes: Buffer, input: unknown) {
  const m = packageManifestSchema.parse(input),
    budget = inspectGlb(bytes);
  const g = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
  if (
    g.extensionsRequired?.length ||
    g.extensionsUsed?.length ||
    g.skins?.length ||
    g.animations?.length
  )
    throw new Error(
      "Required extensions, skins and animations are unsupported by the admitted static model format",
    );
  for (const c of m.components) {
    const parts = c.nodePath.split("/").filter(Boolean);
    let indices = g.scenes?.[g.scene ?? 0]?.nodes ?? [],
      index = -1;
    for (const name of parts) {
      const found = indices.filter((i: number) => g.nodes?.[i]?.name === name);
      if (found.length !== 1)
        throw new Error("Missing or ambiguous scene path");
      index = found[0];
      indices = g.nodes[index].children ?? [];
    }
    if (index !== c.nodeIndex)
      throw new Error("Revision scene path/index mismatch");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex"),
    id =
      "local-import:" +
      createHash("sha256")
        .update(sha256 + JSON.stringify(m))
        .digest("hex");
  return {
    id,
    sha256,
    budget,
    manifest: {
      ...m,
      revision: id,
      sha256,
      status: "Locally imported immutable model package",
    },
  };
}
export async function importModel(
  bytes: Buffer,
  input: unknown,
  actor: number,
) {
  const v = validateModelPackage(bytes, input),
    db = await database();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(202610254)`);
    const [r] = await tx.execute(
      sql`select coalesce(sum(bytes),0) as n,count(*) as count from equipment_model_packages`,
    );
    if (
      Number(r.n) + bytes.length > 256 * 1024 * 1024 ||
      Number(r.count) >= 100
    )
      throw new Error(
        "Local model storage limit reached (256 MiB / 100 packages)",
      );
    await tx.execute(
      sql`insert into equipment_model_packages (id,manifest,glb,sha256,bytes,created_by) values (${v.id},${JSON.stringify(v.manifest)}::jsonb,${bytes}::bytea,${v.sha256},${bytes.length},${actor}) on conflict do nothing`,
    );
    return { revision: v.id, sha256: v.sha256, budget: v.budget };
  });
}
export async function importedTemplate(revision: string) {
  const db = await database();
  const [r] = await db.execute(
    sql`select manifest from equipment_model_packages where id=${revision}`,
  );
  if (!r) throw new Error("Unsupported model revision");
  return r.manifest as any;
}
export async function importedBytes(revision: string) {
  const db = await database();
  const [r] = await db.execute(
    sql`select glb,sha256 from equipment_model_packages where id=${revision}`,
  );
  if (!r) throw new Error("Model unavailable");
  const bytes = Buffer.from(r.glb as Uint8Array);
  if (createHash("sha256").update(bytes).digest("hex") !== r.sha256)
    throw new Error("Stored model revision mismatch");
  return bytes;
}
export async function modelCatalog() {
  const db = await database();
  return (await db.execute(
    sql`select id,manifest->>'name' as name,sha256,bytes from equipment_model_packages order by created_at desc limit 100`,
  )) as unknown as Array<{
    id: string;
    name: string;
    sha256: string;
    bytes: number;
  }>;
}

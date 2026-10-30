import {
  passportFields,
  PASSPORT_DISCLAIMER,
  type PassportDocument,
} from "../shared/passport";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getAssetRecordById, getDb, type Asset } from "./db";
import { demoOnlyRead } from "./demoData";
export const passportField = z.enum(
  Object.keys(passportFields) as [
    keyof typeof passportFields,
    ...(keyof typeof passportFields)[],
  ],
);
export const publicationInput = z
  .object({
    id: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
    fields: z
      .array(passportField)
      .min(1)
      .max(Object.keys(passportFields).length),
    reviewedGuidance: z.string().trim().max(4000).default(""),
  })
  .strict();
const document = (
  asset: Asset,
  fields: (keyof typeof passportFields)[],
  guidance: string,
): PassportDocument => ({
  title: fields.includes("name") ? asset.name : "Product passport",
  fields: [...new Set(fields)].flatMap((key) =>
    asset[key] == null || asset[key] === ""
      ? []
      : [{ key, label: passportFields[key], value: String(asset[key]) }],
  ),
  reviewedGuidance: guidance || null,
  disclaimer: PASSPORT_DISCLAIMER,
  publishedAt: null,
});
const missing = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "Passport unavailable or unpublished",
  });
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Passport storage unavailable",
    });
  return db;
}
export async function previewPassport(id: number) {
  const asset = await getAssetRecordById(id);
  if (!asset || (demoOnlyRead() && !asset.isDemo)) throw missing();
  return {
    ...document(
      asset,
      Object.keys(passportFields) as (keyof typeof passportFields)[],
      "",
    ),
    assetVersion: asset.aasVersion,
    assetId: asset.id,
    isDemo: asset.isDemo,
  };
}
export async function publishPassport(
  input: z.infer<typeof publicationInput>,
  actor: number,
) {
  const db = await database();
  return db.transaction(async (tx) => {
    const [asset] = await tx.execute(
      sql`select * from assets where id=${input.id} and "isDemo"=false for update`,
    );
    if (!asset) throw missing();
    if (Number(asset.aasVersion) !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The asset changed. Refresh the private preview before publishing.",
      });
    const id = randomUUID(),
      publishedAt = new Date().toISOString();
    const snapshot = {
      ...document(
        asset as unknown as Asset,
        input.fields,
        input.reviewedGuidance,
      ),
      publicId: id,
      publishedAt,
    };
    await tx.execute(
      sql`insert into asset_passport_publications(id,asset_id,document,published_by,published_at) values(${id},${input.id},${JSON.stringify(snapshot)}::jsonb,${actor},${publishedAt}::timestamptz)`,
    );
    return { publicId: id, publishedAt };
  });
}
export async function getPublishedPassport(
  id: string,
): Promise<PassportDocument> {
  const db = await database(),
    [row] = await db.execute(
      sql`select document from asset_passport_publications where id=${id} and revoked_at is null`,
    );
  if (!row) throw missing();
  return row.document as PassportDocument;
}
export async function publications(assetId: number) {
  if (!(await getAssetRecordById(assetId))) throw missing();
  const db = await database();
  return db.execute<{
    id: string;
    publishedAt: string;
    revokedAt: string | null;
  }>(
    sql`select id,published_at as "publishedAt",revoked_at as "revokedAt" from asset_passport_publications where asset_id=${assetId} order by published_at desc limit 50`,
  );
}
export async function revokePassport(id: string) {
  const db = await database();
  const [row] = await db.execute(
    sql`update asset_passport_publications set revoked_at=coalesce(revoked_at,now()) where id=${id} returning id`,
  );
  if (!row) throw missing();
  return { revoked: true };
}

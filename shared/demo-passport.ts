import { z } from "zod";

/** Only authored demonstration identity belongs in a portable demo link. */
export const demoPassportIdentity = z
  .object({
    assetId: z.string().trim().min(1).max(180),
    name: z.string().trim().min(1).max(180),
    assetType: z.string().trim().min(1).max(80),
    manufacturer: z.string().trim().max(180).default(""),
    model: z.string().trim().max(100).default(""),
    serialNumber: z.string().trim().max(100).default(""),
    zone: z.string().trim().max(80).nullable().default(null),
  })
  .strict();
export type DemoPassportIdentity = z.infer<typeof demoPassportIdentity>;

// Version the identity separately from the AAS model so a scanned label remains
// an explicit demo snapshot, never a publication or an authorization token.
const payload = z.tuple([
  z.literal(1),
  demoPassportIdentity.shape.assetId,
  demoPassportIdentity.shape.name,
  demoPassportIdentity.shape.assetType,
  demoPassportIdentity.shape.manufacturer,
  demoPassportIdentity.shape.model,
  demoPassportIdentity.shape.serialNumber,
  demoPassportIdentity.shape.zone,
]);
export const MAX_DEMO_PASSPORT_TOKEN_LENGTH = 900;
export const MAX_DEMO_PASSPORT_URL_LENGTH = 1100;

export function encodeDemoPassport(input: DemoPassportIdentity): string {
  const item = demoPassportIdentity.parse(input);
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      1,
      item.assetId,
      item.name,
      item.assetType,
      item.manufacturer,
      item.model,
      item.serialNumber,
      item.zone,
    ]),
  );
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  if (token.length > MAX_DEMO_PASSPORT_TOKEN_LENGTH)
    throw new Error("This demo identity is too long for a scannable QR label.");
  return token;
}

export function decodeDemoPassport(token: string): DemoPassportIdentity | null {
  if (
    !token ||
    token.length > MAX_DEMO_PASSPORT_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  )
    return null;
  try {
    const encoded = token.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = payload.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    const [
      ,
      assetId,
      name,
      assetType,
      manufacturer,
      model,
      serialNumber,
      zone,
    ] = decoded;
    const identity = {
      assetId,
      name,
      assetType,
      manufacturer,
      model,
      serialNumber,
      zone,
    };
    // Reject noncanonical encodings and hidden/trailing input.
    return encodeDemoPassport(identity) === token ? identity : null;
  } catch {
    return null;
  }
}

export function demoPassportPath(input: DemoPassportIdentity): string {
  return `/passport/demo/${encodeDemoPassport(input)}`;
}

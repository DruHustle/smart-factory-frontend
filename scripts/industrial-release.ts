import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bundledAssets } from "../shared/bundled-assets";

const publicRoot = resolve(import.meta.dirname, "../client/public");
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Read-only release verification. Expected bytes come from the exact release checkout. */
export async function verifyIndustrialRelease(
  origin: URL,
  fetcher: typeof fetch = fetch,
) {
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      "Asset verification requires an HTTPS origin without credentials or a path",
    );
  const receipts: { path: string; bytes: number; sha256: string }[] = [];
  for (const asset of bundledAssets) {
    const paths = [
      ...Object.values(asset.models).map((m) => m.url),
      asset.previewUrl,
      asset.licenseFileUrl,
      asset.sourceReceiptUrl,
    ];
    for (const path of paths) {
      if (!/^\/models\/(nvidia|authored)\/[a-z-]+\/[a-zA-Z0-9.-]+$/.test(path))
        throw new Error("Unreviewed release asset path");
      const expected = readFileSync(publicRoot + path);
      if (!expected.length || expected.length > 20 * 1024 * 1024)
        throw new Error("Release asset exceeds byte budget");
      const sha256 = digest(expected);
      const model = Object.values(asset.models).find((m) => m.url === path);
      if (model && (model.sha256 !== sha256 || model.bytes !== expected.length))
        throw new Error("Release checkout and asset catalogue disagree");
      const response = await fetcher(new URL(path, origin), {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        headers: { accept: "*/*", "cache-control": "no-cache" },
        signal: AbortSignal.timeout(20000),
      });
      if (response.status !== 200 || response.redirected || !response.body) {
        await response.body?.cancel();
        throw new Error(
          `Deployed asset ${path} returned HTTP ${response.status} or unexpected delivery`,
        );
      }
      const reader = response.body.getReader();
      const hash = createHash("sha256");
      let size = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > expected.length)
            throw new Error(
              `Deployed asset ${path} exceeds its reviewed byte budget`,
            );
          hash.update(item.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (size !== expected.length || hash.digest("hex") !== sha256)
        throw new Error(
          `Deployed asset ${path} failed byte-for-byte release verification`,
        );
      receipts.push({ path, bytes: size, sha256 });
    }
  }
  return receipts;
}

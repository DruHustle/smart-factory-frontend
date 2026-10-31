import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyIndustrialRelease } from "../../scripts/industrial-release";

const root = resolve(import.meta.dirname, "../../client/public");
const origin = new URL("https://smart-factory.example/");
const content = (url: string | URL | Request) => readFileSync(root + new URL(String(url)).pathname);

describe("production NVIDIA asset qualification", () => {
  it("verifies all six models, three previews, licenses and source receipts without credentials or writes", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      expect(new URL(String(url)).origin).toBe(origin.origin);
      expect(options).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store" });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return new Response(content(url));
    });
    const receipts = await verifyIndustrialRelease(origin, fetcher);
    expect(receipts).toHaveLength(15);
    expect(receipts.filter((r) => r.path.endsWith(".glb"))).toHaveLength(6);
    expect(receipts.every((r) => r.bytes > 0 && /^[a-f0-9]{64}$/.test(r.sha256))).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(15);
  });
  for (const mode of ["missing", "html-fallback", "corrupted-model", "truncated", "oversized", "changed-license", "changed-provenance"]) {
    it(`rejects ${mode} rather than declaring deployment successful`, async () => {
      const fetcher: typeof fetch = async (url) => {
        const path = new URL(String(url)).pathname;
        const bytes = content(url);
        if (mode === "missing") return new Response("missing", { status: 404 });
        if (mode === "html-fallback") return new Response("<html>not a model</html>");
        if (mode === "truncated") return new Response(bytes.subarray(1));
        if (mode === "oversized") return new Response(Buffer.concat([bytes, Buffer.from([0])]));
        if (mode === "corrupted-model" || (mode === "changed-license" && path.endsWith("LICENSE.txt")) || (mode === "changed-provenance" && path.endsWith("SOURCE.json"))) bytes[bytes.length - 1] ^= 1;
        return new Response(bytes);
      };
      await expect(verifyIndustrialRelease(origin, fetcher)).rejects.toThrow(/Deployed asset/);
    });
  }
  it("rejects unsafe release origins before making any request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const url of ["http://example.test", "https://user:pass@example.test", "https://example.test/path", "https://example.test/?query=1", "https://example.test/#fragment"]) {
      await expect(verifyIndustrialRelease(new URL(url), fetcher)).rejects.toThrow(/HTTPS origin/);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});

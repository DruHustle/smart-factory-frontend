import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { industrialAssets } from "../../shared/industrial-assets";
import { floorReferenceBytes } from "../../client/src/components/workspace/factory-reference-delivery";

afterEach(() => vi.unstubAllGlobals());

describe("reviewed NVIDIA references on the factory floor", () => {
  for (const [floor, slug] of [
    ["conveyor", "nvidia-transfer-conveyor"],
    ["warehouse-rack", "nvidia-storage-rack"],
    ["mobile-cart", "nvidia-mobile-cart"],
  ]) {
    it(`loads and verifies the compact ${slug} for ${floor}`, async () => {
      const model = industrialAssets.find((asset) => asset.slug === slug)!
        .models.compact;
      const bytes = readFileSync("client/public" + model.url);
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(new Uint8Array(bytes)),
      );
      vi.stubGlobal("window", {
        location: { origin: "https://factory.example" },
      });
      vi.stubGlobal("crypto", webcrypto);
      vi.stubGlobal("fetch", fetchMock);
      const result = await floorReferenceBytes(floor);
      expect(result.byteLength).toBe(model.bytes);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        "https://factory.example" + model.url,
      );
    });
  }

  it("rejects a tampered reference instead of rendering it", async () => {
    const model = industrialAssets.find(
      (asset) => asset.slug === "nvidia-mobile-cart",
    )!.models.compact;
    const bytes = new Uint8Array(readFileSync("client/public" + model.url));
    bytes[bytes.length - 1] ^= 1;
    vi.stubGlobal("window", {
      location: { origin: "https://factory.example" },
    });
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes)),
    );
    await expect(floorReferenceBytes("mobile-cart")).rejects.toThrow(
      "integrity",
    );
  });

  it("rejects a missing reference and never fetches an unknown model", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("window", {
      location: { origin: "https://factory.example" },
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(floorReferenceBytes("mobile-cart")).rejects.toThrow("404");
    await expect(floorReferenceBytes("not-a-reference")).rejects.toThrow(
      "Unknown reference",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

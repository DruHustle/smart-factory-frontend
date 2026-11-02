import { floorModelUrl, floorNvidiaAsset } from "@shared/factory-floor";

/** Load only reviewed floor references; imported assets never change live data. */
export async function floorReferenceBytes(slug: string): Promise<ArrayBuffer> {
  const nvidiaSlug = floorNvidiaAsset(slug);
  if (nvidiaSlug) {
    // Keep the larger catalog out of initial floor startup until it is needed.
    const [{ industrialAssets }, { fetchBundledModel }] = await Promise.all([
      import("@shared/industrial-assets"),
      import("../equipment/modelDelivery"),
    ]);
    const asset = industrialAssets.find((item) => item.slug === nvidiaSlug);
    if (!asset) throw Error("Reviewed factory reference unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      // Match the library's bounded same-origin delivery and SHA-256 check.
      const bytes = await fetchBundledModel(
        asset.models.compact,
        controller.signal,
      );
      return new Uint8Array(bytes).buffer;
    } finally {
      clearTimeout(timer);
    }
  }
  const url = floorModelUrl(slug);
  if (!url) throw Error("Unknown reference");
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw Error("Reference model unavailable");
  return response.arrayBuffer();
}

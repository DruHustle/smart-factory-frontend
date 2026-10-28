import {
  CubeUVReflectionMapping,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
} from "three";
import studioUrl from "@/assets/equipment/studio-environment.bin.gz?url";

type Atlas = { width: number; height: number; pixels: Uint16Array };
let pending: Promise<Atlas> | undefined;

/** Public, immutable lighting only. Private equipment/model bytes are never cached here. */
export function preloadStudioEnvironment() {
  return (pending ??= (async () => {
    const response = await fetch(studioUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Studio lighting unavailable");
    let buffer = await response.arrayBuffer();
    const signature = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    // Some hosts serve .gz with Content-Encoding; fetch already decompresses it.
    if (signature[0] === 31 && signature[1] === 139) {
      const stream = new Blob([buffer])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
      buffer = await new Response(stream).arrayBuffer();
    }
    if (buffer.byteLength !== 12 + 384 * 512 * 8)
      throw new Error("Studio atlas size mismatch");
    const header = new DataView(buffer);
    if (
      header.getUint32(0, false) !== 0x53464531 ||
      header.getUint32(4, true) !== 384 ||
      header.getUint32(8, true) !== 512
    )
      throw new Error("Studio atlas format mismatch");
    return { width: 384, height: 512, pixels: new Uint16Array(buffer, 12) };
  })().catch((error) => {
    pending = undefined;
    throw error;
  }));
}

/** Each viewer owns its GPU texture; concurrent viewers share only read-only public pixels. */
export async function createStudioEnvironment() {
  const atlas = await preloadStudioEnvironment();
  const texture = new DataTexture(
    atlas.pixels,
    atlas.width,
    atlas.height,
    RGBAFormat,
    HalfFloatType,
  );
  texture.name = "Smart Factory baked HDR studio";
  texture.mapping = CubeUVReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

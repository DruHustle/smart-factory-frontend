import * as T from "three";

/** A quiet studio sweep keeps dark support feet legible without changing PBR. */
export function studioBackdrop(dark: boolean) {
  const top = dark ? [16, 26, 42] : [246, 248, 250];
  const bottom = dark ? [43, 59, 77] : [220, 229, 237];
  const height = 128;
  const pixels = new Uint8Array(height * 4);
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const smooth = t * t * (3 - 2 * t);
    for (let channel = 0; channel < 3; channel++)
      pixels[y * 4 + channel] = Math.round(
        bottom[channel] + (top[channel] - bottom[channel]) * smooth,
      );
    pixels[y * 4 + 3] = 255;
  }
  const texture = new T.DataTexture(pixels, 1, height, T.RGBAFormat);
  texture.colorSpace = T.SRGBColorSpace;
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** RGBA pixels, row by row, as in ImageData. */
export type Raster = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };

export function makeRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Hue in degrees [0, 360), saturation and value in [0, 1]. */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

/** Colour with brightness divided out, so a shadow on the cloth still looks like cloth. */
export type Tone = { cr: number; cg: number; lum: number };

export function toneOf(r: number, g: number, b: number): Tone {
  const sum = r + g + b + 1e-6;
  return { cr: r / sum, cg: g / sum, lum: sum / 765 };
}

/** Same chromaticity as the cloth and neither much darker nor much brighter. */
export function looksLikeCloth(r: number, g: number, b: number, cloth: Tone, chromaTol = 0.07): boolean {
  const sum = r + g + b + 1e-6;
  const dr = r / sum - cloth.cr;
  const dg = g / sum - cloth.cg;
  if (dr * dr + dg * dg > chromaTol * chromaTol) return false;
  const ratio = sum / 765 / Math.max(cloth.lum, 1e-3);
  return ratio > 0.42 && ratio < 1.7;
}

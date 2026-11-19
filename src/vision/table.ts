import { TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import { applyH, homography, type Homography } from './homography';
import { makeRaster, type Raster } from './raster';

const { L, W } = TABLE;

/** Cloth on the cushions reaches roughly this far beyond the nose line when seen from above. */
export const CUSHION_WIDTH = 0.05;

/** True when the table's long rails run across the picture rather than up and down it. */
export function longSideHorizontal(c: Vec2[]): boolean {
  const d = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
  return d(c[0], c[1]) + d(c[3], c[2]) >= d(c[1], c[2]) + d(c[0], c[3]);
}

/**
 * Table metres -> picture pixels, from the four corners of the playing surface as they appear
 * in the picture (top-left, top-right, bottom-right, bottom-left). The table is laid out the
 * way the app draws it: long side across in landscape, or turned a quarter clockwise in portrait.
 */
export function tableToImage(corners: Vec2[], horizontal: boolean, margin = 0): Homography {
  const lo = -margin;
  const table = horizontal
    ? [
        { x: lo, y: W + margin },
        { x: L + margin, y: W + margin },
        { x: L + margin, y: lo },
        { x: lo, y: lo },
      ]
    : [
        { x: lo, y: lo },
        { x: lo, y: W + margin },
        { x: L + margin, y: W + margin },
        { x: L + margin, y: lo },
      ];
  return homography(table, corners);
}

/** Playing-surface corners from the corners of the whole cloth-coloured area (bed plus cushions). */
export function playingCorners(clothQuad: Vec2[], horizontal: boolean): Vec2[] {
  const h = tableToImage(clothQuad, horizontal, CUSHION_WIDTH);
  const pts = horizontal
    ? [
        { x: 0, y: W },
        { x: L, y: W },
        { x: L, y: 0 },
        { x: 0, y: 0 },
      ]
    : [
        { x: 0, y: 0 },
        { x: 0, y: W },
        { x: L, y: W },
        { x: L, y: 0 },
      ];
  return pts.map((p) => applyH(h, p));
}

/**
 * The playing surface resampled to a flat picture, `scale` pixels per metre.
 * Pixel (i, j) is the table point ((i + 0.5) / scale, W - (j + 0.5) / scale).
 */
export function rectify(img: Raster, toImage: Homography, scale: number): Raster {
  const out = makeRaster(Math.round(L * scale), Math.round(W * scale));
  for (let j = 0; j < out.height; j++) {
    for (let i = 0; i < out.width; i++) {
      const p = applyH(toImage, { x: (i + 0.5) / scale, y: W - (j + 0.5) / scale });
      const sx = Math.round(p.x - 0.5);
      const sy = Math.round(p.y - 0.5);
      const o = (j * out.width + i) * 4;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) {
        out.data[o + 3] = 0;
        continue;
      }
      const s = (sy * img.width + sx) * 4;
      out.data[o] = img.data[s];
      out.data[o + 1] = img.data[s + 1];
      out.data[o + 2] = img.data[s + 2];
      out.data[o + 3] = 255;
    }
  }
  return out;
}

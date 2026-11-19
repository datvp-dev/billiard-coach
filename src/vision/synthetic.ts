import { TABLE } from '../core/config';
import { POCKET_IDS, pocketCenter } from '../core/table';
import type { Vec2 } from '../core/types';
import { applyH, invertH } from './homography';
import { makeRaster, type Raster } from './raster';
import { CUSHION_WIDTH, tableToImage } from './table';

const { L, W, R } = TABLE;
type RGB = [number, number, number];

export const BALL_RGB: Record<number, RGB> = {
  0: [242, 240, 232],
  1: [245, 200, 20],
  2: [25, 60, 170],
  3: [215, 30, 30],
  4: [90, 40, 140],
  5: [240, 120, 20],
  6: [10, 75, 35],
  7: [120, 25, 30],
  8: [15, 15, 15],
};
const WHITE: RGB = [242, 240, 232];

export type FakeBall = { id: number; pos: Vec2 };

/**
 * A flat-world picture of a table for tests: green cloth over bed and cushions, wooden rails,
 * grey floor, dark pockets and painted discs for balls (stripes for 9 and up).
 * `corners` are the playing-surface corners in the picture: top-left, top-right, bottom-right, bottom-left.
 */
export function drawTable(width: number, height: number, corners: Vec2[], horizontal: boolean, balls: FakeBall[]): Raster {
  const img = makeRaster(width, height);
  const toTable = invertH(tableToImage(corners, horizontal));
  const pockets = POCKET_IDS.map(pocketCenter);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = applyH(toTable, { x: x + 0.5, y: y + 0.5 });
      let c: RGB = [92, 92, 98];
      const out = Math.max(-t.x, t.x - L, -t.y, t.y - W);
      if (out <= CUSHION_WIDTH) {
        // Cloth, a little brighter toward one end like a table under a lamp.
        const k = 0.9 + 0.2 * (t.x / L);
        c = [30 * k, 120 * k, 80 * k];
      } else if (out <= 0.17) c = [118, 78, 48];
      for (const p of pockets) if (Math.hypot(t.x - p.x, t.y - p.y) < 0.058) c = [8, 8, 8];
      for (const b of balls) {
        const dx = t.x - b.pos.x;
        const dy = t.y - b.pos.y;
        const d = Math.hypot(dx, dy);
        if (d > R) continue;
        const base = BALL_RGB[b.id > 8 ? b.id - 8 : b.id];
        if (b.id === 0) c = WHITE;
        else if (b.id > 8) c = Math.abs(dy) > 0.45 * R ? WHITE : base;
        else c = d < 0.3 * R ? WHITE : base;
      }
      const o = (y * width + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  return img;
}

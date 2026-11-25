import { TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import { cameraFromPlane } from './camera';
import { applyH, homography, type Homography } from './homography';

const { L, W } = TABLE;

/** Cloth on the cushions reaches roughly this far beyond the nose line when seen from above. */
export const CUSHION_WIDTH = 0.05;

/**
 * True when the table's long rails run across the picture rather than up and down it. A table
 * seen from one end can look wider than it is deep, so what decides is which way round a
 * two-to-one table could really have been photographed like this.
 */
export function longSideHorizontal(c: Vec2[], width: number, height: number): boolean {
  const misfit = (horizontal: boolean) => cameraFromPlane(tableToImage(c, horizontal), width, height).misfit;
  const across = misfit(true);
  const along = misfit(false);
  if (Math.abs(across - along) > 0.08) return across < along;
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

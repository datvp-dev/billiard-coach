import { TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import { applyH } from '../vision/homography';
import type { Raster } from '../vision/raster';
import { tableToImage } from '../vision/table';

const { L, W } = TABLE;

/** Colours at fixed places on and around the rails; -1 where the place is outside the picture. */
export type ViewSignature = Float32Array;

const PER_SIDE = 20;
/** Metres outside the nose line: on the bed, on the cushion, on the rail, past the rail. */
const OFFSETS = [-0.05, 0.025, 0.1, 0.22];

/** What the surroundings of the table look like; changes when the broadcast cuts to another camera. */
export function viewSignature(img: Raster, corners: Vec2[], horizontal: boolean): ViewSignature {
  const h = tableToImage(corners, horizontal);
  const out = new Float32Array(PER_SIDE * 4 * OFFSETS.length * 3);
  let o = 0;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < PER_SIDE; i++) {
      const t = (i + 0.5) / PER_SIDE;
      for (const d of OFFSETS) {
        const p = side === 0 ? { x: t * L, y: -d } : side === 1 ? { x: t * L, y: W + d } : side === 2 ? { x: -d, y: t * W } : { x: L + d, y: t * W };
        const q = applyH(h, p);
        const cx = Math.round(q.x);
        const cy = Math.round(q.y);
        let n = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let y = cy - 2; y <= cy + 2; y++) {
          for (let x = cx - 2; x <= cx + 2; x++) {
            if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
            const k = (y * img.width + x) * 4;
            r += img.data[k];
            g += img.data[k + 1];
            b += img.data[k + 2];
            n++;
          }
        }
        out[o++] = n ? r / n : -1;
        out[o++] = n ? g / n : -1;
        out[o++] = n ? b / n : -1;
      }
    }
  }
  return out;
}

/**
 * Share of places that look the same, 0..1. Players leaning over the rails cost a few places;
 * another camera changes most of them. A change of overall brightness is allowed for.
 */
export function viewMatch(a: ViewSignature, b: ViewSignature): number {
  if (a.length !== b.length) return 0;
  const gains: number[] = [];
  for (let i = 0; i < a.length; i += 3) {
    const s = a[i] + a[i + 1] + a[i + 2];
    const t = b[i] + b[i + 1] + b[i + 2];
    if (a[i] >= 0 && b[i] >= 0 && s > 90 && t > 90) gains.push(t / s);
  }
  gains.sort((p, q) => p - q);
  const gain = gains.length ? Math.min(1.4, Math.max(0.7, gains[gains.length >> 1])) : 1;
  let same = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (a[i] < 0 || b[i] < 0) continue;
    n++;
    const d = Math.hypot(a[i] * gain - b[i], a[i + 1] * gain - b[i + 1], a[i + 2] * gain - b[i + 2]);
    if (d < 42) same++;
  }
  return n ? same / n : 0;
}

export const SAME_VIEW = 0.62;

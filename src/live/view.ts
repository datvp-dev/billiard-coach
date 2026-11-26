import { TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import { applyH } from '../vision/homography';
import { bend, TRUE_LENS, type Lens } from '../vision/lens';
import type { Raster } from '../vision/raster';
import { tableToImage } from '../vision/table';

const { L, W, R } = TABLE;

/** Colours at fixed places on and around the rails; -1 where the place is outside the picture. */
export type ViewSignature = Float32Array;

const PER_SIDE = 20;
/** Metres outside the nose line: on the bed, on the cushion, on the rail, past the rail. */
const OFFSETS = [-0.05, 0.025, 0.1, 0.22];

/**
 * What the surroundings of the table look like; changes when the broadcast cuts to another camera.
 * `img` is the picture as taken; `corners` are on the straightened picture, as for `lens`.
 */
export function viewSignature(img: Raster, corners: Vec2[], horizontal: boolean, lens: Lens = TRUE_LENS): ViewSignature {
  const h = tableToImage(corners, horizontal);
  const out = new Float32Array(PER_SIDE * 4 * OFFSETS.length * 3);
  let o = 0;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < PER_SIDE; i++) {
      const t = (i + 0.5) / PER_SIDE;
      for (const d of OFFSETS) {
        const p = side === 0 ? { x: t * L, y: -d } : side === 1 ? { x: t * L, y: W + d } : side === 2 ? { x: -d, y: t * W } : { x: L + d, y: t * W };
        const q = bend(applyH(h, p), lens, img.width, img.height);
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

/**
 * Which of the chosen views a picture is, given its signature for each of them: the one it looks
 * most like, or -1 when it is none of them. A view with no reference yet is taken at once.
 */
export function pickView(refs: (ViewSignature | null)[], seen: ViewSignature[]): number {
  const fresh = refs.indexOf(null);
  if (fresh >= 0) return fresh;
  let best = -1;
  let score = SAME_VIEW;
  refs.forEach((r, i) => {
    const m = viewMatch(r!, seen[i]);
    if (m >= score) (best = i), (score = m);
  });
  return best;
}

/** How many of `a` have one of `b` within `near`, each used once. */
function matches(a: Vec2[], b: Vec2[], near: number): number {
  const all: [number, number, number][] = [];
  a.forEach((p, i) => b.forEach((q, j) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d <= near) all.push([d, i, j]);
  }));
  all.sort((p, q) => p[0] - q[0]);
  const ua = new Set<number>();
  const ub = new Set<number>();
  for (const [, i, j] of all) if (!ua.has(i) && !ub.has(j)) ua.add(i), ub.add(j);
  return ua.size;
}

/**
 * The table looks the same from both ends: a frame lined up on a new camera may have it the other
 * way round. True when the balls found on it lie where the known ones are once turned round.
 */
export function turnedRound(found: Vec2[], known: Vec2[]): boolean {
  const near = 2 * R;
  return matches(found.map((p) => ({ x: L - p.x, y: W - p.y })), known, near) > matches(found, known, near);
}

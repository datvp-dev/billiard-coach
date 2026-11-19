import type { Vec2 } from '../core/types';

/** Row-major 3x3 projective transform. */
export type Homography = number[];

/** The transform taking each `from[i]` to `to[i]` (four point pairs, no three collinear). */
export function homography(from: Vec2[], to: Vec2[]): Homography {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8x9 augmented matrix.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c] || 1e-12;
    for (let k = c; k < 9; k++) a[c][k] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f !== 0) for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k];
    }
  }
  return [a[0][8], a[1][8], a[2][8], a[3][8], a[4][8], a[5][8], a[6][8], a[7][8], 1];
}

export function applyH(h: Homography, p: Vec2): Vec2 {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

export function invertH(h: Homography): Homography {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i;
  const B = -(d * j - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [A / det, (c * i - b * j) / det, (b * f - c * e) / det, B / det, (a * j - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * i) / det, (a * e - b * d) / det];
}

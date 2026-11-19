import type { Vec2 } from '../core/types';
import { looksLikeCloth, toneOf, type Raster, type Tone } from './raster';

/** The colour that fills most of the middle of the picture, taken to be the cloth. */
export function estimateCloth(img: Raster): Tone | null {
  const BINS = 24;
  const counts = new Float64Array(BINS * BINS);
  const sums = new Float64Array(BINS * BINS * 3);
  const x0 = Math.floor(img.width * 0.25);
  const x1 = Math.ceil(img.width * 0.75);
  const y0 = Math.floor(img.height * 0.25);
  const y1 = Math.ceil(img.height * 0.75);
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 120));
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * img.width + x) * 4;
      const t = toneOf(img.data[i], img.data[i + 1], img.data[i + 2]);
      if (t.lum < 0.08) continue;
      const k = Math.min(BINS - 1, Math.floor(t.cr * BINS)) * BINS + Math.min(BINS - 1, Math.floor(t.cg * BINS));
      counts[k]++;
      sums[k * 3] += t.cr;
      sums[k * 3 + 1] += t.cg;
      sums[k * 3 + 2] += t.lum;
    }
  }
  let best = -1;
  for (let k = 0; k < counts.length; k++) if (best < 0 || counts[k] > counts[best]) best = k;
  if (best < 0 || counts[best] === 0) return null;
  const n = counts[best];
  return { cr: sums[best * 3] / n, cg: sums[best * 3 + 1] / n, lum: sums[best * 3 + 2] / n };
}

function convexHull(pts: Vec2[]): Vec2[] {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function lineHit(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  return { x: a.x + rx * t, y: a.y + ry * t };
}

/**
 * Shrinks a convex polygon to four sides by repeatedly dropping the side whose removal
 * (extending its two neighbours until they meet) adds the least area. Corners cut off by
 * pockets or a hand are restored this way.
 */
export function enclosingQuad(hull: Vec2[]): Vec2[] | null {
  let poly = hull.slice();
  while (poly.length > 4) {
    const n = poly.length;
    let bestI = -1;
    let bestArea = Infinity;
    let bestP: Vec2 | null = null;
    for (let i = 0; i < n; i++) {
      const prev = poly[(i + n - 1) % n];
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const next = poly[(i + 2) % n];
      const p = lineHit(prev, a, next, b);
      if (!p) continue;
      // The meeting point must lie beyond a (coming from prev) and beyond b (coming from next).
      if ((p.x - a.x) * (a.x - prev.x) + (p.y - a.y) * (a.y - prev.y) < 0) continue;
      if ((p.x - b.x) * (b.x - next.x) + (p.y - b.y) * (b.y - next.y) < 0) continue;
      const area = Math.abs((a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x)) / 2;
      if (area < bestArea) {
        bestArea = area;
        bestI = i;
        bestP = p;
      }
    }
    if (bestI < 0 || !bestP) return null;
    const j = (bestI + 1) % n;
    poly[bestI] = bestP;
    poly.splice(j, 1);
  }
  return poly.length === 4 ? poly : null;
}

/** Top-left, top-right, bottom-right, bottom-left as they appear in the picture (y grows downward). */
export function orderCorners(q: Vec2[]): Vec2[] {
  const cx = q.reduce((s, p) => s + p.x, 0) / q.length;
  const cy = q.reduce((s, p) => s + p.y, 0) / q.length;
  const sorted = q.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]);
}

/**
 * Four corners of the cloth-coloured area (bed plus cushions) in picture coordinates, ordered
 * as `orderCorners` does. Null when no large cloth-coloured area is found.
 */
export function findClothQuad(img: Raster): Vec2[] | null {
  const cloth = estimateCloth(img);
  if (!cloth) return null;
  const f = Math.max(1, Math.ceil(Math.max(img.width, img.height) / 320));
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  if (w < 8 || h < 8) return null;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y * f + (f >> 1)) * img.width + x * f + (f >> 1)) * 4;
      if (looksLikeCloth(img.data[i], img.data[i + 1], img.data[i + 2], cloth)) mask[y * w + x] = 1;
    }
  }
  // Largest 4-connected region of cloth.
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let bestLabel = 0;
  let bestSize = 0;
  let next = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]) continue;
    next++;
    let top = 0;
    stack[top++] = s;
    label[s] = next;
    let size = 0;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const px = p % w;
      if (px > 0 && mask[p - 1] && !label[p - 1]) (label[p - 1] = next), (stack[top++] = p - 1);
      if (px < w - 1 && mask[p + 1] && !label[p + 1]) (label[p + 1] = next), (stack[top++] = p + 1);
      if (p >= w && mask[p - w] && !label[p - w]) (label[p - w] = next), (stack[top++] = p - w);
      if (p < w * (h - 1) && mask[p + w] && !label[p + w]) (label[p + w] = next), (stack[top++] = p + w);
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
  }
  // Too small to be a table, or so large that the picture shows nothing but one colour.
  if (bestSize < w * h * 0.08 || bestSize > w * h * 0.9) return null;
  // First and last cloth pixel of every row are enough to build the hull.
  const edge: Vec2[] = [];
  for (let y = 0; y < h; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < w; x++) {
      if (label[y * w + x] === bestLabel) {
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    if (lo >= 0) edge.push({ x: lo, y }, { x: hi + 1, y }, { x: lo, y: y + 1 }, { x: hi + 1, y: y + 1 });
  }
  const quad = enclosingQuad(convexHull(edge));
  if (!quad) return null;
  return orderCorners(quad.map((p) => ({ x: p.x * f, y: p.y * f })));
}

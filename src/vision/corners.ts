import type { Vec2 } from '../core/types';
import { cameraFromPlane } from './camera';
import { makeRaster, rgbToHsv, toneOf, type Raster, type Tone } from './raster';
import { CUSHION_WIDTH, tableToImage } from './table';

type ClothTone = Tone & { sat: number };

/**
 * Tones that might be the cloth, most promising first: common in the picture, more so near its
 * middle, and a little more so for the usual green and blue. Grey and other pale cloths are
 * included; which tone really is the table is decided by the shape of the area it covers.
 */
export function clothTones(img: Raster, limit = 10): ClothTone[] {
  const BINS = 30;
  const LUM = 10;
  const size = BINS * BINS * LUM;
  const score = new Float64Array(size);
  const counts = new Float64Array(size);
  const sums = new Float64Array(size * 4);
  const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / 200));
  const bin = (t: Tone) => (Math.min(BINS - 1, Math.floor(t.cr * BINS)) * BINS + Math.min(BINS - 1, Math.floor(t.cg * BINS))) * LUM + Math.min(LUM - 1, Math.floor(t.lum * LUM));
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i];
      const g = img.data[i + 1];
      const b = img.data[i + 2];
      const t = toneOf(r, g, b);
      if (t.lum < 0.08) continue;
      const [hue, sat] = rgbToHsv(r, g, b);
      const k = bin(t);
      const central = Math.abs(x / img.width - 0.5) < 0.3 && Math.abs(y / img.height - 0.5) < 0.3 ? 2 : 1;
      const usual = sat >= 0.25 && hue >= 80 && hue <= 260 ? 2 : 1;
      score[k] += central * usual;
      counts[k]++;
      sums[k * 4] += t.cr;
      sums[k * 4 + 1] += t.cg;
      sums[k * 4 + 2] += t.lum;
      sums[k * 4 + 3] += sat;
    }
  }
  const order = Array.from(score.keys()).filter((k) => score[k] > 0);
  order.sort((p, q) => score[q] - score[p]);
  const out: ClothTone[] = [];
  for (const k of order) {
    if (out.length >= limit) break;
    const n = counts[k];
    const t = { cr: sums[k * 4] / n, cg: sums[k * 4 + 1] / n, lum: sums[k * 4 + 2] / n, sat: sums[k * 4 + 3] / n };
    if (out.some((o) => Math.hypot(o.cr - t.cr, o.cg - t.cg) < 0.02 && Math.abs(Math.log(o.lum / t.lum)) < 0.22)) continue;
    out.push(t);
  }
  return out;
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

/**
 * Top-left, top-right, bottom-right, bottom-left as they appear in the picture (y grows
 * downward). The "top" edge is the one highest in the picture, which also holds for a table
 * that perspective has squeezed into a wide trapezoid.
 */
export function orderCorners(q: Vec2[]): Vec2[] {
  const cx = q.reduce((s, p) => s + p.x, 0) / q.length;
  const cy = q.reduce((s, p) => s + p.y, 0) / q.length;
  const sorted = q.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const top = sorted[i].y + sorted[(i + 1) % 4].y;
    if (top < best) (best = top), (start = i);
  }
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]);
}

/** `bed` areas stop at the cushion noses; the others take in the cloth on the cushions too. */
export type ClothArea = { quad: Vec2[]; score: number; bed: boolean };

/** The four sides of a quad moved outward by `d`. */
function grow(quad: Vec2[], d: number): Vec2[] {
  const c = { x: quad.reduce((t, p) => t + p.x, 0) / 4, y: quad.reduce((t, p) => t + p.y, 0) / 4 };
  const sides = quad.map((a, i) => {
    const b = quad[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = (b.y - a.y) / len;
    let ny = -(b.x - a.x) / len;
    if (nx * (a.x - c.x) + ny * (a.y - c.y) < 0) (nx = -nx), (ny = -ny);
    return [{ x: a.x + nx * d, y: a.y + ny * d }, { x: b.x + nx * d, y: b.y + ny * d }];
  });
  return quad.map((p, i) => {
    const [a, b] = sides[(i + 3) % 4];
    const [e, f] = sides[i];
    return lineHit(a, b, e, f) ?? p;
  });
}

const polygonArea = (p: Vec2[]) => Math.abs(p.reduce((t, a, i) => t + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0)) / 2;

/** The few largest connected areas of one tone, each with the four-sided outline around it. */
function areasOf(small: Raster, cloth: ClothTone, lo: number, hi: number, tol: number, seams: boolean): ClothArea[] {
  const { width: w, height: h, data } = small;
  const mask = new Uint8Array(w * h);
  // The face of a far cushion is the cloth in deep shade: much darker, but the same hue and no paler.
  const [clothHue, clothSat] = rgbToHsv(cloth.cr, cloth.cg, Math.max(0, 1 - cloth.cr - cloth.cg));
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (cloth.sat >= 0.45) {
      const [hue, sat, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      const off = Math.abs(hue - clothHue) % 360;
      if (v > 0.1 && v < cloth.lum * 3 && Math.min(off, 360 - off) < 14 && sat > clothSat - 0.1) mask[p] = 1;
    }
    const sum = data[i] + data[i + 1] + data[i + 2] + 1e-6;
    const ratio = sum / 765 / cloth.lum;
    if (ratio > lo && ratio < hi && Math.hypot(data[i] / sum - cloth.cr, data[i + 1] / sum - cloth.cg) < tol) mask[p] = 1;
  }
  if (seams) {
    // A thin line or a step in brightness is where the cloth ends, even if what follows looks alike.
    const lum = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) lum[p] = Math.log(data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2] + 12);
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const p = y * w + x;
        const c = lum[p];
        const dip = Math.max(Math.min(lum[p - 2], lum[p + 2]) - c, Math.min(lum[p - 2 * w], lum[p + 2 * w]) - c);
        const jump = Math.max(Math.abs(lum[p - 2] - lum[p + 2]), Math.abs(lum[p - 2 * w] - lum[p + 2 * w]));
        if (dip > 0.035 || jump > 0.11) mask[p] = 0;
      }
    }
  }
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const sizes: { label: number; size: number }[] = [];
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
    // Too small to be a table, or so large that the picture shows nothing but one colour.
    if (size > w * h * 0.06 && size < w * h * 0.9) sizes.push({ label: next, size });
  }
  sizes.sort((a, b) => b.size - a.size);
  const out: ClothArea[] = [];
  for (const c of sizes.slice(0, 3)) {
    // First and last pixel of every row are enough to build the hull.
    const edge: Vec2[] = [];
    let border = 0;
    let rim = 0;
    for (let y = 0; y < h; y++) {
      let a = -1;
      let b = -1;
      for (let x = 0; x < w; x++) {
        if (label[y * w + x] !== c.label) continue;
        if (a < 0) a = x;
        b = x;
        if (y === 0 || y === h - 1) border++;
      }
      if (a < 0) continue;
      edge.push({ x: a, y }, { x: b + 1, y }, { x: a, y: y + 1 }, { x: b + 1, y: y + 1 });
      rim += 2;
      border += (a === 0 ? 1 : 0) + (b === w - 1 ? 1 : 0);
    }
    const hull = convexHull(edge);
    const q = enclosingQuad(hull);
    if (!q) continue;
    const quad = orderCorners(q);
    const ha = polygonArea(hull);
    // A table fills its outline (balls are small holes in it); floors, walls and clothes do not,
    // and they run off the edge of the picture.
    const solid = c.size / ha;
    const square = ha / polygonArea(quad);
    const fit = Math.min(...[true, false].map((horizontal) => cameraFromPlane(tableToImage(quad, horizontal, seams ? 0 : CUSHION_WIDTH), w, h).misfit));
    const cx = quad.reduce((t, p) => t + p.x, 0) / 4 / w - 0.5;
    const cy = quad.reduce((t, p) => t + p.y, 0) / 4 / h - 0.5;
    const off = border / (rim + w * 0.5);
    const score = Math.sqrt(c.size / (w * h)) * solid ** 4 * square ** 4 * Math.exp(-2 * fit - 2 * Math.hypot(cx, cy) - 3 * off) * (cloth.sat < 0.2 ? 1 : 1.15);
    // The two pixels next to a seam were left out of the area.
    out.push({ quad: seams ? grow(quad, 2) : quad, score, bed: seams });
  }
  return out;
}

/** A strong colour can be told from everything else by colour alone, so its shade may vary a lot. */
const STRONG = [[0.42, 1.7, 0.06]];
/** A grey cloth differs from a grey wall or rail only in how bright it is: several bands are tried. */
const PALE = [[0.72, 1.35, 0.032], [0.8, 1.22, 0.03], [0.87, 1.14, 0.028]];

export function clothAreas(small: Raster): ClothArea[] {
  const out: ClothArea[] = [];
  for (const t of clothTones(small)) {
    const pale = t.sat < 0.25;
    for (const [lo, hi, tol] of pale ? PALE : STRONG) {
      out.push(...areasOf(small, t, lo, hi, tol, false));
      if (pale) out.push(...areasOf(small, t, lo, hi, tol, true));
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Four corners of the cloth-coloured area (bed plus cushions) in picture coordinates, ordered
 * as `orderCorners` does; `bed` when it stops at the cushion noses. Null when nothing in the picture is shaped like a table.
 */
export function findClothQuad(img: Raster): { quad: Vec2[]; bed: boolean } | null {
  const f = Math.max(1, Math.ceil(Math.max(img.width, img.height) / 320));
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  if (w < 8 || h < 8) return null;
  // Averaged down, so that grain and screen patterns do not break areas apart.
  const small = makeRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += img.data[((y * f + dy) * img.width + x * f + dx) * 4 + k];
        small.data[(y * w + x) * 4 + k] = s / (f * f);
      }
      small.data[(y * w + x) * 4 + 3] = 255;
    }
  }
  const best = clothAreas(small)[0];
  return best ? { quad: best.quad.map((p) => ({ x: p.x * f, y: p.y * f })), bed: best.bed } : null;
}

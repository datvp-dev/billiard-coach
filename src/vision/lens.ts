import type { Vec2 } from '../core/types';
import { makeRaster, type Raster } from './raster';

/** How much the lens bends straight lines: a point at the picture's corner is moved outward by this share. */
export type Lens = { k: number };

export const TRUE_LENS: Lens = { k: 0 };

/** Where a point of the straight picture shows up in the picture as taken. */
export function bend(p: Vec2, lens: Lens, width: number, height: number): Vec2 {
  const cx = width / 2;
  const cy = height / 2;
  const s = 1 + (lens.k * ((p.x - cx) ** 2 + (p.y - cy) ** 2)) / (cx * cx + cy * cy);
  return { x: cx + (p.x - cx) * s, y: cy + (p.y - cy) * s };
}

export function straighten(q: Vec2, lens: Lens, width: number, height: number): Vec2 {
  if (lens.k === 0) return { x: q.x, y: q.y };
  const cx = width / 2;
  const cy = height / 2;
  const far = Math.hypot(q.x - cx, q.y - cy) / Math.hypot(cx, cy);
  // r (1 + k r^2) = far
  let r = far;
  for (let i = 0; i < 12; i++) r -= (r * (1 + lens.k * r * r) - far) / Math.max(0.2, 1 + 3 * lens.k * r * r);
  const s = far > 1e-9 ? r / far : 1;
  return { x: cx + (q.x - cx) * s, y: cy + (q.y - cy) * s };
}

/** The picture with straight lines straight again. The same picture when the lens is true. */
export function straightenImage(img: Raster, lens: Lens): Raster {
  const { width: w, height: h, data } = img;
  if (Math.abs(lens.k) * Math.hypot(w, h) * 0.5 < 0.4) return img;
  const out = makeRaster(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const n = lens.k / (cx * cx + cy * cy);
  for (let y = 0, o = 0; y < h; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < w; x++, o += 4) {
      const dx = x + 0.5 - cx;
      const s = 1 + n * (dx * dx + dy * dy);
      const u = cx + dx * s - 0.5;
      const v = cy + dy * s - 0.5;
      out.data[o + 3] = 255;
      if (u < -1 || v < -1 || u > w || v > h) continue;
      const x0 = Math.min(w - 2, Math.max(0, Math.floor(u)));
      const y0 = Math.min(h - 2, Math.max(0, Math.floor(v)));
      const a = Math.min(1, Math.max(0, u - x0));
      const b = Math.min(1, Math.max(0, v - y0));
      const i = (y0 * w + x0) * 4;
      const j = i + w * 4;
      for (let c = 0; c < 3; c++) out.data[o + c] = (data[i + c] * (1 - a) + data[i + 4 + c] * a) * (1 - b) + (data[j + c] * (1 - a) + data[j + 4 + c] * a) * b + 0.5;
    }
  }
  return out;
}

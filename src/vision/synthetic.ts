import { TABLE } from '../core/config';
import { POCKET_IDS, pocketCenter } from '../core/table';
import type { Vec2 } from '../core/types';
import { applyH, invertH } from './homography';
import { makeRaster, type Raster } from './raster';
import { RISE, SIGHTS, sightSpot } from './sights';
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

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** Linear colours, as reflected under white light. */
const STANDARD_SET: Record<number, V> = { 0: [0.93, 0.92, 0.86], 1: [0.95, 0.74, 0.06], 2: [0.08, 0.2, 0.65], 3: [0.82, 0.08, 0.1], 4: [0.32, 0.13, 0.5], 5: [0.95, 0.42, 0.07], 6: [0.03, 0.34, 0.17], 7: [0.45, 0.07, 0.1], 8: [0.03, 0.03, 0.03] };
const TV_SET: Record<number, V> = { ...STANDARD_SET, 2: [0.1, 0.28, 0.75], 4: [0.95, 0.42, 0.55], 5: [0.95, 0.22, 0.06], 6: [0.02, 0.22, 0.13], 7: [0.45, 0.22, 0.1] };

export type PhotoOptions = { width: number; height: number; from: V; at: V; /** Across the long side, radians. */ fov: number; cloth: V; tv?: boolean; tint?: V; noise?: number; /** Light diamonds on the rails, this far behind the noses. */ sights?: number };

/**
 * A photo of the table by a person standing beside it: round balls on a bed below raised cushions,
 * three lamps, shadows, highlights and grain. Returns the corners of the nose line in the picture
 * in the order `tableToImage` wants for `horizontal`.
 */
export function photograph(o: PhotoOptions, balls: FakeBall[], horizontal: boolean): { img: Raster; corners: Vec2[] } {
  const nose = 0.0363;
  const fw = unit(sub(o.at, o.from));
  const rt = unit(cross(fw, [0, 0, 1]));
  const dn = cross(fw, rt);
  const f = (0.5 * Math.max(o.width, o.height)) / Math.tan(o.fov / 2);
  const set = o.tv ? TV_SET : STANDARD_SET;
  const tint = o.tint ?? [1, 1, 1];
  const lamps: V[] = [[L * 0.25, W / 2, 0.85], [L * 0.5, W / 2, 0.85], [L * 0.75, W / 2, 0.85]];
  const light = (p: V, n: V) => lamps.reduce((s, l) => {
    const d = sub(l, p);
    return s + (Math.max(0, dot(unit(d), n)) * 0.42) / (0.9 + 0.4 * dot(d, d));
  }, 0.22);
  const solids = balls.map((b, i) => ({ id: b.id, c: [b.pos.x, b.pos.y, R] as V, axis: unit([Math.cos(i * 2.4), Math.sin(i * 2.4), 0.4 * Math.sin(i * 1.7)]) }));
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spots = o.sights === undefined ? [] : SIGHTS.map((_, i) => sightSpot(i, o.sights));
  const trace = (px: number, py: number): V => {
    const dir = unit(add(fw, add(mul(rt, (px - o.width / 2) / f), mul(dn, (py - o.height / 2) / f))));
    let near = Infinity;
    let hit: (typeof solids)[number] | null = null;
    for (const b of solids) {
      const oc = sub(o.from, b.c);
      const k = dot(oc, dir);
      const disc = k * k - dot(oc, oc) + R * R;
      if (disc < 0) continue;
      const t = -k - Math.sqrt(disc);
      if (t > 0 && t < near) (near = t), (hit = b);
    }
    if (hit) {
      const p = add(o.from, mul(dir, near));
      const n = mul(sub(p, hit.c), 1 / R);
      const lat = Math.abs(dot(n, hit.axis));
      let c = set[hit.id > 8 ? hit.id - 8 : hit.id];
      if (hit.id > 8 && lat > 0.55) c = o.tv ? set[8] : set[0];
      const spot = unit(cross(hit.axis, [0, 0, 1]));
      if (hit.id > 0 && Math.abs(dot(n, spot)) > 0.93) c = set[0];
      let out = mul(c, light(p, n) * (0.78 + 0.22 * n[2]) * 1.25);
      for (const l of lamps) {
        const shine = Math.pow(Math.max(0, dot(unit(sub(unit(sub(l, p)), dir)), n)), 350) * 1.4;
        out = add(out, [shine, shine, shine]);
      }
      return add(out, mul(o.cloth, Math.max(0, 0.35 - n[2] * 0.5) * 0.25));
    }
    if (dir[2] >= 0) return [0.2, 0.17, 0.15];
    const on = (z: number): V => add(o.from, mul(dir, (z - o.from[2]) / dir[2]));
    const beyond = (p: V) => Math.max(-p[0], p[0] - L, -p[1], p[1] - W);
    const rail = on(nose + RISE);
    if (spots.some((q) => Math.hypot(rail[0] - q.x, rail[1] - q.y) < 0.006)) return mul([0.8, 0.78, 0.72], light(rail, [0, 0, 1]));
    const top = on(nose);
    const up = beyond(top);
    const p = up > 0 ? top : on(0);
    if (POCKET_IDS.some((id) => Math.hypot(p[0] - pocketCenter(id).x, p[1] - pocketCenter(id).y) < 0.06)) return [0.02, 0.02, 0.02];
    if (up > 0.17) return [0.2, 0.17, 0.15];
    let s = light(p, [0, 0, 1]);
    if (up > 0.05) return mul([0.16, 0.08, 0.04], s);
    if (up > 0) return mul(o.cloth, s * 0.8);
    if (beyond(p) > 0) return mul(o.cloth, 0.3);
    for (const b of solids) {
      for (const l of lamps) {
        const k = R / (l[2] - R);
        const d = Math.hypot(p[0] - b.c[0] - (b.c[0] - l[0]) * k, p[1] - b.c[1] - (b.c[1] - l[1]) * k) / R;
        if (d < 1.25) s *= 1 - 0.38 * Math.min(1, (1.25 - d) / 0.4);
      }
    }
    return mul(o.cloth, s);
  };
  const img = makeRaster(o.width, o.height);
  for (let y = 0; y < o.height; y++) {
    for (let x = 0; x < o.width; x++) {
      const c = trace(x + 0.5, y + 0.5);
      const i = (y * o.width + x) * 4;
      for (let k = 0; k < 3; k++) img.data[i + k] = 255 * Math.pow(Math.min(1, Math.max(0, c[k] * tint[k])), 1 / 2.2) + (rand() - 0.5) * 2 * (o.noise ?? 4);
      img.data[i + 3] = 255;
    }
  }
  const at = (x: number, y: number): Vec2 => {
    const d = sub([x, y, nose], o.from);
    const z = dot(d, fw);
    return { x: o.width / 2 + (f * dot(d, rt)) / z, y: o.height / 2 + (f * dot(d, dn)) / z };
  };
  const corners = horizontal ? [at(0, W), at(L, W), at(L, 0), at(0, 0)] : [at(0, 0), at(0, W), at(L, W), at(L, 0)];
  return { img, corners };
}

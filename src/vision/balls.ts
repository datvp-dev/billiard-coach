import { PHYS, TABLE } from '../core/config';
import { POCKET_IDS, isSidePocket, pocketCenter } from '../core/table';
import type { GameMode, Vec2 } from '../core/types';
import { cameraFromPlane, type Camera } from './camera';
import { lightGain, lookOf, nameBalls, type BallLook } from './classify';
import { applyH, homography, invertH } from './homography';
import type { Raster } from './raster';
import { tableToImage } from './table';

const { L, W, R } = TABLE;
/** Ball centres lie this far above the plane of the cushion noses, where the corners are marked. */
const BALL_Z = R - PHYS.cushionH;

/** Discs below this are shadows, logos and scuffs; real balls score well above it. */
const MIN_SCORE = 1.05;
/** A full set plus six pocket mouths, which are sorted out later, and some room. */
const MAX_SPOTS = 26;

export type FoundBall = { pos: Vec2; id: number | null; confidence: number };
export type Spot = { pos: Vec2; x: number; y: number; r: number; score: number };

const median = (a: number[]) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 0);

/** Where a pixel belongs if it shows the middle of a ball, and how big that ball appears. */
export function ballView(camera: Camera) {
  const table = [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: W },
    { x: 0, y: W },
  ];
  const toImage = homography(table, table.map((p) => camera.project(p.x, p.y, BALL_Z)));
  const toTable = invertH(toImage);
  return {
    toTable: (x: number, y: number) => applyH(toTable, { x, y }),
    toImage: (p: Vec2) => camera.project(p.x, p.y, BALL_Z),
    radius: (p: Vec2) => camera.scaleAt(p.x, p.y, BALL_Z) * R,
  };
}

/**
 * Balls in a photo of the table. Works on the photo itself: the camera position, recovered from
 * the four corners, says exactly how large a ball must look at every spot, so the search is for
 * discs of a known size that differ from the cloth around them.
 */
export function locateBalls(img: Raster, corners: Vec2[], horizontal: boolean): Spot[] {
  const { width: w, height: h, data } = img;
  const camera = cameraFromPlane(tableToImage(corners, horizontal), w, h);
  const view = ballView(camera);

  // Part of the picture that shows the bed.
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))));
  const x1 = Math.min(w, Math.ceil(Math.max(...corners.map((c) => c.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))));
  const y1 = Math.min(h, Math.ceil(Math.max(...corners.map((c) => c.y))));
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < 20 || bh < 20) return [];
  const inside = new Uint8Array(bw * bh);
  const turn = Math.sign((corners[1].x - corners[0].x) * (corners[2].y - corners[0].y) - (corners[1].y - corners[0].y) * (corners[2].x - corners[0].x)) || 1;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let ok = 1;
      for (let k = 0; k < 4 && ok; k++) {
        const a = corners[k];
        const b = corners[(k + 1) & 3];
        if (((b.x - a.x) * (y + y0 + 0.5 - a.y) - (b.y - a.y) * (x + x0 + 0.5 - a.x)) * turn < 0) ok = 0;
      }
      inside[y * bw + x] = ok;
    }
  }

  const mid = view.radius({ x: L / 2, y: W / 2 });
  // Colours averaged over a small neighbourhood: screen patterns, grain and weave go away.
  const blur = Math.max(1, Math.round(mid / 9));
  const avg = boxBlur(data, w, h, x0, y0, bw, bh, blur);

  // Cloth colour and brightness around every spot.
  const tile = Math.max(16, Math.round(mid * 5));
  const tw = Math.max(1, Math.ceil(bw / tile));
  const th = Math.max(1, Math.ceil(bh / tile));
  const cloth = new Float32Array(tw * th * 3);
  const step = Math.max(1, Math.floor(tile / 14));
  const sample = (ax: number, ay: number, bx: number, by: number, st: number): [number, number, number] | null => {
    const cr: number[] = [];
    const cg: number[] = [];
    const lum: number[] = [];
    for (let y = Math.max(0, ay); y < Math.min(bh, by); y += st) {
      for (let x = Math.max(0, ax); x < Math.min(bw, bx); x += st) {
        if (!inside[y * bw + x]) continue;
        const o = (y * bw + x) * 3;
        const s = avg[o] + avg[o + 1] + avg[o + 2] + 1e-3;
        cr.push(avg[o] / s);
        cg.push(avg[o + 1] / s);
        lum.push(s);
      }
    }
    return cr.length < 30 ? null : [median(cr), median(cg), median(lum)];
  };
  const whole = sample(0, 0, bw, bh, Math.max(1, Math.floor(Math.min(bw, bh) / 90)));
  if (!whole) return [];
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const pad = Math.round(tile * 0.6);
      let t = sample(tx * tile - pad, ty * tile - pad, (tx + 1) * tile + pad, (ty + 1) * tile + pad, step);
      // A tile full of balls or cushion does not show its cloth.
      if (!t || Math.hypot(t[0] - whole[0], t[1] - whole[1]) > 0.06 || t[2] < whole[2] * 0.4 || t[2] > whole[2] * 2) t = whole;
      cloth.set(t, (ty * tw + tx) * 3);
    }
  }
  // How far every pixel is from the cloth around it: colour, and brightness in logarithms.
  const dc = new Float32Array(bw * bh);
  const dl = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const gy = Math.max(0, Math.min(th - 1, (y + 0.5) / tile - 0.5));
    const ty = Math.min(th - 1, Math.floor(gy));
    const ty2 = Math.min(th - 1, ty + 1);
    const fy = gy - ty;
    for (let x = 0; x < bw; x++) {
      const gx = Math.max(0, Math.min(tw - 1, (x + 0.5) / tile - 0.5));
      const tx = Math.min(tw - 1, Math.floor(gx));
      const tx2 = Math.min(tw - 1, tx + 1);
      const fx = gx - tx;
      const at = (k: number) =>
        (cloth[(ty * tw + tx) * 3 + k] * (1 - fx) + cloth[(ty * tw + tx2) * 3 + k] * fx) * (1 - fy) + (cloth[(ty2 * tw + tx) * 3 + k] * (1 - fx) + cloth[(ty2 * tw + tx2) * 3 + k] * fx) * fy;
      const p = y * bw + x;
      const o = p * 3;
      const s = avg[o] + avg[o + 1] + avg[o + 2] + 1e-3;
      dc[p] = Math.hypot(avg[o] / s - at(0), avg[o + 1] / s - at(1));
      dl[p] = Math.log((s + 6) / (at(2) + 6));
    }
  }
  // What counts as different depends on how noisy this cloth is.
  const nc: number[] = [];
  const nl: number[] = [];
  const st = Math.max(1, Math.floor(Math.sqrt((bw * bh) / 8000)));
  for (let y = 0; y < bh; y += st) {
    for (let x = 0; x < bw; x += st) {
      const p = y * bw + x;
      if (inside[p]) nc.push(dc[p]), nl.push(Math.abs(dl[p]));
    }
  }
  const tc = Math.min(0.06, Math.max(0.026, 4.5 * median(nc)));
  const tl = Math.min(0.25, Math.max(0.085, 4.5 * median(nl)));
  const ev = new Float32Array(bw * bh);
  for (let p = 0; p < bw * bh; p++) {
    const l = dl[p];
    const d = Math.hypot(dc[p] / tc, l > 0 ? l / tl : l / 0.75);
    // Darker cloth may be a shadow: some evidence, not proof.
    ev[p] = d > 1 ? 1 : l < 0 ? 0.45 * Math.min(1, Math.max(0, (-l - 0.12) / 0.3)) : 0;
  }

  // Row sums make the share of evidence inside a disc cheap to look up.
  const rowE = new Float32Array((bw + 1) * bh);
  const rowN = new Float32Array((bw + 1) * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * (bw + 1) + x;
      const p = y * bw + x;
      rowE[i + 1] = rowE[i] + (inside[p] ? ev[p] : 0);
      rowN[i + 1] = rowN[i] + inside[p];
    }
  }
  const disc = (cx: number, cy: number, r: number): [number, number] => {
    let e = 0;
    let n = 0;
    const a = Math.max(0, Math.ceil(cy - r));
    const b = Math.min(bh - 1, Math.floor(cy + r));
    for (let y = a; y <= b; y++) {
      const half = Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
      const l = Math.max(0, Math.min(bw, Math.round(cx - half)));
      const q = Math.max(l, Math.min(bw, Math.round(cx + half) + 1));
      const i = y * (bw + 1);
      e += rowE[i + q] - rowE[i + l];
      n += rowN[i + q] - rowN[i + l];
    }
    return [e, n];
  };
  const C = Array.from({ length: 24 }, (_, i) => [Math.cos((i * Math.PI) / 12), Math.sin((i * Math.PI) / 12)]);
  /** Share of the outline across which the colour changes. */
  const outline = (cx: number, cy: number, r: number): number => {
    let hit = 0;
    let n = 0;
    for (const [ux, uy] of C) {
      const ix = Math.round(cx + ux * r * 0.8);
      const iy = Math.round(cy + uy * r * 0.8);
      const ox = Math.round(cx + ux * r * 1.22);
      const oy = Math.round(cy + uy * r * 1.22);
      if (ix < 0 || iy < 0 || ix >= bw || iy >= bh || ox < 0 || oy < 0 || ox >= bw || oy >= bh) continue;
      n++;
      const i = (iy * bw + ix) * 3;
      const o = (oy * bw + ox) * 3;
      const si = avg[i] + avg[i + 1] + avg[i + 2] + 1e-3;
      const so = avg[o] + avg[o + 1] + avg[o + 2] + 1e-3;
      const c = Math.hypot(avg[i] / si - avg[o] / so, avg[i + 1] / si - avg[o + 1] / so);
      if (Math.hypot(c / tc, Math.log((si + 6) / (so + 6)) / Math.max(0.1, tl)) > 1) hit++;
    }
    return n < 12 ? 0 : hit / n;
  };
  const rate = (cx: number, cy: number): { score: number; pos: Vec2; r: number; fill: number } | null => {
    const pos = view.toTable(cx + x0, cy + y0);
    if (pos.x < R * 0.55 || pos.x > L - R * 0.55 || pos.y < R * 0.55 || pos.y > W - R * 0.55) return null;
    const r = view.radius(pos);
    const [e, n] = disc(cx, cy, r * 0.94);
    if (n < 0.4 * Math.PI * r * r) return null;
    const fill = e / n;
    if (fill < 0.22) return null;
    const [e2, n2] = disc(cx, cy, r * 1.5);
    const [e1, n1] = disc(cx, cy, r * 1.1);
    const ring = n2 > n1 ? (e2 - e1) / (n2 - n1) : 0;
    const edge = outline(cx, cy, r);
    return { score: fill - 0.45 * ring + 0.6 * edge, pos, r, fill };
  };

  const grid = Math.max(1, Math.round(mid / 8));
  type Cand = { x: number; y: number; score: number; pos: Vec2; r: number; fill: number };
  const cands: Cand[] = [];
  for (let y = 0; y < bh; y += grid) {
    for (let x = 0; x < bw; x += grid) {
      const c = rate(x, y);
      if (c && c.score > MIN_SCORE) cands.push({ x, y, ...c });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const used = new Uint8Array(bw * bh);
  const spots: Spot[] = [];
  for (const c of cands) {
    if (spots.length >= MAX_SPOTS) break;
    if (spots.some((s) => Math.hypot(s.pos.x - c.pos.x, s.pos.y - c.pos.y) < 1.65 * R)) continue;
    // Finer look around the best grid point: the middle of the scores close to the top one.
    let top: Cand = c;
    const near: Cand[] = [];
    const span = grid + 2;
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const q = rate(c.x + dx, c.y + dy);
        if (!q) continue;
        const e: Cand = { x: c.x + dx, y: c.y + dy, ...q };
        near.push(e);
        if (e.score > top.score) top = e;
      }
    }
    const close = near.filter((e) => e.score > top.score - 0.05);
    const mx = close.length ? close.reduce((s, e) => s + e.x, 0) / close.length : top.x;
    const my = close.length ? close.reduce((s, e) => s + e.y, 0) / close.length : top.y;
    const pos = view.toTable(mx + x0, my + y0);
    if (spots.some((s) => Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) < 1.65 * R)) continue;
    // Most of the disc must be new: what is left between two balls already found is not a third.
    let fresh = 0;
    let total = 0;
    let covered = 0;
    const mark: number[] = [];
    const rr = top.r * 0.94;
    for (let y = Math.max(0, Math.ceil(my - rr)); y <= Math.min(bh - 1, my + rr); y++) {
      for (let x = Math.max(0, Math.ceil(mx - rr)); x <= Math.min(bw - 1, mx + rr); x++) {
        if ((x - mx) ** 2 + (y - my) ** 2 > rr * rr) continue;
        total++;
        const p = y * bw + x;
        if (!used[p]) fresh += ev[p];
        else covered++;
        mark.push(p);
      }
    }
    // Beside a ball already found, shadow does not count: a second ball must show itself.
    if (covered > 0.12 * total) {
      fresh = 0;
      for (const p of mark) if (!used[p] && ev[p] === 1) fresh++;
      if (fresh < 0.4 * total || fresh < 0.62 * (total - covered)) continue;
    }
    if (fresh < Math.min(0.42, 0.75 * top.fill) * total) continue;
    for (const p of mark) used[p] = 1;
    spots.push({ pos, x: mx + x0, y: my + y0, r: top.r, score: top.score });
  }
  return spots;
}

/** Mean colour around every pixel of a window of the picture. */
function boxBlur(data: Raster['data'], w: number, h: number, x0: number, y0: number, bw: number, bh: number, r: number): Float32Array {
  const tmp = new Float32Array(bw * bh * 3);
  const out = new Float32Array(bw * bh * 3);
  for (let y = 0; y < bh; y++) {
    for (let k = 0; k < 3; k++) {
      let s = 0;
      let n = 0;
      const at = (x: number) => data[((y + y0) * w + x + x0) * 4 + k];
      for (let x = 0; x < Math.min(bw, r); x++) (s += at(x)), n++;
      for (let x = 0; x < bw; x++) {
        if (x + r < bw) (s += at(x + r)), n++;
        if (x - r - 1 >= 0) (s -= at(x - r - 1)), n--;
        tmp[(y * bw + x) * 3 + k] = s / n;
      }
    }
  }
  for (let x = 0; x < bw; x++) {
    for (let k = 0; k < 3; k++) {
      let s = 0;
      let n = 0;
      for (let y = 0; y < Math.min(bh, r); y++) (s += tmp[(y * bw + x) * 3 + k]), n++;
      for (let y = 0; y < bh; y++) {
        if (y + r < bh) (s += tmp[((y + r) * bw + x) * 3 + k]), n++;
        if (y - r - 1 >= 0) (s -= tmp[((y - r - 1) * bw + x) * 3 + k]), n--;
        out[(y * bw + x) * 3 + k] = s / n;
      }
    }
  }
  return out;
}

/** Pixels of a ball's face that no other found ball covers more closely. */
function facePixels(img: Raster, s: Spot, all: Spot[]): number[] {
  const rgb: number[] = [];
  const r = s.r * 0.84;
  for (let y = Math.max(0, Math.ceil(s.y - r)); y <= Math.min(img.height - 1, s.y + r); y++) {
    for (let x = Math.max(0, Math.ceil(s.x - r)); x <= Math.min(img.width - 1, s.x + r); x++) {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d > r) continue;
      if (all.some((o) => o !== s && Math.hypot(x - o.x, y - o.y) / o.r < d / s.r)) continue;
      const i = (y * img.width + x) * 4;
      rgb.push(img.data[i], img.data[i + 1], img.data[i + 2]);
    }
  }
  return rgb;
}

export function findBalls(img: Raster, corners: Vec2[], horizontal: boolean, mode: GameMode): FoundBall[] {
  let spots = locateBalls(img, corners, horizontal);
  let faces = spots.map((s) => facePixels(img, s, spots));
  const gain = lightGain(faces.map((f) => lookOf(f))) ?? undefined;
  let looks: BallLook[] = faces.map((f) => lookOf(f, gain));
  // Pocket mouths are dark discs too: near a pocket a dark one only counts when there is
  // something lighter between it and the mouth.
  const camera = cameraFromPlane(tableToImage(corners, horizontal), img.width, img.height);
  const view = ballView(camera);
  const lumAt = (p: Vec2) => {
    const q = view.toImage(p);
    const x = Math.round(q.x);
    const y = Math.round(q.y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
    const i = (y * img.width + x) * 4;
    return img.data[i] + img.data[i + 1] + img.data[i + 2];
  };
  const keep = spots.map((s, i) => {
    const k = looks[i];
    if (k.coloured >= 0.35 || k.white >= 0.5) return true;
    for (const id of POCKET_IDS) {
      const c = pocketCenter(id);
      const d = Math.hypot(s.pos.x - c.x, s.pos.y - c.y);
      if (d < (isSidePocket(id) ? 2.2 : 2.75) * R) return false;
      if (d > 3.6 * R) continue;
      const ux = (c.x - s.pos.x) / d;
      const uy = (c.y - s.pos.y) / d;
      const bed = lumAt({ x: s.pos.x - ux * 3 * R, y: s.pos.y - uy * 3 * R });
      if ([1.15, 1.35, 1.6].every((f) => lumAt({ x: s.pos.x + ux * f * R, y: s.pos.y + uy * f * R }) < 0.45 * bed)) return false;
    }
    return true;
  });
  spots = spots.filter((_, i) => keep[i]);
  looks = looks.filter((_, i) => keep[i]);
  const names = nameBalls(looks, mode);
  return spots.map((s, i) => ({
    pos: { x: Math.max(R, Math.min(L - R, s.pos.x)), y: Math.max(R, Math.min(W - R, s.pos.y)) },
    id: names[i].id,
    confidence: names[i].confidence,
  }));
}

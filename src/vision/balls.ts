import { PHYS, TABLE } from '../core/config';
import { POCKET_IDS, isSidePocket, pocketCenter } from '../core/table';
import type { GameMode, Vec2 } from '../core/types';
import { cameraFromPlane, type Camera } from './camera';
import { lightGain, lookOf, nameBalls, type BallLook } from './classify';
import { applyH, homography, invertH } from './homography';
import { rgbToHsv, type Raster } from './raster';
import { tableToImage } from './table';

const { L, W, R } = TABLE;
/** Ball centres lie this far above the plane of the cushion noses, where the corners are marked. */
export const BALL_Z = R - PHYS.cushionH;

/** Discs below this are shadows, logos and scuffs; real balls score well above it. */
const MIN_SCORE = 1.05;
/** On top of something larger than this many balls, a disc must stand out as clearly as this. */
const LARGE = 11;
const CLEAR_SCORE = 1.28;
/** A full set plus six pocket mouths, which are sorted out later, and some room. */
const MAX_SPOTS = 26;

export type FoundBall = {
  pos: Vec2;
  id: number | null;
  confidence: number;
  /** What its face looks like, for recognising it again. */
  look?: BallLook;
  /** Part of something much larger that reaches in over a rail: a player, an arm, a cue. */
  attached?: boolean;
};
/** The cloth as seen when nobody is in the way, to compare later frames of the same view with. */
export type ClothModel = { width: number; height: number; tile: number; tiles: Float32Array; whole: [number, number, number]; /** That frame itself, smoothed, with its balls painted out: rails' shadows, pockets, lettering. */ scene: Uint8ClampedArray };
export type Spot = { pos: Vec2; x: number; y: number; r: number; score: number; attached?: boolean };

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
  return surveyBed(img, corners, horizontal).spots;
}

/** The balls, and a way to ask whether a spot on the bed shows nothing but cloth. */
export type Survey = {
  spots: Spot[];
  clearAt(pos: Vec2): boolean;
  toTable(p: Vec2): Vec2;
  cloth: ClothModel | null;
  /** Share of the bed hidden by people reaching in. */
  cover: number;
};

/**
 * `known` is the cloth from an earlier, clear frame of the same view. `sure` are places that do
 * hold balls, so that they are not taken for part of the furniture.
 */
export function surveyBed(img: Raster, corners: Vec2[], horizontal: boolean, known: ClothModel | null = null, sure: Vec2[] = []): Survey {
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
  const nothing: Survey = { spots: [], clearAt: () => false, toTable: (p) => view.toTable(p.x, p.y), cloth: null, cover: 0 };
  if (bw < 20 || bh < 20) return nothing;
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
  const given = known && known.width === bw && known.height === bh && known.tile === tile ? known : null;
  const whole = given ? given.whole : sample(0, 0, bw, bh, Math.max(1, Math.floor(Math.min(bw, bh) / 90)));
  if (!whole) return nothing;
  if (given) cloth.set(given.tiles);
  for (let ty = 0; !given && ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const pad = Math.round(tile * 0.6);
      let t = sample(tx * tile - pad, ty * tile - pad, (tx + 1) * tile + pad, (ty + 1) * tile + pad, step);
      // A tile full of balls or cushion does not show its cloth.
      if (!t || Math.hypot(t[0] - whole[0], t[1] - whole[1]) > 0.06 || t[2] < whole[2] * 0.4 || t[2] > whole[2] * 2) t = whole;
      cloth.set(t, (ty * tw + tx) * 3);
    }
  }
  // The camera may have brightened or dimmed the picture since: go by what still looks like cloth.
  let gain = 1;
  if (given) {
    const ratios: number[] = [];
    const st = Math.max(1, Math.floor(Math.sqrt((bw * bh) / 6000)));
    for (let y = 0; y < bh; y += st) {
      for (let x = 0; x < bw; x += st) {
        if (!inside[y * bw + x]) continue;
        const o = (y * bw + x) * 3;
        const t = (Math.min(th - 1, Math.floor(y / tile)) * tw + Math.min(tw - 1, Math.floor(x / tile))) * 3;
        const sum = avg[o] + avg[o + 1] + avg[o + 2] + 1e-3;
        const q = sum / (cloth[t + 2] + 1e-3);
        if (q > 0.7 && q < 1.4 && Math.hypot(avg[o] / sum - cloth[t], avg[o + 1] / sum - cloth[t + 1]) < 0.03) ratios.push(q);
      }
    }
    if (ratios.length > 200) gain = Math.min(1.25, Math.max(0.8, median(ratios)));
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
      dl[p] = Math.log((s + 6) / (at(2) * gain + 6));
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
  // On a coloured cloth a shadow, however deep, keeps the cloth's hue and is at least as strong a
  // colour (video makes it stronger still), and a black ball has neither. On grey cloth darkness
  // is all there is to go by.
  const [clothHue, clothSat] = rgbToHsv(whole[0], whole[1], Math.max(0, 1 - whole[0] - whole[1]));
  const coloured = clothSat > 0.35;
  const shaded = (o: number): boolean => {
    const [h, sat, v] = rgbToHsv(avg[o], avg[o + 1], avg[o + 2]);
    const gapH = Math.abs(h - clothHue) % 360;
    return v > 0.05 && Math.min(gapH, 360 - gapH) < 24 && sat > clothSat - 0.12;
  };
  const ev = new Float32Array(bw * bh);
  for (let p = 0; p < bw * bh; p++) {
    const l = dl[p];
    let d = Math.hypot(dc[p] / tc, l > 0 ? l / tl : l / 0.75);
    if (coloured && d > 1 && l < -0.12 && shaded(p * 3)) d = 0;
    // Darker cloth may be a shadow: some evidence, not proof.
    ev[p] = d > 1 ? 1 : l < 0 ? 0.45 * Math.min(1, Math.max(0, (-l - 0.12) / 0.3)) : 0;
  }

  // What looks the same as on the clear frame is no ball, whatever it is. Plain cloth never is
  // either, so a ball that was overlooked on that frame leaves nothing behind when it goes.
  if (given) {
    const scene = given.scene;
    const differs = (o: number, q: number) => {
      const b = [scene[q] * gain, scene[q + 1] * gain, scene[q + 2] * gain];
      if (Math.max(Math.abs(avg[o] - b[0]), Math.abs(avg[o + 1] - b[1]), Math.abs(avg[o + 2] - b[2])) < 20) return false;
      const s1 = avg[o] + avg[o + 1] + avg[o + 2] + 1e-3;
      const s2 = b[0] + b[1] + b[2] + 1e-3;
      // Dark pixels have hardly any colour to compare.
      const dim = 1 + 40 / Math.min(s1, s2);
      const l = Math.log((s1 + 6) / (s2 + 6));
      return Math.hypot(Math.hypot(avg[o] / s1 - b[0] / s2, avg[o + 1] / s1 - b[1] / s2) / (1.3 * tc * dim), l / (l > 0 ? 1.5 * tl : 0.5)) > 1;
    };
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const p = y * bw + x;
        if (ev[p] === 0) continue;
        const o = p * 3;
        // Where the clear frame shows plain cloth, the cloth has already been compared with.
        const ti = (Math.min(th - 1, Math.floor(y / tile)) * tw + Math.min(tw - 1, Math.floor(x / tile))) * 3;
        const ss = scene[o] + scene[o + 1] + scene[o + 2] + 1e-3;
        const sl = Math.log((ss + 6) / (cloth[ti + 2] + 6));
        if (sl > -0.14 && sl < 1.2 * tl && Math.hypot(scene[o] / ss - cloth[ti], scene[o + 1] / ss - cloth[ti + 1]) < 0.8 * tc) continue;
        // Edges may sit a pixel away from where they were.
        if (!differs(o, o) || (x > 0 && !differs(o, o - 3)) || (x < bw - 1 && !differs(o, o + 3)) || (y > 0 && !differs(o, o - bw * 3)) || (y < bh - 1 && !differs(o, o + bw * 3))) ev[p] = 0;
      }
    }
  }

  // Row sums make the share of evidence inside a disc cheap to look up.
  const rowE = new Float32Array((bw + 1) * bh);
  const rowN = new Float32Array((bw + 1) * bh);
  const rowB = new Float32Array((bw + 1) * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * (bw + 1) + x;
      const p = y * bw + x;
      rowE[i + 1] = rowE[i] + (inside[p] ? ev[p] : 0);
      rowN[i + 1] = rowN[i] + inside[p];
      rowB[i + 1] = rowB[i] + (inside[p] && dl[p] > tl ? 1 : 0);
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
  // Connected areas of things that are not cloth: an arm or a sleeve is far larger than a few balls.
  const areaId = new Int32Array(bw * bh);
  const areaSize: number[] = [0];
  const areaRim: number[] = [0];
  const stack = new Int32Array(bw * bh);
  for (let s = 0; s < bw * bh; s++) {
    if (areaId[s] || !inside[s] || ev[s] !== 1) continue;
    const id = areaSize.length;
    let n = 0;
    let rim = 0;
    let t = 0;
    stack[t++] = s;
    areaId[s] = id;
    while (t > 0) {
      const p = stack[--t];
      n++;
      const x = p % bw;
      const next = (q: number) => {
        if (!areaId[q] && inside[q] && ev[q] === 1) (areaId[q] = id), (stack[t++] = q);
      };
      if (x > 0) next(p - 1);
      if (x < bw - 1) next(p + 1);
      if (p >= bw) next(p - bw);
      if (p < bw * (bh - 1)) next(p + bw);
      if (x === 0 || x === bw - 1 || p < bw || p >= bw * (bh - 1) || !inside[p - 1] || !inside[p + 1] || !inside[p - bw] || !inside[p + bw]) rim++;
    }
    areaSize.push(n);
    areaRim.push(rim);
  }
  // Big, or reaching in over a rail and bigger than a few balls: somebody, or something they hold.
  const oneBall = Math.PI * mid * mid;
  const isPerson = (id: number) => id > 0 && (areaSize[id] > LARGE * oneBall || (areaSize[id] > 3.5 * oneBall && areaRim[id] > 0.7 * mid));
  let hidden = 0;
  let bed = 0;
  for (let p = 0; p < bw * bh; p++) {
    if (!inside[p]) continue;
    bed++;
    if (isPerson(areaId[p])) hidden++;
  }
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
    // A white ball on pale cloth: bright above, and its shaded underside passes through the very
    // brightness of the cloth. The bright cap with an outline all round is enough.
    let solid = fill;
    if (fill < 0.8 && edge > 0.7) {
      let lit = 0;
      let cap = 0;
      for (let y = Math.max(0, Math.ceil(cy - r * 0.9)); y <= Math.min(bh - 1, Math.floor(cy - r * 0.1)); y++) {
        const half = Math.sqrt(Math.max(0, r * r * 0.81 - (y - cy) ** 2));
        const a = Math.max(0, Math.min(bw, Math.round(cx - half)));
        const b = Math.max(a, Math.min(bw, Math.round(cx + half) + 1));
        const i = y * (bw + 1);
        lit += rowB[i + b] - rowB[i + a];
        cap += rowN[i + b] - rowN[i + a];
      }
      if (cap > 0 && lit / cap > 0.8) solid = (fill + lit / cap) / 2;
    }
    return { score: solid - 0.45 * ring + 0.6 * edge, pos, r, fill: solid };
  };

  const grid = Math.max(1, Math.round(mid / 8));
  type Cand = { x: number; y: number; score: number; pos: Vec2; r: number; fill: number };
  const cands: Cand[] = [];
  for (let y = 0; y < bh; y += grid) {
    for (let x = 0; x < bw; x += grid) {
      const c = rate(x, y);
      if (!c || c.score <= MIN_SCORE) continue;
      if (areaSize[areaId[y * bw + x]] > LARGE * Math.PI * c.r * c.r && c.score < CLEAR_SCORE) continue;
      cands.push({ x, y, ...c });
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
    // Nearer than two balls can lie, and what shows of it is of the other's colour: the same ball, drawn out.
    const twin = spots.find((s) => Math.hypot(s.x - x0 - mx, s.y - y0 - my) < 0.9 * top.r && Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) < 1.95 * R);
    if (twin) {
      const tone = (px: number[]) => {
        const m = [0, 0, 0];
        for (const p of px) for (let k = 0; k < 3; k++) m[k] += avg[p * 3 + k];
        const t = m[0] + m[1] + m[2] + 1e-6;
        return [m[0] / t, m[1] / t];
      };
      const mine = tone(mark.filter((p) => !used[p] && ev[p] > 0.5));
      const its: number[] = [];
      const tr = twin.r * 0.6;
      for (let y = Math.max(0, Math.ceil(twin.y - y0 - tr)); y <= Math.min(bh - 1, twin.y - y0 + tr); y++) {
        for (let x = Math.max(0, Math.ceil(twin.x - x0 - tr)); x <= Math.min(bw - 1, twin.x - x0 + tr); x++) its.push(y * bw + x);
      }
      const other = tone(its);
      if (Math.hypot(mine[0] - other[0], mine[1] - other[1]) < 0.09) continue;
    }
    // A worn or chalky patch: the cloth's own colour, no darker or lighter than cloth gets.
    if (coloured && top.score < 1.2 && mark.length > 0) {
      const m = [0, 0, 0];
      for (const p of mark) for (let k = 0; k < 3; k++) m[k] += avg[p * 3 + k] / mark.length;
      const [hue, sat] = rgbToHsv(m[0], m[1], m[2]);
      const off = Math.abs(hue - clothHue) % 360;
      const light = mark.reduce((t, p) => t + dl[p], 0) / mark.length;
      const spread = Math.sqrt(mark.reduce((t, p) => t + (dl[p] - light) ** 2, 0) / mark.length);
      // A ball, even one of the cloth's colour, is lit on top and dark below.
      if (Math.min(off, 360 - off) < 10 && sat > clothSat - 0.16 && Math.abs(light) < 0.3 && spread < 0.16) continue;
    }
    for (const p of mark) used[p] = 1;
    let onPerson = 0;
    for (const p of mark) if (isPerson(areaId[p])) onPerson++;
    spots.push({ pos, x: mx + x0, y: my + y0, r: top.r, score: top.score, attached: onPerson > 0.15 * total });
  }
  return {
    spots,
    toTable: nothing.toTable,
    cloth: { width: bw, height: bh, tile, tiles: cloth, whole, scene: given ? given.scene : emptyScene(avg, bw, bh, x0, y0, view, sure) },
    cover: bed ? hidden / bed : 0,
    clearAt(pos) {
      const p = view.toImage(pos);
      const [e, n] = disc(p.x - x0, p.y - y0, view.radius(pos) * 0.9);
      return n > 0 && e / n < 0.22;
    },
  };
}

/**
 * The smoothed frame with the balls at `sure` painted out. What lies behind a ball continues from
 * either side of it along the nearest rail, so that the face of a cushion stays a cushion.
 */
function emptyScene(avg: Float32Array, bw: number, bh: number, x0: number, y0: number, view: ReturnType<typeof ballView>, sure: Vec2[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(avg);
  const holes = sure.map((c) => ({ c, q: view.toImage(c), r: view.radius(c) * 1.4 }));
  const inHole = (x: number, y: number) => holes.some((h) => (x - h.q.x) ** 2 + (y - h.q.y) ** 2 <= h.r * h.r);
  for (const h of holes) {
    const { c, q, r } = h;
    const alongX = Math.min(c.y, W - c.y) <= Math.min(c.x, L - c.x);
    for (let y = Math.max(0, Math.floor(q.y - y0 - r)); y <= Math.min(bh - 1, q.y - y0 + r); y++) {
      for (let x = Math.max(0, Math.floor(q.x - x0 - r)); x <= Math.min(bw - 1, q.x - x0 + r); x++) {
        if ((x + x0 - q.x) ** 2 + (y + y0 - q.y) ** 2 > r * r) continue;
        const t = view.toTable(x + x0, y + y0);
        const ends = [-1, 1].map((dir) => {
          for (let d = 0.4 * R; d < 12 * R; d += 0.3 * R) {
            const z = view.toImage(alongX ? { x: t.x + dir * d, y: t.y } : { x: t.x, y: t.y + dir * d });
            const px = Math.round(z.x - x0);
            const py = Math.round(z.y - y0);
            if (px < 0 || py < 0 || px >= bw || py >= bh) return null;
            if (!inHole(z.x, z.y)) return { d, o: (py * bw + px) * 3 };
          }
          return null;
        });
        const [a, b] = ends;
        if (!a && !b) continue;
        const wa = a && b ? b.d / (a.d + b.d) : a ? 1 : 0;
        for (let k = 0; k < 3; k++) out[(y * bw + x) * 3 + k] = (a ? avg[a.o + k] * wa : 0) + (b ? avg[b.o + k] * (1 - wa) : 0);
      }
    }
  }
  return out;
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
    // On a single picture, round bits of something long beside a rail are lettering or the rail itself.
  const spots = locateBalls(img, corners, horizontal).filter((s) => !s.attached || Math.min(s.pos.x, L - s.pos.x, s.pos.y, W - s.pos.y) > 1.6 * R);
  return nameSpots(img, corners, horizontal, mode, spots);
}

/** Sorts out pocket mouths and gives the remaining spots their numbers. */
export function nameSpots(img: Raster, corners: Vec2[], horizontal: boolean, mode: GameMode, all: Spot[]): FoundBall[] {
  let spots = all;
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
    look: looks[i],
    attached: !!s.attached,
  })).filter((b) => b.id !== null || !POCKET_IDS.some((id) => {
    // Nets, leather and castings in a pocket's mouth look like nothing in particular.
    const c = pocketCenter(id);
    return Math.hypot(b.pos.x - c.x, b.pos.y - c.y) < (isSidePocket(id) ? 1.8 : 2.4) * R;
  }));
}

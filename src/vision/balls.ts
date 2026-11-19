import { TABLE } from '../core/config';
import { POCKET_IDS, isSidePocket, pocketCenter } from '../core/table';
import type { GameMode, Vec2 } from '../core/types';
import { classifyBall } from './classify';
import { applyH, invertH, type Homography } from './homography';
import { looksLikeCloth, toneOf, type Raster, type Tone } from './raster';

const { L, W, R } = TABLE;

export type FoundBall = { pos: Vec2; id: number | null; confidence: number };

/** Median chromaticity and brightness of a flat picture of the bed: the cloth, since it covers most of it. */
function medianCloth(img: Raster): Tone {
  const cr: number[] = [];
  const cg: number[] = [];
  const lum: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 6000)));
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] === 0) continue;
      const t = toneOf(img.data[i], img.data[i + 1], img.data[i + 2]);
      cr.push(t.cr);
      cg.push(t.cg);
      lum.push(t.lum);
    }
  }
  const med = (a: number[]) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 0);
  return { cr: med(cr), cg: med(cg), lum: med(lum) };
}

type Blob = { px: number[] };

function blobs(mask: Uint8Array, w: number, h: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    const px: number[] = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      px.push(p);
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    out.push({ px });
  }
  return out;
}

/** Split pixel coordinates into k groups around k centres (plain k-means, seeded along the long axis). */
function split(pts: Vec2[], k: number): Vec2[][] {
  let mx = 0;
  let my = 0;
  for (const p of pts) (mx += p.x), (my += p.y);
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ax = Math.cos(ang);
  const ay = Math.sin(ang);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const t = (p.x - mx) * ax + (p.y - my) * ay;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  let centres: Vec2[] = [];
  for (let i = 0; i < k; i++) {
    const t = lo + ((i + 0.5) / k) * (hi - lo);
    centres.push({ x: mx + ax * t, y: my + ay * t });
  }
  let groups: Vec2[][] = [];
  for (let iter = 0; iter < 12; iter++) {
    groups = centres.map(() => []);
    for (const p of pts) {
      let b = 0;
      let bd = Infinity;
      centres.forEach((c, i) => {
        const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
        if (d < bd) (bd = d), (b = i);
      });
      groups[b].push(p);
    }
    centres = groups.map((g, i) => (g.length ? { x: g.reduce((s, p) => s + p.x, 0) / g.length, y: g.reduce((s, p) => s + p.y, 0) / g.length } : centres[i]));
  }
  return groups.filter((g) => g.length > 0);
}

/**
 * Finds balls in a flat picture of the bed (see `rectify`) and guesses their numbers.
 * `toImage` is the table -> photo transform; it tells which way the camera was looking so that
 * a ball photographed at an angle is placed where it touches the cloth, not where its top appears.
 */
export function findBalls(flat: Raster, scale: number, mode: GameMode, toImage?: Homography): FoundBall[] {
  const { width: w, height: h } = flat;
  const cloth = medianCloth(flat);
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (flat.data[i + 3] === 0) continue;
    if (!looksLikeCloth(flat.data[i], flat.data[i + 1], flat.data[i + 2], cloth)) mask[p] = 1;
  }
  const rPx = R * scale;
  const ballArea = Math.PI * rPx * rPx;
  const toTable = (p: Vec2): Vec2 => ({ x: (p.x + 0.5) / scale, y: W - (p.y + 0.5) / scale });
  const fromImage = toImage ? invertH(toImage) : null;

  const found: FoundBall[] = [];
  for (const b of blobs(mask, w, h)) {
    if (b.px.length < ballArea * 0.3) continue;
    const pts = b.px.map((p) => ({ x: p % w, y: Math.floor(p / w) }));
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    // Long thin strips along an edge are rail or cushion showing through a slightly-off corner.
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < rPx * 1.1 && Math.max(bw, bh) > rPx * 4) continue;
    if (b.px.length / (bw * bh) < 0.3) continue;
    // A cue lying on the table: long, and much thinner than a ball.
    let mx = 0;
    let my = 0;
    for (const p of pts) (mx += p.x), (my += p.y);
    mx /= pts.length;
    my /= pts.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const p of pts) {
      sxx += (p.x - mx) ** 2;
      sxy += (p.x - mx) * (p.y - my);
      syy += (p.y - my) ** 2;
    }
    const tr = (sxx + syy) / pts.length;
    const det = (sxx * syy - sxy * sxy) / (pts.length * pts.length);
    const minor = Math.sqrt(Math.max(0, tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det))));
    if (minor < 0.3 * rPx) continue;
    // Anything much bigger than a full rack is not balls.
    if (b.px.length > ballArea * 14) continue;
    // Rail, cushion face or floor showing at the edge of the flat picture: only something
    // shaped like a single ball is kept there.
    const major = Math.sqrt(Math.max(0, tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det))));
    const atEdge = x0 <= 0 || y0 <= 0 || x1 >= w - 1 || y1 >= h - 1;
    if (atEdge && !(b.px.length > 0.5 * ballArea && b.px.length < 1.7 * ballArea && minor > 0.33 * rPx && major < 0.95 * rPx)) continue;

    // Seen from the side, a ball's picture laid flat on the table is stretched away from the
    // camera. The local stretch of the photo -> table mapping says by how much.
    let stretch = 1;
    if (toImage && fromImage) {
      const c = toTable({ x: mx, y: my });
      const ip = applyH(toImage, c);
      const a = applyH(fromImage, { x: ip.x + 1, y: ip.y });
      const d = applyH(fromImage, { x: ip.x, y: ip.y + 1 });
      const j11 = a.x - c.x;
      const j21 = a.y - c.y;
      const j12 = d.x - c.x;
      const j22 = d.y - c.y;
      const q = j11 * j11 + j12 * j12 + j21 * j21 + j22 * j22;
      const dt = Math.abs(j11 * j22 - j12 * j21);
      const root = Math.sqrt(Math.max(0, q * q - 4 * dt * dt));
      const big = Math.sqrt((q + root) / 2);
      const small = Math.sqrt(Math.max(1e-18, (q - root) / 2));
      stretch = Math.max(1, Math.min(6, big / small));
    }
    const one = ballArea * stretch;
    const k = Math.max(1, Math.min(10, Math.floor(b.px.length / one + 0.35)));
    for (const g of k === 1 ? [pts] : split(pts, k)) {
      if (g.length < one * 0.3) continue;
      let cx = 0;
      let cy = 0;
      for (const p of g) (cx += p.x), (cy += p.y);
      cx /= g.length;
      cy /= g.length;
      let pos = toTable({ x: cx, y: cy });
      if (toImage && fromImage && k === 1) {
        // Direction on the table that points away from the camera at this spot.
        const ip = applyH(toImage, pos);
        const far = applyH(fromImage, { x: ip.x, y: ip.y - 8 });
        const d = Math.hypot(far.x - pos.x, far.y - pos.y);
        if (d > 1e-9) {
          const ux = (far.x - pos.x) / d;
          const uy = (far.y - pos.y) / d;
          let near = Infinity;
          let farT = -Infinity;
          for (const p of g) {
            const t = toTable(p);
            const along = (t.x - pos.x) * ux + (t.y - pos.y) * uy;
            if (along < near) near = along;
            if (along > farT) farT = along;
          }
          // A ball seen from the side smears away from the camera; its near edge is still true.
          if (farT - near > 2.4 * R) pos = { x: pos.x + ux * (near + R), y: pos.y + uy * (near + R) };
        }
      }
      const raw = pos;
      pos = { x: Math.max(R, Math.min(L - R, pos.x)), y: Math.max(R, Math.min(W - R, pos.y)) };
      // Colours from the middle of the ball only: the rim mixes with cloth and shadow.
      const rgb: number[] = [];
      for (const p of g) {
        if (stretch < 1.3 && (p.x - cx) ** 2 + (p.y - cy) ** 2 > (0.85 * rPx) ** 2) continue;
        const i = (p.y * w + p.x) * 4;
        rgb.push(flat.data[i], flat.data[i + 1], flat.data[i + 2]);
      }
      const guess = classifyBall(rgb, mode);
      // Pocket openings are dark blobs too: near a pocket, only a ball with a colour counts.
      let atPocket = false;
      for (const id of POCKET_IDS) {
        const c = pocketCenter(id);
        if (Math.hypot(raw.x - c.x, raw.y - c.y) < (isSidePocket(id) ? 2.0 : 2.6) * R) atPocket = true;
      }
      if (atPocket && (guess.id === null || guess.id === 8)) continue;
      found.push({ pos, id: guess.id, confidence: guess.confidence });
    }
  }
  // One ball per number: the most convincing keeps it, the rest are left for the player to name.
  const best = new Map<number, FoundBall>();
  for (const f of found) {
    if (f.id === null) continue;
    const cur = best.get(f.id);
    if (!cur || f.confidence > cur.confidence) best.set(f.id, f);
  }
  for (const f of found) if (f.id !== null && best.get(f.id) !== f) (f.id = null), (f.confidence = 0);
  return found;
}

import { TABLE } from './config';
import type { GameMode, Layout, PocketId, Vec2 } from './types';
import { add, dist, norm, scale, sub, v2 } from './vec';

const { L, W, R } = TABLE;

export const POCKET_IDS: PocketId[] = ['BL', 'BR', 'TL', 'TR', 'SB', 'ST'];

const CENTERS: Record<PocketId, Vec2> = {
  BL: v2(0, 0),
  BR: v2(L, 0),
  TL: v2(0, W),
  TR: v2(L, W),
  SB: v2(L / 2, 0),
  ST: v2(L / 2, W),
};

const D = Math.SQRT1_2;
const AXES: Record<PocketId, Vec2> = {
  BL: v2(-D, -D),
  BR: v2(D, -D),
  TL: v2(-D, D),
  TR: v2(D, D),
  SB: v2(0, -1),
  ST: v2(0, 1),
};

export function isSidePocket(id: PocketId): boolean {
  return id === 'SB' || id === 'ST';
}

/** Aim point of a pocket. */
export function pocketCenter(id: PocketId): Vec2 {
  return CENTERS[id];
}

/** Unit vector pointing into the pocket (out of the table). */
export function pocketAxis(id: PocketId): Vec2 {
  return AXES[id];
}

export function pocketMouth(id: PocketId): number {
  return isSidePocket(id) ? TABLE.sideMouth : TABLE.cornerMouth;
}

const CAPTURES = Object.fromEntries(
  POCKET_IDS.map((id) => {
    const cfg = isSidePocket(id) ? TABLE.sideCapture : TABLE.cornerCapture;
    return [id, { c: add(CENTERS[id], scale(AXES[id], -cfg.inset)), r: cfg.r }];
  }),
) as Record<PocketId, { c: Vec2; r: number }>;

export function pocketCapture(id: PocketId): { c: Vec2; r: number } {
  return CAPTURES[id];
}

/** Nose-line segment; n is the unit normal pointing into the table. */
export type Cushion = { a: Vec2; b: Vec2; n: Vec2 };

const cg = TABLE.cornerGap;
const sg = TABLE.sideGap;

export const CUSHIONS: Cushion[] = [
  { a: v2(cg, 0), b: v2(L / 2 - sg, 0), n: v2(0, 1) },
  { a: v2(L / 2 + sg, 0), b: v2(L - cg, 0), n: v2(0, 1) },
  { a: v2(cg, W), b: v2(L / 2 - sg, W), n: v2(0, -1) },
  { a: v2(L / 2 + sg, W), b: v2(L - cg, W), n: v2(0, -1) },
  { a: v2(0, cg), b: v2(0, W - cg), n: v2(1, 0) },
  { a: v2(L, cg), b: v2(L, W - cg), n: v2(-1, 0) },
];

export const JAW_POINTS: Vec2[] = CUSHIONS.flatMap((c) => [c.a, c.b]);

/** Lowest numbered object ball on the table. */
export function targetBallId(layout: Layout): number | null {
  let best: number | null = null;
  for (const b of layout.balls) if (b.id > 0 && (best === null || b.id < best)) best = b.id;
  return best;
}

export function nextBallId(layout: Layout, after: number): number | null {
  let best: number | null = null;
  for (const b of layout.balls) if (b.id > after && (best === null || b.id < best)) best = b.id;
  return best;
}

export function ballIdsForMode(mode: GameMode): number[] {
  const n = mode === '9' ? 9 : 10;
  return Array.from({ length: n + 1 }, (_, i) => i);
}

const MIN_SEP = 2 * R + 1e-4;

function clampToBed(p: Vec2): Vec2 {
  return v2(Math.min(L - R, Math.max(R, p.x)), Math.min(W - R, Math.max(R, p.y)));
}

function isLegal(p: Vec2, others: Vec2[]): boolean {
  if (p.x < R - 1e-9 || p.x > L - R + 1e-9 || p.y < R - 1e-9 || p.y > W - R + 1e-9) return false;
  for (const o of others) if (dist(p, o) < MIN_SEP - 1e-9) return false;
  return true;
}

/**
 * Nearest legal position to `wanted`: on the bed and not overlapping any other ball.
 */
export function placeBall(layout: Layout, id: number, wanted: Vec2): Vec2 {
  const others = layout.balls.filter((b) => b.id !== id).map((b) => b.pos);
  const safeWanted = v2(Number.isFinite(wanted.x) ? wanted.x : L / 2, Number.isFinite(wanted.y) ? wanted.y : W / 2);
  let p = clampToBed(safeWanted);
  for (let i = 0; i < 20; i++) {
    if (isLegal(p, others)) return p;
    for (const o of others) {
      const d = dist(p, o);
      if (d < MIN_SEP) {
        let dir = norm(sub(p, o));
        if (dir.x === 0 && dir.y === 0) dir = v2(1, 0);
        p = add(o, scale(dir, MIN_SEP + 1e-6));
      }
    }
    p = clampToBed(p);
  }
  if (isLegal(p, others)) return p;
  // Spiral outward from the wanted spot in 5 mm steps.
  const start = clampToBed(safeWanted);
  for (let r = 0.005; r < L; r += 0.005) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / 0.005));
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      const q = v2(start.x + r * Math.cos(a), start.y + r * Math.sin(a));
      if (isLegal(q, others)) return q;
    }
  }
  return p;
}

import { ballIdsForMode, placeBall } from '../core/table';
import type { GameMode, Layout, Vec2 } from '../core/types';

/** A ball found in the photo; `id` is null until its number is known. */
export type Marker = { pos: Vec2; id: number | null };

/** Scale and offset that fit an iw x ih picture inside a cw x ch box, centred. */
export function fitImage(iw: number, ih: number, cw: number, ch: number): { scale: number; ox: number; oy: number } {
  const scale = Math.max(1e-6, Math.min(cw / iw, ch / ih));
  return { scale, ox: (cw - iw * scale) / 2, oy: (ch - ih * scale) / 2 };
}

/** Index of the point closest to p, or -1 if none is within maxDist. */
export function nearestIndex(points: Vec2[], p: Vec2, maxDist: number): number {
  let best = -1;
  let bd = maxDist;
  points.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bd) (bd = d), (best = i);
  });
  return best;
}

/** Give marker `index` a number (or null); a marker that already had that number loses it. */
export function assignNumber(markers: Marker[], index: number, id: number | null): Marker[] {
  return markers.map((m, i) => (i === index ? { ...m, id } : id !== null && m.id === id ? { ...m, id: null } : m));
}

/** The layout to put on the table: named balls only, valid for the game, nudged apart if they overlap. */
export function markersToLayout(markers: Marker[], mode: GameMode): Layout {
  const allowed = ballIdsForMode(mode);
  const layout: Layout = { mode, balls: [] };
  const seen = new Set<number>();
  for (const m of markers) {
    if (m.id === null || !allowed.includes(m.id) || seen.has(m.id)) continue;
    seen.add(m.id);
    layout.balls.push({ id: m.id, pos: placeBall(layout, m.id, m.pos) });
  }
  layout.balls.sort((a, b) => a.id - b.id);
  return layout;
}

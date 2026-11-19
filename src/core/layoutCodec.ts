import { TABLE } from './config';
import { ballIdsForMode, placeBall } from './table';
import type { GameMode, Layout } from './types';

/** "m9;0:1270,635;1:1800,300" — mode, then id:x_mm,y_mm. */
export function encodeLayout(l: Layout): string {
  const parts = l.balls.map((b) => `${b.id}:${Math.round(b.pos.x * 1000)},${Math.round(b.pos.y * 1000)}`);
  return [`m${l.mode}`, ...parts].join(';');
}

/** Never throws. Unknown or malformed entries are dropped; illegal positions are repaired. */
export function decodeLayout(s: string): Layout {
  const empty: Layout = { mode: '9', balls: [] };
  if (typeof s !== 'string') return empty;
  const parts = s.split(';');
  const head = parts[0];
  if (head !== 'm9' && head !== 'm10') return empty;
  const mode: GameMode = head === 'm9' ? '9' : '10';
  const allowed = new Set(ballIdsForMode(mode));
  const layout: Layout = { mode, balls: [] };
  for (const part of parts.slice(1)) {
    const m = /^(\d{1,2}):(-?\d{1,7}),(-?\d{1,7})$/.exec(part);
    if (!m) continue;
    const id = Number(m[1]);
    if (!allowed.has(id) || layout.balls.some((b) => b.id === id)) continue;
    const wanted = { x: Number(m[2]) / 1000, y: Number(m[3]) / 1000 };
    layout.balls.push({ id, pos: placeBall(layout, id, wanted) });
  }
  return layout;
}

/** Every ball for the mode, scattered legally. */
export function randomLayout(mode: GameMode, rng: () => number = Math.random): Layout {
  const layout: Layout = { mode, balls: [] };
  const { L, W, R } = TABLE;
  for (const id of ballIdsForMode(mode)) {
    const wanted = { x: R + rng() * (L - 2 * R), y: R + rng() * (W - 2 * R) };
    const pos = placeBall(layout, id, wanted);
    // Keep to the millimetre so a layout survives a round trip through the URL unchanged.
    const snapped = placeBall(layout, id, { x: Math.round(pos.x * 1000) / 1000, y: Math.round(pos.y * 1000) / 1000 });
    layout.balls.push({ id, pos: snapped });
  }
  return layout;
}

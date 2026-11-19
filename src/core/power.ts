import { POWER_SPEEDS, TABLE } from './config';
import { simulate } from './physics/simulate';
import type { ClothSpeed } from './types';

const MAX = POWER_SPEEDS.length;

/** Cue ball speed in m/s for a power setting of 1..6; fractions fall between two levels. */
export function speedForPower(power: number): number {
  const p = Math.max(1, Math.min(MAX, power));
  const lo = Math.floor(p);
  if (lo >= MAX) return POWER_SPEEDS[MAX - 1];
  const f = p - lo;
  if (f === 0) return POWER_SPEEDS[lo - 1];
  return POWER_SPEEDS[lo - 1] * Math.pow(POWER_SPEEDS[lo] / POWER_SPEEDS[lo - 1], f);
}

const cache = new Map<string, number>();

/**
 * How many table lengths a rolling cue ball travels up and down an empty table at this speed.
 * This is how a player can find the same power on a real table.
 */
export function lagLengths(speed: number, cloth: ClothSpeed): number {
  const key = `${cloth}:${speed.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const start = { x: 2 * TABLE.R, y: TABLE.W / 2 };
  const sim = simulate([{ id: 0, pos: start }], { dir: 0, speed, tip: { side: 0, vert: 0.4 } }, { cloth });
  const path = sim.paths[0] ?? [];
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  const lengths = d / TABLE.L;
  cache.set(key, lengths);
  return lengths;
}

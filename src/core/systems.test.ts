import { expect, test } from 'vitest';
import { PHYS, TABLE } from './config';
import { collideCushion } from './physics/collide';
import { strike } from './physics/motion';
import { simulate } from './physics/simulate';
import type { SimResult, Tip, Vec2 } from './types';

/**
 * Benchmarks from published kicking systems (Dr. Dave Alciatore, billiards.colostate.edu):
 * the through-diamond rolling-ball 2-to-1 system (Billiards Digest, Jan 2024), the Plus System
 * and the Corner-5 System handouts, and the rail rebound of a rolling ball (TP B.6 / HSV B.15).
 * They describe how a typical table plays, so the simulated cushion has to reproduce them.
 */
const { L, W, R } = TABLE;
/** Diamonds sit on the rail top, this far behind the cushion nose. */
const SETBACK = 0.094;
const DIA = L / 8;
const TOL = 0.4; // diamonds
/** Rolling cue ball with running english, as drawn on the system handouts (60% of maximum side). */
const RUNNING: Tip = { side: -0.3, vert: 0.3 };
const ROLLING: Tip = { side: 0, vert: 0.4 };

function shoot(from: Vec2, through: Vec2, speed: number, tip: Tip): SimResult {
  const dir = Math.atan2(through.y - from.y, through.x - from.x) - PHYS.squirtPerSide * tip.side;
  return simulate([{ id: 0, pos: from }], { dir, speed, tip }, { cloth: 'medium' });
}
const along = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** First and last sampled point of the cue ball's straight run after its k-th cushion. */
function leg(sim: SimResult, k: number): [Vec2, Vec2] {
  const cs = sim.events.filter((e) => e.type === 'cushion');
  if (!cs[k - 1]) throw new Error(`cue ball touched only ${cs.length} cushions`);
  const t0 = cs[k - 1].t;
  const t1 = cs[k] ? cs[k].t : Infinity;
  const pts = sim.paths[0].filter((_, i) => sim.times[0][i] > t0 + 0.02 && sim.times[0][i] < t1 - 0.005);
  return [pts[0], pts[pts.length - 1]];
}
const xAtY = ([a, b]: [Vec2, Vec2], y: number) => a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
const yAtX = ([a, b]: [Vec2, Vec2], x: number) => a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);

test('a rolling ball comes straight off a rail at 0.7-0.8 of its speed with almost no roll left', () => {
  const b = strike(0, { x: 1, y: 0.6 }, { dir: 0, speed: 1.34, tip: ROLLING });
  collideCushion(b, { x: -1, y: 0 });
  expect(-b.vel.x / 1.34).toBeGreaterThan(0.68);
  expect(-b.vel.x / 1.34).toBeLessThan(0.8);
  expect(Math.abs(R * b.w.y) / 1.34).toBeLessThan(0.15);
});

/** How far from the bottom-right corner the ball comes back, in diamonds: + up the short rail, - along the long rail. */
function twoToOne(n: number, speed: number): number {
  const a = { x: L - n * DIA, y: -SETBACK };
  const b = { x: L - (n / 2) * DIA, y: W + SETBACK };
  const run = leg(shoot(along(a, b, 0.25), b, speed, ROLLING), 1);
  const x = xAtY(run, 0);
  return x > L ? yAtX(run, L) / DIA : -(L - x) / DIA;
}
test.each([2, 3, 4, 5])('2-to-1 system: a slow rolling ball on the %i-to-half track kicks to the corner', (n) => {
  expect(Math.abs(twoToOne(n, 1.34))).toBeLessThan(TOL);
});
test('2-to-1 system: more speed shortens the kick', () => {
  expect(twoToOne(4, 3.1)).toBeLessThan(twoToOne(4, 1.34));
});

/** Plus System: from long-rail diamond `o` through short-rail number `n`, the ball returns `n` diamonds further up the rail. */
function plusError(o: number, n: number): number {
  const a = { x: L - o * DIA, y: -SETBACK };
  const b = { x: L + SETBACK, y: W - ((n - 1) / 2) * (W / 4) };
  const back = leg(shoot(along(a, b, 0.2), b, 1.6, RUNNING), 2);
  return (L - xAtY(back, -SETBACK)) / DIA - (o + n);
}
test.each([
  [3, 5],
  [2, 3],
  [2, 6],
  [6, 2],
  [3.5, 3.5],
])('Plus System: from diamond %f through number %f', (o, n) => {
  expect(Math.abs(plusError(o, n))).toBeLessThan(TOL);
});

/** Corner-5: origin number d, first-rail number f, third-rail arrival should be d - f. */
function cornerFiveError(d: number, f: number): number {
  const a = d <= 5 ? { x: (5 - d) * 2 * DIA, y: W + SETBACK } : { x: -SETBACK, y: W - (d - 5) * (W / 4) };
  const b = { x: L - f * DIA, y: -SETBACK };
  const third = leg(shoot(along(a, b, 0.15), b, 2.6, RUNNING), 2);
  return (L - xAtY(third, W + SETBACK)) / DIA - (d - f);
}
test.each([
  [5, 2.5],
  [5, 3],
  [5, 1.5],
  [4.5, 2],
  [4, 1.5],
  [5.5, 3],
  [6, 4],
])('Corner-5 System: %f minus %f', (d, f) => {
  expect(Math.abs(cornerFiveError(d, f))).toBeLessThan(TOL);
});
test('Corner-5 benchmark: 5 through 2.5 comes back to the corner it started from', () => {
  const a = { x: 0, y: W + SETBACK };
  const b = { x: L - 2.5 * DIA, y: -SETBACK };
  const last = leg(shoot(along(a, b, 0.15), b, 2.6, RUNNING), 3);
  expect(Math.abs(yAtX(last, 0)) / DIA).toBeLessThan(0.5);
});

test('sidespin on a ball spinning in place dies off at 5-15 rad/s^2', () => {
  const decel = (5 * PHYS.muSpin * PHYS.g) / (2 * R);
  expect(decel).toBeGreaterThan(5);
  expect(decel).toBeLessThan(15);
});

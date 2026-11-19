import { expect, test } from 'vitest';
import { TABLE, TIPS } from './config';
import { bestPotProbability, cutAngle, entryAngle, ghostBall, pathClear, potGeometryOk, potProbability, solveAim } from './aim';
import { simulate } from './physics/simulate';
import { pocketCenter } from './table';
import type { Layout } from './types';
import { add, dist, norm, scale, v2 } from './vec';

const lay = (...b: [number, number, number][]): Layout => ({ mode: '9', balls: b.map(([id, x, y]) => ({ id, pos: v2(x, y) })) });

test('ghost ball sits 2R behind the object ball on the pocket line', () => {
  const g = ghostBall(v2(2.0, 0.5), 'TR');
  expect(dist(g, v2(2.0, 0.5))).toBeCloseTo(2 * TABLE.R, 9);
  expect(dist(g, pocketCenter('TR'))).toBeGreaterThan(dist(v2(2.0, 0.5), pocketCenter('TR')));
});
test('pathClear detects a blocker', () => {
  expect(pathClear(v2(0.5, 0.5), v2(2, 0.5), [{ id: 4, pos: v2(1.2, 0.52) }], [])).toBe(false);
  expect(pathClear(v2(0.5, 0.5), v2(2, 0.5), [{ id: 4, pos: v2(1.2, 0.52) }], [4])).toBe(true);
  expect(pathClear(v2(0.5, 0.5), v2(2, 0.5), [{ id: 4, pos: v2(1.2, 0.56) }], [])).toBe(true);
});
test('cut angle is zero for a straight shot and entry angle is zero down the pocket axis', () => {
  expect(cutAngle(v2(1.5, 0.23), v2(2.0, 0.73), 'TR')).toBeLessThan(0.03);
  expect(entryAngle(v2(2.0, 0.73), 'TR')).toBeLessThan(0.03);
  expect(entryAngle(v2(1.27, 0.5), 'ST')).toBeCloseTo(0, 6);
});
test('short straight shot is easier than a long thin cut', () => {
  const easy = potProbability(v2(2.0, 0.9), v2(2.25, 1.05), 'TR');
  const hard = potProbability(v2(0.3, 1.1), v2(1.9, 0.4), 'TR');
  expect(easy).toBeGreaterThan(0.85);
  expect(hard).toBeLessThan(0.35);
});
test('1 m + 1 m straight shot is between 45% and 80%', () => {
  const p = pocketCenter('TR');
  const d = norm(v2(-1, -0.5));
  const pr = potProbability(add(p, scale(d, 2)), add(p, scale(d, 1)), 'TR');
  expect(pr).toBeGreaterThan(0.45);
  expect(pr).toBeLessThan(0.8);
});
test('degenerate geometry yields finite numbers', () => {
  expect(Number.isFinite(potProbability(v2(1, 0.5), v2(1 + 2 * TABLE.R + 0.0005, 0.5), 'BR'))).toBe(true);
  expect(Number.isFinite(potProbability(v2(1, 0.5), v2(TABLE.L - 0.03, TABLE.W - 0.03), 'TR'))).toBe(true);
  expect(Number.isFinite(potProbability(v2(1, 0.5), v2(TABLE.L, TABLE.W), 'TR'))).toBe(true);
  expect(Number.isFinite(cutAngle(v2(1, 0.5), v2(1, 0.5), 'TR'))).toBe(true);
  expect(Number.isFinite(entryAngle(v2(TABLE.L, TABLE.W), 'TR'))).toBe(true);
});
test('solveAim pots a 30-degree cut', () => {
  const L = lay([0, 1.2, 0.3], [1, 2.0, 0.9]);
  const dir = solveAim(L, 1, 'TR', 1.8, TIPS.center, 'medium');
  expect(dir).not.toBeNull();
  const r = simulate(L.balls, { dir: dir!, speed: 1.8, tip: TIPS.center }, { cloth: 'medium' });
  expect(r.pocketed).toContainEqual({ id: 1, pocket: 'TR' });
});
test('solveAim compensates for squirt and spin-induced throw with side spin', () => {
  const L = lay([0, 0.9, 0.4], [1, 2.0, 0.9]);
  for (const tip of [TIPS.left, TIPS.right]) {
    const dir = solveAim(L, 1, 'TR', 1.8, tip, 'medium');
    expect(dir).not.toBeNull();
    const r = simulate(L.balls, { dir: dir!, speed: 1.8, tip }, { cloth: 'medium' });
    expect(r.pocketed).toContainEqual({ id: 1, pocket: 'TR' });
  }
});
test('solveAim returns null when a ball blocks the cue path', () => {
  expect(solveAim(lay([0, 0.5, 0.635], [1, 2.0, 0.635], [2, 1.2, 0.635]), 1, 'BR', 2.9, TIPS.center, 'medium')).toBeNull();
});
test('potGeometryOk rejects cuts over 70 degrees and blocked pocket lines', () => {
  expect(potGeometryOk(lay([0, 2.3, 0.2], [1, 2.0, 0.9]), 1, 'BR')).toBe(false);
  expect(potGeometryOk(lay([0, 1.2, 0.3], [1, 2.0, 0.9]), 1, 'TR')).toBe(true);
  expect(potGeometryOk(lay([0, 1.2, 0.3], [1, 2.0, 0.9], [2, 2.27, 1.085]), 1, 'TR')).toBe(false);
});
test('bestPotProbability is 0 without a cue ball or without an open pocket', () => {
  expect(bestPotProbability(lay([1, 2.0, 0.9]), 1)).toBe(0);
  expect(bestPotProbability(lay([0, 1.2, 0.3], [1, 2.0, 0.9]), 1)).toBeGreaterThan(0.3);
});

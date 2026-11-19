import { expect, test } from 'vitest';
import { TABLE } from './config';
import { CUSHIONS, JAW_POINTS, ballIdsForMode, nextBallId, placeBall, pocketAxis, pocketCapture, pocketCenter, targetBallId } from './table';
import type { Layout } from './types';
import { dist, len, v2 } from './vec';

test('six cushions, twelve jaw points', () => {
  expect(CUSHIONS).toHaveLength(6);
  expect(JAW_POINTS).toHaveLength(12);
});
test('bottom-left cushion on the bottom rail starts at cornerGap', () => {
  const c = CUSHIONS.find((c) => c.n.y === 1 && Math.min(c.a.x, c.b.x) < 1)!;
  expect(Math.min(c.a.x, c.b.x)).toBeCloseTo(0.0813, 6);
  expect(Math.max(c.a.x, c.b.x)).toBeCloseTo(1.27 - 0.0635, 6);
});
test('cushion normals point into the table', () => {
  const mid = v2(TABLE.L / 2, TABLE.W / 2);
  for (const c of CUSHIONS) {
    const m = v2((c.a.x + c.b.x) / 2, (c.a.y + c.b.y) / 2);
    expect((mid.x - m.x) * c.n.x + (mid.y - m.y) * c.n.y).toBeGreaterThan(0);
    expect(len(c.n)).toBeCloseTo(1, 9);
  }
});
test('pocket axes point out of the table and capture circles sit outside the nose line', () => {
  expect(pocketCenter('TR')).toEqual({ x: TABLE.L, y: TABLE.W });
  expect(pocketAxis('SB')).toEqual({ x: 0, y: -1 });
  expect(pocketAxis('TR').x).toBeCloseTo(Math.SQRT1_2, 9);
  expect(pocketCapture('SB').c.y).toBeCloseTo(-0.035, 9);
  expect(pocketCapture('BL').c.x).toBeLessThan(0);
});
test('target is lowest numbered ball', () => {
  expect(targetBallId({ mode: '9', balls: [{ id: 0, pos: v2(1, 0.5) }, { id: 5, pos: v2(2, 0.5) }, { id: 3, pos: v2(1.5, 0.5) }] })).toBe(3);
  expect(targetBallId({ mode: '9', balls: [{ id: 0, pos: v2(1, 0.5) }] })).toBeNull();
});
test('nextBallId returns null for the last ball', () => {
  expect(nextBallId({ mode: '9', balls: [{ id: 0, pos: v2(1, 0.5) }, { id: 9, pos: v2(2, 0.5) }] }, 9)).toBeNull();
  expect(nextBallId({ mode: '9', balls: [{ id: 0, pos: v2(1, 0.5) }, { id: 9, pos: v2(2, 0.5) }, { id: 4, pos: v2(2, 0.9) }] }, 4)).toBe(9);
});
test('ball ids per mode', () => {
  expect(ballIdsForMode('9')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(ballIdsForMode('10')).toHaveLength(11);
});
test('placeBall keeps balls on the table and apart', () => {
  const lay: Layout = { mode: '9', balls: [{ id: 0, pos: v2(1, 0.5) }, { id: 1, pos: v2(1.2, 0.5) }] };
  const p = placeBall(lay, 1, v2(1.01, 0.5));
  expect(dist(p, v2(1, 0.5))).toBeGreaterThanOrEqual(2 * TABLE.R);
  const q = placeBall(lay, 1, v2(-5, 9));
  expect(q.x).toBeCloseTo(TABLE.R, 6);
  expect(q.y).toBeCloseTo(TABLE.W - TABLE.R, 6);
});
test('placeBall on top of another ball in a corner still finds a legal spot', () => {
  const lay: Layout = { mode: '9', balls: [{ id: 0, pos: v2(TABLE.R, TABLE.R) }, { id: 1, pos: v2(1, 0.5) }, { id: 2, pos: v2(TABLE.R + 2 * TABLE.R + 0.0002, TABLE.R) }] };
  const p = placeBall(lay, 1, v2(TABLE.R, TABLE.R));
  expect(dist(p, lay.balls[0].pos)).toBeGreaterThanOrEqual(2 * TABLE.R);
  expect(dist(p, lay.balls[2].pos)).toBeGreaterThanOrEqual(2 * TABLE.R);
  expect(p.x).toBeGreaterThanOrEqual(TABLE.R - 1e-9);
  expect(p.y).toBeGreaterThanOrEqual(TABLE.R - 1e-9);
});

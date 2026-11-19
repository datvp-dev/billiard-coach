import { expect, test } from 'vitest';
import { angleOf, len, v2 } from '../vec';
import { advance, isMoving, slipVelocity, strike, type Body } from './motion';

const run = (b: Body, t: number) => {
  for (let i = 0; i < t / 0.001; i++) advance(b, 0.001, { cloth: 'medium' });
  return b;
};

test('high tip 0.4 starts in natural roll', () => {
  expect(len(slipVelocity(strike(0, v2(1, 0.6), { dir: 0, speed: 2, tip: { side: 0, vert: 0.4 } })))).toBeLessThan(1e-9);
});
test('centre hit slides then rolls at 5/7 of launch speed', () => {
  const b = strike(0, v2(0.3, 0.6), { dir: 0, speed: 2, tip: { side: 0, vert: 0 } });
  run(b, (2 * 2) / (7 * 0.2 * 9.81) + 0.002);
  expect(len(b.vel)).toBeCloseTo((2 * 5) / 7, 1);
  expect(len(slipVelocity(b))).toBeLessThan(0.01);
});
test('rolling ball travels v^2 / (2 muRoll g)', () => {
  const b = strike(0, v2(0.2, 0.6), { dir: 0, speed: 0.5, tip: { side: 0, vert: 0.4 } });
  run(b, 10);
  expect(b.pos.x - 0.2).toBeCloseTo(0.25 / (2 * 0.01 * 9.81), 1);
  expect(isMoving(b)).toBe(false);
});
test('draw: backspin decreases while sliding forward', () => {
  const b = strike(0, v2(0.3, 0.6), { dir: 0, speed: 3, tip: { side: 0, vert: -0.4 } });
  const w0 = b.w.y;
  expect(w0).toBeLessThan(0);
  run(b, 0.1);
  expect(Math.abs(b.w.y)).toBeLessThan(Math.abs(w0));
  expect(b.vel.x).toBeGreaterThan(0);
});
test('a sliding ball with no spin picks up forward roll in any direction', () => {
  const b = strike(0, v2(1, 0.3), { dir: Math.PI / 2, speed: 2, tip: { side: 0, vert: 0 } });
  run(b, 0.6);
  expect(len(slipVelocity(b))).toBeLessThan(0.01);
  expect(b.vel.y).toBeGreaterThan(1);
  expect(Math.abs(b.vel.x)).toBeLessThan(1e-9);
});
test('right english squirts left and spins counter-clockwise seen from above', () => {
  const b = strike(0, v2(1, 0.6), { dir: 0, speed: 2, tip: { side: 0.3, vert: 0 } });
  expect(angleOf(b.vel)).toBeCloseTo(0.035 * 0.3, 6);
  expect(b.w.z).toBeGreaterThan(0);
});
test('side spin decays to zero and the ball stops', () => {
  const b = strike(0, v2(1, 0.6), { dir: 0, speed: 1, tip: { side: 0.3, vert: 0 } });
  run(b, 20);
  expect(isMoving(b)).toBe(false);
  expect(b.w.z).toBe(0);
});

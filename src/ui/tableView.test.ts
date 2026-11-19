import { expect, test } from 'vitest';
import { v2 } from '../core/vec';
import { ballColor, computeTransform } from './tableView';

test('portrait puts the table long axis vertical and round-trips', () => {
  const t = computeTransform(390, 700);
  expect(t.portrait).toBe(true);
  const p = v2(1.9, 0.4);
  const q = t.toTable(t.toScreen(p));
  expect(q.x).toBeCloseTo(p.x, 6);
  expect(q.y).toBeCloseTo(p.y, 6);
  const a = t.toScreen(v2(0, 0.635));
  const b = t.toScreen(v2(2.54, 0.635));
  expect(Math.abs(a.y - b.y)).toBeGreaterThan(Math.abs(a.x - b.x));
});
test('portrait is a quarter turn clockwise: BL pocket top-left, TR pocket bottom-right', () => {
  const t = computeTransform(390, 700);
  const bl = t.toScreen(v2(0, 0));
  const tr = t.toScreen(v2(2.54, 1.27));
  expect(bl.x).toBeLessThan(tr.x);
  expect(bl.y).toBeLessThan(tr.y);
  const tl = t.toScreen(v2(0, 1.27));
  expect(tl.x).toBeGreaterThan(bl.x);
  expect(tl.y).toBeCloseTo(bl.y, 6);
});
test('landscape keeps it horizontal, y up, and fits inside the canvas with room for the rails', () => {
  const t = computeTransform(900, 420);
  expect(t.portrait).toBe(false);
  const c = t.toScreen(v2(2.54, 0));
  const o = t.toScreen(v2(0, 1.27));
  expect(o.x).toBeGreaterThan(0);
  expect(o.y).toBeGreaterThan(0);
  expect(c.x).toBeLessThan(900);
  expect(c.y).toBeLessThan(420);
  expect(t.toScreen(v2(1, 1)).y).toBeLessThan(t.toScreen(v2(1, 0)).y);
  const q = t.toTable(t.toScreen(v2(0.7, 0.2)));
  expect(q.x).toBeCloseTo(0.7, 6);
  expect(q.y).toBeCloseTo(0.2, 6);
});
test('a zero-size canvas does not produce NaN', () => {
  const t = computeTransform(0, 0);
  const p = t.toTable(t.toScreen(v2(1, 0.5)));
  expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
});
test('9 and 10 are stripes', () => {
  expect(ballColor(9).stripe).toBe(true);
  expect(ballColor(10).stripe).toBe(true);
  expect(ballColor(8).stripe).toBe(false);
  expect(ballColor(9).fill).toBe(ballColor(1).fill);
});

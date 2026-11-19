import { expect, test } from 'vitest';
import { TABLE } from '../core/config';
import { assignNumber, fitImage, markersToLayout, nearestIndex, type Marker } from './photoModel';

const P = (x: number, y: number) => ({ x, y });

test('a picture is scaled to fit its box and centred', () => {
  expect(fitImage(800, 400, 400, 400)).toEqual({ scale: 0.5, ox: 0, oy: 100 });
  expect(fitImage(400, 800, 400, 400)).toEqual({ scale: 0.5, ox: 100, oy: 0 });
});
test('the nearest point within reach is picked', () => {
  const pts = [P(0, 0), P(10, 0), P(50, 50)];
  expect(nearestIndex(pts, P(8, 1), 20)).toBe(1);
  expect(nearestIndex(pts, P(100, 100), 20)).toBe(-1);
});
test('naming a ball takes that number away from the ball that had it', () => {
  const m: Marker[] = [{ pos: P(1, 0.5), id: 3 }, { pos: P(2, 0.5), id: null }];
  expect(assignNumber(m, 1, 3).map((x) => x.id)).toEqual([null, 3]);
  expect(assignNumber(m, 0, null).map((x) => x.id)).toEqual([null, null]);
});
test('only named balls that exist in the game are placed, in number order', () => {
  const m: Marker[] = [{ pos: P(2, 0.5), id: 10 }, { pos: P(1.5, 0.4), id: null }, { pos: P(1, 0.5), id: 2 }, { pos: P(0.5, 0.5), id: 0 }];
  expect(markersToLayout(m, '9').balls.map((b) => b.id)).toEqual([0, 2]);
  expect(markersToLayout(m, '10').balls.map((b) => b.id)).toEqual([0, 2, 10]);
});
test('balls detected on top of each other are nudged apart', () => {
  const l = markersToLayout([{ pos: P(1, 0.5), id: 1 }, { pos: P(1.01, 0.5), id: 2 }], '9');
  const [a, b] = l.balls;
  expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThanOrEqual(2 * TABLE.R - 1e-9);
});

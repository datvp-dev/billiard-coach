import { expect, test } from 'vitest';
import { BALL_SETS, type BallSetChoice, type BallSetId } from '../core/equipment';
import { TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import { setOf } from './classify';
import { clothTones, findClothQuad } from './corners';
import { detectBalls, guessCorners } from './detect';
import { photograph, type PhotoOptions } from './synthetic';

const { L, W } = TABLE;
const SPOTS: [number, number][] = [[0.6, 0.6], [1.7, 0.8], [2.1, 0.4], [0.9, 0.3], [1.3, 1.05], [0.4, 1.0], [2.2, 1.0], [1.2, 0.25], [1.9, 0.2], [0.35, 0.35]];
const ALL = SPOTS.map(([x, y], id) => ({ id, pos: { x, y } }));
const VIEW: Omit<PhotoOptions, 'cloth'> = { width: 1100, height: 640, from: [L / 2 + 0.2, -1.5, 1.9], at: [L / 2, W / 2, 0], fov: 1.1 };
const CLOTHS: Record<string, PhotoOptions['cloth']> = { blue: [0.06, 0.22, 0.48], grey: [0.33, 0.34, 0.35] };
const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

const shots = new Map<string, ReturnType<typeof photograph>>();
function shot(set: BallSetId, cloth: string, ids?: number[]) {
  const key = `${set} ${cloth} ${ids ?? ''}`;
  if (!shots.has(key)) shots.set(key, photograph({ ...VIEW, cloth: CLOTHS[cloth], set }, ids ? ALL.filter((b) => ids.includes(b.id)) : ALL, true));
  return shots.get(key)!;
}
function read(set: BallSetId, cloth: string, choice: BallSetChoice, ids?: number[]) {
  const s = shot(set, cloth, ids);
  return detectBalls(s.img, s.corners, true, '9', choice);
}
const right = (found: ReturnType<typeof read>, ids = ALL.map((b) => b.id)) => ids.filter((id) => found.some((f) => f.id === id && near(f.pos, ALL[id].pos) < 0.05)).length;

test.each(BALL_SETS.map((s) => s.id))('balls of the %s set are all named once the set is known', (set) => {
  for (const cloth of ['blue', 'grey']) expect(right(read(set, cloth, set))).toBe(10);
});
test('a few balls, which alone could be of several sets, are named by the set that was chosen', () => {
  // A purple ball is the 4 in one set and the 5 in another, and a brown one is no 3.
  const few = [0, 5, 7];
  expect(right(read('black', 'blue', 'black', few), few)).toBe(3);
  const other = [0, 4, 7];
  expect(right(read('standard', 'blue', 'standard', other), other)).toBe(3);
  expect(right(read('arcos', 'blue', 'arcos', other), other)).toBe(3);
});
test.each(BALL_SETS.map((s) => s.id))('a full table of the %s set is mostly right even when the set is not known', (set) => {
  expect(right(read(set, 'blue', 'auto'))).toBeGreaterThanOrEqual(9);
});
test('balls whose numbers were checked tell which set they are, unless several would do', () => {
  for (const set of ['standard', 'black', 'arcos'] as const) {
    const s = shot(set, 'blue');
    const pairs = detectBalls(s.img, s.corners, true, '9', set).filter((f) => f.id !== null).map((f) => ({ id: f.id!, look: f.look! }));
    expect(setOf(pairs)).toBe(set);
  }
  const s = shot('standard', 'blue');
  const pairs = detectBalls(s.img, s.corners, true, '9', 'standard').filter((f) => f.id === 0 || f.id === 3 || f.id === 8).map((f) => ({ id: f.id!, look: f.look! }));
  expect(setOf(pairs)).toBeNull();
});
test('knowing the cloth picks its colour out of a picture full of others', () => {
  const s = shot('standard', 'grey');
  const img = { ...s.img, data: s.img.data.slice() };
  // A large bright green wall behind the table.
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i] > 120 && img.data[i] < 136 && y < 90) img.data.set([40, 160, 70, 255], i);
    }
  }
  expect(clothTones(img, 10, 'grey').every((t) => t.sat < 0.3)).toBe(true);
  expect(clothTones(img, 10, 'green').every((t) => t.cg > t.cr && t.cg > t.cr)).toBe(true);
});
test('a cloth the app would not think of is found once it is named', () => {
  const camel = photograph({ ...VIEW, cloth: [0.4, 0.27, 0.14], sights: 0.094 }, ALL, true);
  const named = guessCorners(camel.img, 'camel')!;
  expect(named).not.toBeNull();
  named.corners.forEach((c, i) => expect(near(c, camel.corners[i])).toBeLessThan(40));
  expect(findClothQuad(camel.img, 'purple')).toBeNull();
});
test('a cloth colour left over from another table does not lead astray', () => {
  const s = shot('standard', 'blue');
  for (const wrong of ['red', 'camel', 'slate', 'black', 'purple'] as const) {
    const g = guessCorners(s.img, wrong);
    if (g) g.corners.forEach((c, i) => expect(near(c, s.corners[i])).toBeLessThan(40));
  }
});

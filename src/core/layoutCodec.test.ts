import { expect, test } from 'vitest';
import { TABLE } from './config';
import { decodeLayout, encodeLayout, randomLayout } from './layoutCodec';
import { dist, v2 } from './vec';

test('round trip to the millimetre', () => {
  const l = { mode: '10' as const, balls: [{ id: 0, pos: v2(1.27, 0.635) }, { id: 10, pos: v2(2.2, 0.3) }] };
  expect(encodeLayout(l)).toBe('m10;0:1270,635;10:2200,300');
  expect(decodeLayout(encodeLayout(l))).toEqual(l);
});
test('garbage decodes to an empty 9-ball table', () => {
  for (const s of ['', '???', 'm7;0:a,b', 'm9;;;:', '%%%', 'm9']) expect(decodeLayout(s)).toEqual({ mode: '9', balls: [] });
});
test('bad entries are dropped, good ones kept', () => {
  expect(decodeLayout('m9;0:1270,635;10:500,500;1:x,2;2:900,400;2:100,100;-1:5,5;1.5:5,5').balls.map((b) => b.id)).toEqual([0, 2]);
});
test('out-of-table and overlapping positions are repaired', () => {
  const l = decodeLayout('m9;0:99999,-5;1:1000,500;2:1001,500');
  expect(l.balls).toHaveLength(3);
  for (const b of l.balls) {
    expect(b.pos.x).toBeGreaterThanOrEqual(TABLE.R);
    expect(b.pos.x).toBeLessThanOrEqual(TABLE.L - TABLE.R);
    expect(b.pos.y).toBeGreaterThanOrEqual(TABLE.R);
    expect(b.pos.y).toBeLessThanOrEqual(TABLE.W - TABLE.R);
  }
  expect(dist(l.balls[1].pos, l.balls[2].pos)).toBeGreaterThanOrEqual(2 * TABLE.R);
});
test('randomLayout places every ball legally and is repeatable with a seeded rng', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const l = randomLayout('10', rng);
  expect(l.balls.map((b) => b.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const a of l.balls) for (const b of l.balls) if (a.id < b.id) expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(2 * TABLE.R);
  seed = 7;
  expect(randomLayout('10', rng)).toEqual(l);
});

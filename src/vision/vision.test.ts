import { expect, test } from 'vitest';
import { TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import { enclosingQuad, orderCorners } from './corners';
import { detectBalls, guessCorners } from './detect';
import { applyH, homography, invertH } from './homography';
import { drawTable, type FakeBall } from './synthetic';

const { R } = TABLE;
const P = (x: number, y: number): Vec2 => ({ x, y });
const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

test('a homography takes each of its four points to its partner and inverts cleanly', () => {
  const from = [P(0, 0), P(2, 0), P(2, 1), P(0, 1)];
  const to = [P(100, 80), P(520, 60), P(600, 330), P(40, 300)];
  const h = homography(from, to);
  from.forEach((p, i) => expect(near(applyH(h, p), to[i])).toBeLessThan(1e-6));
  expect(near(applyH(invertH(h), P(600, 330)), P(2, 1))).toBeLessThan(1e-6);
});
test('a rectangle with its corners cut off is restored to four corners', () => {
  const cut = [P(10, 0), P(190, 0), P(200, 10), P(200, 90), P(190, 100), P(10, 100), P(0, 90), P(0, 10)];
  const quad = orderCorners(enclosingQuad(cut)!);
  [P(0, 0), P(200, 0), P(200, 100), P(0, 100)].forEach((c, i) => expect(near(quad[i], c)).toBeLessThan(1e-6));
});

// Table seen from straight above, long side across the picture.
const OVERHEAD = [P(110, 130), P(690, 130), P(690, 420), P(110, 420)];
// Table seen from one end with the phone upright: the far end looks narrower.
const FROM_END = [P(190, 120), P(420, 120), P(520, 700), P(90, 700)];

const BALLS: FakeBall[] = [
  { id: 0, pos: P(0.6, 0.6) },
  { id: 1, pos: P(1.7, 0.8) },
  { id: 2, pos: P(2.1, 0.4) },
  { id: 3, pos: P(0.9, 0.3) },
  { id: 4, pos: P(1.3, 1.05) },
  { id: 5, pos: P(0.3, 1.0) },
  { id: 6, pos: P(2.3, 1.0) },
  { id: 7, pos: P(1.2, 0.2) },
  { id: 8, pos: P(1.9, 0.15) },
  { id: 9, pos: P(0.25, 0.25) },
];

test('the corners of the playing surface are found on an overhead picture', () => {
  const g = guessCorners(drawTable(800, 550, OVERHEAD, true, BALLS))!;
  expect(g.horizontal).toBe(true);
  g.corners.forEach((c, i) => expect(near(c, OVERHEAD[i])).toBeLessThan(8));
});
test('the corners are found on an upright picture taken from one end', () => {
  const g = guessCorners(drawTable(600, 800, FROM_END, false, BALLS))!;
  expect(g.horizontal).toBe(false);
  g.corners.forEach((c, i) => expect(near(c, FROM_END[i])).toBeLessThan(10));
});
test('a picture with no table gives no corners', () => {
  const img = drawTable(400, 300, [P(-4000, -4000), P(-3000, -4000), P(-3000, -3500), P(-4000, -3500)], true, []);
  expect(guessCorners(img)).toBeNull();
});

function expectAll(found: ReturnType<typeof detectBalls>, balls: FakeBall[], tol: number) {
  expect(found).toHaveLength(balls.length);
  for (const b of balls) {
    const f = found.find((x) => x.id === b.id);
    expect(f, `ball ${b.id}`).toBeDefined();
    expect(near(f!.pos, b.pos), `ball ${b.id} position`).toBeLessThan(tol);
  }
}
test('every ball of a nine-ball layout is found, placed and numbered on an overhead picture', () => {
  const img = drawTable(800, 550, OVERHEAD, true, BALLS);
  expectAll(detectBalls(img, OVERHEAD, true, '9'), BALLS, 0.5 * R);
});
test('the same layout is read from an upright picture taken from one end', () => {
  const img = drawTable(600, 800, FROM_END, false, BALLS);
  expectAll(detectBalls(img, FROM_END, false, '9'), BALLS, 0.6 * R);
});
test('detection from the guessed corners stays within one ball of the truth', () => {
  const img = drawTable(800, 550, OVERHEAD, true, BALLS);
  const g = guessCorners(img)!;
  expectAll(detectBalls(img, g.corners, g.horizontal, '9'), BALLS, 2 * R);
});
test('two touching balls are told apart', () => {
  const pair: FakeBall[] = [
    { id: 3, pos: P(1.2, 0.6) },
    { id: 5, pos: P(1.2 + 2 * R, 0.6) },
  ];
  const found = detectBalls(drawTable(800, 550, OVERHEAD, true, pair), OVERHEAD, true, '9');
  expect(found).toHaveLength(2);
  for (const b of pair) expect(found.some((f) => near(f.pos, b.pos) < 0.6 * R)).toBe(true);
});
test('a blue stripe is the 10 in ten-ball and unknown in nine-ball', () => {
  const balls: FakeBall[] = [{ id: 10, pos: P(1.0, 0.6) }];
  const img = drawTable(800, 550, OVERHEAD, true, balls);
  expect(detectBalls(img, OVERHEAD, true, '10')[0].id).toBe(10);
  expect(detectBalls(img, OVERHEAD, true, '9')[0].id).toBeNull();
});
test('when two balls look like the same number only one keeps it', () => {
  const balls: FakeBall[] = [
    { id: 1, pos: P(1.0, 0.6) },
    { id: 1, pos: P(1.6, 0.6) },
  ];
  const found = detectBalls(drawTable(800, 550, OVERHEAD, true, balls), OVERHEAD, true, '9');
  expect(found.map((f) => f.id).sort()).toEqual([1, null]);
});
test('pockets and an empty table give no balls', () => {
  expect(detectBalls(drawTable(800, 550, OVERHEAD, true, []), OVERHEAD, true, '9')).toEqual([]);
});

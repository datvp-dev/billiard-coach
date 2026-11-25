import { expect, test } from 'vitest';
import type { Vec2 } from '../core/types';
import { photograph, type FakeBall } from '../vision/synthetic';
import { watchTable } from '../vision/detect';
import { parseLiveLink } from './link';
import { createTracker, type Look } from './tracker';
import { SAME_VIEW, viewMatch, viewSignature } from './view';

const P = (x: number, y: number): Vec2 => ({ x, y });
const B = (id: number | null, x: number, y: number, confidence = 0.8) => ({ id, pos: P(x, y), confidence });
const look = (balls: ReturnType<typeof B>[], clear: boolean[] = [], sameView = true): Look => ({ balls, clear, sameView });

test('links: YouTube, TikTok, anything on the web; nothing else', () => {
  expect(parseLiveLink('https://www.youtube.com/live/abc123?si=x')).toEqual({ site: 'youtube', url: 'https://www.youtube.com/live/abc123?si=x' });
  expect(parseLiveLink(' youtu.be/abc ')).toEqual({ site: 'youtube', url: 'https://youtu.be/abc' });
  expect(parseLiveLink('https://www.tiktok.com/@ai.do/live')!.site).toBe('tiktok');
  expect(parseLiveLink('vm.tiktok.com/ZZZ/')!.site).toBe('tiktok');
  expect(parseLiveLink('https://facebook.com/watch/live')!.site).toBe('other');
  expect(parseLiveLink('https://notyoutube.com/x')!.site).toBe('other');
  for (const bad of ['', 'xin chào', 'abc', 'javascript:alert(1)', 'file:///etc/passwd', 'https://a:b@youtube.com/']) expect(parseLiveLink(bad)).toBeNull();
});

const A = [B(0, 0.6, 0.6), B(1, 1.7, 0.8), B(2, 2.1, 0.4)];
const noise = (balls: ReturnType<typeof B>[], k: number) => balls.map((b, i) => ({ ...b, pos: P(b.pos.x + 0.003 * Math.sin(k * 3 + i), b.pos.y + 0.003 * Math.cos(k * 5 + i)) }));

test('a standing table is published once and then left alone', () => {
  const t = createTracker('9');
  const out = [];
  for (let k = 0; k < 10; k++) out.push(t.look(look(noise(A, k))));
  const got = out.filter(Boolean);
  expect(got).toHaveLength(1);
  expect(got[0]!.balls.map((b) => b.id)).toEqual([0, 1, 2]);
  expect(t.status()).toBe('steady');
});
test('nothing is published while balls roll; the new position follows when they stop', () => {
  const t = createTracker('9');
  for (let k = 0; k < 6; k++) t.look(look(A));
  const rolling = [];
  for (let k = 1; k <= 8; k++) {
    const now = [B(0, 0.6 + 0.08 * k, 0.6), B(1, 1.7, 0.8), B(2, 2.1, 0.4)];
    rolling.push(t.look(look(now, [true, false, false])));
    if (k > 1) expect(t.status()).toBe('moving');
  }
  expect(rolling.every((r) => r === null)).toBe(true);
  const end = [B(0, 1.24, 0.6), B(1, 1.7, 0.8), B(2, 2.1, 0.4)];
  let done = null;
  for (let k = 0; k < 6; k++) done = t.look(look(end, [true, false, false, false])) ?? done;
  expect(done!.balls.find((b) => b.id === 0)!.pos.x).toBeCloseTo(1.24, 2);
});
test('a potted ball goes away once its place is seen empty', () => {
  const t = createTracker('9');
  for (let k = 0; k < 6; k++) t.look(look(A));
  let done = null;
  for (let k = 0; k < 6; k++) done = t.look(look([A[0], A[2]], [false, true, false])) ?? done;
  expect(done!.balls.map((b) => b.id)).toEqual([0, 2]);
});
test('a ball behind a player stays on the table', () => {
  const t = createTracker('9');
  for (let k = 0; k < 6; k++) t.look(look(A));
  for (let k = 0; k < 20; k++) expect(t.look(look([A[0], A[2]], [false, false, false]))).toBeNull();
  expect(t.balls().find((b) => b.id === 1)!.hidden).toBe(true);
  for (let k = 0; k < 6; k++) expect(t.look(look(A, [false, false, false]))).toBeNull();
  expect(t.balls().find((b) => b.id === 1)!.hidden).toBe(false);
});
test('another camera changes nothing', () => {
  const t = createTracker('9');
  for (let k = 0; k < 6; k++) t.look(look(A));
  for (let k = 0; k < 8; k++) expect(t.look(look([B(5, 1, 1), B(6, 0.5, 0.2)], [true, true, true], false))).toBeNull();
  expect(t.status()).toBe('away');
  for (let k = 0; k < 6; k++) expect(t.look(look(A, [false, false, false]))).toBeNull();
});
test('something round that is there for one look only is not a ball', () => {
  const t = createTracker('9');
  for (let k = 0; k < 6; k++) t.look(look(A));
  expect(t.look(look([...A, B(7, 1.2, 0.2)]))).toBeNull();
  for (let k = 0; k < 6; k++) expect(t.look(look(A, [false, false, false, true]))).toBeNull();
});
test('a number misread now and then does not win over what was seen before', () => {
  const t = createTracker('9');
  for (let k = 0; k < 8; k++) t.look(look(A));
  for (let k = 0; k < 3; k++) expect(t.look(look([A[0], B(5, 1.7, 0.8), A[2]]))).toBeNull();
});
test('numbers given by the player hold for balls that stay put', () => {
  const t = createTracker('9');
  const first = t.seed([{ pos: P(0.6, 0.6), id: 0 }, { pos: P(1.7, 0.8), id: 7 }, { pos: P(2.1, 0.4), id: 2 }]);
  expect(first.balls.map((b) => b.id)).toEqual([0, 2, 7]);
  for (let k = 0; k < 30; k++) expect(t.look(look([A[0], B(3, 1.7, 0.8), A[2]]))).toBeNull();
});
test('a moved ball that cannot be read keeps its number when it is the only one missing', () => {
  const t = createTracker('9');
  for (let k = 0; k < 6; k++) t.look(look(A));
  let done = null;
  const moved = [A[0], B(null, 1.0, 0.3, 0), A[2]];
  for (let k = 0; k < 8; k++) done = t.look(look(moved, [false, true, false, false])) ?? done;
  expect(done!.balls.find((b) => b.id === 1)!.pos.x).toBeCloseTo(1.0, 2);
});

// --- on pictures ---
const BALLS: FakeBall[] = [
  { id: 0, pos: P(0.6, 0.6) },
  { id: 1, pos: P(1.7, 0.8) },
  { id: 6, pos: P(2.1, 0.4) },
];
const CAM = { width: 960, height: 540, from: [1.27, -1.5, 2.1] as [number, number, number], at: [1.27, 0.55, 0] as [number, number, number], fov: 1.2, cloth: [0.06, 0.25, 0.5] as [number, number, number] };

test('the view is recognised after balls move and not after a cut to another camera', () => {
  const a = photograph(CAM, BALLS, true);
  const b = photograph({ ...CAM, noise: 9, tint: [0.9, 0.9, 0.9] }, [{ id: 0, pos: P(1.1, 0.2) }, { id: 3, pos: P(0.2, 1.1) }], true);
  const cut = photograph({ ...CAM, from: [-0.9, 0.2, 1.2], at: [1.6, 0.7, 0] }, BALLS, true);
  const ref = viewSignature(a.img, a.corners, true);
  expect(viewMatch(ref, viewSignature(b.img, a.corners, true))).toBeGreaterThan(0.85);
  expect(viewMatch(ref, viewSignature(cut.img, a.corners, true))).toBeLessThan(SAME_VIEW - 0.1);
});
test('an empty spot is told from one with a ball or a sleeve on it', () => {
  const { img, corners } = photograph(CAM, BALLS, true);
  // A dark sleeve across the bed.
  for (let y = 250; y < 420; y++) for (let x = 300; x < 360; x++) img.data.set([30, 28, 30, 255], (y * img.width + x) * 4);
  const r = watchTable(img, corners, true, '9', [P(0.6, 0.6), P(1.3, 0.3), P(1.7, 0.8)]);
  expect(r.clear).toEqual([false, true, false]);
  const covered = watchTable(img, corners, true, '9', [r.at({ x: 330, y: 330 })]);
  expect(covered.clear).toEqual([false]);
});

test('a hand or glare that comes and goes does not stop the table from following a pot', () => {
  const t = createTracker('9');
  for (let k = 0; k < 6; k++) t.look(look(A));
  let done = null;
  for (let k = 0; k < 10; k++) {
    const ghost = k % 2 ? [B(null, 0.4 + 0.2 * (k % 5), 0.2, 0)] : [];
    done = t.look(look([A[0], A[2], ...ghost], [false, true, false, true])) ?? done;
  }
  expect(done!.balls.map((b) => b.id)).toEqual([0, 2]);
});
test('a cue ball still rolling after a pot is waited for', () => {
  const t = createTracker('9');
  for (let k = 0; k < 6; k++) t.look(look(A));
  for (let k = 1; k <= 8; k++) expect(t.look(look([B(0, 0.6 + 0.05 * k, 0.6), A[2]], [true, true, false]))).toBeNull();
  let done = null;
  for (let k = 0; k < 6; k++) done = t.look(look([B(0, 1.0, 0.6), A[2]], [true, true, false])) ?? done;
  expect(done!.balls.map((b) => b.id)).toEqual([0, 2]);
});
test('a player moving about over a standing table does not count as rolling balls', () => {
  const t = createTracker('9');
  for (let k = 0; k < 6; k++) t.look(look(A));
  for (let k = 0; k < 6; k++) {
    expect(t.look(look([...A, B(8, 0.4 + 0.2 * k, 0.2)], [false, false, false, true]))).toBeNull();
    expect(t.status()).toBe('steady');
  }
});
test('a player leaning over the bed is not read as a ball', () => {
  for (const [x0, y0, x1, y1, c] of [[430, 100, 560, 300, 36], [300, 250, 360, 420, 30], [500, 120, 700, 330, 225]] as const) {
    const { img, corners } = photograph(CAM, BALLS, true);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set([c, c - 2, c + 2, 255], (y * img.width + x) * 4);
    const r = watchTable(img, corners, true, '9', []);
    for (const b of r.balls) expect(BALLS.some((k) => Math.hypot(k.pos.x - b.pos.x, k.pos.y - b.pos.y) < 0.03), `ball at ${b.pos.x.toFixed(2)},${b.pos.y.toFixed(2)}`).toBe(true);
  }
});

// --- recognising balls again, people over the table, corrections by hand ---
import type { BallLook } from '../vision/classify';
const face = (hue: number, white = 0.1, black = 0): BallLook => {
  const coloured = Math.max(0, 1 - white - black);
  return { white, black, coloured, hue, sat: coloured > 0.2 ? 0.8 : 0, value: 0.7, bright: white > 0.8 ? [240, 238, 225] : [150, 110, 90] };
};
const F: Record<number, BallLook> = { 0: face(0, 1), 1: face(46), 2: face(222), 3: face(357), 5: face(24), 8: face(0, 0.05, 0.95) };
const S = (id: number | null, x: number, y: number, looks: number, extra: object = {}) => ({ id, pos: P(x, y), confidence: 0.8, look: F[looks], ...extra });
const TABLE_A = [S(0, 0.6, 0.6, 0), S(1, 1.7, 0.8, 1), S(3, 2.1, 0.4, 3), S(5, 0.4, 1.0, 5)];
const started = () => {
  const t = createTracker('9');
  t.seed(TABLE_A.map((b) => ({ pos: b.pos, id: b.id })));
  t.meet(TABLE_A);
  for (let k = 0; k < 8; k++) t.look(look(TABLE_A, [false, false, false, false]));
  return t;
};
const run = (t: ReturnType<typeof createTracker>, balls: ReturnType<typeof S>[], n: number, empty: Vec2[] = [], cover = 0) => {
  let done = null;
  for (let k = 0; k < n; k++) {
    const clear = t.watched().map((p) => empty.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.02));
    done = t.look({ balls, clear, sameView: true, cover }) ?? done;
  }
  return done;
};

test('after a shot balls are recognised by how they looked before, whatever the colour rules call them', () => {
  const t = started();
  // The 3 and the 5 both moved; the rules now read them the wrong way round.
  const after = [S(0, 1.0, 0.9, 0), TABLE_A[1], S(5, 1.2, 0.2, 3), S(3, 2.2, 1.0, 5)];
  const l = run(t, after, 8, [P(0.6, 0.6), P(2.1, 0.4), P(0.4, 1.0)])!;
  expect(l.balls.find((b) => b.id === 3)!.pos.x).toBeCloseTo(1.2, 2);
  expect(l.balls.find((b) => b.id === 5)!.pos.x).toBeCloseTo(2.2, 2);
});
test('a round part of a player is never a new ball', () => {
  const t = started();
  const hand = S(8, 1.2, 0.5, 8, { attached: true });
  expect(run(t, [...TABLE_A, hand], 20, [], 0.1)).toBeNull();
  expect(t.balls()).toHaveLength(4);
});
test('a hand where a ball is does not change or move that ball', () => {
  const t = started();
  const hand = S(8, 1.71, 0.81, 8, { attached: true });
  expect(run(t, [TABLE_A[0], hand, TABLE_A[2], TABLE_A[3]], 20, [], 0.1)).toBeNull();
  expect(t.balls().find((b) => b.id === 1)).toMatchObject({ hidden: true });
});
test('something round and unlike any missing ball is not shown while a player is there', () => {
  const t = started();
  expect(run(t, [...TABLE_A, S(8, 1.2, 0.5, 8)], 6, [], 0.1)).toBeNull();
});
test('a ball missing after a shot may be under the player: wait until it is found', () => {
  const t = started();
  const after = [S(0, 1.0, 0.9, 0), TABLE_A[1], TABLE_A[2]];
  expect(run(t, after, 10, [P(0.6, 0.6), P(0.4, 1.0)], 0.1)).toBeNull();
  expect(t.status()).toBe('blocked');
  const l = run(t, [...after, S(5, 0.9, 0.3, 5)], 8, [P(0.6, 0.6), P(0.4, 1.0)])!;
  expect(l.balls.map((b) => b.id)).toEqual([0, 1, 3, 5]);
});
test('a ball missing with nobody around has been potted', () => {
  const t = started();
  const l = run(t, [S(0, 1.0, 0.9, 0), TABLE_A[2], TABLE_A[3]], 8, [P(0.6, 0.6), P(1.7, 0.8)])!;
  expect(l.balls.map((b) => b.id)).toEqual([0, 3, 5]);
});
test('a number put right by hand holds, and the ball keeps it after the next shot', () => {
  const t = createTracker('9');
  // The 3 was read as the 5 and the other way round.
  t.seed([{ pos: P(0.6, 0.6), id: 0 }, { pos: P(2.1, 0.4), id: 5 }, { pos: P(0.4, 1.0), id: 3 }]);
  const seen = [S(0, 0.6, 0.6, 0), S(5, 2.1, 0.4, 3), S(3, 0.4, 1.0, 5)];
  t.meet(seen);
  run(t, seen, 8);
  const fixed = t.correct([{ pos: P(0.6, 0.6), id: 0 }, { pos: P(2.1, 0.4), id: 3 }, { pos: P(0.4, 1.0), id: 5 }]);
  expect(fixed.balls.find((b) => b.id === 3)!.pos.x).toBeCloseTo(2.1, 2);
  expect(run(t, seen, 12)).toBeNull();
  const l = run(t, [S(0, 1.2, 0.6, 0), S(5, 1.5, 0.3, 3), S(3, 0.7, 0.9, 5)], 8, seen.map((b) => b.pos))!;
  expect(l.balls.find((b) => b.id === 3)!.pos.x).toBeCloseTo(1.5, 2);
  expect(l.balls.find((b) => b.id === 5)!.pos.x).toBeCloseTo(0.7, 2);
});
test('a false ball taken off by hand stays off until its place has been empty', () => {
  const t = createTracker('9');
  const ghost = S(8, 1.2, 0.5, 8);
  t.seed([...TABLE_A, ghost].map((b) => ({ pos: b.pos, id: b.id })));
  t.meet([...TABLE_A, ghost]);
  run(t, [...TABLE_A, ghost], 6);
  expect(t.correct(TABLE_A.map((b) => ({ pos: b.pos, id: b.id }))).balls.map((b) => b.id)).toEqual([0, 1, 3, 5]);
  expect(run(t, [...TABLE_A, ghost], 25)).toBeNull();
});
test('a ball added by hand stays although it cannot be made out, until balls move', () => {
  const t = started();
  const l = t.correct([...TABLE_A.map((b) => ({ pos: b.pos, id: b.id })), { pos: P(1.3, 0.2), id: 2 }]);
  expect(l.balls.map((b) => b.id)).toEqual([0, 1, 2, 3, 5]);
  expect(run(t, TABLE_A, 15, [P(1.3, 0.2)])).toBeNull();
  const after = run(t, [S(0, 1.0, 0.9, 0), TABLE_A[1], TABLE_A[2], TABLE_A[3]], 10, [P(0.6, 0.6), P(1.3, 0.2)])!;
  expect(after.balls.map((b) => b.id)).toEqual([0, 1, 3, 5]);
});
test('the cue ball put back after a foul is recognised', () => {
  const t = started();
  run(t, TABLE_A.slice(1), 10, [P(0.6, 0.6)]);
  const l = run(t, [S(0, 0.5, 0.3, 0), ...TABLE_A.slice(1)], 10)!;
  expect(l.balls.map((b) => b.id)).toEqual([0, 1, 3, 5]);
});
test('a ball thought to be covered is found elsewhere by its face, and nothing else is named after a missing one it does not resemble', () => {
  const t = started();
  // The cue ball left; something that cannot be read now covers the place it left.
  const l = run(t, [S(null, 1.0, 0.9, 0), TABLE_A[1], TABLE_A[2]], 10, [P(0.4, 1.0)])!;
  expect(l.balls.find((b) => b.id === 0)!.pos.x).toBeCloseTo(1.0, 2);
  expect(l.balls.map((b) => b.id)).toEqual([0, 1, 3]);
});
test('in contrasty video, where shadows turn almost black, a shadow is not a second ball', () => {
  const few: FakeBall[] = [{ id: 0, pos: P(0.6, 0.6) }, { id: 3, pos: P(1.7, 0.8) }, { id: 8, pos: P(2.1, 0.4) }, { id: 5, pos: P(1.1, 0.3) }];
  const { img, corners } = photograph({ ...CAM, cloth: [0.02, 0.33, 0.04], from: [1.27, -2.6, 1.5], fov: 0.9 }, few, true);
  for (let i = 0; i < img.data.length; i += 4) for (let k = 0; k < 3; k++) img.data[i + k] = (img.data[i + k] - 48) * 1.3;
  const r = watchTable(img, corners, true, '9', []);
  expect(r.balls).toHaveLength(few.length);
  for (const f of few) expect(r.balls.some((b) => Math.hypot(b.pos.x - f.pos.x, b.pos.y - f.pos.y) < 0.03), `ball ${f.id}`).toBe(true);
});

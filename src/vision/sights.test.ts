import { expect, test } from 'vitest';
import { PHYS, TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import { applyH } from './homography';
import { bend, straighten, straightenImage } from './lens';
import { makeRaster } from './raster';
import { CORNER_AT, RISE, SETBACK, SIGHTS, calibrate, sightSpot, type Edge, type Mark } from './sights';
import { tableToImage } from './table';

const { L, W } = TABLE;
const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const WIDTH = 1600;
const HEIGHT = 900;

/** A real camera looking at the table: z is height above the cushion noses. */
function shooter(from: [number, number, number], focal = 1.1, k = 0) {
  const at = [L / 2, W / 2, 0];
  const unit = (v: number[]) => v.map((x) => x / Math.hypot(v[0], v[1], v[2]));
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const fw = unit([0, 1, 2].map((i) => at[i] - from[i]));
  const rt = unit(cross(fw, [0, 0, 1]));
  const dn = cross(fw, rt);
  const straight = (x: number, y: number, z: number): Vec2 => {
    const d = [x - from[0], y - from[1], z - from[2]];
    const dot = (a: number[]) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
    return { x: WIDTH / 2 + (focal * WIDTH * dot(rt)) / dot(fw), y: HEIGHT / 2 + (focal * WIDTH * dot(dn)) / dot(fw) };
  };
  return { straight, raw: (x: number, y: number, z: number) => bend(straight(x, y, z), { k }, WIDTH, HEIGHT) };
}
let seed = 1;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const FROM: [number, number, number] = [L / 2, -1.6, 2.1];
const cornersOf = (f: (x: number, y: number, z: number) => Vec2) => CORNER_AT(true).map((c) => f(c.x, c.y, 0));
function scene(o: { k?: number; setback?: number; nudge?: number; clumsy?: number; from?: [number, number, number] } = {}) {
  const cam = shooter(o.from ?? FROM, 1.1, o.k ?? 0);
  const marks: (Mark | null)[] = SIGHTS.map((_, i) => {
    const p = sightSpot(i, o.setback ?? SETBACK);
    const q = cam.raw(p.x, p.y, RISE);
    return { at: { x: q.x + (o.nudge ?? 0) * gauss(), y: q.y + (o.nudge ?? 0) * gauss() }, hand: false };
  });
  const rough = cornersOf(cam.raw).map((c) => ({ x: c.x + (o.clumsy ?? 0) * gauss(), y: c.y + (o.clumsy ?? 0) * gauss() }));
  return { cam, marks, rough };
}
const solve = (s: ReturnType<typeof scene>, noses: (Edge | null)[] = [null, null, null, null]) => calibrate({ width: WIDTH, height: HEIGHT, horizontal: true, rough: s.rough, marks: s.marks, noses });
/** Largest error, in metres, of reading where things are on the bed. */
function worst(s: ReturnType<typeof scene>, cal: ReturnType<typeof solve>, z = 0): number {
  let m = 0;
  for (const x of [0.1, 0.7, L / 2, 2, 2.44]) for (const y of [0.1, W / 2, 1.17]) m = Math.max(m, near(cal.toTable(s.cam.raw(x, y, z)), { x, y }));
  return m;
}

test('there are six sights on each long rail and three on each short one, none at a pocket', () => {
  expect(SIGHTS).toHaveLength(18);
  expect(SIGHTS.filter((s) => s.rail < 2)).toHaveLength(12);
  for (let i = 0; i < 18; i++) {
    const p = sightSpot(i);
    const out = Math.max(-p.x, p.x - L, -p.y, p.y - W);
    expect(out).toBeCloseTo(SETBACK, 9);
  }
});
test('bending and straightening undo each other', () => {
  for (const k of [-0.08, 0.06]) for (const p of [{ x: 10, y: 20 }, { x: 1500, y: 800 }, { x: 800, y: 450 }]) expect(near(straighten(bend(p, { k }, WIDTH, HEIGHT), { k }, WIDTH, HEIGHT), p)).toBeLessThan(1e-4);
});
test('a picture is straightened to where its points straighten to, and left alone when the lens is true', () => {
  const img = makeRaster(160, 90);
  for (let i = 0; i < 160 * 90; i++) img.data[i * 4 + 3] = 255;
  const dot = { x: 140, y: 78 };
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) img.data[((dot.y + y) * 160 + dot.x + x) * 4] = 255;
  expect(straightenImage(img, { k: 0 })).toBe(img);
  const out = straightenImage(img, { k: -0.1 });
  let best = -1;
  let at = { x: 0, y: 0 };
  for (let y = 1; y < 89; y++) {
    for (let x = 1; x < 159; x++) {
      let s = 0;
      for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) s += out.data[((y + v) * 160 + x + u) * 4];
      if (s > best) (best = s), (at = { x: x + 0.5, y: y + 0.5 });
    }
  }
  expect(near(at, straighten({ x: dot.x + 0.5, y: dot.y + 0.5 }, { k: -0.1 }, 160, 90))).toBeLessThan(1.2);
});
test('sights alone pin the table down, however badly the corners were placed', () => {
  const s = scene({ clumsy: 35 });
  const cal = solve(s);
  expect(worst(s, cal)).toBeLessThan(0.002);
  const true4 = cornersOf(s.cam.raw);
  cal.corners.forEach((c, i) => expect(near(c, true4[i])).toBeLessThan(1.5));
  expect(cal.setback.every((d) => Math.abs(d - SETBACK) < 0.001)).toBe(true);
});
test('sights marked a pixel or two off still place balls within a few millimetres, far better than corners do', () => {
  let bySights = 0;
  let byCorners = 0;
  for (let i = 0; i < 12; i++) {
    const s = scene({ nudge: 1.5, clumsy: 8 });
    const cal = solve(s);
    bySights = Math.max(bySights, worst(s, cal));
    byCorners = Math.max(byCorners, worst(s, calibrate({ width: WIDTH, height: HEIGHT, horizontal: true, rough: s.rough, marks: s.marks.map(() => null), noses: [null, null, null, null] })));
    // It says itself about how far off it may be.
    expect(cal.error).toBeGreaterThan(worst(s, cal) / 5);
    expect(cal.error).toBeLessThan(0.012);
  }
  expect(bySights).toBeLessThan(0.0095);
  expect(byCorners).toBeGreaterThan(2.5 * bySights);
});
test('a lens that bends straight rails is measured and undone', () => {
  for (const k of [-0.05, 0.04]) {
    const s = scene({ k, nudge: 0.4, clumsy: 6 });
    const cal = solve(s);
    expect(cal.lens.k).toBeCloseTo(k, 1);
    expect(worst(s, cal)).toBeLessThan(0.006);
  }
});
test('how far the sights stand from the cushions is measured, rail by rail', () => {
  const s = scene({ setback: 0.1, nudge: 0.3 });
  const cal = solve(s);
  for (const d of cal.setback) expect(d).toBeGreaterThan(0.0953);
  expect(worst(s, cal)).toBeLessThan(0.004);
});
test('a cushion edge set by hand moves that cushion, and balls are read from it', () => {
  // The right-hand cushion stands 6 mm further in than the sights suggest.
  const s = scene({ nudge: 0.2 });
  const shown = s.cam.raw(L - 0.006, W * 0.375, 0);
  const cal = solve(s, [null, null, null, { at: shown, hand: true }]);
  expect(cal.setback[3]).toBeGreaterThan(SETBACK + 0.003);
  // A ball frozen to that cushion reads as frozen to it.
  const frozen = cal.toTable(s.cam.raw(L - 0.006 - TABLE.R, W / 2, 0));
  expect(Math.abs(frozen.x - (L - TABLE.R))).toBeLessThan(0.002);
  expect(Math.abs(solve(s).toTable(s.cam.raw(L - 0.006 - TABLE.R, W / 2, 0)).x - (L - TABLE.R))).toBeGreaterThan(0.004);
});
test('one sight found in the wrong place is seen through', () => {
  const s = scene({ nudge: 0.4, clumsy: 6 });
  s.marks[4] = { at: { x: s.marks[4]!.at.x + 25, y: s.marks[4]!.at.y - 18 }, hand: false };
  const cal = solve(s);
  expect(cal.used[4]).toBe(false);
  expect(cal.used.filter(Boolean)).toHaveLength(17);
  expect(worst(s, cal)).toBeLessThan(0.005);
});
test('sights on two rails are enough when the others are out of sight', () => {
  const s = scene({ nudge: 0.4, clumsy: 12 });
  SIGHTS.forEach((x, i) => {
    if (x.rail === 1 || x.rail === 2) s.marks[i] = null;
  });
  expect(worst(s, solve(s))).toBeLessThan(0.02);
});
test('with no sights at all the corners decide, exactly as they were placed', () => {
  const s = scene();
  const cal = calibrate({ width: WIDTH, height: HEIGHT, horizontal: true, rough: s.rough, marks: s.marks.map(() => null), noses: [null, null, null, null] });
  cal.corners.forEach((c, i) => expect(near(c, s.rough[i])).toBeLessThan(1e-3));
  expect(cal.lens.k).toBe(0);
  expect(near(cal.toRaw({ x: 1, y: 0.5 }), applyH(tableToImage(s.rough, true), { x: 1, y: 0.5 }))).toBeLessThan(0.01);
});
test('a ball, which stands off the bed, is read and shown at its middle', () => {
  const s = scene({ nudge: 0.1 });
  const cal = solve(s);
  const p = { x: 0.4, y: 1.0 };
  const z = TABLE.R - PHYS.cushionH;
  const seen = s.cam.raw(p.x, p.y, z);
  expect(near(cal.toTable(seen, z), p)).toBeLessThan(0.002);
  expect(near(cal.toRaw(p, z), seen)).toBeLessThan(0.6);
});

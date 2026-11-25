import { expect, test } from 'vitest';
import { PHYS, TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import { findSights, snapToSight } from './findSights';
import type { Raster } from './raster';
import { SETBACK, SIGHTS, sightSpot } from './sights';
import { photograph, type PhotoOptions } from './synthetic';
import { cameraFromPlane } from './camera';
import { tableToImage } from './table';

const { L, W, R } = TABLE;
const Z = R - PHYS.cushionH;
const none = <T,>(v: T): T[] => SIGHTS.map(() => v);
const BARE = [null, null, null, null];
const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const BALLS = [{ id: 0, pos: { x: 0.6, y: 0.6 } }, { id: 1, pos: { x: 1.7, y: 0.8 } }, { id: 8, pos: { x: 2.3, y: W - R } }];
const END: PhotoOptions = { width: 1280, height: 720, from: [-2.6, W / 2 + 0.2, 2.3], at: [L / 2, W / 2, 0], fov: 0.85, cloth: [0.05, 0.22, 0.3] };
const SIDE: PhotoOptions = { width: 1280, height: 720, from: [L / 2 + 0.3, -1.7, 2], at: [L / 2, W / 2, 0], fov: 1.05, cloth: [0.05, 0.3, 0.14] };

function take(o: PhotoOptions, horizontal = true) {
  const { img, corners } = photograph(o, BALLS, horizontal);
  // The true camera, to say where anything on the table really is in the picture.
  const cam = cameraFromPlane(tableToImage(corners, horizontal), o.width, o.height);
  return { img, corners, cam, horizontal };
}
const END_SHOT = take({ ...END, sights: SETBACK }, false);
const SIDE_SHOT = take({ ...SIDE, sights: SETBACK });
const look = (s: ReturnType<typeof take>, more: { rough?: Vec2[]; hand?: (Vec2 | null)[]; off?: boolean[]; img?: Raster } = {}) =>
  findSights(more.img ?? s.img, { width: s.img.width, height: s.img.height, horizontal: s.horizontal, rough: more.rough ?? s.corners, hand: more.hand ?? none(null), off: more.off ?? none(false), noses: BARE });
function worst(s: ReturnType<typeof take>, f: ReturnType<typeof look>): number {
  let m = 0;
  for (const x of [0.1, 0.7, L / 2, 2, 2.44]) for (const y of [0.1, W / 2, 1.17]) m = Math.max(m, near(f.cal.toTable(s.cam.project(x, y, Z), Z), { x, y }));
  return m;
}
const bump = (c: Vec2[], px: number) => c.map((p, i) => ({ x: p.x + px * Math.cos(i * 2.2 + 0.4), y: p.y + px * Math.sin(i * 2.2 + 0.4) }));

test('the sights are found and the table is read to a few millimetres', () => {
  for (const s of [SIDE_SHOT, END_SHOT]) {
    const f = look(s);
    expect(f.sure).toBe(true);
    expect(f.marks.filter(Boolean).length).toBeGreaterThanOrEqual(17);
    expect(worst(s, f)).toBeLessThan(0.007);
  }
});
test('corners placed several centimetres off lead to the same table', () => {
  for (const s of [SIDE_SHOT, END_SHOT]) {
    for (const px of [14, 28]) {
      const f = look(s, { rough: bump(s.corners, px) });
      expect(f.sure).toBe(true);
      expect(worst(s, f)).toBeLessThan(0.007);
    }
  }
});
test('sights behind a player are left out and the rest still do', () => {
  const s = SIDE_SHOT;
  const img: Raster = { ...s.img, data: s.img.data.slice() };
  const a = s.cam.project(0.1, W + 0.05, 0);
  for (let y = 0; y < a.y + 40; y++) {
    for (let x = Math.floor(a.x); x < a.x + 170; x++) {
      const o = (y * img.width + x) * 4;
      img.data[o] = 40;
      img.data[o + 1] = 30 + ((x >> 3) % 2) * 25;
      img.data[o + 2] = 60;
    }
  }
  const f = look(s, { img });
  expect(f.sure).toBe(true);
  expect(f.marks[SIGHTS.findIndex((x) => x.rail === 1)]).toBeNull();
  expect(worst(s, f)).toBeLessThan(0.008);
});
test('a table without sights is taken as its corners were placed, and it says so', () => {
  const s = take(SIDE);
  const f = look(s);
  expect(f.sure).toBe(false);
  expect(f.marks.every((m) => m === null)).toBe(true);
  f.cal.corners.forEach((c, i) => expect(near(c, s.corners[i])).toBeLessThan(1e-3));
});
test('cushion edges that show are measured, so a table whose sights stand elsewhere is still read right', () => {
  const s = take({ ...SIDE, sights: 0.084 });
  const f = look(s);
  expect(f.sure).toBe(true);
  // The far cushion and the two at the ends face the camera; the near one does not.
  expect(f.noses[1]).not.toBeNull();
  expect(f.noses[0]).toBeNull();
  expect(Math.abs(f.cal.setback[1] - 0.084)).toBeLessThan(0.004);
  expect(Math.abs(f.cal.setback[2] - 0.084)).toBeLessThan(0.004);
  // A ball frozen to the far cushion reads as frozen to it.
  expect(Math.abs(f.cal.toTable(s.cam.project(1.6, W - R, Z), Z).y - (W - R))).toBeLessThan(0.005);
});
test('a sight put in place by hand is kept, one switched off is not used', () => {
  const s = SIDE_SHOT;
  const p = sightSpot(3);
  const at = s.cam.project(p.x, p.y, 0.0075);
  const f = look(s, { hand: none<Vec2 | null>(null).map((v, i) => (i === 3 ? at : v)), off: none(false).map((_, i) => i === 8) });
  expect(f.marks[3]).toEqual({ at, hand: true });
  expect(f.marks[8]).toBeNull();
  expect(worst(s, f)).toBeLessThan(0.007);
});
test('a mark let go near a sight settles on its middle, and stays put where there is none', () => {
  const s = SIDE_SHOT;
  const f = look(s);
  const p = sightSpot(1);
  const at = s.cam.project(p.x, p.y, 0.0075);
  expect(near(snapToSight(s.img, f.cal, 1, { x: at.x + 3, y: at.y - 2 }), at)).toBeLessThan(1);
  const empty = { x: at.x + 40, y: at.y };
  expect(snapToSight(s.img, f.cal, 1, empty)).toEqual(empty);
});
test('a sight put in the wrong place by hand is pointed out and does not spoil the rest', () => {
  const s = SIDE_SHOT;
  const p = sightSpot(4);
  const at = s.cam.project(p.x, p.y, 0.0075);
  const f = look(s, { hand: none<Vec2 | null>(null).map((v, i) => (i === 4 ? { x: at.x + 24, y: at.y + 20 } : v)), rough: bump(s.corners, 20) });
  expect(f.sure).toBe(true);
  expect(f.cal.off[4]).toBeGreaterThan(0.03);
  expect(f.cal.used[4]).toBe(false);
  expect(f.marks.filter((m) => m && !m.hand).length).toBeGreaterThanOrEqual(15);
  expect(worst(s, f)).toBeLessThan(0.008);
});
test('where no sight can be found, those put in place by hand decide', () => {
  const s = take(SIDE);
  const hand = none<Vec2 | null>(null).map((_, i) => {
    const p = sightSpot(i);
    return [0, 2, 5, 6, 8, 11, 13, 16].includes(i) ? s.cam.project(p.x, p.y, 0.0075) : null;
  });
  const f = look(s, { hand, rough: bump(s.corners, 25) });
  expect(f.sure).toBe(true);
  expect(worst(s, f)).toBeLessThan(0.009);
});

import { expect, test } from 'vitest';
import { PHYS, TABLE } from '../core/config';
import { frameView } from '../vision/frame';
import { SETBACK, SIGHTS } from '../vision/sights';
import { photograph } from '../vision/synthetic';
import { cornersInPicture, describeFrame, newSetup, noseHandle, preview, scaleSetup, search } from './frameSetup';

const { L, W, R } = TABLE;
const SHOT = photograph({ width: 1000, height: 600, from: [L / 2 + 0.2, -1.7, 2], at: [L / 2, W / 2, 0], fov: 1.05, cloth: [0.05, 0.3, 0.14], sights: SETBACK }, [], true);
const { width, height } = SHOT.img;

test('what is found says how many sights it rests on and how good it is', () => {
  const f = search(SHOT.img, newSetup(SHOT.corners, true));
  expect(f.sure).toBe(true);
  expect(describeFrame(f)).toMatch(/^Khớp 1[78]\/18 hình thoi, sai số chỗ kém nhất khoảng \d mm\. Hình thoi cách mép băng [\d,–]+ cm\.$/);
});
test('the frame handed on reads places just as the calibration does', () => {
  const { cal } = search(SHOT.img, newSetup(SHOT.corners, true));
  const view = frameView(cal, width, height);
  for (const z of [0, R - PHYS.cushionH]) {
    const p = { x: 0.4, y: 1.1 };
    const a = view.toRaw(p, z);
    const b = cal.toRaw(p, z);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.3);
    const t = view.toTable(a, z);
    expect(Math.hypot(t.x - p.x, t.y - p.y)).toBeLessThan(1e-6);
  }
});
test('dragging a sight or a cushion edge moves the view with it at once', () => {
  const s = newSetup(SHOT.corners, true);
  const f = search(SHOT.img, s);
  const i = SIGHTS.findIndex((x) => x.rail === 3);
  const at = f.cal.sight(i);
  const moved = preview(width, height, { ...s, hand: s.hand.map((v, k) => (k === i ? { x: at.x + 6, y: at.y } : v)) }, f);
  expect(moved.sight(i).x).toBeGreaterThan(at.x + 0.5);
  const edge = noseHandle(f.cal, 3);
  const cal = preview(width, height, { ...s, noses: [null, null, null, { x: edge.x - 4, y: edge.y }] }, f);
  expect(cal.setback[3]).toBeGreaterThan(f.cal.setback[3] + 0.003);
  expect(cornersInPicture(cal, width, height)[1].x).toBeLessThan(cornersInPicture(f.cal, width, height)[1].x - 1);
});
test('a setup kept as shares of the picture fits the same view at another size', () => {
  const s = newSetup([{ x: 10, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 50 }, { x: 10, y: 50 }], true);
  s.hand[2] = { x: 40, y: 30 };
  s.noses[1] = { x: 44, y: 22 };
  const back = scaleSetup(scaleSetup(s, 1 / 100, 1 / 60), 200, 120);
  expect(back.rough[2]).toEqual({ x: 180, y: 100 });
  expect(back.hand[2]!.x).toBeCloseTo(80, 9);
  expect(back.noses[1]!.y).toBeCloseTo(44, 9);
  expect(back.hand[3]).toBeNull();
});

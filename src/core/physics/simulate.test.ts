import { expect, test } from 'vitest';
import { TABLE, TIPS } from '../config';
import type { BallPos, Shot, SimResult } from '../types';
import { angleDiff, angleOf, dist, sub, v2 } from '../vec';
import { firstContactState, simulate } from './simulate';

const R = TABLE.R;
const sim = (balls: BallPos[], shot: Shot) => simulate(balls, shot, { cloth: 'medium' });
const cueEnd = (r: SimResult) => r.final.find((b) => b.id === 0)!.pos;
const std: BallPos[] = [{ id: 0, pos: v2(0.8, 0.635) }, { id: 1, pos: v2(1.3, 0.635) }];

/** Cue ball heading between two times after its first ball contact. */
function headingAfterContact(r: SimResult, from: number, to: number): number {
  const t0 = r.events.find((e) => e.type === 'ball')!.t;
  const at = (t: number) => {
    const ts = r.times[0];
    let i = ts.findIndex((x) => x >= t);
    if (i < 0) i = ts.length - 1;
    return r.paths[0][i];
  };
  return angleOf(sub(at(t0 + to), at(t0 + from)));
}

// Straight shots are lined up on the top-right corner pocket so the object ball leaves the table
// instead of coming back off a rail into the cue ball.
const D = Math.SQRT1_2;
const onDiagonal = (fromPocket: number) => v2(TABLE.L - fromPocket * D, TABLE.W - fromPocket * D);
const DIAG = Math.PI / 4;
const along = (p: { x: number; y: number }) => p.x * D + p.y * D;

test('short firm centre hit, straight: stop shot', () => {
  const obj = onDiagonal(0.5);
  const r = sim([{ id: 0, pos: onDiagonal(0.7) }, { id: 1, pos: obj }], { dir: DIAG, speed: 3.8, tip: TIPS.center });
  expect(r.pocketed).toEqual([{ id: 1, pocket: 'TR' }]);
  expect(dist(cueEnd(r), onDiagonal(0.5 + 2 * R))).toBeLessThan(0.08);
});
test('high tip follows the object ball', () => {
  const r = sim([{ id: 0, pos: onDiagonal(1.0) }, { id: 1, pos: onDiagonal(0.5) }], { dir: DIAG, speed: 1.5, tip: TIPS.high });
  expect(r.pocketed[0]).toEqual({ id: 1, pocket: 'TR' });
  // it rolls on past where the object ball sat (and may follow it into the pocket)
  if (!r.cueScratched) expect(along(cueEnd(r))).toBeGreaterThan(along(onDiagonal(0.5)) + 0.15);
});
test('low tip draws back', () => {
  const r = sim([{ id: 0, pos: onDiagonal(1.0) }, { id: 1, pos: onDiagonal(0.5) }], { dir: DIAG, speed: 2.5, tip: TIPS.low });
  expect(r.pocketed).toEqual([{ id: 1, pocket: 'TR' }]);
  expect(along(cueEnd(r))).toBeLessThan(along(onDiagonal(0.5 + 2 * R)) - 0.15);
});
test('30-degree rule: rolling cue ball, half-ball hit, deflects 27 to 40 degrees', () => {
  const r = sim([{ id: 0, pos: v2(0.8, 0.635 + R) }, { id: 1, pos: v2(1.3, 0.635) }], { dir: 0, speed: 1.5, tip: TIPS.high });
  const deflection = (Math.abs(headingAfterContact(r, 0.35, 0.45)) * 180) / Math.PI;
  expect(deflection).toBeGreaterThanOrEqual(27);
  expect(deflection).toBeLessThanOrEqual(40);
});
test('90-degree rule: stun cut leaves along the tangent line within 6 degrees', () => {
  const ghostX = 1.3 - 2 * R * Math.cos(Math.PI / 6);
  const r = sim([{ id: 0, pos: v2(ghostX - 0.15, 0.635 + R) }, { id: 1, pos: v2(1.3, 0.635) }], { dir: 0, speed: 3.8, tip: TIPS.center });
  const hit = r.events.find((e) => e.type === 'ball')!;
  const lineOfCentres = angleOf(sub(v2(1.3, 0.635), hit.pos));
  const off = (Math.abs(angleDiff(headingAfterContact(r, 0.002, 0.02), lineOfCentres)) * 180) / Math.PI;
  expect(off).toBeGreaterThanOrEqual(84);
  expect(off).toBeLessThanOrEqual(96);
});
test('ball rolled into a corner pocket is pocketed', () => {
  const r = sim([{ id: 0, pos: v2(0.5, 0.5) }], { dir: Math.atan2(-0.5, -0.5), speed: 1.5, tip: TIPS.high });
  expect(r.cueScratched).toBe(true);
  expect(r.final).toHaveLength(0);
  expect(r.pocketed).toEqual([{ id: 0, pocket: 'BL' }]);
});
test('ball rolled into a side pocket is pocketed', () => {
  const r = sim([{ id: 0, pos: v2(1.0, 0.6) }], { dir: Math.atan2(-0.6, 0.27), speed: 1.5, tip: TIPS.high });
  expect(r.pocketed).toEqual([{ id: 0, pocket: 'SB' }]);
});
test('a ball hit straight at a rail comes straight back', () => {
  const r = sim([{ id: 0, pos: v2(1.0, 0.6) }], { dir: -Math.PI / 2, speed: 0.5, tip: TIPS.high });
  expect(cueEnd(r).x).toBeCloseTo(1.0, 3);
  expect(cueEnd(r).y).toBeGreaterThan(R);
  expect(r.events.filter((e) => e.type === 'cushion')).toHaveLength(1);
});
test('firstContact, cueTouched and railAfterContact are reported', () => {
  const r = sim(std, { dir: 0, speed: 3.8, tip: TIPS.center });
  expect(r.firstContact).toBe(1);
  expect(r.cueTouched[0]).toBe(1);
  expect(r.railAfterContact).toBe(true);
});
test('a miss reports no contact', () => {
  const r = sim(std, { dir: Math.PI / 2, speed: 0.8, tip: TIPS.high });
  expect(r.firstContact).toBeNull();
  expect(r.cueTouched).toEqual([]);
  expect(r.railAfterContact).toBe(false);
});
test('touching balls and a ball frozen to the rail do not hang or tunnel', () => {
  const r = sim(
    [{ id: 0, pos: v2(0.5, 0.635) }, { id: 1, pos: v2(1.0, R) }, { id: 2, pos: v2(1.0 + 2 * R, R) }, { id: 3, pos: v2(1.0 + 4 * R, R) }],
    { dir: Math.atan2(R - 0.635, 0.5), speed: 5.5, tip: TIPS.center },
  );
  for (const b of r.final) {
    expect(Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y)).toBe(true);
    expect(b.pos.x).toBeGreaterThan(0);
    expect(b.pos.x).toBeLessThan(TABLE.L);
    expect(b.pos.y).toBeGreaterThan(0);
    expect(b.pos.y).toBeLessThan(TABLE.W);
  }
  for (const a of r.final) for (const b of r.final) if (a.id < b.id) expect(dist(a.pos, b.pos)).toBeGreaterThan(2 * R - 1e-3);
  expect(r.final.length + r.pocketed.length).toBe(4);
});
test('paths and times line up and start at the initial position', () => {
  const r = sim(std, { dir: 0, speed: 2.5, tip: TIPS.center });
  expect(r.paths[0][0]).toEqual({ x: 0.8, y: 0.635 });
  expect(r.paths[0].length).toBe(r.times[0].length);
  expect(r.paths[1].length).toBe(r.times[1].length);
  expect(r.duration).toBeGreaterThan(0);
});
test('firstContactState stops at the first hit and reports velocities', () => {
  const s = firstContactState(std, { dir: 0, speed: 2.5, tip: TIPS.center }, { cloth: 'medium' });
  expect(s.firstContact).toBe(1);
  expect(s.cushionsBefore).toBe(0);
  expect(s.bodies.find((b) => b.id === 1)!.vel.x).toBeGreaterThan(1.5);
});
test('one full simulation takes under 5 ms on average', () => {
  const t = performance.now();
  for (let i = 0; i < 100; i++) sim(std, { dir: 0, speed: 2.5, tip: TIPS.high });
  expect(performance.now() - t).toBeLessThan(500);
});

import { expect, test } from 'vitest';
import { TIPS } from '../core/config';
import { simulate } from '../core/physics/simulate';
import type { BallPos } from '../core/types';
import { v2 } from '../core/vec';
import { sampleAt, simDuration } from './replay';

// Straight shot on ball 1 into the top-right corner; ball 2 never moves.
const D = Math.SQRT1_2;
const start: BallPos[] = [
  { id: 0, pos: v2(2.54 - 1.0 * D, 1.27 - 1.0 * D) },
  { id: 1, pos: v2(2.54 - 0.5 * D, 1.27 - 0.5 * D) },
  { id: 2, pos: v2(0.5, 0.3) },
];
const sim = simulate(start, { dir: Math.PI / 4, speed: 2.9, tip: TIPS.center }, { cloth: 'medium' });

test('the shot used here pots ball 1', () => {
  expect(sim.pocketed).toEqual([{ id: 1, pocket: 'TR' }]);
});
test('sampleAt(0) equals the start layout', () => {
  expect(sampleAt(sim, start, 0)).toEqual(start);
});
test('sampleAt(duration) equals sim.final', () => {
  const end = sampleAt(sim, start, simDuration(sim));
  expect(end.map((b) => b.id)).toEqual(sim.final.map((b) => b.id));
  for (const b of end) {
    const f = sim.final.find((x) => x.id === b.id)!;
    expect(b.pos.x).toBeCloseTo(f.pos.x, 6);
    expect(b.pos.y).toBeCloseTo(f.pos.y, 6);
  }
});
test('a pocketed ball is present before its pocket event and absent after', () => {
  const t = sim.events.find((e) => e.type === 'pocket')!.t;
  expect(sampleAt(sim, start, t - 0.02).some((b) => b.id === 1)).toBe(true);
  expect(sampleAt(sim, start, t + 0.001).some((b) => b.id === 1)).toBe(false);
});
test('positions are interpolated between samples and balls that never move stay put', () => {
  const hit = sim.events.find((e) => e.type === 'ball')!.t;
  const mid = sampleAt(sim, start, hit / 2).find((b) => b.id === 0)!;
  expect(mid.pos.x).toBeGreaterThan(start[0].pos.x);
  expect(mid.pos.x).toBeLessThan(start[1].pos.x);
  expect(sampleAt(sim, start, hit / 2).find((b) => b.id === 1)!.pos).toEqual(start[1].pos);
  expect(sampleAt(sim, start, 1).find((b) => b.id === 2)!.pos).toEqual(start[2].pos);
});
test('times past the end are clamped', () => {
  expect(sampleAt(sim, start, 999)).toEqual(sampleAt(sim, start, simDuration(sim)));
});

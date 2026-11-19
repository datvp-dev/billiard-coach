import { expect, test } from 'vitest';
import { advise } from './advisor';
import { SCORE, TABLE } from './config';
import { decodeLayout, randomLayout } from './layoutCodec';
import type { Layout, Suggestion } from './types';
import { v2 } from './vec';

const lay = (...b: [number, number, number][]): Layout => ({ mode: '9', balls: b.map(([id, x, y]) => ({ id, pos: v2(x, y) })) });
const ok = (l: Layout) => {
  const r = advise(l, { cloth: 'medium' });
  if (r.status !== 'ok') throw new Error('expected advice, got ' + r.status);
  return r.suggestions;
};
const D = Math.SQRT1_2;
const diag = (fromPocket: number): [number, number] => [TABLE.L - fromPocket * D, TABLE.W - fromPocket * D];
const cueEnd = (s: Suggestion) => s.sim.final.find((b) => b.id === 0)!.pos;

test('straight-in with the next ball close by: plays it simply, not with maximum-power draw', () => {
  const top = ok(lay([0, ...diag(0.9)], [1, ...diag(0.4)], [2, 2.2, 0.5]))[0];
  expect(top.kind).toBe('pot');
  expect(top.pocket).toBe('TR');
  expect(top.potProb).toBeGreaterThan(0.7);
  expect(top.powerLevel).toBeLessThan(6);
  expect(['center', 'high', 'low']).toContain(top.tipName);
});
test('object ball by a side pocket, next ball at the far end: cue ball is sent to that half with a shot on it', () => {
  const top = ok(lay([0, 1.0, 0.9], [1, 1.27, 1.15], [2, 2.3, 0.3]))[0];
  expect(top.kind).toBe('pot');
  expect(cueEnd(top).x).toBeGreaterThan(TABLE.L / 2);
  expect(top.posQuality).toBeGreaterThanOrEqual(0.5);
});
test('lined up to follow the object ball into the corner: no suggestion scratches and follow is not the pick', () => {
  const all = ok(lay([0, ...diag(1.0)], [1, ...diag(0.3)], [2, 1.0, 0.4]));
  expect(all[0].kind).toBe('pot');
  expect(all[0].tipName).not.toBe('high');
  for (const s of all) expect(s.sim.cueScratched).toBe(false);
});
test('two open pockets: the top suggestion uses the one that is easier to make', () => {
  const all = ok(lay([0, 1.2, 0.5], [1, 1.9, 0.635], [2, 0.6, 1.0]));
  expect(all[0].pocket).toBe('TR');
  expect(all[0].potProb).toBeCloseTo(Math.max(...all.map((s) => s.potProb)), 9);
});
test('of two shots that leave about the same position, the softer one is preferred', () => {
  const top = ok(decodeLayout('m9;0:635,635;1:1700,800;2:2100,400;3:900,300'))[0];
  expect(top.powerLevel).toBeLessThanOrEqual(4);
});
test('alternatives clearly worse than the best pot are not shown', () => {
  for (const code of ['m9;0:1500,500;9:2200,1000', 'm9;0:635,635;1:1700,800;2:2100,400;3:900,300', 'm9;0:1200,500;1:1900,635;2:600,1000']) {
    const pots = ok(decodeLayout(code)).filter((s) => s.kind === 'pot');
    for (const s of pots) expect(s.score).toBeGreaterThanOrEqual(pots[0].score - SCORE.maxScoreGap);
  }
});
test(
  '200 random layouts: never throws, every pot goes in as drawn, nothing scratches, and it is fast',
  () => {
    let seed = 20261119;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const full = randomLayout(i % 2 ? '9' : '10', rng);
      // Thin the table out to a random number of object balls, as in the middle of a rack.
      const keep = 1 + Math.floor(rng() * (full.balls.length - 1));
      const layout: Layout = { mode: full.mode, balls: full.balls.filter((b, k) => b.id === 0 || k <= keep) };
      const t = performance.now();
      const r = advise(layout, { cloth: 'medium' });
      times.push(performance.now() - t);
      if (r.status !== 'ok') throw new Error(`layout ${i}: ${r.status}`);
      expect(r.suggestions.length).toBeLessThanOrEqual(3);
      for (const s of r.suggestions) {
        expect(s.targetId).toBe(r.targetId);
        expect(s.sim.cueScratched).toBe(false);
        expect(Number.isFinite(s.score) && Number.isFinite(s.shot.dir)).toBe(true);
        expect(s.text.length).toBeGreaterThan(10);
        if (s.kind === 'pot') expect(s.sim.pocketed).toContainEqual({ id: s.targetId, pocket: s.pocket });
        else expect(s.sim.firstContact).toBe(s.targetId);
      }
    }
    times.sort((a, b) => a - b);
    expect(times[100]).toBeLessThan(400);
    expect(times[199]).toBeLessThan(1000);
  },
  120000,
);

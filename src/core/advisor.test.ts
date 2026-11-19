import { expect, test } from 'vitest';
import { advise } from './advisor';
import { TABLE } from './config';
import type { Layout } from './types';
import { v2 } from './vec';

const lay = (...b: [number, number, number][]): Layout => ({ mode: '9', balls: b.map(([id, x, y]) => ({ id, pos: v2(x, y) })) });
const A = (l: Layout) => advise(l, { cloth: 'medium' });
const ok = (l: Layout) => {
  const r = A(l);
  if (r.status !== 'ok') throw new Error('expected advice, got ' + r.status);
  return r;
};

test('no cue ball / no object ball', () => {
  expect(A(lay([1, 1, 0.5])).status).toBe('no-cue');
  expect(A(lay([0, 1, 0.5])).status).toBe('no-target');
});
test('only suggests the lowest ball', () => {
  const r = ok(lay([0, 1.0, 0.5], [2, 2.2, 1.0], [1, 1.8, 0.3], [5, 0.4, 0.9]));
  expect(r.targetId).toBe(1);
  expect(r.suggestions.length).toBeGreaterThan(0);
  for (const s of r.suggestions) expect(s.targetId).toBe(1);
});
test('easy straight-in shot: first suggestion is a pot, labelled easy, no side spin', () => {
  const s = ok(lay([0, 1.9, 0.8], [1, 2.25, 1.03], [2, 1.0, 0.4])).suggestions[0];
  expect(s.kind).toBe('pot');
  expect(s.pocket).toBe('TR');
  expect(s.potProb).toBeGreaterThan(0.7);
  expect(['center', 'high', 'low']).toContain(s.tipName);
  expect(s.sim.pocketed).toContainEqual({ id: 1, pocket: 'TR' });
  expect(s.sim.cueScratched).toBe(false);
  expect(s.ghost).not.toBeNull();
  expect(s.stopZone.length).toBeGreaterThan(0);
});
test('never returns a shot whose nominal simulation scratches', () => {
  const r = ok(lay([0, 1.5, 0.635], [1, 2.3, 0.635], [2, 0.5, 0.3]));
  for (const s of r.suggestions) expect(s.sim.cueScratched).toBe(false);
});
test('at most 3 suggestions, pots sorted by score', () => {
  const r = ok(lay([0, 1.0, 0.5], [1, 1.6, 0.7], [2, 2.2, 0.3]));
  expect(r.suggestions.length).toBeLessThanOrEqual(3);
  const pots = r.suggestions.filter((s) => s.kind === 'pot');
  expect(pots.length).toBeGreaterThan(0);
  for (let i = 1; i < pots.length; i++) expect(pots[i - 1].score).toBeGreaterThanOrEqual(pots[i].score);
});
test('suggestions are distinct: same pocket means clearly different cue ball finish', () => {
  const r = ok(lay([0, 1.0, 0.5], [1, 1.6, 0.7], [2, 2.2, 0.3]));
  const pots = r.suggestions.filter((s) => s.kind === 'pot');
  const end = (i: number) => pots[i].sim.final.find((b) => b.id === 0)!.pos;
  for (let i = 0; i < pots.length; i++)
    for (let j = i + 1; j < pots.length; j++)
      if (pots[i].pocket === pots[j].pocket) expect(Math.hypot(end(i).x - end(j).x, end(i).y - end(j).y)).toBeGreaterThanOrEqual(0.25);
});
test('position matters: the top pot leaves about the best available position', () => {
  const r = ok(lay([0, 1.27, 0.3], [1, 1.27, 0.635], [2, 2.3, 1.0]));
  const pots = r.suggestions.filter((s) => s.kind === 'pot');
  expect(pots[0].posQuality).toBeGreaterThanOrEqual(Math.max(...pots.map((s) => s.posQuality)) - 0.15);
});
test('last ball: suggestions exist and posQuality is 1', () => {
  const r = ok(lay([0, 1.5, 0.5], [9, 2.2, 1.0]));
  expect(r.suggestions.length).toBeGreaterThan(0);
  expect(r.suggestions[0].posQuality).toBe(1);
});
test('no makeable pot: a legal safety is offered', () => {
  // Object ball in the middle of the far short rail, cue ball straight on: both corners need a ~90 degree cut.
  const r = ok(lay([0, 0.3, 0.635], [1, 2.5, 0.635], [2, 1.2, 0.2]));
  expect(r.suggestions.filter((s) => s.kind === 'pot' && s.potProb >= 0.35)).toHaveLength(0);
  const s = r.suggestions.find((s) => s.kind === 'safety');
  expect(s).toBeDefined();
  expect(s!.sim.firstContact).toBe(1);
  expect(s!.sim.cueScratched).toBe(false);
  expect(s!.sim.railAfterContact || s!.sim.pocketed.length > 0).toBe(true);
  expect(s!.text).toContain('Đánh thủ');
});
test('fully snookered target yields a kick that reaches it off a rail', () => {
  const R = TABLE.R;
  const r = ok(lay([0, 0.3, 0.635], [1, 1.0, 0.635], [2, 0.3 + 2 * R + 0.02, 0.635], [3, 0.36, 0.635 + 2 * R], [4, 0.36, 0.635 - 2 * R]));
  expect(r.suggestions).toHaveLength(1);
  const k = r.suggestions[0];
  expect(k.kind).toBe('kick');
  expect(k.sim.firstContact).toBe(1);
  expect(k.text).toContain('bị che');
});
test('side spin is absent when a no-side pot above 35% exists', () => {
  const r = ok(lay([0, 1.9, 0.8], [1, 2.25, 1.03], [2, 1.0, 0.4]));
  for (const s of r.suggestions) expect(['left', 'right']).not.toContain(s.tipName);
});
test('a 9-ball layout is advised in under 1 second', () => {
  const l = lay([0, 1.0, 0.5], [1, 1.6, 0.7], [2, 2.2, 0.3], [3, 0.4, 1.0], [4, 0.9, 0.2], [5, 1.9, 1.0], [6, 2.3, 0.7], [7, 0.5, 0.4], [8, 1.4, 1.1], [9, 1.27, 0.635]);
  A(l); // warm up
  const t = performance.now();
  A(l);
  expect(performance.now() - t).toBeLessThan(1000);
});

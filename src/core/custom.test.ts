import { expect, test } from 'vitest';
import { advise } from './advisor';
import { clampTip, customShot } from './custom';
import { describeTip } from './explain';
import type { Layout, Suggestion } from './types';
import { v2 } from './vec';

const lay = (...b: [number, number, number][]): Layout => ({ mode: '9', balls: b.map(([id, x, y]) => ({ id, pos: v2(x, y) })) });
// Nearly straight shot on the 1 into the top-right corner, 2 waiting near the bottom rail.
const LAYOUT = lay([0, 1.3, 0.45], [1, 1.9, 0.85], [2, 1.0, 0.3]);
const base = (): Suggestion => {
  const r = advise(LAYOUT, { cloth: 'medium' });
  if (r.status !== 'ok') throw new Error('expected advice');
  const s = r.suggestions.find((x) => x.kind === 'pot');
  if (!s) throw new Error('expected a pot');
  return s;
};
const cueEnd = (s: Suggestion) => s.sim.final.find((b) => b.id === 0)!.pos;

test('the same tip and power as the suggestion pots the same ball in the same pocket', () => {
  const b = base();
  const c = customShot(LAYOUT, b, b.shot.tip, b.powerLevel, 'medium');
  expect(c.kind).toBe('pot');
  expect(c.pocket).toBe(b.pocket);
  expect(c.sim.pocketed).toContainEqual({ id: 1, pocket: b.pocket });
  expect(c.potProb).toBeCloseTo(b.potProb, 5);
  expect(c.tipName).toBe('custom');
});
test('a low tip leaves the cue ball further back than a high tip', () => {
  const b = base();
  const hi = customShot(LAYOUT, b, { side: 0, vert: 0.4 }, 4, 'medium');
  const lo = customShot(LAYOUT, b, { side: 0, vert: -0.4 }, 4, 'medium');
  const along = (s: Suggestion) => cueEnd(s).x * Math.cos(b.shot.dir) + cueEnd(s).y * Math.sin(b.shot.dir);
  expect(along(lo)).toBeLessThan(along(hi) - 0.2);
});
test('side spin is compensated so the ball still goes in', () => {
  const b = base();
  const c = customShot(LAYOUT, b, { side: 0.3, vert: 0 }, 4, 'medium');
  expect(c.sim.pocketed).toContainEqual({ id: 1, pocket: b.pocket });
});
test('a shot too soft to reach the pocket is reported as a miss with zero chance', () => {
  const b = base();
  const c = customShot(LAYOUT, b, { side: 0, vert: 0 }, 2, 'medium');
  expect(c.sim.pocketed).toHaveLength(0);
  expect(c.potProb).toBe(0);
  expect(c.text).toContain('Bi 1 không vào lỗ');
});
test('a shot that never reaches the target ball is reported as a foul', () => {
  const c = customShot(LAYOUT, base(), { side: 0, vert: 0 }, 1, 'medium');
  expect(c.sim.firstContact).toBeNull();
  expect(c.text).toContain('Bi cái không chạm bi 1 trước: phạm lỗi.');
});
test('half power levels are kept', () => {
  const b = base();
  expect(customShot(LAYOUT, b, b.shot.tip, 3.5, 'medium').powerLevel).toBe(3.5);
});
test('the tip is kept inside the miscue limit of half a ball radius', () => {
  const t = clampTip({ side: 0.6, vert: 0.8 });
  expect(Math.hypot(t.side, t.vert)).toBeCloseTo(0.5, 6);
  expect(t.vert / t.side).toBeCloseTo(0.8 / 0.6, 6);
  expect(clampTip({ side: 0.1, vert: -0.2 })).toEqual({ side: 0.1, vert: -0.2 });
});
test('tip positions are described as a share of the maximum offset', () => {
  expect(describeTip({ side: 0, vert: 0 })).toBe('giữa bi');
  expect(describeTip({ side: 0, vert: 0.4 })).toBe('cao 80%');
  expect(describeTip({ side: -0.2, vert: 0.3 })).toBe('cao 60%, trái 40%');
  expect(describeTip({ side: 0.25, vert: -0.5 })).toBe('thấp 100%, phải 50%');
});

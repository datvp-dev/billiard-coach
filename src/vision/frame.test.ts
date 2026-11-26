import { expect, test } from 'vitest';
import { TABLE } from '../core/config';
import { frameView, turnFrame } from './frame';

const { L, W } = TABLE;

test('a frame turned round reads every place as the one opposite it', () => {
  const f = { corners: [{ x: 231, y: 689 }, { x: 476, y: 191 }, { x: 801, y: 191 }, { x: 1044, y: 689 }], horizontal: true, lens: { k: -0.03 } };
  const a = frameView(f, 1280, 720);
  const b = frameView(turnFrame(f), 1280, 720);
  for (const p of [{ x: 0.3, y: 0.2 }, { x: 1.7, y: 1.1 }, { x: 2.5, y: 0.6 }]) {
    for (const z of [0, -0.008]) {
      const q = b.toRaw(p, z);
      const r = a.toRaw({ x: L - p.x, y: W - p.y }, z);
      expect(Math.hypot(q.x - r.x, q.y - r.y)).toBeLessThan(0.01);
    }
  }
  expect(turnFrame(turnFrame(f))).toEqual(f);
});

import { expect, test } from 'vitest';
import { advise } from './advisor';
import { explain, pocketName, posLabel, potLabel, powerLabel, tipLabel } from './explain';
import type { Layout, PocketId } from './types';
import { v2 } from './vec';

const lay = (...b: [number, number, number][]): Layout => ({ mode: '9', balls: b.map(([id, x, y]) => ({ id, pos: v2(x, y) })) });

test('pocket names in landscape', () => {
  const names = (['BL', 'BR', 'TL', 'TR', 'SB', 'ST'] as PocketId[]).map((p) => pocketName(p));
  expect(names).toEqual(['lỗ góc dưới trái', 'lỗ góc dưới phải', 'lỗ góc trên trái', 'lỗ góc trên phải', 'lỗ giữa dưới', 'lỗ giữa trên']);
});
test('pocket names follow the table when it is drawn rotated a quarter turn clockwise', () => {
  const names = (['BL', 'BR', 'TL', 'TR', 'SB', 'ST'] as PocketId[]).map((p) => pocketName(p, true));
  expect(names).toEqual(['lỗ góc trên trái', 'lỗ góc dưới trái', 'lỗ góc trên phải', 'lỗ góc dưới phải', 'lỗ giữa trái', 'lỗ giữa phải']);
});
test('labels and thresholds', () => {
  expect([1, 2, 3, 4, 5, 6].map(powerLabel)).toEqual(['rất nhẹ', 'nhẹ', 'vừa', 'hơi mạnh', 'mạnh', 'rất mạnh']);
  expect(powerLabel(2.5)).toBe('nhẹ đến vừa');
  expect(tipLabel('center')).toBe('giữa bi');
  expect(tipLabel('left')).toBe('xoáy trái');
  expect(potLabel(0.7)).toBe('Dễ');
  expect(potLabel(0.4)).toBe('Trung bình');
  expect(potLabel(0.39)).toBe('Khó');
  expect(posLabel(0.6)).toBe('tốt');
  expect(posLabel(0.3)).toBe('tạm');
  expect(posLabel(0.29)).toBe('xấu');
});
test('pot on the last ball says so', () => {
  const r = advise(lay([0, 1.5, 0.5], [9, 2.2, 1.0]), { cloth: 'medium' });
  if (r.status !== 'ok') throw new Error('expected advice');
  const s = r.suggestions[0];
  expect(s.text).toBe(explain(s, null));
  expect(s.text).toContain('Đây là bi cuối.');
  expect(s.text).toMatch(/^Đánh (giữa bi|cao|thấp), lực /);
});
test('pot with a next ball rates the position', () => {
  const r = advise(lay([0, 1.9, 0.8], [1, 2.25, 1.03], [2, 1.0, 0.4]), { cloth: 'medium' });
  if (r.status !== 'ok') throw new Error('expected advice');
  expect(r.suggestions[0].text).toMatch(/Ra bi 2: (tốt|tạm|xấu)\./);
});

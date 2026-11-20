import { expect, test } from 'vitest';
import { advise } from '../core/advisor';
import { decodeLayout } from '../core/layoutCodec';
import type { AppState } from './state';
import { snapshotCaption, snapshotFileName, snapshotSize, wrapText } from './snapshot';

const layout = decodeLayout('m9;0:635,635;1:1700,800;2:2100,400');
const advice = advise(layout, { cloth: 'medium' });
const state: AppState = { layout, cloth: 'medium', advice, selected: 0, computing: false, potted: [], steps: 0, custom: null };

test('the picture keeps the table shape for the way it is shown, with room below for the caption', () => {
  const p = snapshotSize(true, 3);
  expect(p.tableH).toBeGreaterThan(p.w * 1.7);
  expect(p.h).toBe(p.tableH + p.captionH);
  const l = snapshotSize(false, 3);
  expect(l.w).toBeGreaterThan(l.tableH * 1.7);
  expect(snapshotSize(true, 0).captionH).toBe(0);
});
test('the caption names the shot, where to strike and how hard', () => {
  if (advice.status !== 'ok') throw new Error('expected advice');
  const lines = snapshotCaption(state, false);
  expect(lines[0]).toMatch(/^Bi 1 vào lỗ /);
  expect(lines[1]).toMatch(/^Điểm chạm: .+ · Lực .+ · lăn ≈/);
  expect(lines[2]).toBe(advice.suggestions[0].text);
});
test('no caption without a shot to describe', () => {
  expect(snapshotCaption({ ...state, advice: null }, false)).toEqual([]);
});
test('long text is wrapped on spaces to the given width', () => {
  const measure = (s: string) => s.length * 10;
  expect(wrapText('một hai ba bốn năm', 80, measure)).toEqual(['một hai', 'ba bốn', 'năm']);
  expect(wrapText('ngắn', 80, measure)).toEqual(['ngắn']);
  expect(wrapText('', 80, measure)).toEqual([]);
});
test('file names carry the local date and time', () => {
  expect(snapshotFileName(new Date(2026, 10, 20, 9, 5))).toBe('ban-bi-a-20261120-0905.png');
});

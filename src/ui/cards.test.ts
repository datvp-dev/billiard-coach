import { expect, test } from 'vitest';
import type { Suggestion } from '../core/types';
import { cardTitle, statusMessage } from './cards';

test('titles', () => {
  expect(cardTitle({ kind: 'pot', targetId: 3, pocket: 'TR' } as Suggestion, false)).toBe('Bi 3 vào lỗ góc trên phải');
  expect(cardTitle({ kind: 'pot', targetId: 3, pocket: 'TR' } as Suggestion, true)).toBe('Bi 3 vào lỗ góc dưới phải');
  expect(cardTitle({ kind: 'safety', targetId: 3 } as Suggestion, false)).toBe('Đánh thủ bi 3');
  expect(cardTitle({ kind: 'kick', targetId: 3 } as Suggestion, false)).toBe('Một băng chạm bi 3');
});
test('status messages', () => {
  expect(statusMessage(null, true)).toBe('Đang tính…');
  expect(statusMessage({ status: 'no-cue' }, false)).toBe('Đặt bi cái lên bàn để nhận gợi ý.');
  expect(statusMessage({ status: 'no-target' }, false)).toBe('Đặt ít nhất một bi số lên bàn.');
  expect(statusMessage({ status: 'ok', targetId: 1, suggestions: [] }, false)).toBe('Không tìm được cú đánh hợp lệ. Thử chỉnh lại vị trí bi.');
  expect(statusMessage({ status: 'ok', targetId: 1, suggestions: [{} as Suggestion] }, false)).toBeNull();
});

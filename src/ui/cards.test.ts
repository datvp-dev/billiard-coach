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

test('after the last ball is played the status says the table is cleared', () => {
  expect(statusMessage({ status: 'no-target' }, false, 2)).toBe('Đã ăn hết bi. Bấm "Chọn lại" để thử cách đánh khác.');
  expect(statusMessage({ status: 'no-target' }, false, 0)).toBe('Đặt ít nhất một bi số lên bàn.');
});

import { padToTip, powerText } from './cards';

test('power is named and tied to how far a rolling ball travels on this cloth', () => {
  expect(powerText(3, 'medium')).toBe('Lực vừa · lăn ≈1,4 bàn');
  expect(powerText(1, 'slow')).toBe('Lực rất nhẹ · lăn ≈0,2 bàn');
  expect(powerText(2.5, 'medium')).toMatch(/^Lực nhẹ đến vừa · lăn ≈1(,\d)? bàn$/);
});
test('a touch on the cue-ball pad becomes a tip offset in ball radii', () => {
  // 100 px pad: centre is the middle of the ball, the ball edge is 46 px out.
  expect(padToTip(50, 50, 100)).toEqual({ side: 0, vert: 0 });
  expect(padToTip(50, 50 - 0.4 * 46, 100)).toEqual({ side: 0, vert: 0.4 });
  expect(padToTip(50 - 0.3 * 46, 50 + 0.2 * 46, 100)).toEqual({ side: -0.3, vert: -0.2 });
});
test('touches snap to steps of 5% of the radius, onto the centre lines, and stay inside the miscue limit', () => {
  expect(padToTip(51, 50 - 0.31 * 46, 100)).toEqual({ side: 0, vert: 0.3 });
  const far = padToTip(100, 50, 100);
  expect(far).toEqual({ side: 0.5, vert: 0 });
  const diag = padToTip(100, 0, 100);
  expect(Math.hypot(diag.side, diag.vert)).toBeLessThanOrEqual(0.5 + 1e-9);
});

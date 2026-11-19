import { expect, test } from 'vitest';
import { angleDiff, distPointSegment, norm, v2 } from './vec';

test('norm of zero vector is zero, not NaN', () => {
  expect(norm(v2(0, 0))).toEqual({ x: 0, y: 0 });
});
test('angleDiff wraps', () => {
  expect(angleDiff(3.1, -3.1)).toBeCloseTo(3.1 + 3.1 - 2 * Math.PI, 9);
});
test('distPointSegment clamps to endpoints', () => {
  expect(distPointSegment(v2(2, 1), v2(0, 0), v2(1, 0))).toBeCloseTo(Math.SQRT2, 9);
});

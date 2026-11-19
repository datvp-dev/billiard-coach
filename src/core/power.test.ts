import { expect, test } from 'vitest';
import { POWER_SPEEDS } from './config';
import { lagLengths, speedForPower } from './power';

const MPH = 0.44704;

test('six power levels, from a soft touch under 1 mph up to a 10 mph power shot', () => {
  expect(POWER_SPEEDS).toHaveLength(6);
  expect(POWER_SPEEDS[0]).toBeLessThan(1 * MPH);
  expect(POWER_SPEEDS[5]).toBeCloseTo(10 * MPH, 1);
  for (let i = 1; i < POWER_SPEEDS.length; i++) expect(POWER_SPEEDS[i]).toBeGreaterThan(POWER_SPEEDS[i - 1]);
});
test('whole power levels map to the table, halves fall in between', () => {
  expect(speedForPower(1)).toBe(POWER_SPEEDS[0]);
  expect(speedForPower(6)).toBe(POWER_SPEEDS[5]);
  expect(speedForPower(2.5)).toBeGreaterThan(POWER_SPEEDS[1]);
  expect(speedForPower(2.5)).toBeLessThan(POWER_SPEEDS[2]);
  expect(speedForPower(0)).toBe(POWER_SPEEDS[0]);
  expect(speedForPower(9)).toBe(POWER_SPEEDS[5]);
});
// Dr. Dave TP B.6: a rolling cue ball at 3 mph travels 1.68 table lengths, at 7 mph 3.0.
test('free-rolling travel matches the published table lengths', () => {
  expect(lagLengths(3 * MPH, 'medium')).toBeGreaterThan(1.3);
  expect(lagLengths(3 * MPH, 'medium')).toBeLessThan(2.1);
  expect(lagLengths(7 * MPH, 'medium')).toBeGreaterThan(2.5);
  expect(lagLengths(7 * MPH, 'medium')).toBeLessThan(3.6);
});
test('a ball travels further on faster cloth', () => {
  expect(lagLengths(1.1, 'fast')).toBeGreaterThan(lagLengths(1.1, 'slow'));
});

import { expect, test } from 'vitest';
import { BALL_SETS, FELTS, ballPaint, ballSet, felt, inkOn, readEquipment } from './equipment';

test('every ball set paints all of 0 to 8, and stripes follow the solid eight below', () => {
  for (const s of BALL_SETS) {
    expect(s.paint).toHaveLength(9);
    expect(ballPaint(9, s.id)).toEqual({ fill: s.paint[1], stripe: true, band: s.darkStripes ? '#17181a' : '#f6f2e6' });
    expect(ballPaint(10, s.id).fill).toBe(s.paint[2]);
    expect(ballPaint(4, s.id).stripe).toBe(false);
  }
});
test('no two balls of a set that can be mistaken for each other are painted the same', () => {
  for (const s of BALL_SETS) expect(new Set(s.paint).size).toBe(9);
  expect(new Set(FELTS.map((f) => f.bed)).size).toBe(FELTS.length);
});
test('left to the app, the table is drawn in the usual colours', () => {
  expect(ballSet('auto').id).toBe('standard');
  expect(felt('auto').id).toBe('green');
  expect(ballPaint(4)).toEqual(ballPaint(4, 'standard'));
});
test('stored choices are read back, unknown ones ignored', () => {
  expect(readEquipment({ felt: 'blue', balls: 'black' })).toEqual({ felt: 'blue', balls: 'black' });
  expect(readEquipment({ felt: 'tartan', balls: 7 })).toEqual({ felt: 'auto', balls: 'auto' });
  for (const bad of [null, undefined, 'x', 3]) expect(readEquipment(bad)).toEqual({ felt: 'auto', balls: 'auto' });
});
test('numbers are lettered light on dark balls and dark on light ones', () => {
  expect(inkOn('#17181a')).toBe('#fff');
  expect(inkOn('#115c48')).toBe('#fff');
  expect(inkOn('#f2c230')).toBe('#17181a');
  expect(inkOn('#f6f2e6')).toBe('#17181a');
});

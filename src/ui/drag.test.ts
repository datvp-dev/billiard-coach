import { expect, test } from 'vitest';
import { releaseRemovesBall } from './drag';

// --- final review, finding 8: overshooting the end rail by a few pixels must not delete the ball ---
test('a ball is removed only when released well inside the tray', () => {
  const tray = { top: 600, bottom: 640, left: 0, right: 390 };
  expect(releaseRemovesBall({ x: 100, y: 603 }, tray)).toBe(false);
  expect(releaseRemovesBall({ x: 100, y: 620 }, tray)).toBe(true);
  expect(releaseRemovesBall({ x: 100, y: 590 }, tray)).toBe(false);
  expect(releaseRemovesBall({ x: 400, y: 620 }, tray)).toBe(false);
});

import { aimAngle } from './drag';

test('the cue direction runs from the cue ball to the finger, and a touch on the cue ball itself is ignored', () => {
  expect(aimAngle({ x: 1, y: 0.5 }, { x: 2, y: 0.5 })).toBe(0);
  expect(aimAngle({ x: 1, y: 0.5 }, { x: 1, y: 1 })).toBeCloseTo(Math.PI / 2, 9);
  expect(aimAngle({ x: 1, y: 0.5 }, { x: 1.01, y: 0.5 })).toBeNull();
});

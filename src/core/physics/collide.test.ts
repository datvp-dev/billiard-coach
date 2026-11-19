import { expect, test } from 'vitest';
import { TABLE } from '../config';
import { angleDiff, angleOf, len, v2 } from '../vec';
import { collideBalls, collideCushion, collideJaw } from './collide';
import { restingBody, type Body } from './motion';

const still = (id: number, x: number, y: number): Body => restingBody(id, v2(x, y));

test('head-on stun: cue nearly stops, object leaves at ~eBall speed', () => {
  const a = still(0, 1, 0.6);
  a.vel = v2(2, 0);
  const b = still(1, 1 + 2 * TABLE.R, 0.6);
  collideBalls(a, b);
  expect(b.vel.x).toBeCloseTo((2 * (1 + 0.95)) / 2, 2);
  expect(a.vel.x).toBeCloseTo((2 * (1 - 0.95)) / 2, 2);
});

const halfBall = () => {
  const a = still(0, 1, 0.6);
  a.vel = v2(1.5, 0);
  const b = still(1, 1 + 2 * TABLE.R * Math.cos(Math.PI / 6), 0.6 + 2 * TABLE.R * Math.sin(Math.PI / 6));
  return { a, b };
};

test('half-ball stun cut: object ball is thrown off the line of centres by 1 to 6 degrees', () => {
  const { a, b } = halfBall();
  collideBalls(a, b);
  const thrown = (Math.abs(angleDiff(angleOf(b.vel), Math.PI / 6)) * 180) / Math.PI;
  expect(thrown).toBeGreaterThan(1);
  expect(thrown).toBeLessThan(6);
  // thrown toward the cue ball's direction of travel
  expect(angleOf(b.vel)).toBeLessThan(Math.PI / 6);
});
test('linear momentum is conserved in a cut collision', () => {
  const { a, b } = halfBall();
  collideBalls(a, b);
  expect(a.vel.x + b.vel.x).toBeCloseTo(1.5, 9);
  expect(a.vel.y + b.vel.y).toBeCloseTo(0, 9);
});
test('outside english reduces throw (gearing)', () => {
  const plain = halfBall();
  collideBalls(plain.a, plain.b);
  const geared = halfBall();
  // surface speed at the contact point cancels the sideways rubbing
  geared.a.w.z = (1.5 * Math.sin(Math.PI / 6)) / TABLE.R;
  collideBalls(geared.a, geared.b);
  const t0 = Math.abs(angleDiff(angleOf(plain.b.vel), Math.PI / 6));
  const t1 = Math.abs(angleDiff(angleOf(geared.b.vel), Math.PI / 6));
  expect(t1).toBeLessThan(t0 * 0.2);
});
test('separating balls are left alone', () => {
  const a = still(0, 1, 0.6);
  a.vel = v2(-1, 0);
  const b = still(1, 1 + 2 * TABLE.R, 0.6);
  collideBalls(a, b);
  expect(a.vel).toEqual({ x: -1, y: 0 });
  expect(b.vel).toEqual({ x: 0, y: 0 });
});
test('cushion: no-spin sliding ball at 45 degrees rebounds shallower and slower', () => {
  const b = still(0, 1, 0.5);
  b.vel = v2(1, -1);
  collideCushion(b, v2(0, 1));
  expect(b.vel.y).toBeGreaterThan(0);
  expect(len(b.vel)).toBeLessThan(Math.SQRT2);
  const out = (Math.atan2(b.vel.y, Math.abs(b.vel.x)) * 180) / Math.PI;
  expect(out).toBeGreaterThan(25);
  expect(out).toBeLessThan(50);
});
test('cushion: running english lengthens the rebound, reverse shortens it', () => {
  // Ball travels +x into the bottom rail. Running english rolls along the rail: contact point at rest, w.z < 0.
  const mk = (wz: number) => {
    const b = still(0, 1, 0.5);
    b.vel = v2(1, -1);
    b.w.z = wz;
    collideCushion(b, v2(0, 1));
    return b.vel.x;
  };
  expect(mk(-40)).toBeGreaterThan(mk(0));
  expect(mk(40)).toBeLessThan(mk(0));
});
test('cushion: behaves the same on every rail', () => {
  const rails: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  const speeds = rails.map(([nx, ny]) => {
    const b = still(0, 1, 0.5);
    // 45 degrees into the rail, same handedness each time
    b.vel = v2(-nx - ny, -ny + nx);
    collideCushion(b, v2(nx, ny));
    expect(b.vel.x * nx + b.vel.y * ny).toBeGreaterThan(0);
    return len(b.vel);
  });
  for (const s of speeds) expect(s).toBeCloseTo(speeds[0], 9);
});
test('jaw point reflects the ball away', () => {
  const b = still(0, 1, 0.5);
  b.vel = v2(1, 0);
  collideJaw(b, v2(1 + TABLE.R, 0.5));
  expect(b.vel.x).toBeCloseTo(-0.6, 9);
});

import type { Vec2 } from './types';

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}
export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}
export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}
export function len(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}
export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
/** Unit vector; returns {0,0} for zero input, never NaN. */
export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}
export function fromAngle(rad: number): Vec2 {
  return { x: Math.cos(rad), y: Math.sin(rad) };
}
export function angleOf(a: Vec2): number {
  return Math.atan2(a.y, a.x);
}
/** Signed a - b, wrapped into (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}
/** 90 degrees counter-clockwise. */
export function perp(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}
export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-18) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

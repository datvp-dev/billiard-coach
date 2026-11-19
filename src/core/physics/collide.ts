import { PHYS, TABLE } from '../config';
import type { Vec2 } from '../types';
import type { Body } from './motion';

const R = TABLE.R;
const M = TABLE.m;
const I = (2 * M * R * R) / 5;

/**
 * Ball-ball collision with restitution and surface friction (throw and spin transfer).
 * Does nothing if the balls are not approaching.
 */
export function collideBalls(a: Body, b: Body): void {
  let nx = b.pos.x - a.pos.x;
  let ny = b.pos.y - a.pos.y;
  const d = Math.hypot(nx, ny);
  if (d < 1e-12) {
    nx = 1;
    ny = 0;
  } else {
    nx /= d;
    ny /= d;
  }
  const rvx = a.vel.x - b.vel.x;
  const rvy = a.vel.y - b.vel.y;
  const vn = rvx * nx + rvy * ny;
  if (vn <= 0) return;

  // Normal impulse (per unit mass).
  const jn = ((1 + PHYS.eBall) * vn) / 2;

  // Relative surface velocity at the contact point, tangent to the contact plane.
  // Horizontal tangent t = (-ny, nx); vertical component along z.
  const sx = a.w.x + b.w.x;
  const sy = a.w.y + b.w.y;
  const sz = a.w.z + b.w.z;
  const vth = -rvx * ny + rvy * nx + R * sz;
  const vtz = R * (sx * ny - sy * nx);
  const vt = Math.hypot(vth, vtz);

  a.vel.x -= jn * nx;
  a.vel.y -= jn * ny;
  b.vel.x += jn * nx;
  b.vel.y += jn * ny;

  if (vt > 1e-9) {
    const mu = PHYS.muBallA + PHYS.muBallB * Math.exp(-PHYS.muBallC * vt);
    // Friction impulse per unit mass, capped at the impulse that stops the rubbing.
    const jt = Math.min(mu * jn, vt / 7);
    const jh = (-jt * vth) / vt; // on a, along t
    const jz = (-jt * vtz) / vt; // on a, along z
    a.vel.x += jh * -ny;
    a.vel.y += jh * nx;
    b.vel.x -= jh * -ny;
    b.vel.y -= jh * nx;
    // Torque arm R*n on a and -R*n on b with opposite impulses: both get the same spin change.
    const k = (M * R) / I;
    const dwx = k * ny * jz;
    const dwy = -k * nx * jz;
    const dwz = k * jh;
    a.w.x += dwx;
    a.w.y += dwy;
    a.w.z += dwz;
    b.w.x += dwx;
    b.w.y += dwy;
    b.w.z += dwz;
  }
}


/**
 * Ball-cushion collision after Han (2005). `n` is the cushion normal pointing into the table.
 * The cushion nose touches the ball above its centre, at elevation asin(h/R - 1).
 */
export function collideCushion(b: Body, n: Vec2): void {
  // Local frame: x' points into the cushion, y' = z × x'.
  const xx = -n.x;
  const xy = -n.y;
  const yx = -xy;
  const yy = xx;
  let vx = b.vel.x * xx + b.vel.y * xy;
  let vy = b.vel.x * yx + b.vel.y * yy;
  if (vx <= 0) return;
  let wx = b.w.x * xx + b.w.y * xy;
  let wy = b.w.x * yx + b.w.y * yy;
  let wz = b.w.z;

  const SIN_T = PHYS.cushionH / R - 1;
  const COS_T = Math.sqrt(1 - SIN_T * SIN_T);
  const e = PHYS.eCushion;
  const mu = PHYS.muCushion;
  const sx = vx * SIN_T + R * wy;
  const sy = -vy - R * wz * COS_T + R * wx * SIN_T;
  const c = vx * COS_T;
  // Impulses per unit mass.
  const pn = (1 + e) * c;
  const s = Math.hypot(sx, sy);
  const stick = (2 * s) / 7;
  let PX: number;
  let PY: number;
  let PZ: number;
  if (stick <= mu * pn || s < 1e-12) {
    PX = (-2 * sx * SIN_T) / 7 - pn * COS_T;
    PY = (2 * sy) / 7;
    PZ = (2 * sx * COS_T) / 7 - pn * SIN_T;
  } else {
    const cp = sx / s;
    const sp = sy / s;
    PX = -mu * pn * cp * SIN_T - pn * COS_T;
    PY = mu * pn * sp;
    PZ = mu * pn * cp * COS_T - pn * SIN_T;
  }
  vx += PX;
  vy += PY;
  const k = (M * R) / I;
  wx += -k * PY * SIN_T;
  wy += k * (PX * SIN_T - PZ * COS_T);
  wz += k * PY * COS_T;

  b.vel.x = vx * xx + vy * yx;
  b.vel.y = vx * xy + vy * yy;
  b.w.x = wx * xx + wy * yx;
  b.w.y = wx * xy + wy * yy;
  b.w.z = wz;
}

/** Collision with the tip of a cushion at a pocket jaw, treated as a fixed point. */
export function collideJaw(b: Body, point: Vec2): void {
  let nx = b.pos.x - point.x;
  let ny = b.pos.y - point.y;
  const d = Math.hypot(nx, ny);
  if (d < 1e-12) return;
  nx /= d;
  ny /= d;
  const vn = b.vel.x * nx + b.vel.y * ny;
  if (vn >= 0) return;
  const j = -(1 + PHYS.eJaw) * vn;
  b.vel.x += j * nx;
  b.vel.y += j * ny;
}

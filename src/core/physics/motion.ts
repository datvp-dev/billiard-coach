import { PHYS, TABLE } from '../config';
import type { ClothSpeed, Shot, Vec2, Vec3 } from '../types';

/**
 * Conventions: z points up out of the table. `w` is the angular velocity vector.
 * The contact point with the cloth moves at u = vel + R * (z × w) = (vx - R*wy, vy + R*wx).
 * Natural roll is u = 0, i.e. w_xy = (z × vel) / R.
 */
export type Body = { id: number; pos: Vec2; vel: Vec2; w: Vec3; active: boolean };
export type PhysParams = { cloth: ClothSpeed };

const R = TABLE.R;
const SLIP_EPS = 1e-3;
const STOP_EPS = 1e-4;
const SPIN_EPS = 1e-2;

export function restingBody(id: number, pos: Vec2): Body {
  return { id, pos: { x: pos.x, y: pos.y }, vel: { x: 0, y: 0 }, w: { x: 0, y: 0, z: 0 }, active: true };
}

/** Cue ball state immediately after a level-cue strike. */
export function strike(id: number, pos: Vec2, shot: Shot): Body {
  // Squirt: the ball deflects away from the side the tip is on. Right english (side > 0) pushes it left.
  const dir = shot.dir + PHYS.squirtPerSide * shot.tip.side;
  const dx = Math.cos(dir);
  const dy = Math.sin(dir);
  const k = (5 * shot.speed) / (2 * R);
  return {
    id,
    pos: { x: pos.x, y: pos.y },
    vel: { x: shot.speed * dx, y: shot.speed * dy },
    // z × d = (-dy, dx): topspin axis.
    w: { x: -k * shot.tip.vert * dy, y: k * shot.tip.vert * dx, z: k * shot.tip.side },
    active: true,
  };
}

export function slipVelocity(b: Body): Vec2 {
  return { x: b.vel.x - R * b.w.y, y: b.vel.y + R * b.w.x };
}

export function isMoving(b: Body): boolean {
  return b.active && (Math.abs(b.vel.x) > STOP_EPS || Math.abs(b.vel.y) > STOP_EPS || Math.abs(b.w.z) > SPIN_EPS);
}

/** Advance one body by dt. Exact within each motion state; splits dt at the slide -> roll transition. */
export function advance(b: Body, dt: number, p: PhysParams): void {
  if (!b.active) return;
  const g = PHYS.g;

  // Vertical-axis spin decays linearly in every state.
  if (b.w.z !== 0) {
    const dz = ((5 * PHYS.muSpin * g) / (2 * R)) * dt;
    if (Math.abs(b.w.z) <= dz) b.w.z = 0;
    else b.w.z -= Math.sign(b.w.z) * dz;
  }

  let remaining = dt;
  const ux = b.vel.x - R * b.w.y;
  const uy = b.vel.y + R * b.w.x;
  const u = Math.hypot(ux, uy);
  if (u > SLIP_EPS) {
    // Sliding: friction opposes the slip direction, which stays fixed while sliding.
    const mu = PHYS.muSlide;
    const tSlide = (2 * u) / (7 * mu * g);
    const t = Math.min(remaining, tSlide);
    const ex = ux / u;
    const ey = uy / u;
    const ax = -mu * g * ex;
    const ay = -mu * g * ey;
    b.pos.x += b.vel.x * t + 0.5 * ax * t * t;
    b.pos.y += b.vel.y * t + 0.5 * ay * t * t;
    b.vel.x += ax * t;
    b.vel.y += ay * t;
    // dw/dt = (5 mu g / 2R) * (z × û), with z × û = (-ey, ex).
    const k = ((5 * mu * g) / (2 * R)) * t;
    b.w.x += -k * ey;
    b.w.y += k * ex;
    remaining -= t;
    if (remaining <= 0) return;
  }

  // Rolling.
  const v = Math.hypot(b.vel.x, b.vel.y);
  if (v <= STOP_EPS) {
    b.vel.x = 0;
    b.vel.y = 0;
    b.w.x = 0;
    b.w.y = 0;
    return;
  }
  const decel = PHYS.muRoll[p.cloth] * g;
  const tStop = v / decel;
  const t = Math.min(remaining, tStop);
  const dx = b.vel.x / v;
  const dy = b.vel.y / v;
  const travelled = v * t - 0.5 * decel * t * t;
  b.pos.x += dx * travelled;
  b.pos.y += dy * travelled;
  const v1 = t >= tStop ? 0 : v - decel * t;
  b.vel.x = dx * v1;
  b.vel.y = dy * v1;
  b.w.x = -b.vel.y / R;
  b.w.y = b.vel.x / R;
}

import { PHYS, SCORE, TABLE } from './config';
import { firstContactState } from './physics/simulate';
import { POCKET_IDS, isSidePocket, pocketAxis, pocketCenter, pocketMouth } from './table';
import type { BallPos, ClothSpeed, Layout, PocketId, Tip, Vec2 } from './types';
import { angleDiff, angleOf, dist, distPointSegment, dot, norm, scale, sub } from './vec';

const R = TABLE.R;
const DEG = Math.PI / 180;

/** True if no ball (other than `ignore`) has its centre within 2R of the segment. */
export function pathClear(from: Vec2, to: Vec2, balls: BallPos[], ignore: number[]): boolean {
  for (const b of balls) {
    if (ignore.includes(b.id)) continue;
    if (distPointSegment(b.pos, from, to) < 2 * R) return false;
  }
  return true;
}

/**
 * Point the object ball is sent toward. For corner pockets this sits one ball radius inside the
 * corner along the diagonal, so a ball running down a rail is not aimed into the cushion.
 */
export function pocketAim(pocket: PocketId): Vec2 {
  if (isSidePocket(pocket)) return pocketCenter(pocket);
  return sub(pocketCenter(pocket), scale(pocketAxis(pocket), R));
}

function pocketDir(obj: Vec2, pocket: PocketId): Vec2 {
  const d = norm(sub(pocketAim(pocket), obj));
  return d.x === 0 && d.y === 0 ? pocketAxis(pocket) : d;
}

/** Where the cue ball centre must be at contact: 2R behind the object ball on the pocket line. */
export function ghostBall(obj: Vec2, pocket: PocketId): Vec2 {
  return sub(obj, scale(pocketDir(obj, pocket), 2 * R));
}

/** Radians; 0 is a straight shot. */
export function cutAngle(cue: Vec2, obj: Vec2, pocket: PocketId): number {
  const toGhost = norm(sub(ghostBall(obj, pocket), cue));
  if (toGhost.x === 0 && toGhost.y === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(toGhost, pocketDir(obj, pocket)))));
}

/** Angle between the object ball's line to the pocket and the pocket's axis. */
export function entryAngle(obj: Vec2, pocket: PocketId): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(pocketDir(obj, pocket), pocketAxis(pocket)))));
}

// Abramowitz & Stegun 7.1.26
function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/**
 * Chance of pocketing, from the allowed aiming error versus a typical player's error.
 * Geometry only: does not check for blocking balls.
 */
export function potProbability(cue: Vec2, obj: Vec2, pocket: PocketId): number {
  const entry = entryAngle(obj, pocket);
  const cut = cutAngle(cue, obj, pocket);
  const e = Math.max(0, (pocketMouth(pocket) * Math.cos(entry) - R) / 2);
  const alpha = e / Math.max(dist(obj, pocketAim(pocket)), R);
  const dCue = Math.max(dist(cue, ghostBall(obj, pocket)), 2 * R);
  const margin = (alpha * 2 * R * Math.max(0, Math.cos(cut))) / dCue;
  const p = erf(margin / (SCORE.playerSigmaDeg * DEG * Math.SQRT2));
  return Number.isFinite(p) ? Math.max(0, Math.min(0.99, p)) : 0;
}

function find(layout: Layout, id: number): Vec2 | null {
  for (const b of layout.balls) if (b.id === id) return b.pos;
  return null;
}

/** Both lines open, cut and pocket entry within limits. */
export function potGeometryOk(layout: Layout, targetId: number, pocket: PocketId): boolean {
  const cue = find(layout, 0);
  const obj = find(layout, targetId);
  if (!cue || !obj) return false;
  if (cutAngle(cue, obj, pocket) > SCORE.maxCutDeg * DEG) return false;
  const maxEntry = (isSidePocket(pocket) ? SCORE.maxEntrySideDeg : SCORE.maxEntryCornerDeg) * DEG;
  if (entryAngle(obj, pocket) > maxEntry) return false;
  if (!pathClear(obj, pocketAim(pocket), layout.balls, [0, targetId])) return false;
  return pathClear(cue, ghostBall(obj, pocket), layout.balls, [0, targetId]);
}

/**
 * Cue direction that sends the target into the pocket for this speed and tip, found by
 * simulating the contact and correcting for throw. Null if the target cannot be hit first.
 */
export function solveAim(layout: Layout, targetId: number, pocket: PocketId, speed: number, tip: Tip, cloth: ClothSpeed): number | null {
  const cue = find(layout, 0);
  const obj = find(layout, targetId);
  if (!cue || !obj) return null;
  const want = angleOf(pocketDir(obj, pocket));
  let line = want; // direction of the line of centres at contact
  for (let i = 0; i < 6; i++) {
    const ghost = sub(obj, scale({ x: Math.cos(line), y: Math.sin(line) }, 2 * R));
    const toGhost = sub(ghost, cue);
    if (Math.abs(angleDiff(angleOf(toGhost), line)) > 88 * DEG) return null;
    // Cancel squirt up front so the ball actually travels toward the ghost position.
    const dir = angleOf(toGhost) - PHYS.squirtPerSide * tip.side;
    const s = firstContactState(layout.balls, { dir, speed, tip }, { cloth });
    if (s.firstContact !== targetId || s.cushionsBefore > 0) return null;
    const ob = s.bodies.find((b) => b.id === targetId)!;
    const err = angleDiff(angleOf(ob.vel), want);
    if (Math.abs(err) < 0.05 * DEG) return dir;
    line -= err;
  }
  return null;
}

/** Best pot probability over all pockets with an open shot; 0 if none or if a ball is missing. */
export function bestPotProbability(layout: Layout, targetId: number): number {
  const cue = find(layout, 0);
  const obj = find(layout, targetId);
  if (!cue || !obj) return 0;
  let best = 0;
  for (const p of POCKET_IDS) {
    if (!potGeometryOk(layout, targetId, p)) continue;
    const pr = potProbability(cue, obj, p);
    if (pr > best) best = pr;
  }
  return best;
}


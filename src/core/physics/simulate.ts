import { PHYS, TABLE } from '../config';
import { CUSHIONS, JAW_POINTS, POCKET_IDS, pocketCapture, pocketCenter } from '../table';
import type { BallPos, ClothSpeed, PocketId, Shot, SimEvent, SimResult, Vec2 } from '../types';
import { collideBalls, collideCushion, collideJaw } from './collide';
import { advance, isMoving, restingBody, strike, type Body, type PhysParams } from './motion';

export type SimOptions = { cloth: ClothSpeed; stopAtFirstContact?: boolean };

const { L, W, R } = TABLE;
const D2 = 4 * R * R;
const MAX_COLLISIONS_PER_STEP = 8;
const EDGE = 0.12;

const CUSHION_DATA = CUSHIONS.map((c) => {
  const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
  return { a: c.a, n: c.n, dx: (c.b.x - c.a.x) / len, dy: (c.b.y - c.a.y) / len, len };
});
const CAPTURES = POCKET_IDS.map((id) => ({ id, ...pocketCapture(id) }));

type Hit = { t: number; kind: 0 | 1 | 2 | 3; i: number; j: number }; // 0 none, 1 ball, 2 cushion, 3 jaw

function nearestPocket(p: Vec2): PocketId {
  let best: PocketId = 'BL';
  let bd = Infinity;
  for (const id of POCKET_IDS) {
    const c = pocketCenter(id);
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

function pocketFor(p: Vec2): PocketId | null {
  if (p.x > EDGE && p.x < L - EDGE && p.y > EDGE && p.y < W - EDGE) return null;
  for (const c of CAPTURES) {
    const dx = p.x - c.c.x;
    const dy = p.y - c.c.y;
    if (dx * dx + dy * dy < c.r * c.r) return c.id;
  }
  // Slipped past the nose line through a pocket gap.
  if (p.x < -0.5 * R || p.x > L + 0.5 * R || p.y < -0.5 * R || p.y > W + 0.5 * R) return nearestPocket(p);
  return null;
}

type Run = {
  result: SimResult;
  bodies: Body[];
  cushionsBefore: number;
};

function run(balls: BallPos[], shot: Shot, opts: SimOptions): Run {
  const params: PhysParams = { cloth: opts.cloth };
  const bodies: Body[] = balls.map((b) => (b.id === 0 ? strike(0, b.pos, shot) : restingBody(b.id, b.pos)));
  const n = bodies.length;
  const moving: boolean[] = bodies.map((b) => isMoving(b));
  const events: SimEvent[] = [];
  const paths: Record<number, Vec2[]> = {};
  const times: Record<number, number[]> = {};
  const pocketed: { id: number; pocket: PocketId }[] = [];
  const cueTouched: number[] = [];
  let firstContact: number | null = null;
  let railAfterContact = false;
  let cushionsBefore = 0;
  let t = 0;
  let nextSample = PHYS.sampleEvery;
  let done = false;

  const record = (b: Body) => {
    let p = paths[b.id];
    if (!p) {
      p = paths[b.id] = [];
      times[b.id] = [];
    }
    const last = p[p.length - 1];
    if (last && last.x === b.pos.x && last.y === b.pos.y) return;
    p.push({ x: b.pos.x, y: b.pos.y });
    times[b.id].push(t);
  };
  const wake = (i: number) => {
    if (!moving[i]) {
      moving[i] = true;
      // First point of a ball's path is where it sat, stamped with the time it was struck.
      if (!paths[bodies[i].id]) record(bodies[i]);
    }
  };
  for (let i = 0; i < n; i++) if (moving[i]) record(bodies[i]);

  const hit: Hit = { t: 0, kind: 0, i: 0, j: 0 };

  const findHit = (rem: number) => {
    hit.kind = 0;
    hit.t = rem;
    for (let i = 0; i < n; i++) {
      if (!moving[i]) continue;
      const a = bodies[i];
      if (!a.active) continue;
      const px = a.pos.x;
      const py = a.pos.y;
      const vx = a.vel.x;
      const vy = a.vel.y;

      // Ball-ball.
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const b = bodies[j];
        if (!b.active) continue;
        if (moving[j] && j < i) continue; // pair handled from the other side
        const dpx = b.pos.x - px;
        const dpy = b.pos.y - py;
        const dvx = (moving[j] ? b.vel.x : 0) - vx;
        const dvy = (moving[j] ? b.vel.y : 0) - vy;
        const bq = dpx * dvx + dpy * dvy;
        if (bq >= 0) continue; // not approaching
        const cq = dpx * dpx + dpy * dpy - D2;
        let th: number;
        if (cq <= 0) th = 0;
        else {
          const aq = dvx * dvx + dvy * dvy;
          const disc = bq * bq - aq * cq;
          if (disc < 0) continue;
          th = (-bq - Math.sqrt(disc)) / aq;
        }
        if (th < hit.t) {
          hit.t = th;
          hit.kind = 1;
          hit.i = i;
          hit.j = j;
        }
      }

      // Cushions and jaws only matter near the edge.
      const reach = Math.hypot(vx, vy) * rem + R + 1e-3;
      if (px > reach && px < L - reach && py > reach && py < W - reach) continue;

      for (let k = 0; k < CUSHION_DATA.length; k++) {
        const c = CUSHION_DATA[k];
        const vn = vx * c.n.x + vy * c.n.y;
        if (vn >= 0) continue;
        const d = (px - c.a.x) * c.n.x + (py - c.a.y) * c.n.y;
        if (d < 0) continue; // already beyond the nose line: in a pocket mouth
        const th = d <= R ? 0 : (d - R) / -vn;
        if (th >= hit.t) continue;
        const s = (px + vx * th - c.a.x) * c.dx + (py + vy * th - c.a.y) * c.dy;
        if (s < 0 || s > c.len) continue;
        hit.t = th;
        hit.kind = 2;
        hit.i = i;
        hit.j = k;
      }
      for (let k = 0; k < JAW_POINTS.length; k++) {
        const q = JAW_POINTS[k];
        const dpx = q.x - px;
        const dpy = q.y - py;
        const bq = -(dpx * vx + dpy * vy);
        if (bq >= 0) continue;
        const cq = dpx * dpx + dpy * dpy - R * R;
        let th: number;
        if (cq <= 0) th = 0;
        else {
          const aq = vx * vx + vy * vy;
          const disc = bq * bq - aq * cq;
          if (disc < 0) continue;
          th = (-bq - Math.sqrt(disc)) / aq;
        }
        if (th < hit.t) {
          hit.t = th;
          hit.kind = 3;
          hit.i = i;
          hit.j = k;
        }
      }
    }
  };

  const advanceAll = (dt: number) => {
    if (dt <= 0) return;
    for (let i = 0; i < n; i++) if (moving[i]) advance(bodies[i], dt, params);
    t += dt;
  };

  const checkPockets = () => {
    for (let i = 0; i < n; i++) {
      if (!moving[i]) continue;
      const b = bodies[i];
      if (!b.active) continue;
      const p = pocketFor(b.pos);
      if (p) {
        record(b);
        b.active = false;
        moving[i] = false;
        b.vel.x = 0;
        b.vel.y = 0;
        pocketed.push({ id: b.id, pocket: p });
        events.push({ t, type: 'pocket', ball: b.id, pocket: p, pos: { x: b.pos.x, y: b.pos.y } });
      }
    }
  };

  while (!done && t < PHYS.maxTime) {
    let rem = PHYS.dt;
    for (let iter = 0; iter < MAX_COLLISIONS_PER_STEP && rem > 0; iter++) {
      findHit(rem);
      if (hit.kind === 0) break;
      advanceAll(hit.t);
      rem -= hit.t;
      const a = bodies[hit.i];
      if (hit.kind === 1) {
        const b = bodies[hit.j];
        wake(hit.j);
        collideBalls(a, b);
        record(a);
        record(b);
        events.push({ t, type: 'ball', ball: a.id, other: b.id, pos: { x: a.pos.x, y: a.pos.y } });
        const other = a.id === 0 ? b.id : b.id === 0 ? a.id : -1;
        if (other >= 0) {
          if (firstContact === null) firstContact = other;
          if (!cueTouched.includes(other)) cueTouched.push(other);
          if (opts.stopAtFirstContact) {
            done = true;
            break;
          }
        }
      } else {
        if (hit.kind === 2) collideCushion(a, CUSHION_DATA[hit.j].n);
        else collideJaw(a, JAW_POINTS[hit.j]);
        record(a);
        events.push({ t, type: 'cushion', ball: a.id, pos: { x: a.pos.x, y: a.pos.y } });
        if (firstContact !== null) railAfterContact = true;
        else if (a.id === 0) cushionsBefore++;
      }
    }
    if (done) break;
    advanceAll(rem);
    checkPockets();

    let any = false;
    for (let i = 0; i < n; i++) {
      if (!moving[i]) continue;
      if (isMoving(bodies[i])) any = true;
      else {
        moving[i] = false;
        record(bodies[i]);
      }
    }
    if (t >= nextSample) {
      nextSample = t + PHYS.sampleEvery;
      for (let i = 0; i < n; i++) if (moving[i]) record(bodies[i]);
    }
    if (!any) break;
  }
  for (let i = 0; i < n; i++) if (moving[i] && bodies[i].active) record(bodies[i]);

  const result: SimResult = {
    events,
    paths,
    times,
    final: bodies.filter((b) => b.active).map((b) => ({ id: b.id, pos: { x: b.pos.x, y: b.pos.y } })),
    pocketed,
    firstContact,
    cueScratched: pocketed.some((p) => p.id === 0),
    railAfterContact,
    cueTouched,
    duration: t,
  };
  return { result, bodies, cushionsBefore };
}

/** Simulate a shot until every ball stops. Ball id 0 is struck. */
export function simulate(balls: BallPos[], shot: Shot, opts: SimOptions): SimResult {
  return run(balls, shot, opts).result;
}

/** Simulate up to the cue ball's first ball contact and return the body states right after it. */
export function firstContactState(
  balls: BallPos[],
  shot: Shot,
  opts: { cloth: ClothSpeed },
): { firstContact: number | null; bodies: Body[]; cushionsBefore: number } {
  const r = run(balls, shot, { cloth: opts.cloth, stopAtFirstContact: true });
  return { firstContact: r.result.firstContact, bodies: r.bodies, cushionsBefore: r.cushionsBefore };
}

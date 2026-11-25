import { TABLE } from '../core/config';
import { ballIdsForMode, placeBall } from '../core/table';
import type { GameMode, Layout, Vec2 } from '../core/types';
import type { FoundBall } from '../vision/balls';

const { R } = TABLE;
/** Between two looks, a ball that stays within this is standing still (video noise moves it a little). */
const STILL = 0.014;
/** A ball at rest is the same ball as before if it is found within this. */
const SAME = 0.024;
/** Looks in a row without movement before the position counts. */
const CALM = 3;
/** Looks a new ball must be there for: a hand or a cue tip rarely stays this long. */
const AGE = 2;
/** A published ball is moved only by more than this, so the table does not tremble. */
const NUDGE = 0.011;
/** Weight of a number given by the player. */
const TOLD = 1000;

export type LiveBall = { pos: Vec2; id: number | null; hidden: boolean };
export type LiveStatus = 'away' | 'moving' | 'settling' | 'steady';
type Track = { pos: Vec2; votes: Map<number, number>; age: number; hidden: boolean; id: number | null };

export type Look = {
  balls: FoundBall[];
  /** For each position from `watched()`, in order: nothing but cloth there. */
  clear: boolean[];
  /** False when the picture is not the chosen view of the table. */
  sameView: boolean;
};

const gap = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Closest pairs first; every item is used at most once. */
function pairUp(a: Vec2[], b: Vec2[], max: number): [number, number][] {
  const all: [number, number, number][] = [];
  a.forEach((p, i) => b.forEach((q, j) => {
    const d = gap(p, q);
    if (d <= max) all.push([d, i, j]);
  }));
  all.sort((p, q) => p[0] - q[0]);
  const ua = new Set<number>();
  const ub = new Set<number>();
  const out: [number, number][] = [];
  for (const [, i, j] of all) {
    if (ua.has(i) || ub.has(j)) continue;
    ua.add(i);
    ub.add(j);
    out.push([i, j]);
  }
  return out;
}

/**
 * Turns looks at a running video into table positions. A position counts once the balls have
 * stopped; a ball that a player covers stays where it was until its spot is seen empty; numbers
 * are remembered for balls that did not move and voted on over time for those that did.
 */
export function createTracker(mode: GameMode) {
  let tracks: Track[] = [];
  let last: FoundBall[] | null = null;
  let calm = 0;
  let status: LiveStatus = 'settling';
  let published: Layout | null = null;

  const giveNames = () => {
    const before = new Set(tracks.map((t) => t.id).filter((id): id is number => id !== null));
    const bids: { v: number; t: Track; id: number }[] = [];
    for (const t of tracks) for (const [id, v] of t.votes) bids.push({ v, t, id });
    bids.sort((a, b) => b.v - a.v);
    const taken = new Set<number>();
    for (const t of tracks) t.id = null;
    for (const { t, id } of bids) {
      if (t.id !== null || taken.has(id)) continue;
      t.id = id;
      taken.add(id);
    }
    return before;
  };

  const layoutNow = (): Layout => {
    const layout: Layout = { mode, balls: [] };
    for (const t of tracks) {
      if (t.id === null || t.age < AGE) continue;
      // To the millimetre, as layouts are stored.
      const pos = placeBall(layout, t.id, { x: Math.round(t.pos.x * 1000) / 1000, y: Math.round(t.pos.y * 1000) / 1000 });
      layout.balls.push({ id: t.id, pos });
    }
    layout.balls.sort((a, b) => a.id - b.id);
    return layout;
  };

  const differs = (a: Layout, b: Layout) =>
    a.balls.length !== b.balls.length || a.balls.some((p, i) => p.id !== b.balls[i].id || gap(p.pos, b.balls[i].pos) > NUDGE);

  const settle = (balls: FoundBall[], clear: boolean[]) => {
    const pairs = pairUp(tracks.map((t) => t.pos), balls.map((b) => b.pos), SAME);
    const seen = new Map(pairs);
    const taken = new Set(pairs.map(([, j]) => j));
    const gone: number[] = [];
    const keep: Track[] = [];
    tracks.forEach((t, i) => {
      const j = seen.get(i);
      if (j !== undefined) {
        const b = balls[j];
        t.hidden = false;
        t.age++;
        t.pos = { x: t.pos.x + (b.pos.x - t.pos.x) * 0.3, y: t.pos.y + (b.pos.y - t.pos.y) * 0.3 };
        if (b.id !== null) t.votes.set(b.id, Math.min(TOLD, (t.votes.get(b.id) ?? 0) + 0.2 + b.confidence));
        keep.push(t);
        return;
      }
      // Not found: covered by a player, or no longer there. Two balls cannot share a place.
      const replaced = balls.some((b) => gap(b.pos, t.pos) < 1.5 * R);
      if (!clear[i] && !replaced && t.age >= AGE) {
        t.hidden = true;
        keep.push(t);
      } else if (t.id !== null) gone.push(t.id);
    });
    tracks = keep;
    const fresh: Track[] = [];
    balls.forEach((b, j) => {
      if (taken.has(j)) return;
      const t: Track = { pos: b.pos, votes: new Map(), age: 1, hidden: false, id: null };
      if (b.id !== null) t.votes.set(b.id, 0.2 + b.confidence);
      tracks.push(t);
      fresh.push(t);
    });
    giveNames();
    // One ball left its place and one unnamed ball turned up: the same ball.
    const missing = gone.filter((id) => !tracks.some((t) => t.id === id));
    const unnamed = fresh.filter((t) => t.id === null);
    if (missing.length === 1 && unnamed.length === 1) {
      unnamed[0].id = missing[0];
      unnamed[0].votes.set(missing[0], 0.6);
    }
  };

  return {
    /** Places the next look should report `clear` for. */
    watched: (): Vec2[] => tracks.map((t) => t.pos),
    /** Balls checked by the player: their numbers hold for as long as the balls stay put. */
    seed(balls: { pos: Vec2; id: number | null }[]): Layout {
      tracks = balls.map((b) => ({ pos: b.pos, votes: new Map(b.id === null ? [] : [[b.id, TOLD] as [number, number]]), age: AGE, hidden: false, id: b.id }));
      last = null;
      calm = 0;
      status = 'settling';
      published = layoutNow();
      return published;
    },
    /** Feed one look; returns a new position for the table when there is one. */
    look(l: Look): Layout | null {
      if (!l.sameView) {
        status = 'away';
        last = null;
        calm = 0;
        return null;
      }
      const allowed = ballIdsForMode(mode);
      const balls = l.balls.map((b) => (b.id !== null && !allowed.includes(b.id) ? { ...b, id: null, confidence: 0 } : b));
      if (last) {
        const n = pairUp(last.map((b) => b.pos), balls.map((b) => b.pos), STILL).length;
        const moved = Math.max(last.length, balls.length) - n;
        // A ball flickering in and out at the edge of a shadow or a sleeve is not a moving ball.
        const flicker = last.length !== balls.length && n === Math.min(last.length, balls.length);
        // Hands and cues move over the table all the time; what matters is that every known ball
        // is still in its place, or has only been covered.
        const known = tracks.map((t, i) => ({ t, i })).filter((k) => k.t.age >= AGE);
        const home = new Set(pairUp(known.map((k) => k.t.pos), balls.map((b) => b.pos), SAME).map(([i]) => i));
        const unmoved = known.length > 0 && known.every((k, j) => home.has(j) || l.clear[k.i] === false);
        const still = moved === 0 || flicker || unmoved;
        calm = still ? calm + 1 : 0;
        status = still ? (calm >= CALM - 1 ? 'steady' : 'settling') : 'moving';
      }
      last = balls;
      if (calm < CALM - 1) return null;
      settle(balls, l.clear);
      const now = layoutNow();
      if (published && !differs(now, published)) return null;
      // Give a ball that has just turned up the looks it needs before showing a table without it.
      if (tracks.some((t) => t.age < AGE)) return null;
      published = now;
      return now;
    },
    status: () => status,
    balls: (): LiveBall[] => tracks.filter((t) => t.age >= AGE).map((t) => ({ pos: t.pos, id: t.id, hidden: t.hidden })),
  };
}

export type Tracker = ReturnType<typeof createTracker>;

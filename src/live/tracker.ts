import { TABLE } from '../core/config';
import { ballIdsForMode, placeBall } from '../core/table';
import type { GameMode, Layout, Vec2 } from '../core/types';
import type { FoundBall } from '../vision/balls';
import { learn, lookGap, type Profile } from './looks';

const { R } = TABLE;
/** Between two looks, a ball that stays within this is standing still (video noise moves it a little). */
const STILL = 0.014;
/** A ball at rest is the same ball as before if it is found within this. */
const SAME = 0.024;
/** Looks in a row without movement before the position counts. */
const CALM = 3;
/** Looks a ball must have been there for before it is shown. */
const AGE = 3;
/** After this many looks a ball's number no longer changes by itself. */
const FIRM = 6;
/** Looks something must stay for when no ball is missing: a new rack, or a ball put back. */
const STRANGER = 8;
/** Looks to wait for a missing ball while somebody is over the table. */
const PATIENCE = 26;
/** Share of the bed covered before somebody counts as being over it. */
const COVERED = 0.012;
/** A published ball is moved only by more than this, so the table does not tremble. */
const NUDGE = 0.011;
/** Worst likeness at which a ball is still taken for a missing one. */
const ALIKE = 2.4;

export type LiveBall = { pos: Vec2; id: number | null; hidden: boolean };
export type LiveStatus = 'away' | 'moving' | 'settling' | 'blocked' | 'steady';
type Track = {
  pos: Vec2;
  id: number | null;
  /** The player said which ball this is. */
  told: boolean;
  /** Put there by the player: stays even if it cannot be seen, until balls move. */
  pinned: boolean;
  age: number;
  hidden: boolean;
  /** Looks so far, averaged, and how the general colour rules would name it. */
  face: Profile | undefined;
  votes: Map<number, number>;
};

export type Look = {
  balls: FoundBall[];
  /** For each position from `watched()`, in order: nothing but cloth there. */
  clear: boolean[];
  /** False when the picture is not the chosen view of the table. */
  sameView: boolean;
  /** Share of the bed hidden by people. */
  cover?: number;
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

/** Cheapest way to give each row at most one column, leaving a row out costs `skip`. */
function assign(cost: number[][], cols: number, skip: number): (number | null)[] {
  const size = 1 << cols;
  let dp = new Float64Array(size).fill(Infinity);
  dp[0] = 0;
  const back: Int8Array[] = [];
  for (const row of cost) {
    const nd = new Float64Array(size).fill(Infinity);
    const bk = new Int8Array(size).fill(-1);
    for (let m = 0; m < size; m++) {
      if (dp[m] === Infinity) continue;
      if (dp[m] + skip < nd[m]) (nd[m] = dp[m] + skip), (bk[m] = -1);
      for (let k = 0; k < cols; k++) {
        if (m & (1 << k) || row[k] === Infinity) continue;
        const t = m | (1 << k);
        const v = dp[m] + row[k];
        if (v < nd[t]) (nd[t] = v), (bk[t] = k);
      }
    }
    dp = nd;
    back.push(bk);
  }
  let m = 0;
  for (let k = 1; k < size; k++) if (dp[k] < dp[m]) m = k;
  const out: (number | null)[] = cost.map(() => null);
  for (let i = cost.length - 1; i >= 0; i--) {
    const k = back[i][m];
    if (k < 0) continue;
    out[i] = k;
    m ^= 1 << k;
  }
  return out;
}

/**
 * Turns looks at a running video into table positions.
 *
 * A position counts once the balls have stopped. Balls do not appear from nowhere: after a shot,
 * whatever is found in a new place is matched with the balls that left their places, by what each
 * of them has looked like so far. Anything that is part of a player is never a new ball, and a
 * ball a player covers stays where it was until its spot is seen empty. The player's corrections
 * win over all of this.
 */
export function createTracker(mode: GameMode) {
  const ids = ballIdsForMode(mode);
  let tracks: Track[] = [];
  const profiles = new Map<number, Profile>();
  /** Balls that left their place in this shot and have not been found yet, and for how many looks. */
  const lost = new Map<number, number>();
  /** Places the player said hold no ball; trusted until they are seen empty. */
  let ignored: Vec2[] = [];
  let last: FoundBall[] | null = null;
  let calm = 0;
  let young = 0;
  let status: LiveStatus = 'settling';
  let published: Layout | null = null;

  const track = (pos: Vec2, id: number | null): Track => ({ pos, id, told: false, pinned: false, age: 1, hidden: false, face: undefined, votes: new Map() });

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

  /** A ball in view where `t` is, but something of a player rather than that ball. */
  const impostor = (t: Track, b: FoundBall) => {
    if (!b.attached || !b.look) return false;
    const known = t.id !== null ? profiles.get(t.id) ?? t.face : t.face;
    return !!known && lookGap(known.look, b.look) > ALIKE;
  };

  const observe = (t: Track, b: FoundBall) => {
    t.hidden = false;
    t.pinned = false;
    t.age++;
    // Close to a player the outline is not to be trusted to the millimetre.
    const w = b.attached ? 0.05 : 0.3;
    t.pos = { x: t.pos.x + (b.pos.x - t.pos.x) * w, y: t.pos.y + (b.pos.y - t.pos.y) * w };
    if (b.attached) return;
    if (b.look) t.face = learn(t.face, b.look);
    if (b.id !== null) t.votes.set(b.id, (t.votes.get(b.id) ?? 0) + 0.2 + b.confidence);
    if (b.look && t.id !== null && (t.told || t.age > FIRM)) profiles.set(t.id, learn(profiles.get(t.id), b.look));
  };

  /** Give numbers to the balls that do not have a firm one, out of the numbers that are free. */
  const giveNames = (person: boolean) => {
    // A ball that is only thought to be covered may turn up somewhere else.
    const firm = (t: Track) => !t.hidden && (t.told || (t.id !== null && t.age >= FIRM));
    const taken = new Set(tracks.filter(firm).map((t) => t.id));
    const free = ids.filter((id) => !taken.has(id));
    const loose = tracks.filter((t) => !firm(t) && !t.hidden);
    const under = new Map(tracks.filter((t) => t.hidden && t.id !== null).map((t) => [t.id!, t]));
    if (loose.length === 0) return;
    const total = (t: Track) => [...t.votes.values()].reduce((a, b) => a + b, 0);
    // Balls that left their places are looked for first. Anything else needs time to prove itself:
    // a rack set up again, a ball spotted, or one that was wrongly thought to be down.
    const rack = loose.length >= 4 && lost.size === 0;
    const proven = (t: Track) => published === null || t.age >= (person ? 3 : 1) * (rack ? AGE : STRANGER);
    const cost = loose.map((t) =>
      free.map((id) => {
        // Only a ball that looks just like it, and has stayed, shows that it is not covered after all.
        if (under.has(id)) {
          const q = profiles.get(id);
          return q && t.face && t.age >= AGE && lookGap(q.look, t.face.look) < 1 ? lookGap(q.look, t.face.look) + 1 : Infinity;
        }
        if (t.id !== id && !lost.has(id) && !(id === 0 && !person) && !proven(t)) return Infinity;
        const p = profiles.get(id);
        const vote = total(t) > 0 ? (t.votes.get(id) ?? 0) / total(t) : 0;
        // Known faces are compared with; the general colour rules only break ties. A ball never
        // seen in this stream goes by the rules alone.
        const like = p && t.face ? lookGap(p.look, t.face.look) - 0.5 * vote : 2.6 - 2 * vote;
        // It is more likely one that has just left its place than one that went down earlier.
        // The cue ball comes back after every foul.
        return Math.max(0, like) + (lost.has(id) || id === 0 || published === null ? 0 : 1);
      }),
    );
    const got = assign(cost, free.length, published === null ? 2.5 : ALIKE);
    loose.forEach((t, i) => (t.id = got[i] === null ? null : free[got[i]!]));
    tracks = tracks.filter((t) => !(t.hidden && t.id !== null && loose.some((o) => o.id === t.id)));
    // One ball left its place and one unnamed ball turned up: the same ball.
    const missing = [...lost.keys()].filter((id) => !tracks.some((t) => t.id === id));
    const unnamed = loose.filter((t) => t.id === null && t.age < STRANGER);
    if (missing.length === 1 && unnamed.length === 1) {
      const p = profiles.get(missing[0]);
      const f = unnamed[0].face;
      if (!p || !f || lookGap(p.look, f.look) < 2 * ALIKE) unnamed[0].id = missing[0];
    }
  };

  const settle = (balls: FoundBall[], clear: boolean[], person: boolean) => {
    const pairs = pairUp(tracks.map((t) => t.pos), balls.map((b) => b.pos), SAME).filter(([i, j]) => !impostor(tracks[i], balls[j]));
    const seen = new Map(pairs);
    const taken = new Set(pairs.map(([, j]) => j));
    // A ball has left: there was a shot, and what was put on by hand must now be seen like the rest.
    if (tracks.some((t, i) => !t.pinned && t.age >= AGE && !seen.has(i) && clear[i])) for (const t of tracks) t.pinned = false;
    const keep: Track[] = [];
    tracks.forEach((t, i) => {
      const j = seen.get(i);
      if (j !== undefined) {
        observe(t, balls[j]);
        keep.push(t);
        return;
      }
      // Not found: covered by a player, or no longer there. Two balls cannot share a place.
      const replaced = balls.some((b, k) => !taken.has(k) && !b.attached && gap(b.pos, t.pos) < 1.5 * R);
      if (t.pinned || (!clear[i] && !replaced && t.age >= AGE)) {
        t.hidden = !t.pinned;
        keep.push(t);
      } else if (t.id !== null && t.age >= AGE) lost.set(t.id, 0);
    });
    tracks = keep;
    balls.forEach((b, j) => {
      if (taken.has(j) || b.attached) return;
      // Behind a covered ball there is no room for another one.
      if (tracks.some((t) => gap(t.pos, b.pos) < 1.2 * R)) return;
      const t = track(b.pos, null);
      observe(t, b);
      t.age = 1;
      tracks.push(t);
    });
    giveNames(person);
    for (const t of tracks) if (t.id !== null && (t.told || t.age >= FIRM)) lost.delete(t.id);
    for (const [id, n] of lost) lost.set(id, n + 1);
    // Nothing is missing, so this is not a ball that moved. If it stays, and nobody is around,
    // somebody put it there.
    tracks = tracks.filter((t) => !(t.id === null && person && t.age > AGE));
  };

  return {
    /** Places the next look should report `clear` for. */
    watched: (): Vec2[] => [...tracks.map((t) => t.pos), ...ignored],
    /** Where balls are, as far as is known. */
    places: (): Vec2[] => tracks.map((t) => t.pos),
    /** Balls checked by the player on a clear frame. */
    seed(balls: { pos: Vec2; id: number | null }[]): Layout {
      tracks = balls.map((b) => ({ ...track(b.pos, b.id), told: b.id !== null, pinned: true, age: AGE }));
      profiles.clear();
      lost.clear();
      ignored = [];
      last = null;
      calm = 0;
      status = 'settling';
      published = layoutNow();
      return published;
    },
    /** Balls on a frame, named by the faces known so far where there are any. Parts of players are left out. */
    recognise(balls: FoundBall[]): { pos: Vec2; id: number | null }[] {
      const real = balls.filter((b) => !b.attached);
      const cost = real.map((b) =>
        ids.map((id) => {
          const p = profiles.get(id);
          const vote = b.id === id ? 0.2 + b.confidence : 0;
          return p && b.look ? Math.max(0, lookGap(p.look, b.look) - 0.5 * vote) : Math.max(0, 2.6 - 2 * vote);
        }),
      );
      const got = assign(cost, ids.length, ALIKE);
      return real.map((b, i) => ({ pos: b.pos, id: got[i] === null ? null : ids[got[i]!] }));
    },
    /** Forget the table and go on from this one. What each ball looks like is kept. */
    restart(balls: { pos: Vec2; id: number | null }[]): Layout {
      tracks = balls.map((b) => ({ ...track(b.pos, b.id), told: b.id !== null, pinned: true, age: AGE }));
      lost.clear();
      ignored = [];
      last = null;
      calm = 0;
      young = 0;
      status = 'settling';
      published = layoutNow();
      return published;
    },
    /** What was found on the frame the player checked: the first look at every ball. */
    meet(balls: FoundBall[]): void {
      for (const [i, j] of pairUp(tracks.map((t) => t.pos), balls.map((b) => b.pos), SAME)) {
        const b = balls[j];
        const t = tracks[i];
        if (!b.look) continue;
        t.face = learn(t.face, b.look);
        if (t.id !== null) profiles.set(t.id, learn(profiles.get(t.id), b.look));
      }
    },
    /**
     * The player's own version of the table. Balls keep the numbers and places given here; places
     * where the player removed something are not read as balls again until they have been empty.
     */
    correct(balls: { pos: Vec2; id: number | null }[]): Layout {
      const pairs = new Map(pairUp(balls.map((b) => b.pos), tracks.map((t) => t.pos), 1.2 * R));
      const used = new Set(pairs.values());
      tracks.forEach((t, j) => {
        if (!used.has(j)) ignored.push(t.pos);
      });
      tracks = balls.map((b, i) => {
        const j = pairs.get(i);
        const old = j === undefined ? null : tracks[j];
        const moved = !old || gap(old.pos, b.pos) > NUDGE;
        const renamed = !!old && old.id !== b.id;
        const t: Track = { ...(old ?? track(b.pos, null)), id: b.id, told: b.id !== null, age: Math.max(AGE, old?.age ?? 0), hidden: false };
        if (moved) (t.pos = b.pos), (t.pinned = true);
        // What this ball looks like belongs to its real number, not to the one it was mistaken for.
        if (renamed && b.id !== null && t.face) profiles.set(b.id, { look: t.face.look, n: Math.min(3, t.face.n) });
        return t;
      });
      ignored = ignored.filter((p) => !tracks.some((t) => gap(t.pos, p) < 1.2 * R)).slice(-12);
      lost.clear();
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
      const person = (l.cover ?? 0) > COVERED;
      const clearIgnored = l.clear.slice(tracks.length);
      ignored = ignored.filter((_, i) => clearIgnored[i] !== true);
      const balls = l.balls
        .filter((b) => !ignored.some((p) => gap(p, b.pos) < 1.2 * R))
        .map((b) => (b.id !== null && !ids.includes(b.id) ? { ...b, id: null, confidence: 0 } : b));
      // Hands and cues move over the table all the time; only things that could be balls count.
      const loose = balls.filter((b) => !b.attached);
      const known = tracks.map((t, i) => ({ t, i })).filter((k) => k.t.age >= AGE);
      const home = new Set(pairUp(known.map((k) => k.t.pos), balls.map((b) => b.pos), SAME).map(([i]) => i));
      const left = known.filter((k, j) => !home.has(j) && l.clear[k.i] !== false && !k.t.pinned);
      if (last) {
        const n = pairUp(last.map((b) => b.pos), loose.map((b) => b.pos), STILL).length;
        const moved = Math.max(last.length, loose.length) - n;
        const flicker = last.length !== loose.length && n === Math.min(last.length, loose.length);
        const still = moved === 0 || flicker || (known.length > 0 && left.length === 0);
        calm = still ? calm + 1 : 0;
        if (!still && left.length > 0) {
          for (const t of tracks) t.pinned = false;
          // A new shot: what has not been found by now went down in an earlier one.
          for (const [id, n] of lost) if (n > CALM) lost.delete(id);
        }
        status = still ? (calm >= CALM - 1 ? 'steady' : 'settling') : 'moving';
      }
      last = loose;
      if (calm < CALM - 1) return null;
      settle(balls, l.clear, person);
      if (person && tracks.some((t) => t.hidden)) status = 'blocked';
      const now = layoutNow();
      if (published && !differs(now, published)) {
        young = 0;
        return null;
      }
      // Give a ball that has just turned up the looks it needs before showing a table without it.
      if (tracks.some((t) => t.age < AGE) && ++young < 6) return null;
      // A ball is missing and somebody is over the table: it may be underneath.
      if (person && [...lost].some(([id, n]) => n < PATIENCE && !tracks.some((t) => t.id === id))) {
        status = 'blocked';
        return null;
      }
      young = 0;
      published = now;
      return now;
    },
    status: () => status,
    balls: (): LiveBall[] =>
      tracks.filter((t) => t.age >= AGE && (t.id !== null || t.age >= STRANGER || t.told)).map((t) => ({ pos: t.pos, id: t.id, hidden: t.hidden })),
    published: () => published,
  };
}

export type Tracker = ReturnType<typeof createTracker>;

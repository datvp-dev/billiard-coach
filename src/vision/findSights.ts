import { TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import type { Raster } from './raster';
import { SIGHTS, calibrate, onRail, type Calibration, type Edge, type Mark } from './sights';

const { L, W } = TABLE;

/** A sight is 10 to 13 mm across. */
const SIGHT_R = 0.0055;
/** Grid step of the search, metres. */
const STEP = 0.0025;

/** Brightness difference from which a spot counts fully, and below which it is nothing. */
const FULL = 40;
const FAINT = 12;

type Peak = { along: number; out: number; score: number };
/** How much each place around an expected sight looks like one: a spot unlike everything right around it. */
type Patch = { n: number; reach: number; score: Float32Array; at(along: number, out: number): Vec2 };

function brightness(img: Raster): Float32Array {
  const out = new Float32Array(img.width * img.height);
  for (let i = 0, k = 0; i < out.length; i++, k += 4) out[i] = 0.3 * img.data[k] + 0.59 * img.data[k + 1] + 0.11 * img.data[k + 2];
  return out;
}

/** Around sight `i` as the view now stands; `reach` metres each way, along the rail and across it. */
function lookAround(lum: Float32Array, w: number, h: number, cal: Calibration, i: number, reach: number, bright: boolean): Patch {
  const s = SIGHTS[i];
  const mid = cal.sight(i);
  const spot = onRail(s.rail, s.along, cal.setback[s.rail]);
  const step = (da: number, dv: number) => {
    const p = onRail(s.rail, s.along + da, cal.setback[s.rail] + dv);
    const a = cal.toRaw(p);
    const b = cal.toRaw(spot);
    return { x: (a.x - b.x) / 0.01, y: (a.y - b.y) / 0.01 };
  };
  const ax = step(0.01, 0);
  const ox = step(0, 0.01);
  const at = (along: number, out: number): Vec2 => ({ x: mid.x + ax.x * along + ox.x * out, y: mid.y + ax.y * along + ox.y * out });
  // Never finer than the picture: at least a pixel each way.
  const det = Math.abs(ax.x * ox.y - ax.y * ox.x) || 1;
  const ra = Math.max(SIGHT_R, (0.9 * Math.hypot(ox.x, ox.y)) / det);
  const ro = Math.max(SIGHT_R, (0.9 * Math.hypot(ax.x, ax.y)) / det);
  const pad = 2.3 * Math.max(ra, ro) + STEP;
  const m = Math.ceil((reach + pad) / STEP);
  const side = 2 * m + 1;
  const grid = new Float32Array(side * side);
  for (let v = -m, k = 0; v <= m; v++) {
    for (let u = -m; u <= m; u++, k++) {
      const q = at(u * STEP, v * STEP);
      const x = q.x - 0.5;
      const y = q.y - 0.5;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
        grid[k] = NaN;
        continue;
      }
      const fx = x - x0;
      const fy = y - y0;
      const o = y0 * w + x0;
      grid[k] = (lum[o] * (1 - fx) + lum[o + 1] * fx) * (1 - fy) + (lum[o + w] * (1 - fx) + lum[o + w + 1] * fx) * fy;
    }
  }
  const ringOf = (scale: number, count: number) =>
    Array.from({ length: count }, (_, j) => {
      const t = (2 * Math.PI * j) / count;
      return Math.round((scale * ro * Math.sin(t)) / STEP) * side + Math.round((scale * ra * Math.cos(t)) / STEP);
    });
  const inner = [0, ...ringOf(0.5, 6)];
  const ring = [...ringOf(1.9, 14), ...ringOf(2.3, 14)];
  const n = Math.round(reach / STEP);
  const score = new Float32Array((2 * n + 1) * (2 * n + 1));
  const around = new Float32Array(ring.length);
  const allow = Math.ceil(ring.length * 0.18);
  for (let v = -n, k = 0; v <= n; v++) {
    for (let u = -n; u <= n; u++, k++) {
      const o = (v + m) * side + u + m;
      let mean = 0;
      for (const d of inner) mean += grid[o + d];
      mean /= inner.length;
      if (!(mean === mean)) continue;
      let sum = 0;
      let alike = 0;
      for (let j = 0; j < ring.length && alike <= allow; j++) {
        const g = (around[j] = grid[o + ring[j]]);
        sum += g;
        if (bright ? mean - g < FAINT : g - mean < FAINT) alike++;
      }
      if (alike > allow || !(sum === sum)) continue;
      around.sort();
      // Nearly all of what is around must differ, so that edges and stripes do not count.
      const gap = bright ? mean - around[Math.floor(ring.length * 0.82)] : around[Math.floor(ring.length * 0.18)] - mean;
      const spread = around[Math.floor(ring.length * 0.82)] - around[Math.floor(ring.length * 0.18)];
      score[k] = Math.max(0, gap - 0.25 * spread);
    }
  }
  return { n, reach, score, at };
}

const valueAt = (p: Patch, along: number, out: number): number => {
  const u = Math.round(along / STEP) + p.n;
  const v = Math.round(out / STEP) + p.n;
  const side = 2 * p.n + 1;
  return u < 0 || v < 0 || u >= side || v >= side ? 0 : p.score[v * side + u];
};

/** Highest place within `near` of (along, out), to a fraction of a step. */
function peakNear(p: Patch, along: number, out: number, near: number): Peak {
  const side = 2 * p.n + 1;
  const r = Math.ceil(near / STEP);
  const cu = Math.round(along / STEP) + p.n;
  const cv = Math.round(out / STEP) + p.n;
  let best = 0;
  let bu = cu;
  let bv = cv;
  for (let v = Math.max(0, cv - r); v <= Math.min(side - 1, cv + r); v++) {
    for (let u = Math.max(0, cu - r); u <= Math.min(side - 1, cu + r); u++) {
      if ((u - cu) ** 2 + (v - cv) ** 2 > r * r) continue;
      const s = p.score[v * side + u];
      if (s > best) (best = s), (bu = u), (bv = v);
    }
  }
  if (best <= 0) return { along, out, score: 0 };
  // Middle of everything nearly as good, joined to the best place.
  let sw = 0;
  let su = 0;
  let sv = 0;
  for (let v = Math.max(0, bv - 6); v <= Math.min(side - 1, bv + 6); v++) {
    for (let u = Math.max(0, bu - 6); u <= Math.min(side - 1, bu + 6); u++) {
      const s = p.score[v * side + u] - 0.5 * best;
      if (s <= 0) continue;
      sw += s;
      su += s * u;
      sv += s * v;
    }
  }
  return { along: (su / sw - p.n) * STEP, out: (sv / sw - p.n) * STEP, score: best };
}

/**
 * Looks for the sights of one rail together: they lie on a line and evenly spaced, so a shift that
 * changes evenly along the rail must bring all of them onto a spot at once.
 */
function alignRail(patches: { i: number; p: Patch }[], reach: number): { i: number; peak: Peak }[] {
  const span = patches.map(({ i }) => (SIGHTS[i].along / (SIGHTS[i].rail < 2 ? L : W)) * 2 - 1);
  const coarse = 0.0075;
  const steps = Math.floor(reach / coarse);
  // Spread the spots a little so that a coarse search cannot step over them.
  const wide = patches.map(({ p }) => {
    const c = Math.round(coarse / STEP);
    const m = 2 * steps + 1;
    const out = new Float32Array(m * m);
    for (let v = -steps; v <= steps; v++) {
      for (let u = -steps; u <= steps; u++) {
        let best = 0;
        for (let dv = -c + 1; dv < c; dv++) for (let du = -c + 1; du < c; du++) best = Math.max(best, valueAt(p, u * coarse + du * STEP, v * coarse + dv * STEP));
        out[(v + steps) * m + u + steps] = best < FAINT ? 0 : Math.min(1, best / FULL);
      }
    }
    return out;
  });
  const m = 2 * steps + 1;
  let best = { total: 0, a: 0, o: 0, da: 0, doo: 0 };
  // The two ends of a rail differ in shift by a limited amount: a corner a few centimetres off.
  const tilt = Math.min(steps, 6);
  for (let o = -steps; o <= steps; o++) {
    for (let a = -steps; a <= steps; a++) {
      for (let doo = -tilt; doo <= tilt; doo++) {
        for (let da = -tilt; da <= tilt; da++) {
          let total = 0;
          for (let j = 0; j < patches.length; j++) {
            const u = Math.round(a + da * span[j]);
            const v = Math.round(o + doo * span[j]);
            if (u < -steps || v < -steps || u > steps || v > steps) continue;
            total += wide[j][(v + steps) * m + u + steps];
          }
          total -= 0.02 * (Math.abs(a) + Math.abs(o) + Math.abs(da) + Math.abs(doo)) * (0.2 + 0.1 * patches.length);
          if (total > best.total) best = { total, a, o, da, doo };
        }
      }
    }
  }
  if (best.total <= 0) return [];
  return patches.map(({ i, p }, j) => ({ i, peak: peakNear(p, (best.a + best.da * span[j]) * coarse, (best.o + best.doo * span[j]) * coarse, 0.012) }));
}

/** How far from where it should be a cushion's edge is looked for, metres. */
const NOSE_REACH = 0.022;

/**
 * The edges of the cushions, where they show: seen from across the table the top of a cushion is
 * lit and the face under its nose is dark. Averaged along the whole rail the step stands out
 * clearly. A cushion seen from behind has no such step and is left out.
 */
export function findNoses(lum: Float32Array, w: number, h: number, cal: Calibration): (Vec2 | null)[] {
  return [0, 1, 2, 3].map((rail) => {
    const len = rail < 2 ? L : W;
    const spot = (along: number, out: number) => cal.toRaw(onRail(rail, along, out));
    const a = spot(len * 0.375, 0);
    const b = spot(len * 0.375, 0.01);
    const c = spot(len * 0.375 + 0.01, 0);
    const across = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / (Math.hypot(c.x - a.x, c.y - a.y) || 1);
    // Less than about a pixel per centimetre shows no edge worth measuring.
    if (across < 0.9) return null;
    const MM = 0.001;
    const span = Math.round(NOSE_REACH / MM) + 16;
    const profile: number[] = [];
    for (let o = -span; o <= span; o++) {
      const v: number[] = [];
      for (let along = 0.14; along < len - 0.14; along += 0.011) {
        if (rail < 2 && Math.abs(along - L / 2) < 0.13) continue;
        const q = spot(along, o * MM);
        const x = q.x - 0.5;
        const y = q.y - 0.5;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
        const fx = x - x0;
        const fy = y - y0;
        const k = y0 * w + x0;
        v.push((lum[k] * (1 - fx) + lum[k + 1] * fx) * (1 - fy) + (lum[k + w] * (1 - fx) + lum[k + w + 1] * fx) * fy);
      }
      if (v.length < 25) return null;
      v.sort((p, q) => p - q);
      profile.push(v[v.length >> 1]);
    }
    const mean = (from: number, to: number) => {
      let s = 0;
      for (let o = from; o <= to; o++) s += profile[o + span];
      return s / (to - from + 1);
    };
    let best = { step: Math.log(1.22), at: NaN, inner: 0, outer: 0 };
    for (let o = -span + 16; o <= span - 16; o++) {
      const outer = mean(o + 5, o + 15);
      const inner = mean(o - 12, o - 4);
      const step = Math.log((outer + 4) / (inner + 4));
      if (outer > 30 && step > best.step) best = { step, at: o, inner, outer };
    }
    if (!(best.at === best.at)) return null;
    // Half way up the step, to a fraction of a millimetre.
    const half = (best.inner + best.outer) / 2;
    for (let d = 0; d <= 10; d++) {
      for (const o of [best.at + d, best.at - d - 1]) {
        const p = profile[o + span];
        const q = profile[o + span + 1];
        if (p <= half && q > half) return spot(len * 0.375, (o + (half - p) / (q - p)) * MM);
      }
    }
    return null;
  });
}

export type SightSearch = { width: number; height: number; horizontal: boolean; rough: Vec2[]; /** Sights put in place by hand. */ hand: (Vec2 | null)[]; /** Sights the player says are not to be used. */ off: boolean[]; /** Cushion edges put in place by hand. */ noses: (Vec2 | null)[] };
export type FoundSights = {
  marks: (Mark | null)[];
  cal: Calibration;
  /** Cushion edges the view rests on. */
  noses: (Edge | null)[];
  /** Enough sights agree for the view to rest on them rather than on the rough corners. */
  sure: boolean;
};

const BLANK = [null, null, null, null];

/** Finds the sights around where a rough idea of the table puts them, and the view that follows from them. */
export function findSights(img: Raster, q: SightSearch): FoundSights {
  const { width: w, height: h } = img;
  const lum = brightness(img);
  const base = { width: w, height: h, horizontal: q.horizontal, rough: q.rough, noses: q.noses.map((at): Edge | null => (at ? { at, hand: true } : null)) };
  const byHand: (Mark | null)[] = q.hand.map((p) => (p ? { at: p, hand: true } : null));
  const inside = (p: Vec2) => p.x > 2 && p.y > 2 && p.x < w - 2 && p.y < h - 2;
  const open = SIGHTS.map((_, i) => i).filter((i) => !q.hand[i] && !q.off[i]);
  const hands = byHand.filter(Boolean).length;
  const none = byHand.map(() => null);
  const alone = calibrate({ ...base, marks: byHand });

  /** How clearly sights show on the rail where they show best. */
  let shine = 0;
  /** One look at every rail from `cal`. Together: only rails most of whose sights line up count. */
  const round = (cal: Calibration, reach: number, bright: boolean, together: boolean): { marks: (Mark | null)[]; strength: number } => {
    const marks = byHand.slice();
    let strength = 0;
    const shines: number[] = [];
    for (let rail = 0; rail < 4; rail++) {
      const patches = open.filter((i) => SIGHTS[i].rail === rail && inside(cal.sight(i))).map((i) => ({ i, p: lookAround(lum, w, h, cal, i, reach, bright) }));
      if (patches.length === 0) continue;
      const peaks = together ? alignRail(patches, reach) : patches.map(({ i, p }) => ({ i, peak: peakNear(p, 0, 0, reach) }));
      const hits = peaks.filter((x) => x.peak.score >= FAINT);
      if (together && (hits.length < 2 || hits.length < 0.6 * patches.length)) continue;
      if (together && hits.length >= 3) shines.push(hits.map((x) => x.peak.score).sort((a, b) => a - b)[hits.length >> 1]);
      for (const { i, peak } of hits) {
        // Sights of one table look alike: a glint along a trim is far weaker than the real ones.
        if (peak.score < 0.2 * shine) continue;
        marks[i] = { at: patches.find((x) => x.i === i)!.p.at(peak.along, peak.out), hand: false };
        strength += Math.min(1, peak.score / FULL);
      }
    }
    if (shines.length) shine = Math.max(...shines);
    return { marks, strength };
  };

  const search = (bright: boolean, start: Calibration) => {
    shine = 0;
    let cal = start;
    let got = { marks: byHand, strength: 0 };
    // What one rail shows tells better where to look for the next.
    for (const reach of hands >= 4 ? [0.03, 0.03] : [0.075, 0.12, 0.12, 0.075]) {
      const next = round(cal, reach, bright, true);
      if (next.strength < got.strength - 0.5) continue;
      got = next;
      cal = calibrate({ ...base, marks: got.marks });
      if (open.every((i) => got.marks[i] || !inside(cal.sight(i)))) break;
    }
    for (const near of [0.03, 0.015, 0.01]) {
      got = round(cal, near, bright, false);
      cal = calibrate({ ...base, marks: got.marks });
    }
    const used = got.marks.map((m, i) => (m && (m.hand || cal.used[i]) ? m : null));
    const visible = open.filter((i) => inside(cal.sight(i))).length + hands;
    return { marks: used, cal, visible, strength: used.filter(Boolean).length + 0.01 * got.strength };
  };

  // Nearly always light sights on dark rails; the other way round is tried when that fails.
  // A single mark set wrong by hand bends the start, so without it is tried too.
  const starts = hands > 0 && hands < 6 ? [alone, calibrate({ ...base, marks: none, noses: BLANK })] : [alone];
  for (const [bright, start] of [true, false].flatMap((b) => starts.map((c) => [b, c] as const))) {
    const best = search(bright, start);
    const n = best.marks.filter(Boolean).length;
    // A few spots can always be made to fit. Most of those that should be there, on two rails, cannot.
    const solid = [0, 1, 2, 3].filter((rail) => {
      const has = best.marks.filter((m, i) => m && SIGHTS[i].rail === rail).length;
      const should = SIGHTS.filter((s, i) => s.rail === rail && !q.off[i] && (q.hand[i] || inside(best.cal.sight(i)))).length;
      return has >= 2 && has >= 0.6 * should;
    }).length;
    if (n > hands && n >= 7 && solid >= 2 && n >= 0.55 * best.visible) {
      const read = findNoses(lum, w, h, best.cal);
      const noses = base.noses.map((n, r) => n ?? (read[r] ? { at: read[r], hand: false } : null));
      return { marks: best.marks, cal: calibrate({ ...base, marks: best.marks, noses }), noses, sure: true };
    }
  }
  return { marks: byHand, cal: alone, noses: base.noses, sure: hands >= 6 };
}

/** The sight under a mark put down by hand, if one shows within `reach` metres of it. */
export function snapToSight(img: Raster, cal: Calibration, i: number, at: Vec2, reach = 0.012): Vec2 {
  const lum = brightness(img);
  const here: Calibration = { ...cal, sight: () => at };
  let best: { peak: Peak; p: Patch } | null = null;
  for (const bright of [true, false]) {
    const p = lookAround(lum, img.width, img.height, here, i, reach, bright);
    const peak = peakNear(p, 0, 0, reach);
    if (peak.score >= 2 * FAINT && (!best || peak.score > best.peak.score)) best = { peak, p };
  }
  return best ? best.p.at(best.peak.along, best.peak.out) : at;
}

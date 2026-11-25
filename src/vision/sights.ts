import { TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import { cameraFromPlane } from './camera';
import { applyH, homography, invertH, type Homography } from './homography';
import { bend, straighten, type Lens } from './lens';

const { L, W } = TABLE;

/** Rails: 0 is y = 0, 1 is y = W, 2 is x = 0, 3 is x = L. */
export type Sight = { rail: number; along: number };

/** The diamonds on the rails, an eighth of the long side apart. There are none at the pockets. */
export const SIGHTS: Sight[] = [
  ...[0, 1].flatMap((rail) => [1, 2, 3, 5, 6, 7].map((k) => ({ rail, along: (k * L) / 8 }))),
  ...[2, 3].flatMap((rail) => [1, 2, 3].map((k) => ({ rail, along: (k * W) / 4 }))),
];

/** From the cushion nose to the middle of a sight: 3 11/16 in, give or take 1/8 in (WPA). */
export const SETBACK = 0.09366;
/** Rail tops stand about this much above the cushion noses. */
export const RISE = 0.0075;

/** Place on the table of a point beyond the nose of `rail` by `out`. */
export function onRail(rail: number, along: number, out: number): Vec2 {
  return rail === 0 ? { x: along, y: -out } : rail === 1 ? { x: along, y: W + out } : rail === 2 ? { x: -out, y: along } : { x: L + out, y: along };
}

export function sightSpot(i: number, setback: number = SETBACK): Vec2 {
  return onRail(SIGHTS[i].rail, SIGHTS[i].along, setback);
}

/** Which corner of the table is which in the picture: top-left, top-right, bottom-right, bottom-left. */
export function CORNER_AT(horizontal: boolean): Vec2[] {
  return horizontal
    ? [{ x: 0, y: W }, { x: L, y: W }, { x: L, y: 0 }, { x: 0, y: 0 }]
    : [{ x: 0, y: 0 }, { x: 0, y: W }, { x: L, y: W }, { x: L, y: 0 }];
}

/** A sight as seen in the picture; one put there by hand is taken at its word. */
export type Mark = { at: Vec2; hand: boolean };

/** A point on the edge of a cushion: read from the picture, or put there by hand. */
export type Edge = { at: Vec2; hand: boolean };

export type CalibrateInput = {
  width: number;
  height: number;
  horizontal: boolean;
  /** Corners of the nose line as placed roughly; they count only where sights do not decide. */
  rough: Vec2[];
  /** One per sight; null where it is not seen. */
  marks: (Mark | null)[];
  /** A point on the edge of each rail's cushion, where it is known. */
  noses: (Edge | null)[];
};

export type Calibration = {
  /** Corners of the nose line in the straightened picture, as the rest of the vision code wants them. */
  corners: Vec2[];
  lens: Lens;
  horizontal: boolean;
  /** Measured distance from the sights to the cushion nose, per rail. */
  setback: number[];
  /** Sights that agree with each other and decided the result. */
  used: boolean[];
  /** How far each marked sight is from where it should be, metres; 0 where there is none. */
  off: number[];
  /** How far off a place on the bed may be read (standard error at the worst place), metres. */
  error: number;
  /** Picture as taken <-> table; z is the height above the cushion noses. */
  toRaw(p: Vec2, z?: number): Vec2;
  toTable(q: Vec2, z?: number): Vec2;
  /** Where sight `i` should appear in the picture as taken. */
  sight(i: number): Vec2;
  /** Pixels per metre around a place on the nose plane. */
  scale(p: Vec2): number;
};

/** Unknowns: 8 corner coordinates, the lens, each rail's setback, each nose's offset outward, the rails' rise. */
const N = 18;
const K = 8;
const D = 9;
const E = 13;
const Z = 17;

const unit = [
  { x: 0, y: 0 },
  { x: L, y: 0 },
  { x: L, y: W },
  { x: 0, y: W },
];

/** Solves `a x = b` in place for a symmetric positive matrix; null when it is not one. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-18) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      if (f !== 0) for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

/** Grid on the bed for judging the error. */
const GRID = [0.06, 0.5, 0.94].flatMap((v) => [0.03, 0.27, 0.5, 0.73, 0.97].map((u) => ({ x: u * L, y: v * W })));

/**
 * The view of the table from the sights on its rails. The sights stand a known distance apart, so
 * between them they fix the perspective, the bend of the lens and how far each cushion lies from
 * its sights; corners of the bed, which nobody can point at, follow from that.
 */
export function calibrate(input: CalibrateInput): Calibration {
  const { width, height, horizontal, rough, marks, noses } = input;
  const named = CORNER_AT(horizontal);
  // Corners in the order of `unit`.
  const start = unit.map((u) => rough[named.findIndex((c) => c.x === u.x && c.y === u.y)]);
  const seen = marks.filter(Boolean).length;
  const bare = seen === 0 && noses.every((n) => !n);

  const planeOf = (p: number[]): Homography => homography(unit, [0, 1, 2, 3].map((i) => ({ x: p[2 * i], y: p[2 * i + 1] })));
  const first = [...start.flatMap((c) => [c.x, c.y]), 0, SETBACK, SETBACK, SETBACK, SETBACK, 0, 0, 0, 0, RISE];

  const cam0 = cameraFromPlane(planeOf(first), width, height);
  const size = (p: Vec2) => Math.max(20, cam0.scaleAt(p.x, p.y, 0));
  const sigma = marks.map((m, i) => (m ? Math.hypot(m.hand ? 0.9 : 0.8, 0.0012 * size(sightSpot(i))) : 1));
  const priors: [number, number, number][] = [
    // A handful of sights cannot tell a bent lens from a tilted camera.
    [K, 0, seen >= 10 ? 0.03 : seen >= 6 ? 0.008 : 1e-6],
    ...[0, 1, 2, 3].map((r): [number, number, number] => [D + r, SETBACK, noses[r] ? 0.012 : 0.0032]),
    ...[0, 1, 2, 3].map((r): [number, number, number] => [E + r, 0, noses[r] ? 0.004 : 0.0005]),
    [Z, RISE, 0.004],
    ...start.flatMap((c, i): [number, number, number][] => {
      const s = (bare ? 0.0001 : 0.08) * size(unit[i]);
      return [
        [2 * i, c.x, s],
        [2 * i + 1, c.y, s],
      ];
    }),
  ];

  type Row = { mark: number; value: number; sd: number };
  const rows = (p: number[]): Row[] => {
    const h = planeOf(p);
    const cam = cameraFromPlane(h, width, height);
    const lens = { k: p[K] };
    const out: Row[] = [];
    marks.forEach((m, i) => {
      if (!m) return;
      const s = SIGHTS[i];
      const at = onRail(s.rail, s.along, p[D + s.rail] + p[E + s.rail]);
      const q = bend(cam.project(at.x, at.y, p[Z]), lens, width, height);
      out.push({ mark: i, value: q.x - m.at.x, sd: sigma[i] }, { mark: i, value: q.y - m.at.y, sd: sigma[i] });
    });
    noses.forEach((n, r) => {
      if (!n) return;
      // Only the distance across the rail counts, not where along it the edge was marked.
      const flat = straighten(n.at, lens, width, height);
      const t = applyH(invertH(h), flat);
      const beyond = r === 0 ? -t.y : r === 1 ? t.y - W : r === 2 ? -t.x : t.x - L;
      const a = applyH(h, t);
      const b = applyH(h, onRail(r, r < 2 ? t.x : t.y, beyond + 0.01));
      const px = Math.max(20, Math.hypot(b.x - a.x, b.y - a.y) * 100);
      out.push({ mark: -1, value: beyond - p[E + r], sd: n.hand ? Math.hypot(1.2 / px, 0.0012) : Math.hypot(0.6 / px, 0.002) });
    });
    return out;
  };

  const many = marks.filter((m) => m && !m.hand).length >= 8;
  /** Found sights that disagree with the rest fade out; `cut` is how far they may stray, in deviations. */
  const trust = (r: Row[], cut: number) => {
    const w = new Map<number, number>();
    for (let j = 0; j < r.length; j += 2) {
      const i = r[j].mark;
      if (i < 0) break;
      const e = Math.hypot(r[j].value, r[j + 1].value) / r[j].sd / cut;
      // A hand can slip too, but only plenty of other sights may overrule it.
      w.set(i, marks[i]!.hand ? (many ? 1 / (1 + (e / 2.5) ** 2) ** 2 : 1) : 1 / (1 + e * e) ** 2);
    }
    return w;
  };
  const cost = (p: number[], w: Map<number, number>) => {
    let s = 0;
    for (const r of rows(p)) s += (w.get(r.mark) ?? 1) * (r.value / r.sd) ** 2;
    for (const [i, v, sd] of priors) s += ((p[i] - v) / sd) ** 2;
    return s;
  };
  const STEP = Array.from({ length: N }, (_, i) => (i < 8 ? 0.05 : i === K ? 1e-4 : 1e-4));
  /** Jacobian of the weighted rows, then the normal equations. */
  const normal = (p: number[], w: Map<number, number>) => {
    const r0 = rows(p);
    const a = Array.from({ length: N }, () => new Array<number>(N).fill(0));
    const g = new Array<number>(N).fill(0);
    const jac = r0.map(() => new Array<number>(N).fill(0));
    for (let k = 0; k < N; k++) {
      const q = p.slice();
      q[k] += STEP[k];
      rows(q).forEach((r, j) => (jac[j][k] = (r.value - r0[j].value) / STEP[k] / r.sd));
    }
    r0.forEach((r, j) => {
      const weight = w.get(r.mark) ?? 1;
      const v = r.value / r.sd;
      for (let k = 0; k < N; k++) {
        g[k] += weight * jac[j][k] * v;
        for (let l = 0; l < N; l++) a[k][l] += weight * jac[j][k] * jac[j][l];
      }
    });
    for (const [i, v, sd] of priors) {
      a[i][i] += 1 / (sd * sd);
      g[i] += (p[i] - v) / (sd * sd);
    }
    return { a, g };
  };

  let p = first;
  let w = new Map<number, number>();
  if (!bare) {
    let damp = 1e-3;
    for (const cut of [40, 40, 25, 15, 9, 6, 4, 3.5, 3.5, 3.5]) {
      w = trust(rows(p), cut);
      for (let it = 0; it < 4; it++) {
        const { a, g } = normal(p, w);
        for (let i = 0; i < N; i++) a[i][i] *= 1 + damp;
        const d = solve(a, g);
        if (!d) break;
        const q = p.map((v, i) => v - d[i]);
        if (q.every(Number.isFinite) && cost(q, w) <= cost(p, w)) {
          p = q;
          damp = Math.max(1e-7, damp / 6);
        } else damp *= 10;
      }
    }
  }

  const h = planeOf(p);
  const cam = cameraFromPlane(h, width, height);
  const lens: Lens = { k: bare ? 0 : p[K] };
  const back = invertH(h);
  const last = rows(p);
  const used = marks.map(() => false);
  const off = marks.map(() => 0);
  let sum = 0;
  let count = 0;
  for (let j = 0; j < last.length && last[j].mark >= 0; j += 2) {
    const i = last[j].mark;
    const px = Math.hypot(last[j].value, last[j + 1].value);
    const s = SIGHTS[i];
    const at = onRail(s.rail, s.along, p[D + s.rail] + p[E + s.rail]);
    off[i] = px / Math.max(20, cam.scaleAt(at.x, at.y, 0));
    used[i] = marks[i]!.hand && !many ? true : px < (marks[i]!.hand ? 12 : 5) * sigma[i];
    if (used[i]) {
      sum += (px / sigma[i]) ** 2;
      count += 2;
    }
  }

  // Everything is read between the noses as they really lie.
  const nose = [p[E], p[E + 1], p[E + 2], p[E + 3]];
  const placed = (q: number[], t: Vec2): Vec2 => ({ x: -q[E + 2] + (t.x / L) * (L + q[E + 2] + q[E + 3]), y: -q[E] + (t.y / W) * (W + q[E] + q[E + 1]) });
  const read = (q: number[], t: Vec2): Vec2 => ({ x: ((t.x + q[E + 2]) / (L + q[E + 2] + q[E + 3])) * L, y: ((t.y + q[E]) / (W + q[E] + q[E + 1])) * W });
  const corners = named.map((c) => applyH(h, placed(p, c)));

  /** Where a place at height z is seen and the other way; both through the true plane. */
  const lift = new Map<number, Homography>();
  const planeAt = (z: number): Homography => {
    let m = lift.get(z);
    if (!m) lift.set(z, (m = homography(unit, unit.map((u) => cam.project(u.x, u.y, z)))));
    return m;
  };

  let error = 0.02;
  if (!bare) {
    const { a } = normal(p, w);
    const noise = Math.max(1, sum / Math.max(1, count - 8));
    const cov = Array.from({ length: N }, (_, k) => solve(a, Array.from({ length: N }, (_, l) => (l === k ? 1 : 0))));
    if (cov.every(Boolean)) {
      let worst = 0;
      for (const t of GRID) {
        const at = placed(p, t);
        const q = bend(applyH(h, at), lens, width, height);
        const dx = new Array<number>(N).fill(0);
        const dy = new Array<number>(N).fill(0);
        for (let k = 0; k < N; k++) {
          const v = p.slice();
          v[k] += STEP[k];
          const r = read(v, applyH(invertH(planeOf(v)), straighten(q, { k: v[K] }, width, height)));
          dx[k] = (r.x - t.x) / STEP[k];
          dy[k] = (r.y - t.y) / STEP[k];
        }
        let s = 0;
        for (let k = 0; k < N; k++) for (let l = 0; l < N; l++) s += (dx[k] * dx[l] + dy[k] * dy[l]) * cov[k]![l];
        worst = Math.max(worst, s);
      }
      error = Math.sqrt(worst * noise);
    }
  }

  return {
    corners,
    lens,
    horizontal,
    setback: [0, 1, 2, 3].map((r) => p[D + r]),
    used,
    off,
    error,
    toRaw(t, z = 0) {
      const at = placed(p, t);
      return bend(z === 0 ? applyH(h, at) : applyH(planeAt(z), at), lens, width, height);
    },
    toTable(q, z = 0) {
      const flat = straighten(q, lens, width, height);
      return read(p, applyH(z === 0 ? back : invertH(planeAt(z)), flat));
    },
    sight(i) {
      const s = SIGHTS[i];
      const at = onRail(s.rail, s.along, p[D + s.rail] + nose[s.rail]);
      return bend(cam.project(at.x, at.y, p[Z]), lens, width, height);
    },
    scale: (t) => Math.max(1, cam.scaleAt(t.x, t.y, 0)),
  };
}

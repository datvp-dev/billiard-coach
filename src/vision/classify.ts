import type { BallSetChoice, BallSetId } from '../core/equipment';
import { ballIdsForMode } from '../core/table';
import type { GameMode } from '../core/types';
import { rgbToHsv } from './raster';

/** What a ball looks like, from the pixels inside its outline. Shares are 0..1 of those pixels. */
export type BallLook = {
  white: number;
  black: number;
  coloured: number;
  /** Degrees; of the coloured pixels. */
  hue: number;
  sat: number;
  /** Brightness of the coloured pixels, relative to the white reference. */
  value: number;
  /** Mean colour of the brighter half, used to find the cue ball as a white reference. */
  bright: [number, number, number];
};

type Proto = { h: number; s: number; v: number };
type Palette = { id: BallSetId; /** How much better it must fit than the usual sets to be believed unasked. */ rare: number; solid: Record<number, Proto>; /** Other shades the same number comes in. */ also?: Record<number, Proto>; /** Stripes are banded with black instead of white. */ darkStripes: boolean };

const PALETTES: Palette[] = [
  {
    id: 'standard',
    rare: 0,
    darkStripes: false,
    solid: {
      1: { h: 46, s: 0.85, v: 0.92 },
      2: { h: 222, s: 0.78, v: 0.6 },
      3: { h: 357, s: 0.85, v: 0.78 },
      4: { h: 275, s: 0.55, v: 0.48 },
      5: { h: 23, s: 0.85, v: 0.92 },
      6: { h: 152, s: 0.7, v: 0.42 },
      7: { h: 352, s: 0.75, v: 0.45 },
    },
  },
  {
    // Sets made for television: pink 4, light brown 7, black-banded stripes.
    id: 'tvdark',
    rare: 0,
    darkStripes: true,
    solid: {
      1: { h: 42, s: 0.8, v: 0.88 },
      2: { h: 218, s: 0.7, v: 0.75 },
      3: { h: 355, s: 0.75, v: 0.66 },
      4: { h: 344, s: 0.32, v: 0.98 },
      5: { h: 17, s: 0.75, v: 0.97 },
      6: { h: 165, s: 0.6, v: 0.36 },
      7: { h: 26, s: 0.45, v: 0.62 },
    },
    also: {
      4: { h: 15, s: 0.56, v: 0.95 },
    },
  },
  {
    // Aramith Pro-Cup TV: the pink 4 and light brown 7, on an otherwise ordinary set.
    id: 'protv',
    rare: 0.8,
    darkStripes: false,
    solid: {
      1: { h: 45, s: 0.83, v: 0.92 },
      2: { h: 219, s: 0.76, v: 0.64 },
      3: { h: 357, s: 0.82, v: 0.75 },
      4: { h: 346, s: 0.4, v: 0.96 },
      5: { h: 22, s: 0.83, v: 0.94 },
      6: { h: 152, s: 0.7, v: 0.42 },
      7: { h: 28, s: 0.55, v: 0.64 },
    },
    also: {
      4: { h: 15, s: 0.56, v: 0.95 },
    },
  },
  {
    // Predator Arcos II, Dynaspheres Palladium TV: light purple 4, brown 7.
    id: 'arcos',
    rare: 0.8,
    darkStripes: false,
    solid: {
      1: { h: 43, s: 0.85, v: 0.93 },
      2: { h: 208, s: 0.85, v: 0.62 },
      3: { h: 354, s: 0.82, v: 0.84 },
      4: { h: 290, s: 0.36, v: 0.54 },
      5: { h: 15, s: 0.83, v: 0.93 },
      6: { h: 160, s: 0.8, v: 0.4 },
      7: { h: 25, s: 0.82, v: 0.52 },
    },
  },
  {
    // Aramith Tournament Black: pink 4, purple 5, bright green 6, brown 7, black-banded stripes.
    id: 'black',
    rare: 0.8,
    darkStripes: true,
    solid: {
      1: { h: 43, s: 0.88, v: 0.95 },
      2: { h: 212, s: 0.85, v: 0.64 },
      3: { h: 358, s: 0.88, v: 0.86 },
      4: { h: 350, s: 0.52, v: 0.98 },
      5: { h: 264, s: 0.48, v: 0.62 },
      6: { h: 160, s: 0.82, v: 0.54 },
      7: { h: 24, s: 0.82, v: 0.62 },
    },
    also: {
      4: { h: 12, s: 0.5, v: 0.96 },
    },
  },
];

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/** `rgb` holds flat triples; `gain` divides out the colour of the light. */
export function lookOf(rgb: ArrayLike<number>, gain: [number, number, number] = [1, 1, 1]): BallLook {
  const n = Math.max(1, Math.floor(rgb.length / 3));
  let white = 0;
  let black = 0;
  let sx = 0;
  let sy = 0;
  let wsum = 0;
  const sats: number[] = [];
  const vals: number[] = [];
  const px: { r: number; g: number; b: number; l: number }[] = [];
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    const r = Math.min(255, rgb[i] * gain[0]);
    const g = Math.min(255, rgb[i + 1] * gain[1]);
    const b = Math.min(255, rgb[i + 2] * gain[2]);
    px.push({ r, g, b, l: r + g + b });
    const [h, s, v] = rgbToHsv(r, g, b);
    // In the dark, saturation is mostly noise: what counts is how far apart the channels are.
    const range = s * v;
    if (v < 0.3 && range < 0.11) black++;
    else if (s < 0.26 && v > 0.42 && !(range > 0.13 && (h > 315 || h < 12))) white++;
    else if (range < 0.07) black += v < 0.4 ? 1 : 0.3;
    else {
      const w = range;
      sx += Math.cos((h * Math.PI) / 180) * w;
      sy += Math.sin((h * Math.PI) / 180) * w;
      wsum += w;
      sats.push(s);
      vals.push(v);
    }
  }
  px.sort((a, b) => b.l - a.l);
  const top = px.slice(0, Math.max(1, px.length >> 1));
  const mean = (k: 'r' | 'g' | 'b') => top.reduce((t, p) => t + p[k], 0) / Math.max(1, top.length);
  const med = (a: number[]) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 0);
  let hue = (Math.atan2(sy, sx) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return {
    white: white / n,
    black: black / n,
    coloured: sats.length / n,
    hue: wsum > 0 ? hue : 0,
    sat: med(sats),
    value: med(vals),
    bright: [mean('r'), mean('g'), mean('b')],
  };
}

function solidCost(k: BallLook, p: Proto): number {
  const hue = Math.min(4.5, hueGap(k.hue, p.h) / 14);
  const sat = Math.abs(k.sat - p.s) / 0.35;
  const val = Math.max(0, Math.abs(k.value - p.v) - 0.08) / 0.22;
  return hue + 0.6 * sat + 0.8 * val;
}

/** How badly a ball's look fits a number: 0 is a perfect fit, above 3 is not it. */
function fitCost(k: BallLook, id: number, pal: Palette): number {
  if (id === 0) return 4 * Math.max(0, 0.9 - k.white) + 3 * k.coloured + 2 * k.black;
  if (id === 8) return 4.5 * Math.max(0, 0.75 - k.black - 0.7 * Math.min(0.3, k.white)) + 2.5 * k.coloured;
  const stripe = id > 8;
  const n = stripe ? id - 8 : id;
  const variant = pal.also?.[n];
  const base = Math.min(solidCost(k, pal.solid[n]), variant ? solidCost(k, variant) + 0.1 : Infinity);
  const thin = 3 * Math.max(0, 0.25 - k.coloured);
  if (!stripe) return base + thin + 4 * Math.max(0, k.white - 0.3) + 3.5 * Math.max(0, k.black - 0.25);
  const band = pal.darkStripes ? Math.max(k.black, k.white) : k.white;
  const other = pal.darkStripes ? 0 : 2 * Math.max(0, k.black - 0.25);
  // The band of a stripe may face the camera or hide, so only the hue of what shows is held to much.
  return 0.85 * base + thin * 0.5 + 5 * Math.max(0, 0.3 - band) + 3 * Math.max(0, band - 0.85) + other;
}

/** A ball that fits nothing better than this stays unnamed. */
const UNNAMED = 3;
/** With the set known there is less to be mistaken about. */
const UNNAMED_KNOWN = 4.2;

export type Naming = { id: number | null; confidence: number };

/**
 * Names all balls at once: every number is used at most once, so a red ball beside a darker red
 * one becomes the 3 and the other the 7. With the set of balls known only its colours count;
 * otherwise each known set is tried and the one that fits best kept.
 */
export function nameBalls(looks: BallLook[], mode: GameMode, choice: BallSetChoice = 'auto'): Naming[] {
  const ids = ballIdsForMode(mode);
  const size = 1 << ids.length;
  const unnamed = choice === 'auto' ? UNNAMED : UNNAMED_KNOWN;
  let best: { total: number; names: Naming[] } | null = null;
  for (const pal of PALETTES) {
    if (choice !== 'auto' && pal.id !== choice) continue;
    const cost = looks.map((k) => ids.map((id) => fitCost(k, id, pal)));
    let dp = new Float64Array(size).fill(Infinity);
    dp[0] = 0;
    const back: Int8Array[] = [];
    for (let i = 0; i < looks.length; i++) {
      const nd = new Float64Array(size).fill(Infinity);
      const bk = new Int8Array(size).fill(-1);
      for (let m = 0; m < size; m++) {
        if (dp[m] === Infinity) continue;
        if (dp[m] + unnamed < nd[m]) (nd[m] = dp[m] + unnamed), (bk[m] = -1);
        for (let k = 0; k < ids.length; k++) {
          if (m & (1 << k)) continue;
          const v = dp[m] + cost[i][k];
          const t = m | (1 << k);
          if (v < nd[t]) (nd[t] = v), (bk[t] = k);
        }
      }
      dp = nd;
      back.push(bk);
    }
    let m = 0;
    for (let k = 1; k < size; k++) if (dp[k] < dp[m]) m = k;
    const total = dp[m] + pal.rare;
    const names: Naming[] = looks.map(() => ({ id: null, confidence: 0 }));
    for (let i = looks.length - 1; i >= 0; i--) {
      const k = back[i][m];
      if (k < 0) continue;
      names[i] = { id: ids[k], confidence: Math.max(0.05, 1 - cost[i][k] / unnamed) };
      m ^= 1 << k;
    }
    if (!best || total < best.total) best = { total, names };
  }
  return best!.names;
}

/** How much better the best set must fit than the next to be told apart from it. */
const CLEARLY = 1.5;

/** Which set the balls belong to, from balls whose numbers are known; null when several would do. */
export function setOf(known: { id: number; look: BallLook }[]): BallSetId | null {
  const cost = PALETTES.map((pal) => ({ id: pal.id, sum: pal.rare + known.reduce((t, k) => t + (k.id === 0 || k.id === 8 ? 0 : Math.min(4, fitCost(k.look, k.id, pal))), 0) })).sort((a, b) => a.sum - b.sum);
  return cost[1].sum - cost[0].sum >= CLEARLY ? cost[0].id : null;
}

/** Light colour from the ball that looks most like a cue ball, as gains; null when none does. */
export function lightGain(looks: BallLook[]): [number, number, number] | null {
  let ref: BallLook | null = null;
  for (const k of looks) {
    const [r, g, b] = k.bright;
    const max = Math.max(r, g, b);
    if (max < 90) continue;
    const [h, s] = rgbToHsv(r, g, b);
    // White under a warm lamp is a pale yellow; anything stronger is a coloured ball.
    if (s > 0.42 || (s > 0.12 && !(h > 18 && h < 75))) continue;
    if (k.white + (s < 0.42 && k.sat < 0.45 ? k.coloured : 0) < 0.85) continue;
    if (!ref || r + g + b > ref.bright[0] + ref.bright[1] + ref.bright[2]) ref = k;
  }
  if (!ref) return null;
  const [r, g, b] = ref.bright;
  const top = Math.max(r, g, b);
  const lim = (x: number) => Math.min(1.7, Math.max(0.75, x));
  // Cue balls are ivory rather than pure white.
  return [lim((top * 0.99) / r), lim((top * 0.97) / g), lim((top * 0.9) / b)];
}

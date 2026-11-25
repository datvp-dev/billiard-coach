import type { BallLook } from '../vision/classify';

/** What one particular ball has looked like so far in this stream. */
export type Profile = { look: BallLook; n: number };

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/**
 * How unlike two faces are: below 1 could be the same ball, above 2.5 hardly. A ball rolls, so
 * how much white or black shows counts for less than the colour itself.
 */
export function lookGap(a: BallLook, b: BallLook): number {
  const coloured = Math.min(a.coloured, b.coloured);
  const both = Math.min(1, coloured / 0.3);
  const hue = both * Math.min(4, hueGap(a.hue, b.hue) / 13);
  const sat = both * (Math.abs(a.sat - b.sat) / 0.3) * 0.5;
  const val = both * (Math.abs(a.value - b.value) / 0.18) * 0.8;
  const shares = (Math.abs(a.white - b.white) * 1.6 + Math.abs(a.black - b.black) * 2 + Math.abs(a.coloured - b.coloured) * 1.6) / 1.4;
  const lum = (k: BallLook) => (k.bright[0] + k.bright[1] + k.bright[2]) / 765;
  return hue + sat + val + shares + Math.abs(lum(a) - lum(b)) * 2;
}

/** A running average; early looks count fully, later ones nudge it. */
export function learn(p: Profile | undefined, k: BallLook): Profile {
  if (!p) return { look: { ...k, bright: [...k.bright] }, n: 1 };
  const w = Math.max(0.08, 1 / (p.n + 1));
  const mix = (a: number, b: number) => a + (b - a) * w;
  const rad = Math.PI / 180;
  // Hue goes round, and a face with little colour says little about it.
  const hw = w * Math.min(1, k.coloured / 0.3);
  const hx = Math.cos(p.look.hue * rad) * (1 - hw) + Math.cos(k.hue * rad) * hw;
  const hy = Math.sin(p.look.hue * rad) * (1 - hw) + Math.sin(k.hue * rad) * hw;
  const hue = ((Math.atan2(hy, hx) / rad) + 360) % 360;
  const l = p.look;
  return {
    n: p.n + 1,
    look: {
      white: mix(l.white, k.white),
      black: mix(l.black, k.black),
      coloured: mix(l.coloured, k.coloured),
      hue,
      sat: l.sat + (k.sat - l.sat) * hw,
      value: l.value + (k.value - l.value) * hw,
      bright: [mix(l.bright[0], k.bright[0]), mix(l.bright[1], k.bright[1]), mix(l.bright[2], k.bright[2])],
    },
  };
}

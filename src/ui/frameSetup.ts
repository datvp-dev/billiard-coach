import { TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import { findSights, type FoundSights } from '../vision/findSights';
import { bend } from '../vision/lens';
import type { Raster } from '../vision/raster';
import { SIGHTS, calibrate, onRail, type Calibration, type Edge, type Mark } from '../vision/sights';

const { L, W } = TABLE;

/** What the player has set about where the table is; everything else is worked out from the picture. */
export type FrameSetup = {
  horizontal: boolean;
  /** Rough corners, in picture pixels: where the search starts. */
  rough: Vec2[];
  /** Sights and cushion edges put in place by hand, and sights not to be used. */
  hand: (Vec2 | null)[];
  off: boolean[];
  noses: (Vec2 | null)[];
};

export function newSetup(rough: Vec2[], horizontal: boolean): FrameSetup {
  return { horizontal, rough, hand: SIGHTS.map(() => null), off: SIGHTS.map(() => false), noses: [null, null, null, null] };
}

/** The same setup on the same view at another size. */
export function scaleSetup(s: FrameSetup, kx: number, ky: number): FrameSetup {
  const at = (p: Vec2) => ({ x: p.x * kx, y: p.y * ky });
  const some = (p: Vec2 | null) => (p ? at(p) : null);
  return { ...s, rough: s.rough.map(at), hand: s.hand.map(some), noses: s.noses.map(some) };
}

export function search(img: Raster, s: FrameSetup): FoundSights {
  return findSights(img, { width: img.width, height: img.height, ...s });
}

/** The view while something is being dragged: what was found stays, what is set by hand moves. */
export function preview(width: number, height: number, s: FrameSetup, found: FoundSights): Calibration {
  const marks = s.hand.map((p, i): Mark | null => (p ? { at: p, hand: true } : s.off[i] ? null : found.marks[i] && !found.marks[i]!.hand ? found.marks[i] : null));
  const noses = s.noses.map((p, r): Edge | null => (p ? { at: p, hand: true } : found.noses[r] && !found.noses[r]!.hand ? found.noses[r] : null));
  return calibrate({ width, height, horizontal: s.horizontal, rough: s.rough, marks, noses });
}

/** Corners as they show in the picture as taken. */
export function cornersInPicture(cal: Calibration, width: number, height: number): Vec2[] {
  return cal.corners.map((c) => bend(c, cal.lens, width, height));
}

/** Where a cushion's edge is taken hold of: clear of sights and pockets. */
export function noseHandle(cal: Calibration, rail: number): Vec2 {
  return cal.toRaw(onRail(rail, rail < 2 ? L * 0.4375 : W * 0.375, 0));
}

const cm = (m: number) => (m * 100).toFixed(1).replace('.', ',');

/** What the view rests on and how good it is, in words. */
export function describeFrame(found: FoundSights): string {
  const n = found.marks.filter((m, i) => m && found.cal.used[i]).length;
  const mm = Math.max(1, Math.round(found.cal.error * 1000));
  const measured = found.cal.setback.filter((_, r) => found.noses[r]);
  const far = measured.length ? ` Hình thoi cách mép băng ${cm(Math.min(...measured)) === cm(Math.max(...measured)) ? cm(measured[0]) : `${cm(Math.min(...measured))}–${cm(Math.max(...measured))}`} cm.` : '';
  return `Khớp ${n}/18 hình thoi, sai số chỗ kém nhất khoảng ${mm} mm.${far}`;
}

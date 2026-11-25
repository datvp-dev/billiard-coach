import type { Vec2 } from '../core/types';
import type { Homography } from './homography';

export type Vec3 = [number, number, number];

/** Pinhole camera over a plane: metres on the plane (x, y) plus height z above it -> picture pixels. */
export type Camera = {
  /** Where the camera stands, in the plane's coordinates. */
  center: Vec3;
  /** Focal length as a share of the picture's long side. */
  focal: number;
  project(x: number, y: number, z: number): Vec2;
  /** Pixels per metre for something facing the camera at that point. */
  scaleAt(x: number, y: number, z: number): number;
  /** How far the picture is from any real view of this plane: 0 fits, 0.3 and up does not. */
  misfit: number;
};

/** A phone's main camera; used when the picture does not say (a table seen from straight above). */
const DEFAULT_FOCAL = 0.75;
const MIN_FOCAL = 0.35;
const MAX_FOCAL = 3.5;

/**
 * Recovers the camera from the plane -> picture mapping, taking the optical axis through the
 * middle of the picture. The two in-plane axes must come out perpendicular and equally long,
 * which fixes the focal length unless the plane is seen face on.
 */
export function cameraFromPlane(h: Homography, width: number, height: number): Camera {
  const cx = width / 2;
  const cy = height / 2;
  const size = Math.max(width, height);
  const col = (k: number): Vec3 => [(h[k] - cx * h[6 + k]) / size, (h[3 + k] - cy * h[6 + k]) / size, h[6 + k]];
  const c1 = col(0);
  const c2 = col(1);
  const c3 = col(2);
  // u = 1 / f^2 solves both a1 u + b1 = 0 (perpendicular) and a2 u + b2 = 0 (equal length), in least squares.
  const a1 = c1[0] * c2[0] + c1[1] * c2[1];
  const b1 = c1[2] * c2[2];
  const a2 = c1[0] ** 2 + c1[1] ** 2 - c2[0] ** 2 - c2[1] ** 2;
  const b2 = c1[2] ** 2 - c2[2] ** 2;
  const tilt = (Math.abs(b1) + Math.abs(b2)) / (c1[0] ** 2 + c1[1] ** 2 + c2[0] ** 2 + c2[1] ** 2);
  const u = -(a1 * b1 + a2 * b2) / (a1 * a1 + a2 * a2 + 1e-18);
  const solved = u > 0 ? 1 / Math.sqrt(u) : NaN;
  const focal = tilt > 0.02 && solved > 0 ? Math.min(MAX_FOCAL, Math.max(MIN_FOCAL, solved)) : DEFAULT_FOCAL;

  const unit = (c: Vec3): Vec3 => [c[0] / focal, c[1] / focal, c[2]];
  const len = (c: Vec3) => Math.hypot(c[0], c[1], c[2]);
  const k1 = unit(c1);
  const k2 = unit(c2);
  const k3 = unit(c3);
  // The plane must lie in front of the camera.
  const s = (k3[2] < 0 ? -2 : 2) / (len(k1) + len(k2));
  const r1 = k1.map((v) => v * s) as Vec3;
  const r2 = k2.map((v) => v * s) as Vec3;
  const t = k3.map((v) => v * s) as Vec3;
  let r3: Vec3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  const dot = (a: Vec3) => a[0] * t[0] + a[1] * t[1] + a[2] * t[2];
  // Height is measured toward the camera, whichever way round the picture's axes run.
  if (dot(r3) > 0) r3 = [-r3[0], -r3[1], -r3[2]];
  const depth = (x: number, y: number, z: number) => Math.max(r1[2] * x + r2[2] * y + r3[2] * z + t[2], 1e-6);
  // Lengths and angle of the two axes once the focal length is taken out, plus a nudge away from
  // lenses that phones do not have.
  const l1 = len(k1);
  const l2 = len(k2);
  const skew = Math.abs(k1[0] * k2[0] + k1[1] * k2[1] + k1[2] * k2[2]) / (l1 * l2);
  const lens = tilt > 0.02 && !(solved > 0.33 && solved < 4) ? 0.15 : 0;
  return {
    misfit: Math.abs(Math.log(l1 / l2)) + skew + lens,
    center: [-dot(r1), -dot(r2), -dot(r3)],
    focal,
    project(x, y, z) {
      const px = r1[0] * x + r2[0] * y + r3[0] * z + t[0];
      const py = r1[1] * x + r2[1] * y + r3[1] * z + t[1];
      const w = depth(x, y, z);
      return { x: cx + (focal * size * px) / w, y: cy + (focal * size * py) / w };
    },
    scaleAt: (x, y, z) => (focal * size) / depth(x, y, z),
  };
}

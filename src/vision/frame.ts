import { TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import { cameraFromPlane } from './camera';
import { applyH, homography, invertH, type Homography } from './homography';
import { bend, straighten, type Lens } from './lens';
import { tableToImage } from './table';

const { L, W } = TABLE;

/** Where the table is in a picture: corners of the nose line once the lens's bend is taken out. */
export type TableFrame = { corners: Vec2[]; horizontal: boolean; lens: Lens };

export type FrameView = {
  /** Picture as taken <-> table; z is the height above the cushion noses. */
  toRaw(p: Vec2, z?: number): Vec2;
  toTable(q: Vec2, z?: number): Vec2;
};

export function frameView(f: TableFrame, width: number, height: number): FrameView {
  const camera = cameraFromPlane(tableToImage(f.corners, f.horizontal), width, height);
  const rect = [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W }];
  const planes = new Map<number, { to: Homography; from: Homography }>();
  const at = (z: number) => {
    let m = planes.get(z);
    if (!m) {
      const to = homography(rect, rect.map((p) => camera.project(p.x, p.y, z)));
      planes.set(z, (m = { to, from: invertH(to) }));
    }
    return m;
  };
  return {
    toRaw: (p, z = 0) => bend(applyH(at(z).to, p), f.lens, width, height),
    toTable: (q, z = 0) => applyH(at(z).from, straighten(q, f.lens, width, height)),
  };
}

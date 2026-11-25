import type { GameMode, Vec2 } from '../core/types';
import type { ClothModel, FoundBall } from '../vision/balls';
import { watchTable } from '../vision/detect';
import { SAME_VIEW, viewMatch, viewSignature, type ViewSignature } from '../live/view';

export type LiveRequest = { seq: number; width: number; height: number; data: Uint8ClampedArray; corners: Vec2[]; horizontal: boolean; mode: GameMode; check: Vec2[]; ref: ViewSignature | null; cloth: ClothModel | null; /** Balls known to be there. */ sure: Vec2[]; /** Make a new reference from this frame if nobody is over the table. */ renew: boolean };
export type LiveReply = { seq: number; balls: FoundBall[]; clear: boolean[]; cover: number; cloth: ClothModel | null; sameView: boolean; signature: ViewSignature };

/** Share of the bed covered up to which a frame may serve as the new reference. */
const CLEAR_ENOUGH = 0.02;

self.onmessage = (e: MessageEvent<LiveRequest>) => {
  const { seq, width, height, data, corners, horizontal, mode, check, ref, cloth, sure, renew } = e.data;
  const img = { width, height, data };
  const signature = viewSignature(img, corners, horizontal);
  const sameView = !ref || viewMatch(ref, signature) >= SAME_VIEW;
  const r = sameView ? watchTable(img, corners, horizontal, mode, check, cloth, sure) : { balls: [], clear: check.map(() => false), cover: 0, cloth: null };
  let fresh = cloth ? null : r.cloth;
  if (cloth && renew && sameView && r.cover < CLEAR_ENOUGH) fresh = watchTable(img, corners, horizontal, mode, [], null, sure).cloth;
  const reply: LiveReply = { seq, balls: r.balls, clear: r.clear, cover: r.cover, cloth: fresh, sameView, signature };
  self.postMessage(reply);
};

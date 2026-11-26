import type { BallSetChoice } from '../core/equipment';
import type { GameMode, Vec2 } from '../core/types';
import type { ClothModel, FoundBall } from '../vision/balls';
import { watchTable } from '../vision/detect';
import { straightenImage, type Lens } from '../vision/lens';
import { pickView, viewSignature, type ViewSignature } from '../live/view';

/** One camera of the stream the player lined the table up on. */
export type LiveView = { corners: Vec2[]; horizontal: boolean; lens: Lens; ref: ViewSignature | null; cloth: ClothModel | null };
export type LiveRequest = { seq: number; width: number; height: number; data: Uint8ClampedArray; views: LiveView[]; mode: GameMode; check: Vec2[]; /** Balls known to be there. */ sure: Vec2[]; /** Make a new reference from this frame if nobody is over the table. */ renew: boolean; set: BallSetChoice };
/** `view`: which camera the frame is from, -1 for none of them; `signature` is for that camera. */
export type LiveReply = { seq: number; view: number; balls: FoundBall[]; clear: boolean[]; cover: number; cloth: ClothModel | null; sameView: boolean; signature: ViewSignature | null };

/** Share of the bed covered up to which a frame may serve as the new reference. */
const CLEAR_ENOUGH = 0.02;

self.onmessage = (e: MessageEvent<LiveRequest>) => {
  const { seq, width, height, data, views, mode, check, sure, renew, set } = e.data;
  const raw = { width, height, data };
  const seen = views.map((v) => viewSignature(raw, v.corners, v.horizontal, v.lens));
  const view = pickView(views.map((v) => v.ref), seen);
  if (view < 0) {
    const none: LiveReply = { seq, view, balls: [], clear: check.map(() => false), cover: 0, cloth: null, sameView: false, signature: null };
    self.postMessage(none);
    return;
  }
  const { corners, horizontal, lens, cloth } = views[view];
  const img = straightenImage(raw, lens);
  const r = watchTable(img, corners, horizontal, mode, check, cloth, sure, set);
  let fresh = cloth ? null : r.cloth;
  if (cloth && renew && r.cover < CLEAR_ENOUGH) fresh = watchTable(img, corners, horizontal, mode, [], null, sure).cloth;
  const reply: LiveReply = { seq, view, balls: r.balls, clear: r.clear, cover: r.cover, cloth: fresh, sameView: true, signature: seen[view] };
  self.postMessage(reply);
};

import type { GameMode, Vec2 } from '../core/types';
import type { FoundBall } from '../vision/balls';
import { watchTable } from '../vision/detect';
import { SAME_VIEW, viewMatch, viewSignature, type ViewSignature } from '../live/view';

export type LiveRequest = { seq: number; width: number; height: number; data: Uint8ClampedArray; corners: Vec2[]; horizontal: boolean; mode: GameMode; check: Vec2[]; ref: ViewSignature | null };
export type LiveReply = { seq: number; balls: FoundBall[]; clear: boolean[]; sameView: boolean; signature: ViewSignature };

self.onmessage = (e: MessageEvent<LiveRequest>) => {
  const { seq, width, height, data, corners, horizontal, mode, check, ref } = e.data;
  const img = { width, height, data };
  const signature = viewSignature(img, corners, horizontal);
  const sameView = !ref || viewMatch(ref, signature) >= SAME_VIEW;
  const r = sameView ? watchTable(img, corners, horizontal, mode, check) : { balls: [], clear: check.map(() => false) };
  const reply: LiveReply = { seq, balls: r.balls, clear: r.clear, sameView, signature };
  self.postMessage(reply);
};

import type { GameMode, Vec2 } from '../core/types';
import { findBalls, type FoundBall } from './balls';
import { findClothQuad } from './corners';
import type { Raster } from './raster';
import { longSideHorizontal, playingCorners, rectify, tableToImage } from './table';

/** Pixels per metre of the flat picture used for finding balls (a ball is about 17 px across). */
export const FLAT_SCALE = 300;

/** A first guess at the four corners of the playing surface, or null if no table is recognised. */
export function guessCorners(img: Raster): { corners: Vec2[]; horizontal: boolean } | null {
  const quad = findClothQuad(img);
  if (!quad) return null;
  const horizontal = longSideHorizontal(quad);
  return { corners: playingCorners(quad, horizontal), horizontal };
}

/** Balls on the table whose playing-surface corners are at `corners` in the picture. */
export function detectBalls(img: Raster, corners: Vec2[], horizontal: boolean, mode: GameMode): FoundBall[] {
  const toImage = tableToImage(corners, horizontal);
  return findBalls(rectify(img, toImage, FLAT_SCALE), FLAT_SCALE, mode, toImage);
}

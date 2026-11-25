import type { GameMode, Vec2 } from '../core/types';
import { findBalls, nameSpots, surveyBed, type FoundBall } from './balls';
import { findClothQuad } from './corners';
import type { Raster } from './raster';
import { longSideHorizontal, playingCorners } from './table';

/** A first guess at the four corners of the playing surface, or null if no table is recognised. */
export function guessCorners(img: Raster): { corners: Vec2[]; horizontal: boolean } | null {
  const found = findClothQuad(img);
  if (!found) return null;
  const horizontal = longSideHorizontal(found.quad, img.width, img.height);
  return { corners: found.bed ? found.quad : playingCorners(found.quad, horizontal), horizontal };
}

/** Balls on the table whose playing-surface corners are at `corners` in the picture. */
export function detectBalls(img: Raster, corners: Vec2[], horizontal: boolean, mode: GameMode): FoundBall[] {
  return findBalls(img, corners, horizontal, mode);
}

/** Like `detectBalls`, and for each of `check` whether that spot on the bed is empty. */
export function watchTable(img: Raster, corners: Vec2[], horizontal: boolean, mode: GameMode, check: Vec2[]): { balls: FoundBall[]; clear: boolean[]; at(p: Vec2): Vec2 } {
  const survey = surveyBed(img, corners, horizontal);
  return { balls: nameSpots(img, corners, horizontal, mode, survey.spots), clear: check.map((p) => survey.clearAt(p)), at: survey.toTable };
}

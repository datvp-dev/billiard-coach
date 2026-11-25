import type { BallSetChoice, FeltChoice } from '../core/equipment';
import type { GameMode, Vec2 } from '../core/types';
import { findBalls, nameSpots, surveyBed, type ClothModel, type FoundBall } from './balls';
import { findClothQuad } from './corners';
import type { Raster } from './raster';
import { longSideHorizontal, playingCorners } from './table';

/** A first guess at the four corners of the playing surface, or null if no table is recognised. */
export function guessCorners(img: Raster, felt: FeltChoice = 'auto'): { corners: Vec2[]; horizontal: boolean } | null {
  const found = findClothQuad(img, felt);
  if (!found) return null;
  const horizontal = longSideHorizontal(found.quad, img.width, img.height);
  return { corners: found.bed ? found.quad : playingCorners(found.quad, horizontal), horizontal };
}

/** Balls on the table whose playing-surface corners are at `corners` in the picture. */
export function detectBalls(img: Raster, corners: Vec2[], horizontal: boolean, mode: GameMode, set: BallSetChoice = 'auto'): FoundBall[] {
  return findBalls(img, corners, horizontal, mode, set);
}

export type Watch = { balls: FoundBall[]; clear: boolean[]; cover: number; cloth: ClothModel | null; at(p: Vec2): Vec2 };

/**
 * Like `detectBalls` for a running video: compares with the cloth of an earlier clear frame when
 * there is one, and reports for each of `check` whether that spot on the bed is empty. `sure` are the
 * balls known to be there, for making a new reference from this frame.
 */
export function watchTable(img: Raster, corners: Vec2[], horizontal: boolean, mode: GameMode, check: Vec2[], known: ClothModel | null = null, sure: Vec2[] = check, set: BallSetChoice = 'auto'): Watch {
  const survey = surveyBed(img, corners, horizontal, known, sure);
  return { balls: nameSpots(img, corners, horizontal, mode, survey.spots, set), clear: check.map((p) => survey.clearAt(p)), cover: survey.cover, cloth: survey.cloth, at: survey.toTable };
}

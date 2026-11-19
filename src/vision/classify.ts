import { ballIdsForMode } from '../core/table';
import type { GameMode } from '../core/types';
import { rgbToHsv } from './raster';

export type Guess = { id: number | null; confidence: number };

function solidFromHue(h: number, medianV: number): number | null {
  if (h >= 345 || h < 14) return medianV >= 0.62 ? 3 : 7; // red, or maroon when dark
  if (h < 36) return medianV >= 0.55 ? 5 : 7; // orange; dark orange-brown reads as maroon
  if (h < 72) return 1; // yellow
  if (h >= 80 && h < 172) return 6; // green
  if (h >= 185 && h < 252) return 2; // blue
  if (h >= 252 && h < 325) return 4; // purple
  return null;
}

/**
 * Ball number from the colours of its pixels (flat RGB triples). Only colour is used, so pairs
 * such as red/maroon or a solid and its stripe are easily confused; `confidence` is 0..1.
 */
export function classifyBall(rgb: number[], mode: GameMode): Guess {
  const n = rgb.length / 3;
  if (n < 6) return { id: null, confidence: 0 };
  let white = 0;
  let black = 0;
  let sx = 0;
  let sy = 0;
  const vals: number[] = [];
  for (let i = 0; i < rgb.length; i += 3) {
    const [h, s, v] = rgbToHsv(rgb[i], rgb[i + 1], rgb[i + 2]);
    if (v < 0.2) black++;
    else if (s < 0.28) {
      if (v > 0.5) white++;
      else black += 0.5;
    } else {
      sx += Math.cos((h * Math.PI) / 180) * s;
      sy += Math.sin((h * Math.PI) / 180) * s;
      vals.push(v);
    }
  }
  const coloured = vals.length;
  if (white / n >= 0.68) return { id: 0, confidence: white / n };
  if (black / n >= 0.5) return { id: 8, confidence: black / n };
  if (coloured / n < 0.25) return { id: null, confidence: 0 };
  let hue = (Math.atan2(sy, sx) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  vals.sort((a, b) => a - b);
  const solid = solidFromHue(hue, vals[vals.length >> 1]);
  if (solid === null) return { id: null, confidence: 0 };
  const whiteShare = white / (white + coloured);
  const id = whiteShare >= 0.3 ? solid + 8 : solid;
  if (!ballIdsForMode(mode).includes(id)) return { id: null, confidence: 0 };
  // Least sure near the solid/stripe boundary.
  return { id, confidence: Math.min(1, coloured / n + 0.2) * Math.min(1, Math.abs(whiteShare - 0.3) / 0.15 + 0.4) };
}

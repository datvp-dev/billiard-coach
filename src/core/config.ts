import type { Tip, TipName } from './types';

/** 9-foot table. Metres. Origin at the bottom-left corner of the playing surface (cushion nose lines). */
export const TABLE = {
  L: 2.54,
  W: 1.27,
  R: 0.028575,
  m: 0.17,
  cornerMouth: 0.115,
  sideMouth: 0.127,
  /** Cushion starts this far from the corner along each rail. */
  cornerGap: 0.0813,
  /** Cushion gap half-width around x = L/2. */
  sideGap: 0.0635,
  /** Capture circle centre is pushed |inset| outward (corner: along the diagonal). */
  cornerCapture: { inset: -0.02, r: 0.07 },
  sideCapture: { inset: -0.035, r: 0.06 },
};

export const PHYS = {
  g: 9.81,
  muSlide: 0.2,
  muSpin: 0.044,
  muRoll: { fast: 0.008, medium: 0.01, slow: 0.013 },
  eBall: 0.95,
  /** Ball-ball friction mu = A + B * exp(-C * vRel). */
  muBallA: 9.951e-3,
  muBallB: 0.108,
  muBallC: 1.088,
  eCushion: 0.85,
  muCushion: 0.2,
  /** Cushion nose height = 7R/5. */
  cushionH: 0.04,
  eJaw: 0.6,
  /** Cue ball deflection in radians per unit tip.side. */
  squirtPerSide: 0.035,
  dt: 0.001,
  maxTime: 20,
  sampleEvery: 0.01,
};

/** m/s for power level 1..5. */
export const POWER_SPEEDS = [0.8, 1.5, 2.5, 3.8, 5.5] as const;

export const TIPS: Record<TipName, Tip> = {
  center: { side: 0, vert: 0 },
  high: { side: 0, vert: 0.4 },
  low: { side: 0, vert: -0.4 },
  left: { side: -0.3, vert: 0 },
  right: { side: 0.3, vert: 0 },
};

export const SCORE = {
  playerSigmaDeg: 0.15,
  maxCutDeg: 70,
  maxEntrySideDeg: 60,
  maxEntryCornerDeg: 50,
  safetyThreshold: 0.35,
  wPot: 0.45,
  wPos: 0.55,
  bonusCenter: 0.03,
  bonusMidPower: 0.02,
  penSide: 0.08,
  penMaxPower: 0.05,
  penExtraContact: 0.05,
  penNearRail: 0.03,
  scratchPerturbFactor: 0.5,
  diversityDist: 0.25,
};

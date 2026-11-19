export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };
export type GameMode = '9' | '10';
/** id 0 is the cue ball. */
export type BallPos = { id: number; pos: Vec2 };
export type Layout = { mode: GameMode; balls: BallPos[] };
/** B/T = bottom (y=0) / top (y=W); L/R = x=0 / x=L; S = side pocket. */
export type PocketId = 'BL' | 'BR' | 'TL' | 'TR' | 'SB' | 'ST';
export type TipName = 'center' | 'high' | 'low' | 'left' | 'right';
/** Tip offset as a fraction of the ball radius, each in [-0.5, 0.5]. */
export type Tip = { side: number; vert: number };
/** dir is in radians from +x. speed in m/s. */
export type Shot = { dir: number; speed: number; tip: Tip };
export type ClothSpeed = 'fast' | 'medium' | 'slow';
export type SimEvent = {
  t: number;
  type: 'ball' | 'cushion' | 'pocket';
  ball: number;
  other?: number;
  pocket?: PocketId;
  pos: Vec2;
};
export type SimResult = {
  events: SimEvent[];
  /** Polyline per ball that moved. */
  paths: Record<number, Vec2[]>;
  /** Timestamps matching each point of `paths`. */
  times: Record<number, number[]>;
  /** Balls still on the table. */
  final: BallPos[];
  pocketed: { id: number; pocket: PocketId }[];
  /** First ball the cue ball touched. */
  firstContact: number | null;
  cueScratched: boolean;
  /** Any ball hit a cushion after the first contact. */
  railAfterContact: boolean;
  /** Every ball the cue ball touched, in order. */
  cueTouched: number[];
  duration: number;
};
export type PowerLevel = 1 | 2 | 3 | 4 | 5;
export type Suggestion = {
  kind: 'pot' | 'safety' | 'kick';
  targetId: number;
  pocket?: PocketId;
  shot: Shot;
  tipName: TipName;
  powerLevel: PowerLevel;
  /** 0..1 (0 for safety/kick). */
  potProb: number;
  /** 0..1 */
  posQuality: number;
  score: number;
  ghost: Vec2 | null;
  /** Nominal simulation. */
  sim: SimResult;
  /** Cue ball final positions at 0.9x, 1x, 1.1x speed. */
  stopZone: Vec2[];
  text: string;
};
export type AdviceResult =
  | { status: 'no-cue' }
  | { status: 'no-target' }
  | { status: 'ok'; targetId: number; suggestions: Suggestion[] };

/** Ball sets and cloths people actually play with: what they are called and how they are painted. */

export type BallSetId = 'standard' | 'protv' | 'arcos' | 'black' | 'tvdark';
export type BallSetChoice = BallSetId | 'auto';

export type BallSet = {
  id: BallSetId;
  name: string;
  note: string;
  /** Colours of 0 to 8; a stripe has the colour of the solid eight below it. */
  paint: string[];
  /** Stripes are banded with black rather than white. */
  darkStripes: boolean;
};

export const BALL_SETS: BallSet[] = [
  {
    id: 'standard',
    name: 'Truyền thống',
    note: '4 tím, 5 cam, 7 đỏ rượu. Đa số bộ bi: Aramith Premier, Tournament, Super Pro…',
    paint: ['#f6f2e6', '#f2c230', '#2463c4', '#d5362f', '#6d41a6', '#ef7f1f', '#1f8f4f', '#8a2433', '#17181a'],
    darkStripes: false,
  },
  {
    id: 'protv',
    name: 'TV Pro-Cup',
    note: '4 hồng, 5 cam, 7 nâu nhạt, sọc trắng. Aramith Pro-Cup TV, Super Pro TV.',
    paint: ['#f6f2e6', '#f2c230', '#2463c4', '#d5362f', '#f2829c', '#ef7f1f', '#1f8f4f', '#b07d4a', '#17181a'],
    darkStripes: false,
  },
  {
    id: 'arcos',
    name: 'Arcos II / Palladium',
    note: '4 tím nhạt, 5 cam đỏ, 7 nâu, sọc trắng. Predator Arcos II, Dynaspheres Palladium TV.',
    paint: ['#f6f2e6', '#f7bd22', '#0d69ae', '#e02337', '#8a5c96', '#f2561f', '#0b7a50', '#94500f', '#17181a'],
    darkStripes: false,
  },
  {
    id: 'black',
    name: 'Tournament Black',
    note: '4 hồng, 5 tím, 6 xanh tươi, 7 nâu, sọc đen. Aramith, dùng ở World Nineball Tour.',
    paint: ['#f6f2e6', '#feb501', '#0e57ad', '#ea1216', '#fe677f', '#7a58ac', '#05a06e', '#a54a0c', '#17181a'],
    darkStripes: true,
  },
  {
    id: 'tvdark',
    name: 'TV sọc đen, 5 cam',
    note: '4 hồng, 5 cam đỏ, 6 xanh đậm, 7 nâu, sọc đen.',
    paint: ['#f6f2e6', '#f4b93a', '#2f6fd0', '#c82a33', '#f58ba0', '#f4612a', '#115c48', '#a5733f', '#17181a'],
    darkStripes: true,
  },
];

export const ballSet = (id: BallSetChoice): BallSet => BALL_SETS.find((s) => s.id === id) ?? BALL_SETS[0];

/** How a ball is drawn; `band` is the colour of a stripe's two caps. */
export function ballPaint(id: number, choice: BallSetChoice = 'auto'): { fill: string; stripe: boolean; band: string } {
  const set = ballSet(choice);
  return { fill: set.paint[id > 8 ? id - 8 : id] ?? '#888', stripe: id >= 9, band: set.darkStripes ? '#17181a' : '#f6f2e6' };
}

/** Lettering that can be read on that colour. */
export function inkOn(fill: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
  return 0.3 * r + 0.59 * g + 0.11 * b > 118 ? '#17181a' : '#fff';
}

export type FeltId = 'green' | 'teal' | 'blue' | 'navy' | 'grey' | 'slate' | 'red' | 'camel' | 'purple' | 'black';
export type FeltChoice = FeltId | 'auto';

export type Felt = {
  id: FeltId;
  name: string;
  bed: string;
  cushion: string;
  /** What it may look like in a photo: hue in degrees (from, to, going up), saturation, brightness. */
  hue: [number, number] | null;
  sat: [number, number];
  lum: [number, number];
};

export const FELTS: Felt[] = [
  { id: 'green', name: 'Xanh lá', bed: '#1b7d57', cushion: '#23936a', hue: [85, 165], sat: [0.22, 1], lum: [0.05, 0.75] },
  { id: 'teal', name: 'Xanh ngọc', bed: '#12807f', cushion: '#1a9594', hue: [155, 198], sat: [0.22, 1], lum: [0.05, 0.8] },
  { id: 'blue', name: 'Xanh dương', bed: '#2a73b5', cushion: '#3787cb', hue: [188, 232], sat: [0.25, 1], lum: [0.1, 0.9] },
  { id: 'navy', name: 'Xanh đậm', bed: '#23407e', cushion: '#2d4f97', hue: [205, 255], sat: [0.25, 1], lum: [0.03, 0.5] },
  { id: 'grey', name: 'Xám', bed: '#7f868a', cushion: '#92999d', hue: null, sat: [0, 0.26], lum: [0.28, 0.95] },
  { id: 'slate', name: 'Xám đậm', bed: '#4b5256', cushion: '#5a6266', hue: null, sat: [0, 0.3], lum: [0.07, 0.42] },
  { id: 'red', name: 'Đỏ', bed: '#9c2231', cushion: '#b22c3c', hue: [335, 378], sat: [0.35, 1], lum: [0.05, 0.6] },
  { id: 'camel', name: 'Nâu be', bed: '#b08d5d', cushion: '#c09d6c', hue: [14, 56], sat: [0.16, 0.75], lum: [0.14, 0.9] },
  { id: 'purple', name: 'Tím', bed: '#5b3a86', cushion: '#6b479b', hue: [250, 325], sat: [0.18, 1], lum: [0.04, 0.6] },
  { id: 'black', name: 'Đen', bed: '#2b2e30', cushion: '#383c3e', hue: null, sat: [0, 0.4], lum: [0.015, 0.17] },
];

export const felt = (choice: FeltChoice): Felt => FELTS.find((f) => f.id === choice) ?? FELTS[0];

/** What the player has said their table and balls are. */
export type Equipment = { felt: FeltChoice; balls: BallSetChoice };
export const PLAIN: Equipment = { felt: 'auto', balls: 'auto' };

/** Never throws; anything not recognised is left to the app to find out. */
export function readEquipment(o: unknown): Equipment {
  const e = o as Partial<Equipment> | null | undefined;
  return {
    felt: FELTS.some((f) => f.id === e?.felt) ? e!.felt! : 'auto',
    balls: BALL_SETS.some((s) => s.id === e?.balls) ? e!.balls! : 'auto',
  };
}

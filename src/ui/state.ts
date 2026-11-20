import { POWER_SPEEDS } from '../core/config';
import { decodeLayout, encodeLayout, randomLayout } from '../core/layoutCodec';
import { ballIdsForMode, placeBall } from '../core/table';
import { clampTip, customShot } from '../core/custom';
import type { AdviceResult, ClothSpeed, GameMode, Layout, PocketId, Suggestion, Tip, Vec2 } from '../core/types';
import type { AdvisorClient } from '../worker/client';

export type Potted = { id: number; pocket: PocketId };
export type AppState = {
  layout: Layout;
  cloth: ClothSpeed;
  advice: AdviceResult | null;
  selected: number;
  computing: boolean;
  /** Balls pocketed by shots played in this run, shown resting in their pockets. */
  potted: Potted[];
  /** How many played shots can be undone. */
  steps: number;
  /** The player's own tip position and power, tried on the line of the selected suggestion. */
  custom: { base: Suggestion; tip: Tip; power: number; /** Cue direction set by hand, or null to aim automatically. */ aim: number | null; sug: Suggestion } | null;
};

/** The shot drawn on the table: the hand-set one while it is open, otherwise the selected suggestion. */
export function activeSuggestion(s: AppState): Suggestion | null {
  if (s.custom) return s.custom.sug;
  if (!s.advice || s.advice.status !== 'ok') return null;
  return s.advice.suggestions[s.selected] ?? null;
}

export type Store = {
  get(): AppState;
  subscribe(fn: (s: AppState) => void): () => void;
  /** Replace the whole layout (also the hook for photo import). */
  setLayout(l: Layout): void;
  moveBall(id: number, wanted: Vec2): void;
  toggleBall(id: number): void;
  setMode(m: GameMode): void;
  setCloth(c: ClothSpeed): void;
  select(i: number): void;
  /** Play suggestion i: balls go where the simulation left them and advice is requested for the next ball. */
  applySuggestion(i: number): void;
  /** Go back to the position before the last played shot. */
  undo(): void;
  /** Start a hand-set shot from the selected suggestion's tip and power. */
  openCustom(): void;
  setCustom(patch: { tip?: Tip; power?: number; aim?: number | null }): void;
  closeCustom(): void;
  /** Play the hand-set shot, fouls and misses included. */
  applyCustom(): void;
  /** Put back a saved table and reopen its hand-set shot. */
  openSaved(r: { layout: Layout; cloth: ClothSpeed; base: Suggestion; tip: Tip; power: number; aim: number | null }): void;
  clear(): void;
  randomize(): void;
  /** Result from the advisor; ignored unless it was computed for the current layout. */
  receive(r: AdviceResult, layout: Layout): void;
};

export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export const STORAGE_KEY = 'billiard-coach:v1';
export const SAMPLE_LAYOUT = 'm9;0:635,635;1:1700,800;2:2100,400;3:900,300';
const DEBOUNCE_MS = 150;
const CLOTHS: ClothSpeed[] = ['fast', 'medium', 'slow'];

/** URL hash first, then what was saved on this device, then a sample position. Never throws. */
export function loadInitial(hash: string, storage: StorageLike | null): { layout: Layout; cloth: ClothSpeed } {
  let cloth: ClothSpeed = 'medium';
  let saved: Layout | null = null;
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (CLOTHS.includes(o?.cloth)) cloth = o.cloth;
      if (typeof o?.layout === 'string') {
        const l = decodeLayout(o.layout);
        if (l.balls.length > 0) saved = l;
      }
    }
  } catch {
    // unreadable storage: fall through to the sample
  }
  let fromHash: Layout | null = null;
  try {
    const l = decodeLayout(decodeURIComponent(hash.replace(/^#/, '')));
    if (l.balls.length > 0) fromHash = l;
  } catch {
    // malformed escape sequence in the URL
  }
  return { layout: fromHash ?? saved ?? decodeLayout(SAMPLE_LAYOUT), cloth };
}

export function createStore(
  client: AdvisorClient,
  env: { storage: StorageLike | null; initial: { layout: Layout; cloth: ClothSpeed }; setHash?: (code: string) => void },
): Store {
  let state: AppState = { layout: env.initial.layout, cloth: env.initial.cloth, advice: null, selected: 0, computing: true, potted: [], steps: 0, custom: null };
  let history: { layout: Layout; potted: Potted[] }[] = [];
  const subs = new Set<(s: AppState) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emit = () => subs.forEach((fn) => fn(state));
  // Runs from the debounced path only: browsers throttle history.replaceState (Safari throws
  // after 100 calls in a short window), and a drag fires far more pointer moves than that.
  const persist = () => {
    const code = encodeLayout(state.layout);
    try {
      env.storage?.setItem(STORAGE_KEY, JSON.stringify({ layout: code, cloth: state.cloth }));
    } catch {
      // storage full or blocked: the position still lives in the URL
    }
    try {
      env.setHash?.(code);
    } catch {
      // history throttled or unavailable: the position is still saved on the device
    }
  };
  const requestNow = (save = true) => {
    timer = null;
    if (save) persist();
    client.request(state.layout, { cloth: state.cloth });
  };
  const changed = (layout: Layout, cloth = state.cloth, potted: Potted[] = state.potted) => {
    state = { layout, cloth, advice: null, selected: 0, computing: true, potted, steps: history.length, custom: null };
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => requestNow(), DEBOUNCE_MS);
    emit();
  };

  /** A new position from outside the current run: nothing is potted and there is nothing to undo. */
  const fresh = (layout: Layout) => {
    history = [];
    changed(layout, state.cloth, []);
  };

  const play = (sug: Suggestion) => {
    history.push({ layout: state.layout, potted: state.potted });
    const balls = sug.sim.final.map((b) => ({ id: b.id, pos: { x: b.pos.x, y: b.pos.y } })).sort((a, b) => a.id - b.id);
    const sunk = sug.sim.pocketed.filter((p) => p.id !== 0 && !state.potted.some((q) => q.id === p.id));
    changed({ mode: state.layout.mode, balls }, state.cloth, [...state.potted, ...sunk]);
  };
  const setCustomShot = (base: Suggestion, tipWanted: Tip, powerWanted: number, aim: number | null) => {
    const tip = clampTip(tipWanted);
    const power = Math.max(1, Math.min(POWER_SPEEDS.length, powerWanted));
    state = { ...state, custom: { base, tip, power, aim, sug: customShot(state.layout, base, tip, power, state.cloth, aim) } };
    emit();
  };

  const defaultSpot = (id: number): Vec2 => (id === 0 ? { x: 0.635, y: 0.635 } : { x: 1.2 + (id - 1) * 0.07, y: 0.635 });

  const store: Store = {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    setLayout: (l) => fresh(l),
    moveBall(id, wanted) {
      if (!state.layout.balls.some((b) => b.id === id)) return;
      const pos = placeBall(state.layout, id, wanted);
      changed({ mode: state.layout.mode, balls: state.layout.balls.map((b) => (b.id === id ? { id, pos } : b)) });
    },
    toggleBall(id) {
      if (!ballIdsForMode(state.layout.mode).includes(id)) return;
      const { mode, balls } = state.layout;
      if (balls.some((b) => b.id === id)) changed({ mode, balls: balls.filter((b) => b.id !== id) });
      else {
        const pos = placeBall(state.layout, id, defaultSpot(id));
        changed({ mode, balls: [...balls, { id, pos }].sort((a, b) => a.id - b.id) }, state.cloth, state.potted.filter((p) => p.id !== id));
      }
    },
    setMode(mode) {
      if (mode === state.layout.mode) return;
      const allowed = ballIdsForMode(mode);
      fresh({ mode, balls: state.layout.balls.filter((b) => allowed.includes(b.id)) });
    },
    setCloth(c) {
      if (c !== state.cloth) changed(state.layout, c);
    },
    select(i) {
      state = { ...state, selected: i, custom: null };
      emit();
    },
    clear: () => fresh({ mode: state.layout.mode, balls: [] }),
    randomize: () => fresh(randomLayout(state.layout.mode)),
    applySuggestion(i) {
      if (!state.advice || state.advice.status !== 'ok') return;
      const sug = state.advice.suggestions[i];
      if (sug) play(sug);
    },
    openCustom() {
      const base = activeSuggestion({ ...state, custom: null });
      if (base) setCustomShot(base, base.shot.tip, base.powerLevel, null);
    },
    setCustom(patch) {
      const c = state.custom;
      if (c) setCustomShot(c.base, patch.tip ?? c.tip, patch.power ?? c.power, patch.aim === undefined ? c.aim : patch.aim);
    },
    closeCustom() {
      if (!state.custom) return;
      state = { ...state, custom: null };
      emit();
    },
    applyCustom() {
      if (state.custom) play(state.custom.sug);
    },
    openSaved(r) {
      history = [];
      changed(r.layout, r.cloth, []);
      setCustomShot(r.base, r.tip, r.power, r.aim);
    },
    undo() {
      const prev = history.pop();
      if (prev) changed(prev.layout, state.cloth, prev.potted);
    },
    receive(r, layout) {
      if (encodeLayout(layout) !== encodeLayout(state.layout) || timer !== null) return;
      state = { ...state, advice: r, selected: 0, computing: false };
      emit();
    },
  };

  requestNow(false);
  return store;
}

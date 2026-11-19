import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TABLE } from '../core/config';
import { decodeLayout, encodeLayout } from '../core/layoutCodec';
import type { AdviceResult, Layout } from '../core/types';
import { dist, v2 } from '../core/vec';
import type { AdvisorClient } from '../worker/client';
import { SAMPLE_LAYOUT, STORAGE_KEY, createStore, loadInitial } from './state';

const fakeStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const setup = (code = 'm9;0:635,635;1:1700,800') => {
  const requests: Layout[] = [];
  const client: AdvisorClient = { request: (l) => void requests.push(l), dispose: () => {} };
  const storage = fakeStorage();
  const hashes: string[] = [];
  const store = createStore(client, { storage, initial: { layout: decodeLayout(code), cloth: 'medium' }, setHash: (h) => void hashes.push(h) });
  return { requests, storage, hashes, store };
};
const res: AdviceResult = { status: 'ok', targetId: 1, suggestions: [] };

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

test('advice is requested once at start-up', () => {
  const { requests, store } = setup();
  vi.advanceTimersByTime(200);
  expect(requests).toHaveLength(1);
  expect(store.get().computing).toBe(true);
});
test('moving a ball clears advice, persists, and requests advice once after 150 ms', () => {
  const { requests, storage, hashes, store } = setup();
  vi.advanceTimersByTime(200);
  store.receive(res, requests[0]);
  expect(store.get().advice).toEqual(res);
  expect(store.get().computing).toBe(false);
  store.moveBall(1, v2(1.0, 0.5));
  store.moveBall(1, v2(1.1, 0.5));
  store.moveBall(1, v2(1.2, 0.5));
  expect(store.get().advice).toBeNull();
  expect(store.get().computing).toBe(true);
  vi.advanceTimersByTime(149);
  expect(requests).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(requests).toHaveLength(2);
  const code = encodeLayout(store.get().layout);
  expect(code).toBe('m9;0:635,635;1:1200,500');
  expect(JSON.parse(storage.getItem(STORAGE_KEY)!).layout).toBe(code);
  expect(hashes[hashes.length - 1]).toBe(code);
});
test('a result for an older layout is ignored', () => {
  const { requests, store } = setup();
  vi.advanceTimersByTime(200);
  const old = requests[0];
  store.moveBall(1, v2(1.0, 0.5));
  store.receive(res, old);
  expect(store.get().advice).toBeNull();
  expect(store.get().computing).toBe(true);
});
test('switching to 9-ball removes the 10', () => {
  const { store } = setup('m10;0:635,635;10:1700,800;3:500,500');
  store.setMode('9');
  expect(store.get().layout.mode).toBe('9');
  expect(store.get().layout.balls.map((b) => b.id)).toEqual([0, 3]);
});
test('toggleBall adds at a legal default spot and removes on second call', () => {
  const { store } = setup('m9;0:635,635;1:1200,635');
  store.toggleBall(2);
  const balls = store.get().layout.balls;
  expect(balls.map((b) => b.id)).toEqual([0, 1, 2]);
  for (const a of balls) for (const b of balls) if (a.id < b.id) expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(2 * TABLE.R);
  store.toggleBall(2);
  expect(store.get().layout.balls.map((b) => b.id)).toEqual([0, 1]);
});
test('toggleBall ignores ids outside the mode', () => {
  const { store } = setup();
  store.toggleBall(10);
  store.toggleBall(42);
  expect(store.get().layout.balls.map((b) => b.id)).toEqual([0, 1]);
});
test('moveBall keeps the ball legal', () => {
  const { store } = setup();
  store.moveBall(1, v2(0.64, 0.635));
  const [cue, one] = store.get().layout.balls;
  expect(dist(cue.pos, one.pos)).toBeGreaterThanOrEqual(2 * TABLE.R);
});
test('subscribers are told about changes and select() picks a card', () => {
  const { store } = setup();
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.select(2);
  expect(store.get().selected).toBe(2);
  expect(calls).toBe(1);
  off();
  store.select(0);
  expect(calls).toBe(1);
});
test('a new result selects the first card', () => {
  const { requests, store } = setup();
  vi.advanceTimersByTime(200);
  store.select(2);
  store.receive(res, requests[0]);
  expect(store.get().selected).toBe(0);
});
test('loadInitial prefers the URL, then storage, then the sample; garbage never yields an empty screen', () => {
  const storage = fakeStorage();
  expect(encodeLayout(loadInitial('', storage).layout)).toBe(SAMPLE_LAYOUT);
  storage.setItem(STORAGE_KEY, JSON.stringify({ layout: 'm9;0:500,500;4:900,900', cloth: 'fast' }));
  expect(encodeLayout(loadInitial('', storage).layout)).toBe('m9;0:500,500;4:900,900');
  expect(loadInitial('', storage).cloth).toBe('fast');
  expect(encodeLayout(loadInitial('#m10;0:100,100;10:900,900', storage).layout)).toBe('m10;0:100,100;10:900,900');
  expect(encodeLayout(loadInitial('#%%%garbage', storage).layout)).toBe('m9;0:500,500;4:900,900');
  storage.setItem(STORAGE_KEY, '{not json');
  expect(encodeLayout(loadInitial('#???', storage).layout)).toBe(SAMPLE_LAYOUT);
  storage.setItem(STORAGE_KEY, JSON.stringify({ layout: 5, cloth: 'warp' }));
  expect(loadInitial('', storage).cloth).toBe('medium');
});

// --- final review, finding 1: persistence must not run per pointer move, nor break the drag ---
test('a burst of moves writes the URL and storage once, after the debounce', () => {
  const { hashes, storage, store } = setup();
  const before = hashes.length;
  for (let i = 0; i < 50; i++) store.moveBall(1, v2(1.0 + i * 0.01, 0.5));
  expect(hashes.length).toBe(before);
  vi.advanceTimersByTime(150);
  expect(hashes.length).toBe(before + 1);
  expect(hashes[hashes.length - 1]).toBe(encodeLayout(store.get().layout));
  expect(JSON.parse(storage.getItem(STORAGE_KEY)!).layout).toBe(encodeLayout(store.get().layout));
});
test('a throwing history or storage does not stop redraws or advice', () => {
  const requests: Layout[] = [];
  const client: AdvisorClient = { request: (l) => void requests.push(l), dispose: () => {} };
  const storage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const store = createStore(client, {
    storage,
    initial: { layout: decodeLayout('m9;0:635,635;1:1700,800'), cloth: 'medium' },
    setHash: () => { throw new Error('SecurityError'); },
  });
  let emitted = 0;
  store.subscribe(() => emitted++);
  store.moveBall(1, v2(1.0, 0.5));
  expect(emitted).toBe(1);
  vi.advanceTimersByTime(150);
  expect(requests).toHaveLength(2);
  expect(encodeLayout(requests[1])).toBe('m9;0:635,635;1:1000,500');
});

// --- playing a suggestion and stepping through a run-out ---
import { advise } from '../core/advisor';

const playable = () => {
  const s = setup('m9;0:1900,800;1:2250,1030;2:1000,400');
  vi.advanceTimersByTime(200);
  const advice = advise(s.requests[0], { cloth: 'medium' });
  s.store.receive(advice, s.requests[0]);
  if (advice.status !== 'ok') throw new Error('expected advice');
  return { ...s, advice };
};

test('playing a suggestion moves the cue ball to where it stops, leaves the potted ball in its pocket, and asks for the next ball', () => {
  const { store, advice, requests } = playable();
  const sug = advice.suggestions[0];
  store.applySuggestion(0);
  const st = store.get();
  expect(st.layout.balls.map((b) => b.id)).toEqual([0, 2]);
  const cueEnd = sug.sim.final.find((b) => b.id === 0)!.pos;
  expect(st.layout.balls[0].pos.x).toBeCloseTo(cueEnd.x, 6);
  expect(st.layout.balls[0].pos.y).toBeCloseTo(cueEnd.y, 6);
  expect(st.potted).toEqual([{ id: 1, pocket: 'TR' }]);
  expect(st.steps).toBe(1);
  expect(st.advice).toBeNull();
  vi.advanceTimersByTime(150);
  expect(requests[requests.length - 1].balls.map((b) => b.id)).toEqual([0, 2]);
});
test('undo returns to the position before the shot so another option can be chosen', () => {
  const { store } = playable();
  const before = encodeLayout(store.get().layout);
  store.applySuggestion(0);
  store.undo();
  expect(encodeLayout(store.get().layout)).toBe(before);
  expect(store.get().potted).toEqual([]);
  expect(store.get().steps).toBe(0);
  store.undo(); // nothing left to undo: no-op
  expect(encodeLayout(store.get().layout)).toBe(before);
});
test('applySuggestion without advice, or with a bad index, does nothing', () => {
  const { store } = setup();
  store.applySuggestion(0);
  expect(store.get().steps).toBe(0);
  const p = playable();
  p.store.applySuggestion(7);
  expect(p.store.get().steps).toBe(0);
});
test('putting a potted ball back on the table takes it out of the pocket', () => {
  const { store } = playable();
  store.applySuggestion(0);
  store.toggleBall(1);
  expect(store.get().potted).toEqual([]);
  expect(store.get().layout.balls.map((b) => b.id)).toEqual([0, 1, 2]);
});
test('dragging a ball mid run keeps the potted balls and the ability to undo', () => {
  const { store } = playable();
  store.applySuggestion(0);
  store.moveBall(2, v2(1.1, 0.5));
  expect(store.get().potted).toHaveLength(1);
  expect(store.get().steps).toBe(1);
});
test('clearing, shuffling, switching mode or loading a layout starts a fresh run', () => {
  for (const reset of [(s: ReturnType<typeof playable>['store']) => s.clear(), (s: ReturnType<typeof playable>['store']) => s.randomize(), (s: ReturnType<typeof playable>['store']) => s.setMode('10'), (s: ReturnType<typeof playable>['store']) => s.setLayout(decodeLayout('m9;0:500,500;3:900,900'))]) {
    const { store } = playable();
    store.applySuggestion(0);
    reset(store);
    expect(store.get().potted).toEqual([]);
    expect(store.get().steps).toBe(0);
  }
});

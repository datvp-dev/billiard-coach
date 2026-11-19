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

import { expect, test } from 'vitest';
import { advise } from '../core/advisor';
import { customShot } from '../core/custom';
import { decodeLayout } from '../core/layoutCodec';
import type { AppState } from './state';
import { MAX_SAVED, SAVED_KEY, addSaved, loadSaved, removeSaved, restoreSaved, savedTitle, snapshotShot, storeSaved } from './saved';

const layout = decodeLayout('m9;0:635,635;1:1700,800;2:2100,400');
const advice = advise(layout, { cloth: 'medium' });
if (advice.status !== 'ok') throw new Error('expected advice');
const base = advice.suggestions[0];
const stateWith = (tip = { side: 0.2, vert: -0.3 }, power = 3.5, aim: number | null = null): AppState => ({
  layout,
  cloth: 'medium',
  advice,
  selected: 0,
  computing: false,
  potted: [],
  steps: 0,
  custom: { base, tip, power, aim, sug: customShot(layout, base, tip, power, 'medium', aim) },
});
const fakeStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test('nothing to save while no hand-set shot is open', () => {
  expect(snapshotShot({ ...stateWith(), custom: null }, 1000)).toBeNull();
});
test('a saved shot survives storage and comes back as the same shot on the same table', () => {
  const s = stateWith();
  const shot = snapshotShot(s, 1000)!;
  const storage = fakeStorage();
  storeSaved(storage, [shot]);
  const [back] = loadSaved(storage);
  expect(back).toEqual(shot);
  const r = restoreSaved(back)!;
  expect(r.layout).toEqual(layout);
  expect(r.cloth).toBe('medium');
  expect(r.tip).toEqual({ side: 0.2, vert: -0.3 });
  expect(r.power).toBe(3.5);
  expect(r.aim).toBeNull();
  const again = customShot(r.layout, r.base, r.tip, r.power, r.cloth, r.aim);
  expect(again.shot.dir).toBeCloseTo(s.custom!.sug.shot.dir, 9);
  expect(again.text).toBe(s.custom!.sug.text);
});
test('a hand-turned cue keeps its exact direction', () => {
  const s = stateWith({ side: 0, vert: 0 }, 2, 0.4321);
  const r = restoreSaved(snapshotShot(s, 5)!)!;
  expect(r.aim).toBe(0.4321);
  expect(customShot(r.layout, r.base, r.tip, r.power, r.cloth, r.aim).shot.dir).toBe(0.4321);
});
test('newest first, the same shot is not stored twice, and the list is capped', () => {
  const a = snapshotShot(stateWith(), 1)!;
  const b = snapshotShot(stateWith({ side: 0, vert: 0.4 }), 2)!;
  let list = addSaved(addSaved([], a), b);
  expect(list.map((x) => x.at)).toEqual([2, 1]);
  list = addSaved(list, snapshotShot(stateWith(), 3)!);
  expect(list.map((x) => x.at)).toEqual([3, 2]);
  for (let i = 0; i < MAX_SAVED + 5; i++) list = addSaved(list, snapshotShot(stateWith({ side: 0, vert: 0 }, 1 + (i % 11) * 0.5, i), 10 + i)!);
  expect(list).toHaveLength(MAX_SAVED);
  expect(removeSaved(list, list[0].id)).toHaveLength(MAX_SAVED - 1);
});
test('unreadable or malformed storage gives an empty list, bad entries are dropped', () => {
  const storage = fakeStorage();
  expect(loadSaved(storage)).toEqual([]);
  expect(loadSaved(null)).toEqual([]);
  storage.setItem(SAVED_KEY, '{not json');
  expect(loadSaved(storage)).toEqual([]);
  const good = snapshotShot(stateWith(), 7)!;
  storage.setItem(SAVED_KEY, JSON.stringify([good, { id: 'x' }, null, { ...good, id: 'y', tip: { side: 'a', vert: 0 } }, { ...good, id: 'z', layout: 'm9;1:500,500' }]));
  expect(loadSaved(storage)).toEqual([good]);
});
test('a shot whose balls are no longer in the stored layout cannot be restored', () => {
  const shot = snapshotShot(stateWith(), 1)!;
  expect(restoreSaved({ ...shot, layout: 'm9;0:635,635;2:2100,400' })).toBeNull();
});
test('the list names the ball, the tip and the power', () => {
  expect(savedTitle(snapshotShot(stateWith(), 1)!)).toBe('Bi 1 · thấp 60%, phải 40% · lực vừa đến hơi mạnh');
  expect(savedTitle(snapshotShot(stateWith({ side: 0, vert: 0 }, 2, 0.4), 1)!)).toBe('Bi 1 · giữa bi · lực nhẹ · tự xoay cơ');
});

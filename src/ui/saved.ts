import { clampTip, customShot } from '../core/custom';
import { POWER_SPEEDS } from '../core/config';
import { describeTip, powerLabel } from '../core/explain';
import { decodeLayout, encodeLayout } from '../core/layoutCodec';
import { POCKET_IDS } from '../core/table';
import type { ClothSpeed, Layout, PocketId, Suggestion, Tip, Vec2 } from '../core/types';
import type { AppState, StorageLike } from './state';

/** A hand-set shot together with the table it was set on, kept on this device. */
export type SavedShot = {
  id: string;
  /** When it was saved, ms since the epoch. */
  at: number;
  /** Encoded layout, as in the URL. */
  layout: string;
  cloth: ClothSpeed;
  /** The suggestion the shot was tuned from: enough to aim it again. */
  base: { kind: Suggestion['kind']; targetId: number; pocket?: PocketId; dir: number; tip: Tip; power: number; posQuality: number; ghost: Vec2 | null };
  tip: Tip;
  power: number;
  /** Cue direction set by hand, or null when the shot is aimed automatically. */
  aim: number | null;
  /** What the simulation said about the shot when it was saved. */
  text: string;
};

export const SAVED_KEY = 'billiard-coach:saved:v1';
export const MAX_SAVED = 50;

const CLOTHS: ClothSpeed[] = ['fast', 'medium', 'slow'];
const KINDS: Suggestion['kind'][] = ['pot', 'safety', 'kick'];
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isTip = (t: unknown): t is Tip => !!t && num((t as Tip).side) && num((t as Tip).vert);
const isPower = (p: unknown): p is number => num(p) && p >= 1 && p <= POWER_SPEEDS.length;

/** The open hand-set shot as a record to keep, or null when none is open. */
export function snapshotShot(s: AppState, at: number): SavedShot | null {
  const c = s.custom;
  if (!c) return null;
  const b = c.base;
  return {
    id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at,
    layout: encodeLayout(s.layout),
    cloth: s.cloth,
    base: { kind: b.kind, targetId: b.targetId, ...(b.pocket ? { pocket: b.pocket } : {}), dir: b.shot.dir, tip: { ...b.shot.tip }, power: b.powerLevel, posQuality: b.posQuality, ghost: b.ghost ? { x: b.ghost.x, y: b.ghost.y } : null },
    tip: { ...c.tip },
    power: c.power,
    aim: c.aim,
    text: c.sug.text,
  };
}

function valid(o: unknown): o is SavedShot {
  const s = o as SavedShot;
  if (!s || typeof s.id !== 'string' || !num(s.at) || typeof s.layout !== 'string' || !CLOTHS.includes(s.cloth)) return false;
  if (!isTip(s.tip) || !isPower(s.power) || !(s.aim === null || num(s.aim)) || typeof s.text !== 'string') return false;
  const b = s.base;
  if (!b || !KINDS.includes(b.kind) || !num(b.targetId) || !num(b.dir) || !isTip(b.tip) || !isPower(b.power) || !num(b.posQuality)) return false;
  if (b.pocket !== undefined && !POCKET_IDS.includes(b.pocket)) return false;
  if (!(b.ghost === null || (num(b.ghost?.x) && num(b.ghost?.y)))) return false;
  const balls = decodeLayout(s.layout).balls;
  return balls.some((x) => x.id === 0) && balls.some((x) => x.id === b.targetId);
}

/** Never throws; entries that cannot be used are dropped. */
export function loadSaved(storage: StorageLike | null): SavedShot[] {
  try {
    const raw = storage?.getItem(SAVED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(valid).slice(0, MAX_SAVED) : [];
  } catch {
    return [];
  }
}

/** False when the device refused to keep the list (storage full or blocked). */
export function storeSaved(storage: StorageLike | null, list: SavedShot[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVED_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

const sameShot = (a: SavedShot, b: SavedShot) =>
  a.layout === b.layout && a.cloth === b.cloth && a.power === b.power && a.aim === b.aim && a.tip.side === b.tip.side && a.tip.vert === b.tip.vert && a.base.kind === b.base.kind && a.base.pocket === b.base.pocket && a.base.targetId === b.base.targetId;

/** Newest first. Saving the same shot again moves it to the front instead of storing it twice. */
export function addSaved(list: SavedShot[], shot: SavedShot): SavedShot[] {
  return [shot, ...list.filter((x) => !sameShot(x, shot))].slice(0, MAX_SAVED);
}

export function removeSaved(list: SavedShot[], id: string): SavedShot[] {
  return list.filter((x) => x.id !== id);
}

export type Restored = { layout: Layout; cloth: ClothSpeed; base: Suggestion; tip: Tip; power: number; aim: number | null };

/** Table and shot settings to put back, or null when the record no longer fits its layout. */
export function restoreSaved(shot: SavedShot): Restored | null {
  if (!valid(shot)) return null;
  const layout = decodeLayout(shot.layout);
  const b = shot.base;
  const tip = clampTip(b.tip);
  const base = customShot(layout, { kind: b.kind, targetId: b.targetId, pocket: b.pocket, shot: { dir: b.dir, speed: 0, tip }, posQuality: b.posQuality, ghost: b.ghost }, tip, b.power, shot.cloth);
  return { layout, cloth: shot.cloth, base, tip: clampTip(shot.tip), power: shot.power, aim: shot.aim };
}

export function savedTitle(shot: SavedShot): string {
  return `Bi ${shot.base.targetId} · ${describeTip(shot.tip)} · lực ${powerLabel(shot.power)}${shot.aim === null ? '' : ' · tự xoay cơ'}`;
}

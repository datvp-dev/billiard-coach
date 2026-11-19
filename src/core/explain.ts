import { TABLE } from './config';
import type { PocketId, SimResult, Suggestion, TipName, Vec2 } from './types';

const LANDSCAPE: Record<PocketId, string> = {
  BL: 'lỗ góc dưới trái',
  BR: 'lỗ góc dưới phải',
  TL: 'lỗ góc trên trái',
  TR: 'lỗ góc trên phải',
  SB: 'lỗ giữa dưới',
  ST: 'lỗ giữa trên',
};
// Table drawn rotated a quarter turn clockwise (phone held upright).
const PORTRAIT: Record<PocketId, string> = {
  BL: 'lỗ góc trên trái',
  BR: 'lỗ góc dưới trái',
  TL: 'lỗ góc trên phải',
  TR: 'lỗ góc dưới phải',
  SB: 'lỗ giữa trái',
  ST: 'lỗ giữa phải',
};

/** Pocket name as the user sees it on screen. */
export function pocketName(id: PocketId, portrait = false): string {
  return (portrait ? PORTRAIT : LANDSCAPE)[id];
}

const TIP_LABELS: Record<TipName, string> = {
  center: 'giữa bi',
  high: 'cao',
  low: 'thấp',
  left: 'xoáy trái',
  right: 'xoáy phải',
};
export function tipLabel(t: TipName): string {
  return TIP_LABELS[t];
}

const POWER_LABELS = ['rất nhẹ', 'nhẹ', 'vừa', 'mạnh', 'rất mạnh'];
export function powerLabel(level: number): string {
  return POWER_LABELS[Math.max(1, Math.min(5, Math.round(level))) - 1];
}

export function potLabel(p: number): 'Dễ' | 'Trung bình' | 'Khó' {
  return p >= 0.7 ? 'Dễ' : p >= 0.4 ? 'Trung bình' : 'Khó';
}
export function posLabel(q: number): 'tốt' | 'tạm' | 'xấu' {
  return q >= 0.6 ? 'tốt' : q >= 0.3 ? 'tạm' : 'xấu';
}

/** Where the cue ball was at its first ball contact, and how many cushions it touched before/after. */
export function cueSummary(sim: SimResult): { contact: Vec2 | null; end: Vec2 | null; railsBefore: number; railsAfter: number; travelled: number } {
  const hit = sim.events.find((e) => e.type === 'ball' && (e.ball === 0 || e.other === 0));
  const path = sim.paths[0] ?? [];
  const times = sim.times[0] ?? [];
  let contact: Vec2 | null = null;
  let travelled = 0;
  if (hit) {
    let i = times.findIndex((t) => t >= hit.t);
    if (i < 0) i = path.length - 1;
    contact = path[i] ?? null;
    for (let k = i + 1; k < path.length; k++) travelled += Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y);
  }
  const endBall = sim.final.find((b) => b.id === 0);
  let railsBefore = 0;
  let railsAfter = 0;
  for (const e of sim.events) {
    if (e.type !== 'cushion' || e.ball !== 0) continue;
    if (hit && e.t > hit.t) railsAfter++;
    else railsBefore++;
  }
  return { contact, end: endBall ? endBall.pos : null, railsBefore, railsAfter, travelled };
}

const cm = (m: number) => Math.max(5, Math.round((m * 100) / 5) * 5);

/** One or two plain sentences describing what the simulation says will happen. */
export function explain(s: Omit<Suggestion, 'text'>, nextId: number | null): string {
  const c = cueSummary(s.sim);
  const power = powerLabel(s.powerLevel);
  if (s.kind === 'kick') {
    return `Bi ${s.targetId} bị che. Đánh ${Math.max(1, c.railsBefore)} băng để chạm bi, lực ${power}.`;
  }
  if (s.kind === 'safety') {
    const cue = s.sim.final.find((b) => b.id === 0)?.pos;
    const target = s.sim.final.find((b) => b.id === s.targetId)?.pos;
    const apart = cue && target ? Math.hypot(cue.x - target.x, cue.y - target.y) : 0;
    const hidden = s.posQuality >= 0.6;
    const thin = thickness(s);
    const tail = hidden ? `Bi ${s.targetId} bị che sau bi khác.` : `Hai bi cách nhau khoảng ${cm(apart)} cm.`;
    return `Đánh thủ: chạm ${thin} bi ${s.targetId}, lực ${power}. ${tail}`;
  }
  let cueSentence: string;
  if (!c.contact || !c.end || c.travelled < 0.15) cueSentence = 'Bi cái dừng gần chỗ chạm.';
  else if (c.railsAfter > 0) cueSentence = `Bi cái chạm ${c.railsAfter} băng, đi khoảng ${cm(c.travelled)} cm.`;
  else {
    const forward = (c.end.x - c.contact.x) * Math.cos(s.shot.dir) + (c.end.y - c.contact.y) * Math.sin(s.shot.dir) >= 0;
    cueSentence = forward ? `Bi cái lăn tới khoảng ${cm(c.travelled)} cm.` : `Bi cái lùi lại khoảng ${cm(c.travelled)} cm.`;
  }
  const nextSentence = nextId === null ? 'Đây là bi cuối.' : `Ra bi ${nextId}: ${posLabel(s.posQuality)}.`;
  return `Đánh ${tipLabel(s.tipName)}, lực ${power}. ${cueSentence} ${nextSentence}`;
}

function thickness(s: Omit<Suggestion, 'text'>): string {
  const cue = s.sim.paths[0]?.[0];
  const hit = s.sim.events.find((e) => e.type === 'ball' && (e.ball === 0 || e.other === 0));
  const target = s.ghost;
  if (!cue || !hit || !target) return 'mỏng';
  // `ghost` for a safety holds the target ball's starting position.
  const aim = Math.atan2(target.y - cue.y, target.x - cue.x);
  const off = Math.abs(Math.atan2(Math.sin(s.shot.dir - aim), Math.cos(s.shot.dir - aim)));
  const d = Math.hypot(target.x - cue.x, target.y - cue.y);
  return Math.sin(off) * d > TABLE.R ? 'mỏng' : 'dày';
}

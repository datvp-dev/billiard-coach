import { clampTip, MAX_TIP } from '../core/custom';
import { cueSummary, describeTip, pocketName, potLabel, powerLabel, tipLabel } from '../core/explain';
import { lagLengths, speedForPower } from '../core/power';
import type { AdviceResult, ClothSpeed, Suggestion, Tip } from '../core/types';
import { activeSuggestion, type AppState } from './state';

const RAIL_WORDS = ['Một', 'Hai', 'Ba', 'Bốn'];

export function cardTitle(s: Suggestion, portrait: boolean): string {
  if (s.kind === 'safety') return `Đánh thủ bi ${s.targetId}`;
  if (s.kind === 'kick') {
    const n = s.sim ? Math.max(1, cueSummary(s.sim).railsBefore) : 1;
    return `${RAIL_WORDS[n - 1] ?? n} băng chạm bi ${s.targetId}`;
  }
  return `Bi ${s.targetId} vào ${s.pocket ? pocketName(s.pocket, portrait) : 'lỗ'}`;
}

export function statusMessage(a: AdviceResult | null, computing: boolean, pottedCount = 0): string | null {
  if (computing || !a) return 'Đang tính…';
  if (a.status === 'no-cue') return 'Đặt bi cái lên bàn để nhận gợi ý.';
  if (a.status === 'no-target') return pottedCount > 0 ? 'Đã ăn hết bi. Bấm "Chọn lại" để thử cách đánh khác.' : 'Đặt ít nhất một bi số lên bàn.';
  if (a.suggestions.length === 0) return 'Không tìm được cú đánh hợp lệ. Thử chỉnh lại vị trí bi.';
  return null;
}

/** Power in words plus a way to find it on a real table: how far a rolling ball goes at that speed. */
export function powerText(level: number, cloth: ClothSpeed): string {
  const n = lagLengths(speedForPower(level), cloth).toFixed(1).replace(/\.0$/, '').replace('.', ',');
  return `Lực ${powerLabel(level)} · lăn ≈${n} bàn`;
}

/** Share of the pad's width taken by the ball radius. */
const PAD_BALL = 0.46;

/** Tip offset for a touch at (x, y) on a square pad of `size` px showing the cue ball from behind. */
export function padToTip(x: number, y: number, size: number): Tip {
  const snap = (v: number) => Math.round(v * 20) / 20 + 0;
  const raw = clampTip({ side: (x - size / 2) / (PAD_BALL * size), vert: -(y - size / 2) / (PAD_BALL * size) });
  return clampTip({ side: snap(raw.side), vert: snap(raw.vert) });
}

const SVG = 'http://www.w3.org/2000/svg';

/** Cue ball seen from behind, with a dot where the tip should strike. */
function tipIcon(s: Suggestion): SVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '48');
  svg.setAttribute('height', '48');
  svg.setAttribute('class', 'tip');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Đầu cơ: ${tipLabel(s.tipName)}`);
  const mk = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    svg.append(e);
  };
  mk('circle', { cx: 24, cy: 24, r: 21, fill: '#f6f2e6', stroke: '#9db0a5', 'stroke-width': 1.5 });
  mk('line', { x1: 24, y1: 6, x2: 24, y2: 42, stroke: '#c9c3b2', 'stroke-width': 1 });
  mk('line', { x1: 6, y1: 24, x2: 42, y2: 24, stroke: '#c9c3b2', 'stroke-width': 1 });
  mk('circle', { cx: 24 + s.shot.tip.side * 30, cy: 24 - s.shot.tip.vert * 30, r: 5, fill: '#2463c4', stroke: '#0e1512', 'stroke-width': 1 });
  return svg;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function buildCard(s: Suggestion, index: number, portrait: boolean, cloth: ClothSpeed, onSelect: (i: number) => void, onReplay: () => void, onPlay: (i: number) => void): HTMLElement {
  const card = h('div', 'card');
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.addEventListener('click', () => onSelect(index));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(index);
    }
  });
  card.append(tipIcon(s));

  const title = h('h3');
  if (index === 0) title.append(h('span', 'badge', 'Nên đánh'));
  title.append(cardTitle(s, portrait));
  card.append(title);

  const meta = h('div', 'meta');
  const power = h('span');
  const bars = h('span', 'power');
  for (let i = 1; i <= 6; i++) bars.append(h('i', i <= s.powerLevel ? 'on' : ''));
  power.append(bars, powerText(s.powerLevel, cloth));
  meta.append(power);
  if (s.kind === 'pot') {
    const label = potLabel(s.potProb);
    const pot = h('span');
    pot.append('Ăn bi ');
    pot.append(h('b', label === 'Dễ' ? 'easy' : label === 'Trung bình' ? 'mid' : 'hard', `${Math.round(s.potProb * 100)}% · ${label}`));
    meta.append(pot);
  }
  card.append(meta);
  card.append(h('p', '', s.text));

  const replay = h('button', 'replay', '▶');
  replay.type = 'button';
  replay.setAttribute('aria-label', 'Xem lại cú đánh');
  replay.addEventListener('click', (e) => {
    e.stopPropagation();
    onSelect(index);
    onReplay();
  });
  const play = h('button', 'play', 'Đánh');
  play.type = 'button';
  play.setAttribute('aria-label', 'Đánh cú này và xem gợi ý cho bi tiếp theo');
  play.addEventListener('click', (e) => {
    e.stopPropagation();
    onPlay(index);
  });
  card.append(replay, play);
  return card;
}

const NOTE = 'Đường bi là ước lượng. Nỉ và băng mỗi bàn một khác.';

type EditorHandlers = { custom(patch: { tip?: Tip; power?: number }): void; closeCustom(): void; playCustom(): void; replay(): void };

/** Cue ball to tap for the tip position, a power slider, and what the simulation says about that shot. */
function buildEditor(on: EditorHandlers): { root: HTMLElement; update(s: AppState): void } {
  const root = h('div', 'custom');
  const pad = document.createElementNS(SVG, 'svg');
  pad.setAttribute('viewBox', '0 0 100 100');
  pad.setAttribute('class', 'pad');
  pad.setAttribute('role', 'img');
  const mk = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    pad.append(e);
    return e;
  };
  const ballR = PAD_BALL * 100;
  mk('circle', { cx: 50, cy: 50, r: ballR, fill: '#f6f2e6', stroke: '#9db0a5', 'stroke-width': 1.5 });
  mk('circle', { cx: 50, cy: 50, r: MAX_TIP * ballR, fill: 'rgba(36,99,196,0.10)', stroke: '#2463c4', 'stroke-width': 0.8, 'stroke-dasharray': '3 2' });
  mk('line', { x1: 50, y1: 50 - ballR, x2: 50, y2: 50 + ballR, stroke: '#c9c3b2', 'stroke-width': 0.8 });
  mk('line', { x1: 50 - ballR, y1: 50, x2: 50 + ballR, y2: 50, stroke: '#c9c3b2', 'stroke-width': 0.8 });
  const dot = mk('circle', { cx: 50, cy: 50, r: 6, fill: '#2463c4', stroke: '#0e1512', 'stroke-width': 1 });

  const pick = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    const size = Math.min(r.width, r.height);
    if (size <= 0) return;
    on.custom({ tip: padToTip(e.clientX - r.left - (r.width - size) / 2, e.clientY - r.top - (r.height - size) / 2, size) });
  };
  let held = false;
  pad.addEventListener('pointerdown', (e) => {
    held = true;
    pad.setPointerCapture?.(e.pointerId);
    pick(e);
    e.preventDefault();
  });
  pad.addEventListener('pointermove', (e) => {
    if (held) pick(e);
  });
  const release = () => void (held = false);
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);

  const main = h('div', 'custom-main');
  const row = h('label', 'custom-power');
  const slider = h('input');
  slider.type = 'range';
  slider.min = '1';
  slider.max = '6';
  slider.step = '0.5';
  slider.setAttribute('aria-label', 'Lực đánh');
  slider.addEventListener('input', () => on.custom({ power: Number(slider.value) }));
  const powerOut = h('span');
  row.append(slider, powerOut);
  const result = h('p', 'custom-text');
  const actions = h('div', 'custom-actions');
  const btn = (cls: string, text: string, label: string, fn: () => void) => {
    const b = h('button', cls, text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    actions.append(b);
  };
  btn('ghost', '▶ Xem', 'Xem cú đánh này', () => on.replay());
  btn('primary', 'Đánh', 'Đánh cú này và xem gợi ý cho bi tiếp theo', () => on.playCustom());
  btn('ghost', 'Giữa bi', 'Đưa điểm chạm về giữa bi', () => on.custom({ tip: { side: 0, vert: 0 } }));
  btn('ghost', 'Đóng', 'Quay lại các gợi ý', () => on.closeCustom());
  main.append(row, result, actions);
  root.append(pad, main);

  return {
    root,
    update(s) {
      const c = s.custom;
      if (!c) return;
      dot.setAttribute('cx', String(50 + c.tip.side * ballR));
      dot.setAttribute('cy', String(50 - c.tip.vert * ballR));
      pad.setAttribute('aria-label', `Điểm chạm bi cái: ${describeTip(c.tip)}. Chạm để chọn.`);
      if (Number(slider.value) !== c.power) slider.value = String(c.power);
      powerOut.textContent = powerText(c.power, s.cloth);
      result.replaceChildren();
      if (c.sug.kind === 'pot' && c.sug.potProb > 0) {
        const label = potLabel(c.sug.potProb);
        result.append(h('b', label === 'Dễ' ? 'easy' : label === 'Trung bình' ? 'mid' : 'hard', `Ăn bi ${Math.round(c.sug.potProb * 100)}% · ${label}. `));
      }
      result.append(c.sug.text);
    },
  };
}

/**
 * Renders the run bar (undo + note) and the suggestion cards.
 * The cards are rebuilt only when the advice itself changes, so scrolling is kept.
 */
export function createCards(
  root: HTMLElement,
  on: { select(i: number): void; replay(): void; play(i: number): void; undo(): void; openCustom(): void } & EditorHandlers,
): { update(s: AppState, portrait: boolean): void } {
  const bar = h('div', 'runbar');
  const undo = h('button', 'undo', '← Chọn lại');
  undo.type = 'button';
  undo.setAttribute('aria-label', 'Quay lại cú trước để chọn cách đánh khác');
  undo.addEventListener('click', () => on.undo());
  const note = h('p', 'note', NOTE);
  const tune = h('button', 'tune', 'Tự chỉnh');
  tune.type = 'button';
  tune.setAttribute('aria-label', 'Tự chọn điểm chạm bi cái và lực cho cú đang chọn');
  tune.addEventListener('click', () => on.openCustom());
  bar.append(undo, note, tune);
  const body = h('div', 'cards-body');
  const editor = buildEditor(on);
  root.replaceChildren(bar, body, editor.root);

  let shown: AdviceResult | null | undefined;
  let shownPortrait = false;
  let shownComputing = false;
  let shownPotted = -1;
  let cards: HTMLElement[] = [];

  return {
    update(s, portrait) {
      undo.hidden = s.steps === 0;
      // While the hand-set shot is open the bar names the shot being adjusted.
      note.textContent = s.custom ? `Tự chỉnh: ${cardTitle(s.custom.base, portrait)}` : s.steps === 0 ? NOTE : `Đã đánh ${s.steps} cú.`;
      note.classList.toggle('strong', !!s.custom);
      tune.hidden = !!s.custom || s.computing || !activeSuggestion(s);
      body.hidden = !!s.custom;
      editor.root.hidden = !s.custom;
      editor.update(s);
      if (s.advice !== shown || portrait !== shownPortrait || s.computing !== shownComputing || s.potted.length !== shownPotted) {
        shown = s.advice;
        shownPortrait = portrait;
        shownComputing = s.computing;
        shownPotted = s.potted.length;
        body.replaceChildren();
        cards = [];
        const msg = statusMessage(s.advice, s.computing, s.potted.length);
        if (msg !== null) body.append(h('div', 'status', msg));
        else if (s.advice && s.advice.status === 'ok') {
          const strip = h('div', 'cards');
          cards = s.advice.suggestions.map((sg, i) => buildCard(sg, i, portrait, s.cloth, on.select, on.replay, on.play));
          strip.append(...cards);
          body.append(strip);
        }
      }
      cards.forEach((c, i) => {
        const active = i === s.selected;
        if (c.getAttribute('aria-pressed') !== String(active)) {
          c.setAttribute('aria-pressed', String(active));
          if (active) c.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        }
      });
    },
  };
}

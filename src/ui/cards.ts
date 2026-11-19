import { cueSummary, pocketName, potLabel, powerLabel, tipLabel } from '../core/explain';
import type { AdviceResult, Suggestion } from '../core/types';
import type { AppState } from './state';

const RAIL_WORDS = ['Một', 'Hai', 'Ba', 'Bốn'];

export function cardTitle(s: Suggestion, portrait: boolean): string {
  if (s.kind === 'safety') return `Đánh thủ bi ${s.targetId}`;
  if (s.kind === 'kick') {
    const n = s.sim ? Math.max(1, cueSummary(s.sim).railsBefore) : 1;
    return `${RAIL_WORDS[n - 1] ?? n} băng chạm bi ${s.targetId}`;
  }
  return `Bi ${s.targetId} vào ${s.pocket ? pocketName(s.pocket, portrait) : 'lỗ'}`;
}

export function statusMessage(a: AdviceResult | null, computing: boolean): string | null {
  if (computing || !a) return 'Đang tính…';
  if (a.status === 'no-cue') return 'Đặt bi cái lên bàn để nhận gợi ý.';
  if (a.status === 'no-target') return 'Đặt ít nhất một bi số lên bàn.';
  if (a.suggestions.length === 0) return 'Không tìm được cú đánh hợp lệ. Thử chỉnh lại vị trí bi.';
  return null;
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

function buildCard(s: Suggestion, index: number, portrait: boolean, onSelect: (i: number) => void, onReplay: () => void): HTMLElement {
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
  for (let i = 1; i <= 5; i++) bars.append(h('i', i <= s.powerLevel ? 'on' : ''));
  power.append(bars, `Lực ${powerLabel(s.powerLevel)}`);
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
  card.append(replay);
  return card;
}

const NOTE = 'Đường bi là ước lượng. Nỉ và băng mỗi bàn một khác.';

/** Renders the suggestion cards. Rebuilds only when the advice itself changes, so scrolling is kept. */
export function createCards(root: HTMLElement, onSelect: (i: number) => void, onReplay: () => void): { update(s: AppState, portrait: boolean): void } {
  let shown: AdviceResult | null | undefined;
  let shownPortrait = false;
  let shownComputing = false;
  let cards: HTMLElement[] = [];

  return {
    update(s, portrait) {
      if (s.advice !== shown || portrait !== shownPortrait || s.computing !== shownComputing) {
        shown = s.advice;
        shownPortrait = portrait;
        shownComputing = s.computing;
        root.replaceChildren();
        cards = [];
        const msg = statusMessage(s.advice, s.computing);
        if (msg !== null) root.append(h('div', 'status', msg));
        else if (s.advice && s.advice.status === 'ok') {
          const strip = h('div', 'cards');
          cards = s.advice.suggestions.map((sg, i) => buildCard(sg, i, portrait, onSelect, onReplay));
          strip.append(...cards);
          root.append(strip, h('p', 'note', NOTE));
        }
      }
      cards.forEach((c, i) => {
        const on = i === s.selected;
        if (c.getAttribute('aria-pressed') !== String(on)) {
          c.setAttribute('aria-pressed', String(on));
          if (on) c.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        }
      });
    },
  };
}

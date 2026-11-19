import { encodeLayout } from '../core/layoutCodec';
import { ballIdsForMode } from '../core/table';
import type { ClothSpeed, GameMode } from '../core/types';
import type { AppState, Store } from './state';
import { ballColor } from './tableView';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Top bar: game mode, cloth speed, random / clear / share. */
export function createToolbar(root: HTMLElement, store: Store): { update(s: AppState): void } {
  const modes = el('div', 'seg');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Chế độ chơi');
  const modeBtns = (['9', '10'] as GameMode[]).map((m) => {
    const b = el('button', 'seg-btn', `${m} bi`);
    b.type = 'button';
    b.addEventListener('click', () => store.setMode(m));
    modes.append(b);
    return { m, b };
  });

  const clothWrap = el('label', 'cloth');
  clothWrap.setAttribute('aria-label', 'Tốc độ nỉ');
  const cloth = el('select');
  for (const [v, label] of [['fast', 'Nỉ nhanh'], ['medium', 'Nỉ vừa'], ['slow', 'Nỉ chậm']] as [ClothSpeed, string][]) {
    const o = el('option', '', label);
    o.value = v;
    cloth.append(o);
  }
  cloth.addEventListener('change', () => store.setCloth(cloth.value as ClothSpeed));
  clothWrap.append(cloth);

  const actions = el('div', 'actions');
  const random = el('button', 'btn', 'Trộn bi');
  random.type = 'button';
  random.setAttribute('aria-label', 'Xếp bi ngẫu nhiên');
  random.addEventListener('click', () => store.randomize());
  const clear = el('button', 'btn', 'Xóa');
  clear.type = 'button';
  clear.setAttribute('aria-label', 'Xóa bàn');
  clear.addEventListener('click', () => store.clear());
  const share = el('button', 'btn', 'Chia sẻ');
  share.type = 'button';
  share.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#${encodeLayout(store.get().layout)}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Billiard Coach', url });
      else {
        await navigator.clipboard.writeText(url);
        share.textContent = 'Đã chép liên kết';
        setTimeout(() => (share.textContent = 'Chia sẻ'), 1600);
      }
    } catch {
      // the user closed the share sheet, or the clipboard is unavailable
    }
  });
  actions.append(random, clear, share);
  root.append(modes, clothWrap, actions);

  return {
    update(s) {
      for (const { m, b } of modeBtns) b.setAttribute('aria-pressed', String(s.layout.mode === m));
      cloth.value = s.cloth;
    },
  };
}

/** Row of balls: tap to put a ball on the table or take it off. */
export function createTray(root: HTMLElement, store: Store): { update(s: AppState): void } {
  let mode: GameMode | null = null;
  let buttons: { id: number; b: HTMLButtonElement }[] = [];

  const build = (m: GameMode) => {
    root.replaceChildren();
    buttons = ballIdsForMode(m).map((id) => {
      const b = el('button', 'tray-ball');
      b.type = 'button';
      const { fill, stripe } = ballColor(id);
      const dot = el('span', 'dot' + (stripe ? ' stripe' : ''), id === 0 ? '' : String(id));
      dot.style.setProperty('--c', fill);
      b.append(dot);
      b.setAttribute('aria-label', id === 0 ? 'Bi cái' : `Bi ${id}`);
      b.addEventListener('click', () => store.toggleBall(id));
      root.append(b);
      return { id, b };
    });
    mode = m;
  };

  return {
    update(s) {
      if (s.layout.mode !== mode) build(s.layout.mode);
      for (const { id, b } of buttons) b.setAttribute('aria-pressed', String(s.layout.balls.some((x) => x.id === id)));
    },
  };
}

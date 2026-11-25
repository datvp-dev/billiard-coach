import { BALL_SETS, FELTS, ballPaint, type BallSetChoice, type Equipment, type FeltChoice } from '../core/equipment';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** One ball as a small round label, painted as in the set. */
export function ballDot(id: number, set: BallSetChoice): HTMLSpanElement {
  const p = ballPaint(id, set);
  const dot = el('span', 'dot' + (p.stripe ? ' stripe' : ''), id === 0 ? '' : String(id));
  dot.style.setProperty('--c', p.fill);
  dot.style.setProperty('--band', p.band);
  return dot;
}

/** Full-screen choice of cloth colour and ball set. Every tap takes effect at once. */
export function createLookSheet(deps: { host: HTMLElement; get(): Equipment; set(patch: Partial<Equipment>): void }): { show(): void } {
  const root = el('div', 'saved look');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Màu nỉ và bộ bi');
  const head = el('div', 'saved-head');
  const close = el('button', '', 'Xong');
  close.type = 'button';
  close.addEventListener('click', () => (root.hidden = true));
  head.append(el('h2', '', 'Màu nỉ và bộ bi'), close);
  const body = el('div', 'saved-list');
  root.append(head, body);
  deps.host.append(root);

  const render = () => {
    const now = deps.get();
    const scroll = body.scrollTop;
    body.replaceChildren();
    body.append(el('p', 'look-note', 'Chọn đúng như bàn thật để app vẽ giống và nhận bi từ ảnh, live chính xác hơn.'));
    body.append(el('h3', 'look-title', 'Màu nỉ'));
    const felts = el('div', 'look-felts');
    felts.setAttribute('role', 'group');
    felts.setAttribute('aria-label', 'Màu nỉ');
    for (const f of [{ id: 'auto' as FeltChoice, name: 'Tự nhận', bed: '' }, ...FELTS]) {
      const b = el('button', 'look-felt');
      b.type = 'button';
      const sw = el('span', 'look-swatch');
      if (f.bed) sw.style.background = f.bed;
      else sw.classList.add('auto');
      b.append(sw, el('span', '', f.name));
      b.setAttribute('aria-pressed', String(now.felt === f.id));
      b.addEventListener('click', () => {
        deps.set({ felt: f.id });
        render();
      });
      felts.append(b);
    }
    body.append(felts, el('h3', 'look-title', 'Bộ bi'));
    for (const s of [{ id: 'auto' as BallSetChoice, name: 'Tự nhận', note: 'App thử các bộ và chọn bộ khớp nhất. Càng ít bi trên bàn càng dễ nhầm.' }, ...BALL_SETS]) {
      const b = el('button', 'saved-open look-set');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(now.balls === s.id));
      b.append(el('b', '', s.name), el('span', '', s.note));
      if (s.id !== 'auto') {
        const row = el('span', 'look-balls');
        for (let id = 1; id <= 10; id++) row.append(ballDot(id, s.id));
        row.setAttribute('aria-hidden', 'true');
        b.append(row);
      }
      b.addEventListener('click', () => {
        deps.set({ balls: s.id });
        render();
      });
      body.append(b);
    }
    body.scrollTop = scroll;
  };

  return {
    show() {
      render();
      root.hidden = false;
      body.scrollTop = 0;
    },
  };
}

import { savedTitle, type SavedShot } from './saved';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const when = (at: number) => {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Full-screen list of the saved hand-set shots: tap one to put its table back, or remove it. */
export function createSavedSheet(deps: { host: HTMLElement; list(): SavedShot[]; open(shot: SavedShot): void; remove(id: string): void }): { show(): void } {
  const root = el('div', 'saved');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Cú đánh đã lưu');
  const head = el('div', 'saved-head');
  const close = el('button', '', 'Đóng');
  close.type = 'button';
  close.addEventListener('click', () => (root.hidden = true));
  head.append(el('h2', '', 'Cú đánh đã lưu'), close);
  const body = el('div', 'saved-list');
  root.append(head, body);
  deps.host.append(root);

  const render = () => {
    const list = deps.list();
    body.replaceChildren();
    if (list.length === 0) {
      body.append(el('p', 'saved-empty', 'Chưa có cú nào. Mở "Tự chỉnh", chọn điểm chạm và lực, rồi bấm "Lưu".'));
      return;
    }
    for (const shot of list) {
      const row = el('div', 'saved-row');
      const open = el('button', 'saved-open');
      open.type = 'button';
      open.append(el('b', '', savedTitle(shot)), el('span', '', shot.text), el('small', '', `${shot.layout.startsWith('m10') ? '10 bi' : '9 bi'} · ${when(shot.at)}`));
      open.addEventListener('click', () => {
        root.hidden = true;
        deps.open(shot);
      });
      // Two taps to remove: the first one only asks.
      const del = el('button', 'saved-del', 'Xóa');
      del.type = 'button';
      let armed = false;
      del.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          del.textContent = 'Xóa hẳn?';
          del.classList.add('armed');
          return;
        }
        deps.remove(shot.id);
        render();
      });
      row.append(open, del);
      body.append(row);
    }
  };

  return {
    show() {
      render();
      root.hidden = false;
    },
  };
}

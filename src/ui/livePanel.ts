import type { GameMode, Layout, Vec2 } from '../core/types';
import { parseLiveLink } from '../live/link';
import { createTracker, type LiveStatus, type Tracker } from '../live/tracker';
import type { ViewSignature } from '../live/view';
import { applyH } from '../vision/homography';
import { tableToImage } from '../vision/table';
import { createLiveClient } from '../worker/liveClient';
import type { FrameChoice, FrameRequest } from './photo';
import type { StorageLike } from './state';
import { ballColor } from './tableView';

const LINK_KEY = 'billiard-coach:live:v1';
/** Longest side of the frames that are read. */
const MAX_SIDE = 1600;
/** Pause between two looks, ms. */
const PAUSE_MS = 500;

const STATUS_TEXT: Record<LiveStatus, string> = {
  away: 'Đang chiếu góc máy khác. Chờ quay lại khung bàn đã chọn.',
  moving: 'Bi đang lăn…',
  settling: 'Đang đọc thế bi…',
  steady: 'Đang theo dõi. Bàn khớp với luồng.',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Corners as shares of the frame, so a change of resolution does not move them. */
type Choice = { corners: Vec2[]; horizontal: boolean; aspect: number };

export type LivePanelDeps = {
  root: HTMLElement;
  storage: StorageLike | null;
  mode(): GameMode;
  place(layout: Layout): void;
  openFrame(frame: HTMLCanvasElement, req: FrameRequest): void;
  onToggle(open: boolean): void;
};

/**
 * Follows a live stream. A page may not read the pixels of a YouTube or TikTok player, so the
 * stream plays in its own tab and the player shares that tab with the app; frames are read on
 * the device and nothing is sent anywhere.
 */
export function createLivePanel(deps: LivePanelDeps): { toggle(): void; modeChanged(): void } {
  const { root } = deps;
  root.hidden = true;
  root.setAttribute('aria-label', 'Theo dõi live stream');
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;

  const head = el('div', 'live-head');
  const close = el('button', '', 'Đóng');
  close.type = 'button';
  head.append(el('h2', '', 'Theo dõi live'), close);
  const form = el('form', 'live-form');
  const input = el('input');
  input.type = 'url';
  input.inputMode = 'url';
  input.placeholder = 'Dán link YouTube, TikTok…';
  input.setAttribute('aria-label', 'Link live stream');
  input.autocomplete = 'off';
  const go = el('button', '', 'Mở link');
  go.type = 'submit';
  form.append(input, go);
  form.noValidate = true;
  const canvas = el('canvas', 'live-view');
  const text = el('p', 'live-text');
  text.setAttribute('role', 'status');
  const actions = el('div', 'live-actions');
  root.append(head, form, canvas, text, actions);
  const ctx = canvas.getContext('2d')!;

  try {
    const saved = deps.storage?.getItem(LINK_KEY);
    if (saved && parseLiveLink(saved)) input.value = saved;
  } catch {
    // no remembered link
  }

  const video = el('video');
  video.muted = true;
  video.playsInline = true;
  const client = createLiveClient();
  let stream: MediaStream | null = null;
  let choice: Choice | null = null;
  let tracker: Tracker | null = null;
  let ref: ViewSignature | null = null;
  let paused = false;
  let opened = false;
  let message = '';
  /** Goes up whenever what is being followed changes, so late results are thrown away. */
  let run = 0;
  let paintTimer: ReturnType<typeof setInterval> | null = null;

  const fit = (w: number, h: number) => {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  };
  const reader = el('canvas');
  const readCtx = reader.getContext('2d', { willReadFrequently: true })!;
  const ready = () => !!stream && video.readyState >= 2 && video.videoWidth > 0;

  function grab(): HTMLCanvasElement {
    const { w, h } = fit(video.videoWidth, video.videoHeight);
    const c = el('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0, w, h);
    return c;
  }

  const button = (label: string, cls: string, fn: () => void) => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };

  function render() {
    form.hidden = !!stream;
    canvas.hidden = !stream;
    actions.replaceChildren();
    if (!supported) {
      form.hidden = true;
      text.textContent = 'Trình duyệt này không cho đọc hình của thẻ khác (điện thoại chưa hỗ trợ). Hãy mở app bằng Chrome hoặc Edge trên máy tính. Trên điện thoại, bạn chụp màn hình live rồi dùng nút "Ảnh".';
      return;
    }
    if (!stream) {
      text.textContent = message || (opened ? 'Link đã mở ở thẻ khác. Bấm "Kết nối" rồi chọn đúng thẻ đó trong hộp thoại của trình duyệt.' : 'Dán link và bấm "Mở link". Khi luồng đã phát, quay lại đây bấm "Kết nối".');
      actions.append(button('Kết nối', opened ? 'primary' : 'ghost', () => void connect()));
      return;
    }
    if (!choice) {
      text.textContent = message || 'Khi luồng chiếu toàn bàn, bấm "Chọn khung bàn".';
      actions.append(button('Chọn khung bàn', 'primary', pickTable), button('Ngắt', 'ghost', () => stop('')));
      return;
    }
    const unknown = tracker ? tracker.balls().filter((b) => b.id === null).length : 0;
    text.textContent = message || (paused ? 'Đã tạm dừng.' : STATUS_TEXT[tracker?.status() ?? 'settling'] + (unknown && tracker?.status() === 'steady' ? ` ${unknown} bi chưa rõ số.` : ''));
    actions.append(
      button(paused ? 'Tiếp tục' : 'Tạm dừng', paused ? 'primary' : 'ghost', () => {
        paused = !paused;
        render();
      }),
      button('Chọn khung', 'ghost', pickTable),
      button('Ngắt', 'ghost', () => stop('')),
    );
  }

  async function connect() {
    message = '';
    let got: MediaStream;
    try {
      const options: DisplayMediaStreamOptions & Record<string, unknown> = {
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { max: 15 }, displaySurface: 'browser' } as MediaTrackConstraints,
        audio: false,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
      };
      // Stay on the app instead of jumping to the shared tab.
      const Controller = (window as unknown as { CaptureController?: new () => { setFocusBehavior(b: string): void } }).CaptureController;
      const controller = Controller ? new Controller() : null;
      if (controller) options.controller = controller;
      got = await navigator.mediaDevices.getDisplayMedia(options);
      try {
        controller?.setFocusBehavior('no-focus-change');
      } catch {
        // a window or screen was shared: there is no focus to keep
      }
    } catch (e) {
      const name = (e as DOMException)?.name;
      message = name === 'NotAllowedError' ? 'Chưa chọn thẻ nào, hoặc trình duyệt chưa được phép ghi màn hình. Bấm "Kết nối" để thử lại.' : 'Không kết nối được. Hãy thử bằng Chrome hoặc Edge trên máy tính.';
      render();
      return;
    }
    stream = got;
    got.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (stream === got) stop('Đã ngừng chia sẻ thẻ.');
    });
    video.srcObject = got;
    // Settles only when a frame arrives, which a paused stream may not send: do not wait for it.
    void video.play().catch(() => {});
    if (paintTimer === null) paintTimer = setInterval(paint, 100);
    render();
  }

  function stop(why: string) {
    run++;
    const s = stream;
    stream = null;
    s?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    if (paintTimer !== null) clearInterval(paintTimer);
    paintTimer = null;
    choice = null;
    tracker = null;
    ref = null;
    paused = false;
    message = why;
    render();
  }

  function pickTable() {
    if (!ready()) {
      message = 'Chưa có hình từ luồng. Hãy chờ video chạy rồi thử lại.';
      render();
      message = '';
      return;
    }
    const frame = grab();
    const same = choice && Math.abs(choice.aspect - frame.width / frame.height) < 0.01;
    deps.openFrame(frame, {
      ...(choice && same ? { start: { corners: choice.corners.map((c) => ({ x: c.x * frame.width, y: c.y * frame.height })), horizontal: choice.horizontal } } : {}),
      doneLabel: 'Theo dõi bàn này',
      done: (c) => follow(c, frame),
    });
  }

  function follow(c: FrameChoice, frame: HTMLCanvasElement) {
    if (!stream) return;
    run++;
    choice = { corners: c.corners.map((p) => ({ x: p.x / frame.width, y: p.y / frame.height })), horizontal: c.horizontal, aspect: frame.width / frame.height };
    tracker = createTracker(deps.mode());
    ref = null;
    paused = false;
    message = '';
    // What the player has just checked is the starting position.
    const data = frame.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, frame.width, frame.height);
    const first = tracker.seed(c.markers);
    if (first.balls.length > 0) deps.place(first);
    render();
    void loop(run, { width: data.width, height: data.height, data: data.data });
  }

  /** The chosen frame fixes what the view looks like; after that, one look after another. */
  async function loop(mine: number, first: { width: number; height: number; data: Uint8ClampedArray }) {
    let still: typeof first | null = first;
    while (mine === run && choice && tracker) {
      if (!still && (paused || !ready())) {
        await wait(PAUSE_MS);
        continue;
      }
      let img: typeof first;
      if (still) img = still;
      else {
        const { w, h } = fit(video.videoWidth, video.videoHeight);
        if (Math.abs(w / h - choice.aspect) > 0.02) {
          message = 'Khung hình của thẻ đã đổi kích thước. Bấm "Chọn khung".';
          render();
          await wait(PAUSE_MS);
          continue;
        }
        message = '';
        if (reader.width !== w || reader.height !== h) {
          reader.width = w;
          reader.height = h;
        }
        readCtx.drawImage(video, 0, 0, w, h);
        img = readCtx.getImageData(0, 0, w, h);
      }
      const { width, height } = img;
      const t = tracker;
      try {
        const r = await client.look({ width, height, data: img.data, corners: choice.corners.map((c) => ({ x: c.x * width, y: c.y * height })), horizontal: choice.horizontal, mode: deps.mode(), check: t.watched(), ref });
        if (mine !== run) return;
        if (still) ref = r.signature;
        else if (!paused) {
          const layout = t.look({ balls: r.balls, clear: r.clear, sameView: r.sameView });
          if (layout) deps.place(layout);
        }
      } catch {
        if (mine !== run) return;
      }
      still = null;
      refresh();
      await wait(PAUSE_MS);
    }
  }
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /** Update the words without rebuilding the buttons under the player's finger. */
  function refresh() {
    if (!choice || !tracker || message) return render();
    const unknown = tracker.balls().filter((b) => b.id === null).length;
    const s = tracker.status();
    const next = paused ? 'Đã tạm dừng.' : STATUS_TEXT[s] + (unknown && s === 'steady' ? ` ${unknown} bi chưa rõ số.` : '');
    if (text.textContent !== next) text.textContent = next;
  }

  /** The video, cropped to the table once it is known, with what has been read drawn on top. */
  function paint() {
    if (!ready() || root.hidden) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;
    const quad = choice?.corners.map((c) => ({ x: c.x * vw, y: c.y * vh }));
    if (quad) {
      const xs = quad.map((p) => p.x);
      const ys = quad.map((p) => p.y);
      const pad = 0.07 * (Math.max(...xs) - Math.min(...xs));
      sx = Math.max(0, Math.min(...xs) - pad);
      sy = Math.max(0, Math.min(...ys) - pad);
      sw = Math.min(vw, Math.max(...xs) + pad) - sx;
      sh = Math.min(vh, Math.max(...ys) + pad) - sy;
    }
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round((cw * sh) / sw));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const k = cw / sw;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
    if (!quad || !choice) return;
    const at = (p: Vec2) => ({ x: (p.x - sx) * k, y: (p.y - sy) * k });
    const away = tracker?.status() === 'away';
    ctx.strokeStyle = away ? 'rgba(239,107,94,0.8)' : 'rgba(242,194,48,0.8)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    quad.forEach((p, i) => {
      const q = at(p);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.stroke();
    if (away || !tracker) return;
    const h = tableToImage(quad, choice.horizontal);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${9 * dpr}px system-ui, sans-serif`;
    for (const b of tracker.balls()) {
      const q = at(applyH(h, b.pos));
      const y = q.y - 15 * dpr;
      ctx.globalAlpha = b.hidden ? 0.5 : 1;
      ctx.beginPath();
      ctx.arc(q.x, y, 7 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = b.id === null ? '#ef6b5e' : ballColor(b.id).fill;
      ctx.fill();
      ctx.strokeStyle = '#0e1512';
      ctx.lineWidth = dpr;
      ctx.stroke();
      ctx.fillStyle = b.id !== null && [2, 4, 7, 8, 10].includes(b.id) ? '#fff' : '#17181a';
      ctx.fillText(b.id === null ? '?' : b.id === 0 ? 'C' : String(b.id), q.x, y + 0.5 * dpr);
    }
    ctx.globalAlpha = 1;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const link = parseLiveLink(input.value);
    if (!link) {
      message = 'Link chưa đúng. Dán cả địa chỉ, ví dụ https://www.youtube.com/live/…';
      render();
      message = '';
      return;
    }
    input.value = link.url;
    try {
      deps.storage?.setItem(LINK_KEY, link.url);
    } catch {
      // the link is simply not remembered
    }
    window.open(link.url, '_blank', 'noopener');
    opened = true;
    message = '';
    render();
  });
  const show = (on: boolean) => {
    root.hidden = !on;
    if (!on) stop('');
    deps.onToggle(on);
    render();
  };
  close.addEventListener('click', () => show(false));
  render();

  return {
    toggle: () => show(!!root.hidden),
    modeChanged() {
      if (!tracker) return;
      run++;
      choice = null;
      tracker = null;
      ref = null;
      message = 'Đã đổi chế độ chơi. Bấm "Chọn khung bàn" để theo dõi lại.';
      render();
      message = '';
    },
  };
}

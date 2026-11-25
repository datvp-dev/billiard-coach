import { TABLE } from '../core/config';
import { ballIdsForMode } from '../core/table';
import type { GameMode, Layout, Vec2 } from '../core/types';
import { detectBalls, guessCorners } from '../vision/detect';
import { applyH, invertH, type Homography } from '../vision/homography';
import type { Raster } from '../vision/raster';
import { tableToImage } from '../vision/table';
import { assignNumber, fitImage, markersToLayout, nearestIndex, type Marker } from './photoModel';
import { ballColor } from './tableView';

const { L, W, R } = TABLE;
/** Longest side the photo is reduced to before it is analysed. */
const MAX_SIDE = 1600;
const GRAB_PX = 34;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

async function decode(file: Blob): Promise<HTMLCanvasElement> {
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    source = bmp;
    w = bmp.width;
    h = bmp.height;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const im = new Image();
      im.src = url;
      await im.decode();
      source = im;
      w = im.naturalWidth;
      h = im.naturalHeight;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d', { willReadFrequently: true })!.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/**
 * Photo -> layout, entirely on the device. Two steps in a full-screen sheet: line the four
 * corner pockets up, then check the balls that were found and fix their numbers.
 */
export type FrameChoice = { corners: Vec2[]; horizontal: boolean; markers: Marker[] };
/**
 * A still frame of a video to mark the table on; `start` reuses an earlier choice, and `markers`
 * goes straight to checking those balls.
 */
export type FrameRequest = { start?: { corners: Vec2[]; horizontal: boolean }; markers?: Marker[]; doneLabel: string; done(choice: FrameChoice): void; cancel?(): void };

export function createPhotoImport(deps: { host: HTMLElement; mode(): GameMode; place(layout: Layout): void }): { pick(): void; openFrame(frame: HTMLCanvasElement, req: FrameRequest): void } {
  const input = el('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  deps.host.append(input);

  const sheet = el('div', 'photo');
  sheet.hidden = true;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Xếp bàn theo ảnh');
  const hint = el('p', 'photo-hint');
  const stage = el('div', 'photo-stage');
  const canvas = el('canvas');
  stage.append(canvas);
  const picker = el('div', 'photo-picker');
  const actions = el('div', 'photo-actions');
  sheet.append(hint, stage, picker, actions);
  deps.host.append(sheet);
  const ctx = canvas.getContext('2d')!;

  let photo: HTMLCanvasElement | null = null;
  let raster: Raster | null = null;
  let step: 'corners' | 'review' = 'corners';
  let corners: Vec2[] = [];
  let horizontal = true;
  let found = true;
  let markers: Marker[] = [];
  let selected = -1;
  let dragging = -1;
  /** A ball being moved by hand: which one, where the finger started, and whether it has moved. */
  let moving: { i: number; from: Vec2; on: boolean; wasSelected: boolean } | null = null;
  let frameReq: FrameRequest | null = null;
  let cssW = 0;
  let cssH = 0;
  let view = { scale: 1, ox: 0, oy: 0 };

  const toScreen = (p: Vec2): Vec2 => ({ x: view.ox + p.x * view.scale, y: view.oy + p.y * view.scale });
  const toPhoto = (p: Vec2): Vec2 => ({ x: (p.x - view.ox) / view.scale, y: (p.y - view.oy) / view.scale });
  const homog = (): Homography => tableToImage(corners, horizontal);

  function button(text: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  function close() {
    sheet.hidden = true;
    photo = null;
    raster = null;
    markers = [];
    const req = frameReq;
    frameReq = null;
    req?.cancel?.();
  }

  function renderChrome() {
    picker.replaceChildren();
    actions.replaceChildren();
    if (step === 'corners') {
      hint.textContent = found
        ? 'Kéo 4 điểm tròn tới 4 lỗ góc. Hai chấm vàng phải nằm ở 2 lỗ giữa; nếu không, bấm "Đổi băng dài".'
        : 'Không tự tìm được bàn. Kéo 4 điểm tròn tới 4 lỗ góc. Hai chấm vàng phải nằm ở 2 lỗ giữa.';
      actions.append(
        button('Hủy', 'ghost', close),
        button('Đổi băng dài', 'ghost', () => {
          horizontal = !horizontal;
          draw();
        }),
        button('Tìm bi', 'primary', () => {
          if (!raster) return;
          markers = detectBalls(raster, corners, horizontal, deps.mode()).map((f) => ({ pos: f.pos, id: f.id }));
          selected = -1;
          step = 'review';
          renderChrome();
          draw();
        }),
      );
      return;
    }
    const named = markersToLayout(markers, deps.mode()).balls.length;
    const unknown = markers.filter((m) => m.id === null).length;
    hint.textContent =
      markers.length === 0
        ? 'Không thấy bi nào. Chạm vào ảnh ở chỗ có bi để thêm, hoặc quay lại chỉnh góc.'
        : `Thấy ${markers.length} bi. Chạm vào một bi để sửa số, kéo để dời; chạm chỗ trống để thêm bi.${unknown ? ` Còn ${unknown} bi "?" chưa có số sẽ bị bỏ qua.` : ''}`;
    if (selected >= 0 && markers[selected]) {
      const cur = markers[selected].id;
      for (const id of ballIdsForMode(deps.mode())) {
        const b = button(id === 0 ? 'Cái' : String(id), 'num', () => {
          markers = assignNumber(markers, selected, id);
          renderChrome();
          draw();
        });
        b.style.setProperty('--c', ballColor(id).fill);
        b.setAttribute('aria-pressed', String(cur === id));
        picker.append(b);
      }
      picker.append(
        button('Xóa', 'num del', () => {
          markers = markers.filter((_, i) => i !== selected);
          selected = -1;
          renderChrome();
          draw();
        }),
      );
    }
    actions.append(
      button('← Góc', 'ghost', () => {
        step = 'corners';
        renderChrome();
        draw();
      }),
      ...(frameReq
        ? [
            button('Xóa hết', 'ghost', () => {
              markers = [];
              selected = -1;
              renderChrome();
              draw();
            }),
          ]
        : []),
      button('Hủy', 'ghost', close),
      button(frameReq ? frameReq.doneLabel : `Đặt ${named} bi lên bàn`, 'primary', () => {
        if (frameReq) {
          const req = frameReq;
          const choice: FrameChoice = { corners, horizontal, markers };
          frameReq = null;
          close();
          req.done(choice);
          return;
        }
        const layout = markersToLayout(markers, deps.mode());
        close();
        deps.place(layout);
      }),
    );
  }

  function draw() {
    if (!photo || cssW === 0) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.drawImage(photo, view.ox, view.oy, photo.width * view.scale, photo.height * view.scale);
    const h = homog();
    const pt = (x: number, y: number) => toScreen(applyH(h, { x, y }));
    // Outline of the playing surface.
    const quad = corners.map(toScreen);
    ctx.beginPath();
    quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.strokeStyle = step === 'corners' ? '#f2c230' : 'rgba(242,194,48,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (step === 'corners') {
      for (const s of [pt(L / 2, 0), pt(L / 2, W)]) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#f2c230';
        ctx.fill();
        ctx.strokeStyle = '#0e1512';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      quad.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === dragging ? 20 : 15, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(242,194,48,0.18)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      });
      if (dragging >= 0) loupe(quad[dragging]);
      return;
    }
    markers.forEach((m, i) => {
      const c = pt(m.pos.x, m.pos.y);
      const e = pt(m.pos.x + R, m.pos.y);
      const f = pt(m.pos.x, m.pos.y + R);
      const r = Math.max(9, Math.max(Math.hypot(e.x - c.x, e.y - c.y), Math.hypot(f.x - c.x, f.y - c.y)) * 1.25);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = i === selected ? '#fff' : m.id === null ? '#ef6b5e' : '#f2c230';
      ctx.lineWidth = i === selected ? 3.5 : 2.5;
      ctx.stroke();
      const label = m.id === null ? '?' : m.id === 0 ? 'Cái' : String(m.id);
      ctx.font = '700 13px system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 10;
      const lx = c.x - tw / 2;
      const ly = c.y - r - 20;
      ctx.fillStyle = m.id === null ? '#ef6b5e' : m.id === 0 ? '#f6f2e6' : ballColor(m.id).fill;
      ctx.beginPath();
      ctx.roundRect?.(lx, ly, tw, 18, 9);
      if (!ctx.roundRect) ctx.rect(lx, ly, tw, 18);
      ctx.fill();
      ctx.strokeStyle = '#0e1512';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = m.id === null || m.id === 8 || m.id === 2 || m.id === 4 || m.id === 7 || m.id === 10 ? '#fff' : '#17181a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, c.x, ly + 9.5);
    });
  }

  /** Enlarged view of what is under the finger, shown in the top corner away from it. */
  function loupe(at: Vec2) {
    if (!photo) return;
    const r = 56;
    const zoom = 3;
    const cx = at.x < cssW / 2 ? cssW - r - 8 : r + 8;
    const cy = r + 8;
    const p = toPhoto(at);
    const half = r / (view.scale * zoom);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0e1512';
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.drawImage(photo, p.x - half, p.y - half, 2 * half, 2 * half, cx - r, cy - r, 2 * r, 2 * r);
    ctx.restore();
    ctx.strokeStyle = '#f2c230';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function layoutCanvas() {
    if (!photo) return;
    const r = stage.getBoundingClientRect();
    cssW = Math.floor(r.width);
    cssH = Math.floor(r.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    const pad = 22;
    const f = fitImage(photo.width, photo.height, Math.max(1, cssW - 2 * pad), Math.max(1, cssH - 2 * pad));
    view = { scale: f.scale, ox: f.ox + pad, oy: f.oy + pad };
    draw();
  }
  new ResizeObserver(() => {
    if (!sheet.hidden) layoutCanvas();
  }).observe(stage);

  const local = (e: PointerEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!photo) return;
    const p = local(e);
    e.preventDefault();
    if (step === 'corners') {
      dragging = nearestIndex(corners.map(toScreen), p, GRAB_PX);
      if (dragging >= 0) canvas.setPointerCapture?.(e.pointerId);
      draw();
      return;
    }
    const h = homog();
    const hit = nearestIndex(markers.map((m) => toScreen(applyH(h, m.pos))), p, 26);
    if (hit >= 0) {
      moving = { i: hit, from: p, on: false, wasSelected: hit === selected };
      selected = hit;
      canvas.setPointerCapture?.(e.pointerId);
    } else {
      const t = applyH(invertH(h), toPhoto(p));
      if (t.x > 0 && t.x < L && t.y > 0 && t.y < W) {
        markers = [...markers, { pos: { x: Math.max(R, Math.min(L - R, t.x)), y: Math.max(R, Math.min(W - R, t.y)) }, id: null }];
        selected = markers.length - 1;
      } else selected = -1;
    }
    renderChrome();
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (moving && photo) {
      const q = local(e);
      if (!moving.on && Math.hypot(q.x - moving.from.x, q.y - moving.from.y) < 6) return;
      moving.on = true;
      const t = applyH(invertH(homog()), toPhoto(q));
      const i = moving.i;
      markers = markers.map((m, k) => (k === i ? { ...m, pos: { x: Math.max(R, Math.min(L - R, t.x)), y: Math.max(R, Math.min(W - R, t.y)) } } : m));
      draw();
      return;
    }
    if (dragging < 0 || !photo) return;
    const p = toPhoto(local(e));
    corners = corners.map((c, i) => (i === dragging ? { x: Math.max(0, Math.min(photo!.width, p.x)), y: Math.max(0, Math.min(photo!.height, p.y)) } : c));
    draw();
  });
  const release = () => {
    if (moving) {
      // A tap on the ball that was already chosen lets go of it.
      if (!moving.on && moving.wasSelected) selected = -1;
      moving = null;
      renderChrome();
      draw();
      return;
    }
    if (dragging < 0) return;
    dragging = -1;
    draw();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  async function open(file: Blob) {
    frameReq = null;
    sheet.hidden = false;
    step = 'corners';
    hint.textContent = 'Đang đọc ảnh…';
    picker.replaceChildren();
    actions.replaceChildren(button('Hủy', 'ghost', close));
    try {
      photo = await decode(file);
    } catch {
      photo = null;
      hint.textContent = 'Không đọc được ảnh này. Hãy thử ảnh khác.';
      return;
    }
    load(photo);
  }

  /** Start on a picture: read its pixels and make a first guess at the corners. */
  function load(source: HTMLCanvasElement, start?: { corners: Vec2[]; horizontal: boolean }) {
    photo = source;
    const { width: w, height: h } = source;
    const data = source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h);
    raster = { width: data.width, height: data.height, data: data.data };
    const g = start ?? guessCorners(raster);
    found = !!g;
    if (g) {
      corners = g.corners.map((c) => ({ x: Math.max(0, Math.min(w, c.x)), y: Math.max(0, Math.min(h, c.y)) }));
      horizontal = g.horizontal;
    } else {
      corners = [
        { x: w * 0.15, y: h * 0.15 },
        { x: w * 0.85, y: h * 0.15 },
        { x: w * 0.85, y: h * 0.85 },
        { x: w * 0.15, y: h * 0.85 },
      ];
      horizontal = w >= h;
    }
    renderChrome();
    layoutCanvas();
  }

  function openFrame(frame: HTMLCanvasElement, req: FrameRequest) {
    frameReq = req;
    sheet.hidden = false;
    step = 'corners';
    selected = -1;
    markers = req.markers ? req.markers.map((m) => ({ ...m })) : [];
    if (req.start && req.markers) step = 'review';
    load(frame, req.start);
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void open(file);
  });

  return { pick: () => input.click(), openFrame };
}

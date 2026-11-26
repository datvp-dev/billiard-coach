import { TABLE } from '../core/config';
import { BALL_SETS, FELTS, ballSet, inkOn, type Equipment } from '../core/equipment';
import { ballIdsForMode } from '../core/table';
import type { GameMode, Layout, Vec2 } from '../core/types';
import { BALL_Z, type FoundBall } from '../vision/balls';
import { setOf } from '../vision/classify';
import { detectBalls, guessCorners } from '../vision/detect';
import { snapToSight, type FoundSights } from '../vision/findSights';
import { frameView, type FrameView, type TableFrame } from '../vision/frame';
import { TRUE_LENS, straightenImage } from '../vision/lens';
import type { Raster } from '../vision/raster';
import { SIGHTS } from '../vision/sights';
import { cornersInPicture, describeFrame, firstSetup, newSetup, noseHandle, preview, search, type FrameSetup } from './frameSetup';
import { assignNumber, fitImage, markersToLayout, nearestIndex, type Marker } from './photoModel';
import { ballColor } from './tableView';

const { L, W, R } = TABLE;
/** Longest side the photo is reduced to before it is analysed. */
const MAX_SIDE = 1600;
const GRAB_PX = 34;
/** A sight marked by hand this far from where the others say it is, in metres, is pointed out. */
const ASTRAY = 0.009;
/** Room around the bed that still shows the rails, metres. */
const RAILS = 0.17;
/** How far outside the picture a corner may lie, as a share of its size. */
const BEYOND = 0.35;

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

export type FrameChoice = { frame: TableFrame; setup: FrameSetup; markers: Marker[] };
/**
 * A still frame of a video to mark the table on; `start` reuses an earlier choice, and `markers`
 * goes straight to checking those balls.
 */
export type FrameRequest = {
  start?: { frame: TableFrame; setup: FrameSetup };
  markers?: Marker[];
  doneLabel: string;
  /** Numbers for the balls found on the frame, instead of what their colours suggest. */
  name?(balls: FoundBall[]): Marker[];
  done(choice: FrameChoice): void;
  cancel?(): void;
};

/** Something that can be dragged while the table is being lined up. */
type Grip = { kind: 'corner' | 'sight' | 'nose'; i: number };

/**
 * Photo -> layout, entirely on the device. Two steps in a full-screen sheet: check that the table's
 * diamonds were found and put right any that were not, then check the balls and fix their numbers.
 */
export function createPhotoImport(deps: { host: HTMLElement; mode(): GameMode; equipment(): Equipment; setEquipment(patch: Partial<Equipment>): void; place(layout: Layout): void }): { pick(): void; openFrame(frame: HTMLCanvasElement, req: FrameRequest): void } {
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
  let setup: FrameSetup = newSetup([], true);
  let found: FoundSights | null = null;
  let frame: TableFrame = { corners: [], horizontal: true, lens: TRUE_LENS };
  let view: FrameView | null = null;
  /** Lining up by the corners, as a start: the sights are not being used. */
  let coarse = false;
  /** Whether a first guess at the table was made, before any sights. */
  let guessed = true;
  let grip: Grip | null = null;
  /** The sight or edge last touched, for the buttons and arrow keys. */
  let picked: Grip | null = null;
  let grab = { x: 0, y: 0 };
  let from = { x: 0, y: 0 };
  let moved = false;
  let markers: Marker[] = [];
  /** The markers are as the app found them: naming them afresh loses nothing. */
  let untouched = false;
  /** The set the balls look like, when that was left to the app. */
  let seems = '';
  let selected = -1;
  /** A ball being moved by hand: which one, where the finger started, and whether it has moved. */
  let moving: { i: number; from: Vec2; on: boolean; wasSelected: boolean } | null = null;
  let frameReq: FrameRequest | null = null;
  let cssW = 0;
  let cssH = 0;
  let fit = { scale: 1, ox: 0, oy: 0 };

  const toScreen = (p: Vec2): Vec2 => ({ x: fit.ox + p.x * fit.scale, y: fit.oy + p.y * fit.scale });
  const toPhoto = (p: Vec2): Vec2 => ({ x: (p.x - fit.ox) / fit.scale, y: (p.y - fit.oy) / fit.scale });
  /** Where a ball at this place on the table shows in the picture, and the other way. */
  const ballAt = (p: Vec2): Vec2 => toScreen(view!.toRaw(p, BALL_Z));
  const ballFrom = (screen: Vec2): Vec2 => view!.toTable(toPhoto(screen), BALL_Z);
  const onBed = (t: Vec2): Vec2 => ({ x: Math.max(R, Math.min(L - R, t.x)), y: Math.max(R, Math.min(W - R, t.y)) });

  function setFrame(f: TableFrame) {
    frame = { corners: f.corners, horizontal: f.horizontal, lens: f.lens };
    view = photo ? frameView(frame, photo.width, photo.height) : null;
  }

  /** Look for the sights again from the setup as it stands. */
  function find() {
    if (!raster) return;
    found = search(raster, setup);
    if (found.sure) {
      coarse = false;
      // The next search starts from here.
      setup = { ...setup, rough: cornersInPicture(found.cal, raster.width, raster.height) };
    }
    setFrame(found.cal);
  }

  function findBalls() {
    if (!raster) return;
    const balls = detectBalls(straightenImage(raster, frame.lens), frame.corners, frame.horizontal, deps.mode(), deps.equipment().balls);
    markers = frameReq?.name ? frameReq.name(balls) : balls.map((f) => ({ pos: f.pos, id: f.id }));
    untouched = true;
    selected = -1;
    const set = setOf(balls.flatMap((f) => (f.id !== null && f.look ? [{ id: f.id, look: f.look }] : [])));
    seems = set ? ballSet(set).name : '';
  }

  /** A choice of equipment, kept for next time. */
  function choose(label: string, options: { id: string; name: string }[], value: string, fn: (id: string) => void): HTMLSelectElement {
    const s = el('select');
    s.setAttribute('aria-label', label);
    for (const o of options) {
      const opt = el('option', '', `${label}: ${o.name}`);
      opt.value = o.id;
      s.append(opt);
    }
    s.value = value;
    s.addEventListener('change', () => fn(s.value));
    return s;
  }

  /** Start over from roughly where the table is now, forgetting what was set by hand. */
  function restart(horizontal: boolean) {
    if (!found || !photo) return;
    setup = newSetup(cornersInPicture(found.cal, photo.width, photo.height), horizontal);
    picked = null;
  }

  function grips(): { g: Grip; at: Vec2 }[] {
    if (!found || !photo) return [];
    const out: { g: Grip; at: Vec2 }[] = [];
    if (coarse || !found.sure) cornersInPicture(found.cal, photo.width, photo.height).forEach((at, i) => out.push({ g: { kind: 'corner', i }, at }));
    if (!coarse) {
      SIGHTS.forEach((_, i) => out.push({ g: { kind: 'sight', i }, at: setup.hand[i] ?? found!.marks[i]?.at ?? found!.cal.sight(i) }));
      if (found.sure) for (let r = 0; r < 4; r++) out.push({ g: { kind: 'nose', i: r }, at: noseHandle(found.cal, r) });
    }
    return out.map((x) => ({ g: x.g, at: toScreen(x.at) }));
  }

  const same = (a: Grip | null, b: Grip | null) => !!a && !!b && a.kind === b.kind && a.i === b.i;

  /** Put what is held at a place in the picture and see at once what that does. */
  function hold(g: Grip, p: Vec2) {
    if (!photo || !found) return;
    const { width: w, height: h } = photo;
    const room = g.kind === 'corner' ? BEYOND : 0;
    const at = { x: Math.max(-room * w, Math.min((1 + room) * w, p.x)), y: Math.max(-room * h, Math.min((1 + room) * h, p.y)) };
    const put = <T,>(list: T[], v: T) => list.map((o, i) => (i === g.i ? v : o));
    if (g.kind === 'corner') setup = { ...setup, rough: put(setup.rough, at) };
    else if (g.kind === 'sight') setup = { ...setup, hand: put<Vec2 | null>(setup.hand, at), off: put(setup.off, false) };
    else setup = { ...setup, noses: put<Vec2 | null>(setup.noses, at) };
    const cal = preview(w, h, setup, found);
    found = { ...found, cal };
    setFrame(cal);
  }

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

  function cornerHint(): string {
    if (!found) return '';
    if (coarse || !found.sure) {
      const why = coarse ? '' : guessed ? 'Chưa dò được hình thoi. ' : 'Không tự tìm được bàn. ';
      return `${why}Kéo 4 vòng lớn tới gần 4 lỗ góc, chấm vàng nằm ở 2 lỗ giữa; app sẽ tự dò hình thoi.${coarse ? '' : ' Không thấy đủ góc thì kéo các vòng nhỏ vào đúng hình thoi.'}`;
    }
    const astray = SIGHTS.filter((_, i) => setup.hand[i] && found!.cal.off[i] > ASTRAY).length;
    return `${describeFrame(found)} ${astray ? 'Vòng đỏ lệch so với các hình thoi khác: xem lại.' : 'Vòng nào sai thì kéo vào đúng hình thoi; vạch xanh phải nằm trên mép băng.'}`;
  }

  /** What the picture is fitted to changes with these, and only then. */
  let shown = '';
  const showing = () => `${step} ${coarse} ${!found || found.sure}`;
  function refresh() {
    renderChrome();
    if (showing() !== shown) layoutCanvas();
    else draw();
  }

  function renderChrome() {
    picker.replaceChildren();
    actions.replaceChildren();
    if (step === 'corners') {
      hint.textContent = cornerHint();
      const g = picked;
      if (g && found && g.kind === 'sight') {
        const used = !!setup.hand[g.i] || (!!found.marks[g.i] && !setup.off[g.i]);
        picker.append(
          button(used ? 'Bỏ chấm này' : 'Dùng chấm này', 'pill', () => {
            const at = found!.cal.sight(g.i);
            setup = { ...setup, hand: setup.hand.map((v, i) => (i === g.i ? (used ? null : at) : v)), off: setup.off.map((v, i) => (i === g.i ? used : v)) };
            find();
            refresh();
          }),
        );
      }
      if (g && found && ((g.kind === 'sight' && setup.hand[g.i]) || (g.kind === 'nose' && setup.noses[g.i]))) {
        picker.append(
          button('Để app tự dò', 'pill', () => {
            setup = g.kind === 'sight' ? { ...setup, hand: setup.hand.map((v, i) => (i === g.i ? null : v)) } : { ...setup, noses: setup.noses.map((v, i) => (i === g.i ? null : v)) };
            find();
            refresh();
          }),
        );
      }
      picker.append(
        button(coarse || !found?.sure ? 'Dò hình thoi' : 'Kéo 4 góc', 'pill', () => {
          const again = coarse || !found?.sure;
          restart(setup.horizontal);
          if (again) {
            coarse = false;
            find();
          } else {
            coarse = true;
            found = { ...found!, marks: SIGHTS.map(() => null), noses: [null, null, null, null], sure: false, cal: preview(photo!.width, photo!.height, setup, { ...found!, marks: SIGHTS.map(() => null), noses: [null, null, null, null] }) };
            setFrame(found.cal);
          }
          refresh();
        }),
        button('Đổi băng dài', 'pill', () => {
          restart(!setup.horizontal);
          find();
          refresh();
        }),
        choose('Nỉ', [{ id: 'auto', name: 'tự nhận' }, ...FELTS.map((f) => ({ id: f.id as string, name: f.name }))], deps.equipment().felt, (id) => {
          deps.setEquipment({ felt: id as Equipment['felt'] });
          // Where the sights already hold the table there is nothing to look for again.
          if (!found?.sure && raster) {
            guess();
            find();
          }
          refresh();
        }),
      );
      actions.append(
        button('Hủy', 'ghost', close),
        button('Tìm bi', 'primary', () => {
          if (!raster) return;
          findBalls();
          step = 'review';
          refresh();
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
    if (untouched && selected < 0) {
      picker.append(
        choose('Bộ bi', [{ id: 'auto', name: seems && deps.equipment().balls === 'auto' ? `tự nhận (${seems})` : 'tự nhận' }, ...BALL_SETS.map((s) => ({ id: s.id as string, name: s.name }))], deps.equipment().balls, (id) => {
          deps.setEquipment({ balls: id as Equipment['balls'] });
          findBalls();
          refresh();
        }),
      );
    }
    if (selected >= 0 && markers[selected]) {
      const cur = markers[selected].id;
      for (const id of ballIdsForMode(deps.mode())) {
        const b = button(id === 0 ? 'Cái' : String(id), 'num', () => {
          markers = assignNumber(markers, selected, id);
          untouched = false;
          renderChrome();
          draw();
        });
        b.style.setProperty('--c', ballColor(id, deps.equipment()).fill);
        b.setAttribute('aria-pressed', String(cur === id));
        picker.append(b);
      }
      picker.append(
        button('Xóa', 'num del', () => {
          markers = markers.filter((_, i) => i !== selected);
          untouched = false;
          selected = -1;
          renderChrome();
          draw();
        }),
      );
    }
    actions.append(
      button('← Khung', 'ghost', () => {
        step = 'corners';
        picked = null;
        if (!found) find();
        refresh();
      }),
      ...(frameReq
        ? [
            button('Xóa hết', 'ghost', () => {
              markers = [];
              untouched = false;
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
          const choice: FrameChoice = { frame, setup, markers };
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
    ctx.drawImage(photo, fit.ox, fit.oy, photo.width * fit.scale, photo.height * fit.scale);
    if (!view) return;
    const v = view;
    /** A straight line on the table, which a lens may bend. */
    const line = (a: Vec2, b: Vec2) => {
      for (let k = 0; k <= 16; k++) {
        const q = toScreen(v.toRaw({ x: a.x + ((b.x - a.x) * k) / 16, y: a.y + ((b.y - a.y) * k) / 16 }));
        if (k) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      }
    };
    if (step === 'corners') {
      ctx.beginPath();
      for (let k = 1; k < 8; k++) line({ x: (k * L) / 8, y: 0 }, { x: (k * L) / 8, y: W });
      for (let k = 1; k < 4; k++) line({ x: 0, y: (k * W) / 4 }, { x: L, y: (k * W) / 4 });
      ctx.strokeStyle = 'rgba(242,194,48,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // The cushions' edges.
    ctx.beginPath();
    for (const [a, b] of [[0, 0, L, 0], [L, 0, L, W], [L, W, 0, W], [0, W, 0, 0]].map(([p, q, r, t]) => [{ x: p, y: q }, { x: r, y: t }])) line(a, b);
    ctx.strokeStyle = step === 'corners' ? '#4fd1e8' : 'rgba(79,209,232,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (step === 'corners') {
      if (!found) return;
      for (const s of [{ x: L / 2, y: 0 }, { x: L / 2, y: W }].map((p) => toScreen(v.toRaw(p)))) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#f2c230';
        ctx.fill();
        ctx.strokeStyle = '#0e1512';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      let held: Vec2 | null = null;
      for (const { g, at } of grips()) {
        const on = same(g, grip);
        const chosen = on || same(g, picked);
        if (on) held = at;
        if (g.kind === 'corner') {
          ctx.beginPath();
          ctx.arc(at.x, at.y, on ? 20 : 15, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(242,194,48,0.18)';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          continue;
        }
        if (g.kind === 'nose') {
          ctx.beginPath();
          ctx.rect(at.x - 5, at.y - 5, 10, 10);
          ctx.fillStyle = setup.noses[g.i] ? '#4fd1e8' : 'rgba(14,21,18,0.55)';
          ctx.fill();
          ctx.strokeStyle = chosen ? '#fff' : '#4fd1e8';
          ctx.lineWidth = chosen ? 3 : 2;
          ctx.stroke();
          continue;
        }
        const mark = setup.hand[g.i] || (!setup.off[g.i] && found.marks[g.i]);
        const astray = !!setup.hand[g.i] && found.cal.off[g.i] > ASTRAY && found.sure;
        ctx.beginPath();
        ctx.arc(at.x, at.y, on ? 12 : 8, 0, Math.PI * 2);
        ctx.setLineDash(mark ? [] : [3, 3]);
        for (const [w, c] of [[4, 'rgba(14,21,18,0.7)'], [chosen ? 2.6 : 2, astray ? '#ef6b5e' : !mark ? '#c9c9c9' : setup.hand[g.i] ? '#fff' : '#7ee08a']] as const) {
          ctx.lineWidth = w;
          ctx.strokeStyle = c;
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      if (held) loupe(held);
      return;
    }
    markers.forEach((m, i) => {
      const c = ballAt(m.pos);
      const e = ballAt({ x: m.pos.x + R, y: m.pos.y });
      const f = ballAt({ x: m.pos.x, y: m.pos.y + R });
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
      ctx.fillStyle = m.id === null ? '#ef6b5e' : m.id === 0 ? '#f6f2e6' : ballColor(m.id, deps.equipment()).fill;
      ctx.beginPath();
      ctx.roundRect?.(lx, ly, tw, 18, 9);
      if (!ctx.roundRect) ctx.rect(lx, ly, tw, 18);
      ctx.fill();
      ctx.strokeStyle = '#0e1512';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = m.id === null ? '#fff' : m.id === 0 ? '#17181a' : inkOn(ballColor(m.id, deps.equipment()).fill);
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
    const half = r / (fit.scale * zoom);
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
    shown = showing();
    const r = stage.getBoundingClientRect();
    cssW = Math.floor(r.width);
    cssH = Math.floor(r.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    const pad = 22;
    // Corners outside the picture need room to be taken hold of.
    const loose = coarse || (!!found && !found.sure);
    const pts = loose ? setup.rough : [];
    const room = (v: number, max: number) => Math.max(-BEYOND * max, Math.min((1 + BEYOND) * max, v));
    let x0 = Math.min(0, ...pts.map((p) => room(p.x, photo!.width)));
    let x1 = Math.max(photo.width, ...pts.map((p) => room(p.x, photo!.width)));
    let y0 = Math.min(0, ...pts.map((p) => room(p.y, photo!.height)));
    let y1 = Math.max(photo.height, ...pts.map((p) => room(p.y, photo!.height)));
    if (!loose && view) {
      // The table is known: show it as large as it goes, rails and all.
      const edge = [[-RAILS, -RAILS], [L + RAILS, -RAILS], [L + RAILS, W + RAILS], [-RAILS, W + RAILS]].map(([x, y]) => view!.toRaw({ x, y }));
      const a = Math.max(0, Math.min(...edge.map((p) => p.x)));
      const b = Math.min(photo.width, Math.max(...edge.map((p) => p.x)));
      const c = Math.max(0, Math.min(...edge.map((p) => p.y)));
      const d = Math.min(photo.height, Math.max(...edge.map((p) => p.y)));
      if (b - a > 40 && d - c > 40) [x0, x1, y0, y1] = [a, b, c, d];
    }
    const f = fitImage(x1 - x0, y1 - y0, Math.max(1, cssW - 2 * pad), Math.max(1, cssH - 2 * pad));
    fit = { scale: f.scale, ox: f.ox + pad - x0 * f.scale, oy: f.oy + pad - y0 * f.scale };
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
      const all = grips();
      const k = nearestIndex(all.map((x) => x.at), p, GRAB_PX);
      picked = k >= 0 ? all[k].g : null;
      // Nothing moves until the finger does, and then by as much as the finger: no jump to its tip.
      moved = false;
      if (k >= 0) {
        grip = all[k].g;
        grab = { x: all[k].at.x - p.x, y: all[k].at.y - p.y };
        from = p;
        canvas.setPointerCapture?.(e.pointerId);
      }
      // The buttons follow on release: they must not push the picture about under the finger.
      if (k < 0) renderChrome();
      draw();
      return;
    }
    if (!view) return;
    const hit = nearestIndex(markers.map((m) => ballAt(m.pos)), p, 26);
    if (hit >= 0) {
      moving = { i: hit, from: p, on: false, wasSelected: hit === selected };
      selected = hit;
      canvas.setPointerCapture?.(e.pointerId);
    } else {
      const t = ballFrom(p);
      if (t.x > 0 && t.x < L && t.y > 0 && t.y < W) {
        markers = [...markers, { pos: onBed(t), id: null }];
        untouched = false;
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
      const t = onBed(ballFrom(q));
      untouched = false;
      const i = moving.i;
      markers = markers.map((m, k) => (k === i ? { ...m, pos: t } : m));
      draw();
      return;
    }
    if (!grip || !photo) return;
    const q = local(e);
    if (!moved && Math.hypot(q.x - from.x, q.y - from.y) < 4) return;
    moved = true;
    hold(grip, toPhoto({ x: q.x + grab.x, y: q.y + grab.y }));
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
    const g = grip;
    grip = null;
    if (!g) return;
    if (moved && raster && found) {
      if (g.kind === 'sight' && setup.hand[g.i]) {
        const at = snapToSight(raster, found.cal, g.i, setup.hand[g.i]!);
        setup = { ...setup, hand: setup.hand.map((v, i) => (i === g.i ? at : v)) };
      }
      find();
    }
    refresh();
  };
  // Fine adjustment with the keyboard.
  window.addEventListener('keydown', (e) => {
    if (sheet.hidden || step !== 'corners' || !picked || !found) return;
    if (e.target instanceof HTMLSelectElement) return;
    const step1 = e.shiftKey ? 4 : 0.5;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const now = grips().find((x) => same(x.g, picked));
    if (!now) return;
    const p = toPhoto(now.at);
    hold(picked, { x: p.x + d[0] * step1, y: p.y + d[1] * step1 });
    refresh();
  });
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

  /** A first idea of where the table is, from the colour of its cloth. */
  function guess() {
    if (!raster) return;
    const { width: w, height: h } = raster;
    // The cloth as chosen first, then whatever looks most like a table: the choice may be an old one.
    const felt = deps.equipment().felt;
    const ideas = (felt === 'auto' ? [guessCorners(raster)] : [guessCorners(raster, felt), guessCorners(raster)]).filter((g) => g !== null);
    guessed = ideas.length > 0;
    const at = (x: number, y: number) => ({ x: x * w, y: y * h });
    setup = firstSetup(raster, ideas) ?? newSetup([at(0.15, 0.15), at(0.85, 0.15), at(0.85, 0.85), at(0.15, 0.85)], w >= h);
  }

  /** Start on a picture: read its pixels and find the table, unless it is known already. */
  function load(source: HTMLCanvasElement, start?: { frame: TableFrame; setup: FrameSetup }) {
    photo = source;
    const { width: w, height: h } = source;
    untouched = false;
    const data = source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h);
    raster = { width: data.width, height: data.height, data: data.data };
    found = null;
    picked = null;
    grip = null;
    coarse = false;
    if (start) {
      setup = start.setup;
      guessed = true;
      setFrame(start.frame);
    } else {
      guess();
    }
    if (step === 'corners') find();
    renderChrome();
    layoutCanvas();
  }

  function openFrame(source: HTMLCanvasElement, req: FrameRequest) {
    frameReq = req;
    sheet.hidden = false;
    step = req.start && req.markers ? 'review' : 'corners';
    selected = -1;
    markers = req.markers ? req.markers.map((m) => ({ ...m })) : [];
    load(source, req.start);
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void open(file);
  });

  return { pick: () => input.click(), openFrame };
}

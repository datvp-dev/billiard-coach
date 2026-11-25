import './style.css';
import { createCards } from './ui/cards';
import { attachDrag } from './ui/drag';
import type { Layout } from './core/types';
import { PLAIN } from './core/equipment';
import { createLivePanel } from './ui/livePanel';
import { createLookSheet } from './ui/lookSheet';
import { createPhotoImport } from './ui/photo';
import { sampleAt, simDuration } from './ui/replay';
import { addSaved, loadSaved, removeSaved, restoreSaved, snapshotShot, storeSaved } from './ui/saved';
import { createSavedSheet } from './ui/savedSheet';
import { renderSnapshot, saveSnapshot, snapshotFileName } from './ui/snapshot';
import { activeSuggestion, createStore, loadInitial, type StorageLike } from './ui/state';
import { computeTransform, drawTable, type TableUi, type ViewTransform } from './ui/tableView';
import { createToolbar, createTray } from './ui/tray';
import { createAdvisorClient } from './worker/client';

function safeStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    s.getItem('billiard-coach:probe');
    return s;
  } catch {
    return null;
  }
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const bar = document.createElement('header');
bar.className = 'bar';
const stage = document.createElement('main');
stage.className = 'stage';
const canvas = document.createElement('canvas');
canvas.setAttribute('aria-label', 'Bàn bi-a. Kéo bi để đặt vị trí.');
const stageTools = document.createElement('div');
stageTools.className = 'stage-tools';
const ICONS = {
  saved: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z',
  live: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14',
  look: 'M12 3a9 9 0 1 0 0 18c1.2 0 2-.9 2-2 0-1.4-1-1.6-1-2.7 0-.8.7-1.3 1.5-1.3H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 12h.01M10 7.5h.01M15 7.8h.01',
  picture: 'M12 3v10m0 0l-4-4m4 4l4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
};
/** Small icon-over-label button that fits in the strip beside an upright table. */
function toolButton(icon: string): { button: HTMLButtonElement; label: HTMLSpanElement } {
  const button = document.createElement('button');
  button.type = 'button';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', icon);
  svg.append(path);
  const label = document.createElement('span');
  button.append(svg, label);
  return { button, label };
}
const { button: savedBtn, label: savedLabel } = toolButton(ICONS.saved);
const { button: shotBtn, label: shotLabel } = toolButton(ICONS.picture);
shotLabel.textContent = 'Lưu ảnh';
shotBtn.setAttribute('aria-label', 'Lưu ảnh bàn hiện tại');
const { button: liveBtn, label: liveLabel } = toolButton(ICONS.live);
liveLabel.textContent = 'Live';
liveBtn.setAttribute('aria-label', 'Theo dõi live stream');
const { button: lookBtn, label: lookLabel } = toolButton(ICONS.look);
lookLabel.textContent = 'Màu';
lookBtn.setAttribute('aria-label', 'Chọn màu nỉ và bộ bi');
stageTools.append(liveBtn, lookBtn, savedBtn, shotBtn);
stage.append(canvas, stageTools);
const trayEl = document.createElement('div');
trayEl.className = 'tray';
const cardsWrap = document.createElement('section');
cardsWrap.className = 'cards-wrap';
const livePanel = document.createElement('section');
livePanel.className = 'live';
app.replaceChildren(bar, livePanel, stage, trayEl, cardsWrap);

const storage = safeStorage();
const client = createAdvisorClient((r, layout) => store.receive(r, layout));
const store = createStore(client, {
  storage,
  initial: loadInitial(location.hash, storage),
  setHash: (code) => history.replaceState(null, '', `#${code}`),
});

const equipment = () => store.get().equipment ?? PLAIN;
const photoImport = createPhotoImport({ host: document.body, mode: () => store.get().layout.mode, equipment, setEquipment: (e) => store.setEquipment(e), place: (layout) => store.setLayout(layout) });
const toolbar = createToolbar(bar, store, () => photoImport.pick());
const tray = createTray(trayEl, store);
const ui: TableUi = {};
const ctx = canvas.getContext('2d')!;
let cssW = 0;
let cssH = 0;
let transform: ViewTransform = computeTransform(1, 1);

function redraw() {
  if (cssW === 0 || cssH === 0) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawTable(ctx, transform, store.get(), ui, cssW, cssH);
}

function resize() {
  const r = stage.getBoundingClientRect();
  cssW = Math.floor(r.width);
  cssH = Math.floor(r.height);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  // Orientation comes from the screen, not the canvas box: browser bars can leave a wide, short box on an upright phone.
  transform = computeTransform(cssW, cssH, window.innerHeight >= window.innerWidth);
  redraw();
}

// --- Shot replay ---
const MAX_REPLAY_MS = 6000;
const HOLD_MS = 700;
let replayFrame = 0;

function stopReplay() {
  if (replayFrame) cancelAnimationFrame(replayFrame);
  replayFrame = 0;
  if (ui.replay) {
    ui.replay = null;
    redraw();
  }
}

function startReplay(then?: () => void) {
  stopReplay();
  const s = store.get();
  const sug = activeSuggestion(s);
  if (!sug) return;
  const start = s.layout.balls;
  const duration = simDuration(sug.sim);
  const rate = Math.max(1, (duration * 1000) / MAX_REPLAY_MS);
  const t0 = performance.now();
  const frame = (now: number) => {
    const t = ((now - t0) / 1000) * rate;
    ui.replay = sampleAt(sug.sim, start, t);
    redraw();
    if (t < duration + (HOLD_MS / 1000) * rate) replayFrame = requestAnimationFrame(frame);
    else {
      stopReplay();
      then?.();
    }
  };
  replayFrame = requestAnimationFrame(frame);
}

const cards = createCards(cardsWrap, {
  select(i) {
    stopReplay();
    store.select(i);
  },
  replay: () => startReplay(),
  // Show the shot, then leave the balls where it put them and advise on the next ball.
  play(i) {
    store.select(i);
    startReplay(() => store.applySuggestion(i));
  },
  undo() {
    stopReplay();
    store.undo();
  },
  openCustom() {
    stopReplay();
    store.openCustom();
  },
  custom(patch) {
    stopReplay();
    store.setCustom(patch);
  },
  closeCustom() {
    stopReplay();
    store.closeCustom();
  },
  playCustom: () => startReplay(() => store.applyCustom()),
  saveCustom() {
    const shot = snapshotShot(store.get(), Date.now());
    if (!shot) return false;
    const next = addSaved(saved, shot);
    if (!storeSaved(storage, next)) return false;
    saved = next;
    showSavedCount();
    return true;
  },
});

// --- Following a live stream ---
/** The last table that came from the stream; anything else on the board was put there by hand. */
let liveLayout: Layout | null = null;
let editTimer: ReturnType<typeof setTimeout> | null = null;
const live = createLivePanel({
  root: livePanel,
  storage,
  mode: () => store.get().layout.mode,
  equipment,
  place(layout) {
    stopReplay();
    liveLayout = layout;
    store.setLayout(layout);
  },
  openFrame: (frame, req) => photoImport.openFrame(frame, req),
  onToggle: (open) => liveBtn.setAttribute('aria-pressed', String(open)),
});
liveBtn.addEventListener('click', () => live.toggle());
let liveMode = store.get().layout.mode;
store.subscribe((s) => {
  // Dragging a ball or tapping the tray corrects what was read. Shots played in the app are only
  // tried out, and do not count.
  if (editTimer !== null) clearTimeout(editTimer);
  editTimer = null;
  if (liveLayout && s.layout !== liveLayout && s.steps === 0) editTimer = setTimeout(() => live.edited(store.get().layout), 400);
});
store.subscribe((s) => {
  if (s.layout.mode === liveMode) return;
  liveMode = s.layout.mode;
  live.modeChanged();
});

const lookSheet = createLookSheet({ host: document.body, get: equipment, set: (e) => store.setEquipment(e) });
lookBtn.addEventListener('click', () => lookSheet.show());

// --- Saved hand-set shots ---
let saved = loadSaved(storage);
function showSavedCount() {
  savedBtn.hidden = saved.length === 0;
  savedLabel.textContent = `Đã lưu ${saved.length}`;
  savedBtn.setAttribute('aria-label', `Xem ${saved.length} cú đánh đã lưu`);
}
const savedSheet = createSavedSheet({
  host: document.body,
  list: () => saved,
  open(shot) {
    const r = restoreSaved(shot);
    if (!r) return;
    stopReplay();
    store.openSaved(r);
  },
  remove(id) {
    const next = removeSaved(saved, id);
    if (storeSaved(storage, next)) saved = next;
    showSavedCount();
  },
});
savedBtn.addEventListener('click', () => savedSheet.show());
showSavedCount();

// --- Picture of the table as it is shown now ---
shotBtn.addEventListener('click', async () => {
  stopReplay();
  shotBtn.disabled = true;
  let how: Awaited<ReturnType<typeof saveSnapshot>> = 'failed';
  try {
    how = await saveSnapshot(renderSnapshot(store.get(), transform.portrait), snapshotFileName(new Date()));
  } catch {
    // canvas export refused
  }
  shotBtn.disabled = false;
  if (how === 'cancelled' || how === 'shared') return;
  shotLabel.textContent = how === 'downloaded' ? 'Đã tải' : 'Lỗi';
  setTimeout(() => (shotLabel.textContent = 'Lưu ảnh'), 1600);
});

new ResizeObserver(() => {
  resize();
  cards.update(store.get(), transform.portrait);
}).observe(stage);
attachDrag(canvas, trayEl, () => transform, store, ui, redraw, stopReplay);

let lastLayout = store.get().layout;
store.subscribe((s) => {
  if (s.layout !== lastLayout) {
    lastLayout = s.layout;
    stopReplay();
  }
  toolbar.update(s);
  tray.update(s);
  cards.update(s, transform.portrait);
  redraw();
});
toolbar.update(store.get());
tray.update(store.get());
resize();
cards.update(store.get(), transform.portrait);

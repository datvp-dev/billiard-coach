import './style.css';
import { createCards } from './ui/cards';
import { attachDrag } from './ui/drag';
import { sampleAt, simDuration } from './ui/replay';
import { createStore, loadInitial, type StorageLike } from './ui/state';
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
stage.append(canvas);
const trayEl = document.createElement('div');
trayEl.className = 'tray';
const cardsWrap = document.createElement('section');
cardsWrap.className = 'cards-wrap';
app.replaceChildren(bar, stage, trayEl, cardsWrap);

const storage = safeStorage();
const client = createAdvisorClient((r, layout) => store.receive(r, layout));
const store = createStore(client, {
  storage,
  initial: loadInitial(location.hash, storage),
  setHash: (code) => history.replaceState(null, '', `#${code}`),
});

const toolbar = createToolbar(bar, store);
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
  if (!s.advice || s.advice.status !== 'ok') return;
  const sug = s.advice.suggestions[s.selected];
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

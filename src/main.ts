import './style.css';
import { attachDrag } from './ui/drag';
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
  transform = computeTransform(cssW, cssH);
  redraw();
}

new ResizeObserver(resize).observe(stage);
attachDrag(canvas, trayEl, () => transform, store, ui, redraw, () => {});

store.subscribe((s) => {
  toolbar.update(s);
  tray.update(s);
  redraw();
});
toolbar.update(store.get());
tray.update(store.get());
resize();

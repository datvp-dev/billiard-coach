import { TABLE } from '../core/config';
import type { Vec2 } from '../core/types';
import type { Store } from './state';
import type { TableUi, ViewTransform } from './tableView';

const MIN_GRAB_PX = 22;
/** How far into the tray a release must be to take the ball off: a small overshoot past the end rail must not. */
const TRAY_INSET_PX = 10;

export function releaseRemovesBall(p: Vec2, tray: { top: number; bottom: number; left: number; right: number }): boolean {
  return p.x >= tray.left && p.x <= tray.right && p.y >= tray.top + TRAY_INSET_PX && p.y <= tray.bottom;
}

/**
 * Drag balls with a finger or mouse. Releasing a ball over the tray takes it off the table.
 * `onInteract` fires when a drag starts (used to stop a running replay).
 */
export function attachDrag(
  canvas: HTMLCanvasElement,
  tray: HTMLElement,
  getTransform: () => ViewTransform,
  store: Store,
  ui: TableUi,
  redraw: () => void,
  onInteract: () => void,
): void {
  let grabOffset: Vec2 = { x: 0, y: 0 };
  let pointerId: number | null = null;

  const local = (e: PointerEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    const t = getTransform();
    const p = local(e);
    const reach = Math.max(TABLE.R * t.scale * 1.3, MIN_GRAB_PX);
    let best: { id: number; d: number; s: Vec2 } | null = null;
    for (const b of store.get().layout.balls) {
      const s = t.toScreen(b.pos);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d <= reach && (!best || d < best.d)) best = { id: b.id, d, s };
    }
    if (!best) return;
    e.preventDefault();
    onInteract();
    pointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    // Keep the ball under the same part of the finger it was grabbed by.
    grabOffset = { x: best.s.x - p.x, y: best.s.y - p.y };
    ui.drag = { id: best.id, finger: p };
    canvas.classList.add('dragging');
    redraw();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId || !ui.drag) return;
    e.preventDefault();
    const p = local(e);
    ui.drag.finger = p;
    const t = getTransform();
    store.moveBall(ui.drag.id, t.toTable({ x: p.x + grabOffset.x, y: p.y + grabOffset.y }));
    tray.classList.toggle('drop-target', releaseRemovesBall({ x: e.clientX, y: e.clientY }, tray.getBoundingClientRect()));
  });

  const end = (e: PointerEvent, cancelled: boolean) => {
    if (e.pointerId !== pointerId || !ui.drag) return;
    const id = ui.drag.id;
    pointerId = null;
    ui.drag = null;
    canvas.classList.remove('dragging');
    tray.classList.remove('drop-target');
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!cancelled && releaseRemovesBall({ x: e.clientX, y: e.clientY }, tray.getBoundingClientRect())) store.toggleBall(id);
    redraw();
  };
  canvas.addEventListener('pointerup', (e) => end(e, false));
  canvas.addEventListener('pointercancel', (e) => end(e, true));
}

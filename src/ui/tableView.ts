import { TABLE } from '../core/config';
import { POCKET_IDS, pocketAxis, pocketCenter, targetBallId } from '../core/table';
import type { BallPos, Suggestion, Vec2 } from '../core/types';
import type { AppState } from './state';

export type ViewTransform = { toScreen(p: Vec2): Vec2; toTable(p: Vec2): Vec2; scale: number; portrait: boolean };

const { L, W, R } = TABLE;
/** Rail width drawn around the playing surface, in metres. */
const RAIL = 0.085;

/**
 * Fit the table (with rails) into a cssW x cssH box. Landscape: x right, y up.
 * Portrait: the landscape picture turned a quarter turn clockwise (table x runs down the screen).
 * Orientation follows the box unless the caller forces it (an upright phone keeps an upright table).
 */
export function computeTransform(cssW: number, cssH: number, portrait: boolean = cssH > cssW): ViewTransform {
  const long = L + 2 * RAIL;
  const short = W + 2 * RAIL;
  const scale = Math.max(1e-6, portrait ? Math.min(cssW / short, cssH / long) : Math.min(cssW / long, cssH / short));
  const ox = (cssW - (portrait ? short : long) * scale) / 2 + RAIL * scale;
  const oy = (cssH - (portrait ? long : short) * scale) / 2 + RAIL * scale;
  if (portrait) {
    return {
      scale,
      portrait,
      toScreen: (p) => ({ x: ox + p.y * scale, y: oy + p.x * scale }),
      toTable: (p) => ({ x: (p.y - oy) / scale, y: (p.x - ox) / scale }),
    };
  }
  return {
    scale,
    portrait,
    toScreen: (p) => ({ x: ox + p.x * scale, y: oy + (W - p.y) * scale }),
    toTable: (p) => ({ x: (p.x - ox) / scale, y: W - (p.y - oy) / scale }),
  };
}

const COLORS = ['#f6f2e6', '#f2c230', '#2463c4', '#d5362f', '#6d41a6', '#ef7f1f', '#1f8f4f', '#8a2433', '#17181a', '#f2c230', '#2463c4'];

export function ballColor(id: number): { fill: string; stripe: boolean } {
  return { fill: COLORS[id] ?? '#888', stripe: id >= 9 };
}

export type TableUi = {
  /** Ball being dragged and where the finger is, in CSS pixels. */
  drag?: { id: number; finger: Vec2 } | null;
  /** Ball positions to show instead of the layout while a shot is replayed. */
  replay?: BallPos[] | null;
};

function rectFromTable(t: ViewTransform, x0: number, y0: number, x1: number, y1: number) {
  const a = t.toScreen({ x: x0, y: y0 });
  const b = t.toScreen({ x: x1, y: y1 });
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBed(ctx: CanvasRenderingContext2D, t: ViewTransform) {
  const s = t.scale;
  const outer = rectFromTable(t, -RAIL, -RAIL, L + RAIL, W + RAIL);
  roundRect(ctx, outer.x, outer.y, outer.w, outer.h, 0.06 * s);
  ctx.fillStyle = '#4a2f1d';
  ctx.fill();
  ctx.strokeStyle = '#2c1a0f';
  ctx.lineWidth = Math.max(1, 0.008 * s);
  ctx.stroke();

  const cushion = rectFromTable(t, -0.04, -0.04, L + 0.04, W + 0.04);
  ctx.fillStyle = '#135c40';
  ctx.fillRect(cushion.x, cushion.y, cushion.w, cushion.h);
  const bed = rectFromTable(t, 0, 0, L, W);
  ctx.fillStyle = '#1b7d57';
  ctx.fillRect(bed.x, bed.y, bed.w, bed.h);

  // Pockets
  ctx.fillStyle = '#0a0d0c';
  for (const id of POCKET_IDS) {
    const side = id === 'SB' || id === 'ST';
    const c = pocketCenter(id);
    const a = pocketAxis(id);
    const off = side ? 0.04 : 0.022;
    const p = t.toScreen({ x: c.x + a.x * off, y: c.y + a.y * off });
    ctx.beginPath();
    ctx.arc(p.x, p.y, (side ? 0.058 : 0.064) * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Diamonds
  ctx.fillStyle = 'rgba(244, 236, 214, 0.75)';
  const dot = (x: number, y: number) => {
    const p = t.toScreen({ x, y });
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.2, 0.009 * s), 0, Math.PI * 2);
    ctx.fill();
  };
  const d = RAIL * 0.62;
  for (const k of [1, 2, 3, 5, 6, 7]) {
    dot((L * k) / 8, -d);
    dot((L * k) / 8, W + d);
  }
  for (const k of [1, 2, 3]) {
    dot(-d, (W * k) / 4);
    dot(L + d, (W * k) / 4);
  }
}

function drawBall(ctx: CanvasRenderingContext2D, t: ViewTransform, b: BallPos, alpha = 1) {
  const p = t.toScreen(b.pos);
  const r = R * t.scale;
  const { fill, stripe } = ballColor(b.id);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(p.x, p.y + r * 0.18, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = stripe ? '#f6f2e6' : fill;
  ctx.fill();
  if (stripe) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = fill;
    ctx.fillRect(p.x - r, p.y - r * 0.55, 2 * r, r * 1.1);
    ctx.restore();
  }
  if (b.id > 0) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.56, 0, Math.PI * 2);
    ctx.fillStyle = '#f6f2e6';
    ctx.fill();
    ctx.fillStyle = '#17181a';
    ctx.font = `700 ${Math.max(5, r * (b.id >= 10 ? 0.78 : 0.95))}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(b.id), p.x, p.y + r * 0.05);
  }
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(0.6, r * 0.07);
  ctx.stroke();
  ctx.restore();
}

function strokePath(ctx: CanvasRenderingContext2D, t: ViewTransform, pts: Vec2[], from = 0, to = pts.length - 1) {
  if (to - from < 1) return;
  ctx.beginPath();
  for (let i = from; i <= to; i++) {
    const p = t.toScreen(pts[i]);
    if (i === from) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawOverlay(ctx: CanvasRenderingContext2D, t: ViewTransform, s: Suggestion) {
  const sc = t.scale;
  const r = R * sc;
  const lw = Math.max(1.5, 0.007 * sc);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Where the cue ball is expected to stop: a band through the soft / nominal / firm results.
  if (s.stopZone.length > 0) {
    const order = s.stopZone.length === 3 ? [s.stopZone[1], s.stopZone[0], s.stopZone[2]] : s.stopZone;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 3.2 * r;
    ctx.beginPath();
    order.forEach((q, i) => {
      const p = t.toScreen(q);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    if (order.length === 1) {
      const p = t.toScreen(order[0]);
      ctx.lineTo(p.x + 0.01, p.y);
    }
    ctx.stroke();
  }

  // Target pocket
  if (s.pocket) {
    const c = pocketCenter(s.pocket);
    const a = pocketAxis(s.pocket);
    const p = t.toScreen({ x: c.x + a.x * 0.025, y: c.y + a.y * 0.025 });
    ctx.strokeStyle = '#f2c230';
    ctx.lineWidth = lw * 1.4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.075 * sc, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Other balls that get moved
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = lw * 0.8;
  for (const key of Object.keys(s.sim.paths)) {
    const id = Number(key);
    if (id !== 0 && id !== s.targetId) strokePath(ctx, t, s.sim.paths[id]);
  }

  // Object ball path
  const objPath = s.sim.paths[s.targetId];
  if (objPath) {
    ctx.strokeStyle = ballColor(s.targetId).fill;
    ctx.lineWidth = lw * 1.3;
    strokePath(ctx, t, objPath);
  }

  // Cue ball: solid up to first contact, dashed afterwards
  const cuePath = s.sim.paths[0] ?? [];
  const cueTimes = s.sim.times[0] ?? [];
  const hit = s.sim.events.find((e) => e.type === 'ball' && (e.ball === 0 || e.other === 0));
  let split = cuePath.length - 1;
  if (hit) {
    const i = cueTimes.findIndex((x) => x >= hit.t);
    if (i >= 0) split = i;
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = lw * 1.3;
  strokePath(ctx, t, cuePath, 0, split);
  ctx.setLineDash([lw * 3, lw * 3]);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  strokePath(ctx, t, cuePath, split);

  // Ghost ball at contact
  if (hit && cuePath[split]) {
    const p = t.toScreen(cuePath[split]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Cue ball's resting place
  const end = s.sim.final.find((b) => b.id === 0);
  if (end) {
    const p = t.toScreen(end.pos);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(246,242,230,0.45)';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.restore();
}

function selectedSuggestion(s: AppState): Suggestion | null {
  if (!s.advice || s.advice.status !== 'ok') return null;
  return s.advice.suggestions[s.selected] ?? null;
}

function drawScene(ctx: CanvasRenderingContext2D, t: ViewTransform, s: AppState, ui: TableUi) {
  drawBed(ctx, t);
  const replaying = !!ui.replay;
  const sug = selectedSuggestion(s);
  if (sug && !ui.drag && !replaying) drawOverlay(ctx, t, sug);
  const balls = ui.replay ?? s.layout.balls;
  const target = targetBallId(s.layout);
  for (const b of balls) {
    if (!replaying && b.id === target) {
      const p = t.toScreen(b.pos);
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * t.scale * 1.55, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(242,194,48,0.9)';
      ctx.lineWidth = Math.max(1.2, R * t.scale * 0.18);
      ctx.stroke();
    }
    drawBall(ctx, t, b);
  }
}

const LOUPE_R = 48;
const LOUPE_ZOOM = 2.5;
const LOUPE_LIFT = 70;

/** Draw the table for the current state. The context must already be scaled for devicePixelRatio. */
export function drawTable(ctx: CanvasRenderingContext2D, t: ViewTransform, s: AppState, ui: TableUi, cssW: number, cssH: number): void {
  ctx.clearRect(0, 0, cssW, cssH);
  drawScene(ctx, t, s, ui);

  const drag = ui.drag;
  const ball = drag && s.layout.balls.find((b) => b.id === drag.id);
  if (!drag || !ball) return;
  // Magnifier above the finger (below it when there is no room), centred on the dragged ball.
  const focus = t.toScreen(ball.pos);
  let cx = Math.min(cssW - LOUPE_R - 4, Math.max(LOUPE_R + 4, drag.finger.x));
  let cy = drag.finger.y - LOUPE_LIFT - LOUPE_R;
  if (cy < LOUPE_R + 4) cy = Math.min(cssH - LOUPE_R - 4, drag.finger.y + LOUPE_LIFT + LOUPE_R);
  if (!Number.isFinite(cx)) cx = LOUPE_R + 4;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, LOUPE_R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#0e1512';
  ctx.fillRect(cx - LOUPE_R, cy - LOUPE_R, 2 * LOUPE_R, 2 * LOUPE_R);
  ctx.translate(cx, cy);
  ctx.scale(LOUPE_ZOOM, LOUPE_ZOOM);
  ctx.translate(-focus.x, -focus.y);
  drawScene(ctx, t, s, { drag });
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, LOUPE_R, 0, Math.PI * 2);
  ctx.strokeStyle = '#f2c230';
  ctx.lineWidth = 2;
  ctx.stroke();
}

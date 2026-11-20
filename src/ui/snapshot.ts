import { describeTip } from '../core/explain';
import { cardTitle, powerText } from './cards';
import { activeSuggestion, type AppState } from './state';
import { computeTransform, drawTable } from './tableView';

/** Long side of the table in the saved picture, in pixels. */
const LONG_PX = 1600;
/** Table with rails is 2.71 m by 1.44 m. */
const ASPECT = 2.71 / 1.44;
const FONT = 30;
const LINE = 40;
const PAD = 28;
const BG = '#0e1512';

export function snapshotSize(portrait: boolean, captionLines: number): { w: number; h: number; tableH: number; captionH: number } {
  const w = portrait ? Math.round(LONG_PX / ASPECT) : LONG_PX;
  const tableH = portrait ? LONG_PX : Math.round(LONG_PX / ASPECT);
  const captionH = captionLines > 0 ? captionLines * LINE + 2 * PAD : 0;
  return { w, h: tableH + captionH, tableH, captionH };
}

/** Title, how to strike, and what to expect, for the shot drawn on the table. Empty when there is none. */
export function snapshotCaption(s: AppState, portrait: boolean): string[] {
  const sug = activeSuggestion(s);
  if (!sug || s.computing) return [];
  const title = s.custom ? `Tự chỉnh: bi ${sug.targetId}${s.custom.aim === null ? '' : ', tự xoay cơ'}` : cardTitle(sug, portrait);
  return [title, `Điểm chạm: ${describeTip(sug.shot.tip)} · ${powerText(sug.powerLevel, s.cloth)}`, sug.text];
}

export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function snapshotFileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `ban-bi-a-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
}

const font = (weight: number) => `${weight} ${FONT}px system-ui, -apple-system, 'Segoe UI', sans-serif`;

/** The table as it is shown now (balls, pocketed balls, the drawn shot) with a caption underneath. */
export function renderSnapshot(s: AppState, portrait: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const width = snapshotSize(portrait, 0).w;
  const caption = snapshotCaption(s, portrait);
  const rows: { text: string; bold: boolean }[] = [];
  caption.forEach((text, i) => {
    ctx.font = font(i === 0 ? 700 : 400);
    for (const line of wrapText(text, width - 2 * PAD, (t) => ctx.measureText(t).width)) rows.push({ text: line, bold: i === 0 });
  });
  const size = snapshotSize(portrait, rows.length);
  canvas.width = size.w;
  canvas.height = size.h;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size.w, size.h);
  const margin = 12;
  ctx.save();
  ctx.translate(margin, margin);
  drawTable(ctx, computeTransform(size.w - 2 * margin, size.tableH - 2 * margin, portrait), s, {}, 0, 0);
  ctx.restore();
  ctx.textBaseline = 'middle';
  rows.forEach((r, i) => {
    ctx.font = font(r.bold ? 700 : 400);
    ctx.fillStyle = r.bold ? '#f2c230' : '#e8efe9';
    ctx.fillText(r.text, PAD, size.tableH + PAD + LINE * (i + 0.5));
  });
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

/**
 * Hand the picture to the phone's share sheet (where "save image" lives), or download it elsewhere.
 * Resolves to how it went so the button can say so.
 */
export async function saveSnapshot(canvas: HTMLCanvasElement, name: string): Promise<'shared' | 'downloaded' | 'cancelled' | 'failed'> {
  const blob = await toBlob(canvas);
  if (!blob) return 'failed';
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (touch && typeof navigator.share === 'function' && typeof File === 'function') {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
        // sharing refused: fall through to a download
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

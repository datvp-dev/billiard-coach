import type { AdviseOptions } from '../core/advisor';
import type { AdviceResult, Layout } from '../core/types';

export type AdvisorClient = { request(layout: Layout, opts: AdviseOptions): void; dispose(): void };

const defaultWorker = () => new Worker(new URL('./advisor.worker.ts', import.meta.url), { type: 'module' });

/**
 * Runs the advisor off the main thread. Only the latest request's result is delivered;
 * a computation made stale by a newer request is killed rather than queued behind.
 */
export function createAdvisorClient(
  onResult: (r: AdviceResult, layout: Layout) => void,
  makeWorker: () => Worker = defaultWorker,
): AdvisorClient {
  let worker: Worker | null = null;
  let seq = 0;
  let pending: { seq: number; layout: Layout } | null = null;

  const finish = (result: AdviceResult) => {
    const p = pending;
    pending = null;
    if (p) onResult(result, p.layout);
  };

  const start = () => {
    const w = makeWorker();
    w.onmessage = (e: MessageEvent<{ seq: number; result: AdviceResult }>) => {
      if (w !== worker || !pending || e.data.seq !== pending.seq) return;
      finish(e.data.result);
    };
    w.onerror = () => {
      if (w !== worker) return;
      w.terminate();
      worker = null;
      finish({ status: 'ok', targetId: 0, suggestions: [] });
    };
    return w;
  };

  return {
    request(layout, opts) {
      if (worker && pending) {
        worker.terminate();
        worker = null;
      }
      if (!worker) worker = start();
      seq++;
      pending = { seq, layout };
      worker.postMessage({ seq, layout, opts });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending = null;
    },
  };
}

import type { LiveReply, LiveRequest } from './live.worker';

export type LiveClient = { look(r: Omit<LiveRequest, 'seq'>): Promise<LiveReply>; dispose(): void };

/** Reads video frames off the main thread, one at a time. */
export function createLiveClient(makeWorker: () => Worker = () => new Worker(new URL('./live.worker.ts', import.meta.url), { type: 'module' })): LiveClient {
  let worker: Worker | null = null;
  let seq = 0;
  let waiting: { seq: number; done(r: LiveReply): void; fail(e: Error): void } | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const send = (r: Omit<LiveRequest, 'seq'>) =>
      new Promise<LiveReply>((done, fail) => {
        if (!worker) {
          worker = makeWorker();
          worker.onmessage = (e: MessageEvent<LiveReply>) => {
            const w = waiting;
            if (!w || e.data.seq !== w.seq) return;
            waiting = null;
            w.done(e.data);
          };
          worker.onerror = (e) => {
            const w = waiting;
            waiting = null;
            worker?.terminate();
            worker = null;
            w?.fail(new Error(e.message || 'worker failed'));
          };
        }
        seq++;
        waiting = { seq, done, fail };
        worker.postMessage({ ...r, seq }, [r.data.buffer]);
      });
  return {
    look(r) {
      const answer = tail.then(() => send(r));
      tail = answer.catch(() => {});
      return answer;
    },
    dispose() {
      worker?.terminate();
      worker = null;
      waiting = null;
    },
  };
}

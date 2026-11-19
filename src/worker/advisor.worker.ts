import { advise, type AdviseOptions } from '../core/advisor';
import type { Layout } from '../core/types';

export type AdvisorRequest = { seq: number; layout: Layout; opts: AdviseOptions };

self.onmessage = (e: MessageEvent<AdvisorRequest>) => {
  const { seq, layout, opts } = e.data;
  self.postMessage({ seq, result: advise(layout, opts) });
};

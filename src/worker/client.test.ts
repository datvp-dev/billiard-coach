import { expect, test } from 'vitest';
import type { AdviceResult, Layout } from '../core/types';
import { v2 } from '../core/vec';
import { createAdvisorClient } from './client';

class FakeWorker {
  posted: any[] = [];
  terminated = 0;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  postMessage(m: any) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated++;
  }
}
const setup = () => {
  const workers: FakeWorker[] = [];
  const results: { r: AdviceResult; layout: Layout }[] = [];
  const client = createAdvisorClient(
    (r, layout) => results.push({ r, layout }),
    () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    },
  );
  return { workers, results, client };
};
const A: Layout = { mode: '9', balls: [{ id: 0, pos: v2(1, 0.5) }] };
const B: Layout = { mode: '9', balls: [{ id: 0, pos: v2(2, 0.5) }] };
const res: AdviceResult = { status: 'no-target' };

test('a result is delivered with the layout it was computed for', () => {
  const { workers, results, client } = setup();
  client.request(A, { cloth: 'medium' });
  expect(workers[0].posted[0].layout).toEqual(A);
  workers[0].onmessage!({ data: { seq: workers[0].posted[0].seq, result: res } });
  expect(results).toEqual([{ r: res, layout: A }]);
});
test('a stale result is dropped', () => {
  const { workers, results, client } = setup();
  client.request(A, { cloth: 'medium' });
  const first = workers[0];
  const seqA = first.posted[0].seq;
  client.request(B, { cloth: 'medium' });
  first.onmessage?.({ data: { seq: seqA, result: res } });
  expect(results).toHaveLength(0);
  const second = workers[workers.length - 1];
  second.onmessage!({ data: { seq: second.posted[second.posted.length - 1].seq, result: res } });
  expect(results).toEqual([{ r: res, layout: B }]);
});
test('an in-flight worker is terminated when a new request arrives', () => {
  const { workers, client } = setup();
  client.request(A, { cloth: 'medium' });
  client.request(B, { cloth: 'medium' });
  expect(workers).toHaveLength(2);
  expect(workers[0].terminated).toBe(1);
});
test('an idle worker is reused', () => {
  const { workers, client } = setup();
  client.request(A, { cloth: 'medium' });
  workers[0].onmessage!({ data: { seq: workers[0].posted[0].seq, result: res } });
  client.request(B, { cloth: 'medium' });
  expect(workers).toHaveLength(1);
  expect(workers[0].terminated).toBe(0);
});
test('a worker crash reports an empty result instead of hanging', () => {
  const { workers, results, client } = setup();
  client.request(A, { cloth: 'medium' });
  workers[0].onerror!(new Error('boom'));
  expect(results).toHaveLength(1);
  expect(results[0].r).toEqual({ status: 'ok', targetId: 0, suggestions: [] });
});

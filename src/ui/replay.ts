import type { BallPos, SimResult } from '../core/types';

export function simDuration(sim: SimResult): number {
  return sim.duration;
}

/** Ball positions at time t of a simulated shot. Pocketed balls disappear at their pocket event. */
export function sampleAt(sim: SimResult, start: BallPos[], t: number): BallPos[] {
  const time = Math.max(0, Math.min(t, sim.duration));
  const out: BallPos[] = [];
  for (const b of start) {
    const pocket = sim.events.find((e) => e.type === 'pocket' && e.ball === b.id);
    if (pocket && time >= pocket.t) continue;
    const path = sim.paths[b.id];
    const times = sim.times[b.id];
    if (!path || path.length === 0) {
      out.push(b);
      continue;
    }
    if (time <= times[0]) {
      out.push({ id: b.id, pos: path[0] });
      continue;
    }
    const last = path.length - 1;
    if (time >= times[last]) {
      out.push({ id: b.id, pos: path[last] });
      continue;
    }
    let i = 1;
    while (times[i] < time) i++;
    const span = times[i] - times[i - 1];
    const f = span > 0 ? (time - times[i - 1]) / span : 1;
    out.push({
      id: b.id,
      pos: { x: path[i - 1].x + (path[i].x - path[i - 1].x) * f, y: path[i - 1].y + (path[i].y - path[i - 1].y) * f },
    });
  }
  return out;
}

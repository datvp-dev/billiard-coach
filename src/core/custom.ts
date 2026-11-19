import { ghostBall, potProbability, solveAim } from './aim';
import { leaveQuality } from './advisor';
import { PHYS } from './config';
import { explain } from './explain';
import { simulate } from './physics/simulate';
import { speedForPower } from './power';
import { nextBallId } from './table';
import type { ClothSpeed, Layout, Suggestion, Tip, Vec2 } from './types';
import { angleOf, sub } from './vec';

/** Furthest the tip may strike from the centre, as a fraction of the ball radius. */
export const MAX_TIP = 0.5;

export function clampTip(tip: Tip): Tip {
  const d = Math.hypot(tip.side, tip.vert);
  if (d <= MAX_TIP) return { side: tip.side, vert: tip.vert };
  return { side: (tip.side * MAX_TIP) / d, vert: (tip.vert * MAX_TIP) / d };
}

/**
 * The player's own tip position and power on the line of an existing suggestion.
 * A pot is re-aimed for the new spin and speed; a safety or kick keeps its line.
 * Nothing is filtered out: a miss or a foul is simulated and described as such.
 */
export function customShot(layout: Layout, base: Suggestion, tipWanted: Tip, power: number, cloth: ClothSpeed): Suggestion {
  const tip = clampTip(tipWanted);
  const speed = speedForPower(power);
  const cue = layout.balls.find((b) => b.id === 0)!.pos;
  const obj = layout.balls.find((b) => b.id === base.targetId)!.pos;

  let dir: number;
  if (base.kind === 'pot' && base.pocket) {
    const solved = solveAim(layout, base.targetId, base.pocket, speed, tip, cloth);
    dir = solved ?? angleOf(sub(ghostBall(obj, base.pocket), cue)) - PHYS.squirtPerSide * tip.side;
  } else {
    // Same travel line as the suggestion once squirt is taken into account.
    dir = base.shot.dir + PHYS.squirtPerSide * (base.shot.tip.side - tip.side);
  }
  const shot = { dir, speed, tip };
  const sim = simulate(layout.balls, shot, { cloth });
  const end = (s: typeof sim): Vec2 | null => s.final.find((b) => b.id === 0)?.pos ?? null;

  const potted = base.kind === 'pot' && !sim.cueScratched && sim.pocketed.some((p) => p.id === base.targetId && p.pocket === base.pocket);
  const nextId = nextBallId(layout, base.targetId);
  const stopZone: Vec2[] = [end(sim) ?? cue];
  let posQuality = base.kind === 'pot' ? 0 : base.posQuality;
  if (potted) {
    let q = nextId === null ? 1 : leaveQuality(sim, layout.mode, base.targetId, base.pocket!);
    for (const f of [0.9, 1.1]) {
      const alt = simulate(layout.balls, { ...shot, speed: speed * f }, { cloth });
      const p = end(alt);
      if (p) stopZone.push(p);
      q += nextId === null ? (alt.cueScratched ? 0 : 1) : leaveQuality(alt, layout.mode, base.targetId, base.pocket!);
    }
    posQuality = q / 3;
  }
  const hit = sim.events.find((e) => e.type === 'ball');
  const draft: Omit<Suggestion, 'text'> = {
    kind: base.kind,
    targetId: base.targetId,
    pocket: base.pocket,
    shot,
    tipName: 'custom',
    powerLevel: power,
    potProb: potted ? potProbability(cue, obj, base.pocket!) : 0,
    posQuality,
    score: 0,
    ghost: base.kind === 'pot' ? (hit ? hit.pos : ghostBall(obj, base.pocket!)) : base.ghost,
    sim,
    stopZone,
  };
  return { ...draft, text: explain(draft, nextId) };
}

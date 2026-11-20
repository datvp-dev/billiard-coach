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

/** What a hand-set shot needs from the suggestion it starts from. */
export type ShotBase = Pick<Suggestion, 'kind' | 'targetId' | 'pocket' | 'shot' | 'posQuality' | 'ghost'>;

/**
 * The player's own tip position and power on the line of an existing suggestion.
 * With `aim` null the shot is aimed for them: a pot is re-aimed for the new spin and speed,
 * a safety or kick keeps its line. With `aim` set, the cue points exactly that way.
 * Nothing is filtered out: a miss or a foul is simulated and described as such.
 */
export function customShot(layout: Layout, base: ShotBase, tipWanted: Tip, power: number, cloth: ClothSpeed, aim: number | null = null): Suggestion {
  const tip = clampTip(tipWanted);
  const speed = speedForPower(power);
  const cue = layout.balls.find((b) => b.id === 0)!.pos;
  const obj = layout.balls.find((b) => b.id === base.targetId)!.pos;

  let dir: number;
  if (aim !== null) dir = aim;
  else if (base.kind === 'pot' && base.pocket) {
    const solved = solveAim(layout, base.targetId, base.pocket, speed, tip, cloth);
    dir = solved ?? angleOf(sub(ghostBall(obj, base.pocket), cue)) - PHYS.squirtPerSide * tip.side;
  } else {
    // Same travel line as the suggestion once squirt is taken into account.
    dir = base.shot.dir + PHYS.squirtPerSide * (base.shot.tip.side - tip.side);
  }
  const shot = { dir, speed, tip };
  const sim = simulate(layout.balls, shot, { cloth });
  const end = (s: typeof sim): Vec2 | null => s.final.find((b) => b.id === 0)?.pos ?? null;

  // A hand-aimed shot may send the ball to any pocket; an automatic one is judged on its own pocket.
  const fell = sim.pocketed.find((p) => p.id === base.targetId && (aim !== null || p.pocket === base.pocket));
  const kind = aim !== null ? 'pot' : base.kind;
  const pocket = aim !== null ? fell?.pocket : base.pocket;
  const potted = kind === 'pot' && !sim.cueScratched && sim.firstContact === base.targetId && !!fell && !!pocket;
  const nextId = nextBallId(layout, base.targetId);
  const stopZone: Vec2[] = [end(sim) ?? cue];
  let posQuality = kind === 'pot' ? 0 : base.posQuality;
  if (potted) {
    let q = nextId === null ? 1 : leaveQuality(sim, layout.mode, base.targetId, pocket!);
    for (const f of [0.9, 1.1]) {
      const alt = simulate(layout.balls, { ...shot, speed: speed * f }, { cloth });
      const p = end(alt);
      if (p) stopZone.push(p);
      q += nextId === null ? (alt.cueScratched ? 0 : 1) : leaveQuality(alt, layout.mode, base.targetId, pocket!);
    }
    posQuality = q / 3;
  }
  const hit = sim.events.find((e) => e.type === 'ball');
  const draft: Omit<Suggestion, 'text'> = {
    kind,
    targetId: base.targetId,
    pocket,
    shot,
    tipName: 'custom',
    powerLevel: power,
    potProb: potted ? potProbability(cue, obj, pocket!) : 0,
    posQuality,
    score: 0,
    ghost: kind === 'pot' ? (hit ? hit.pos : pocket ? ghostBall(obj, pocket) : null) : base.ghost,
    sim,
    stopZone,
  };
  return { ...draft, text: explain(draft, nextId) };
}

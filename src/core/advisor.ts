import { bestPotProbability, ghostBall, pathClear, potGeometryOk, potProbability, solveAim } from './aim';
import { POWER_SPEEDS, SCORE, TABLE, TIPS } from './config';
import { explain } from './explain';
import { firstContactState, simulate } from './physics/simulate';
import { POCKET_IDS, nextBallId, targetBallId } from './table';
import type { AdviceResult, ClothSpeed, Layout, PocketId, PowerLevel, Shot, SimResult, Suggestion, TipName, Vec2 } from './types';
import { angleOf, dist, sub } from './vec';

export type AdviseOptions = { cloth: ClothSpeed };

const { L, W, R } = TABLE;
const LEVELS: PowerLevel[] = [1, 2, 3, 4, 5];
const PERTURB = [0.9, 1.1];
/** Only the most promising candidates get the extra speed-perturbed runs. */
const MAX_REFINED = 12;

type Draft = Omit<Suggestion, 'text'>;

function cuePos(sim: SimResult): Vec2 | null {
  const c = sim.final.find((b) => b.id === 0);
  return c ? c.pos : null;
}

/** Quality of the leave: best pot chance on the next ball from where everything stopped. */
function leaveQuality(sim: SimResult, mode: Layout['mode'], targetId: number, pocket: PocketId): number {
  if (sim.cueScratched) return 0;
  if (!sim.pocketed.some((p) => p.id === targetId && p.pocket === pocket)) return 0;
  const after: Layout = { mode, balls: sim.final };
  const next = targetBallId(after);
  if (next === null) return 1;
  return bestPotProbability(after, next);
}

function nearRail(p: Vec2): boolean {
  return p.x < 1.5 * R || p.x > L - 1.5 * R || p.y < 1.5 * R || p.y > W - 1.5 * R;
}

function potCandidates(layout: Layout, targetId: number, tips: TipName[], cloth: ClothSpeed): Draft[] {
  const cue = layout.balls.find((b) => b.id === 0)!.pos;
  const obj = layout.balls.find((b) => b.id === targetId)!.pos;
  const isLast = nextBallId(layout, targetId) === null;
  const drafts: { d: Draft; prelim: number }[] = [];

  for (const pocket of POCKET_IDS) {
    if (!potGeometryOk(layout, targetId, pocket)) continue;
    const potProb = potProbability(cue, obj, pocket);
    for (const tipName of tips) {
      for (const powerLevel of LEVELS) {
        const speed = POWER_SPEEDS[powerLevel - 1];
        const tip = TIPS[tipName];
        const dir = solveAim(layout, targetId, pocket, speed, tip, cloth);
        if (dir === null) continue;
        const shot: Shot = { dir, speed, tip };
        const sim = simulate(layout.balls, shot, { cloth });
        if (sim.cueScratched) continue;
        if (!sim.pocketed.some((p) => p.id === targetId && p.pocket === pocket)) continue;
        const end = cuePos(sim)!;
        const q = isLast ? 1 : leaveQuality(sim, layout.mode, targetId, pocket);
        const hit = sim.events.find((e) => e.type === 'ball');
        drafts.push({
          prelim: potProb * (SCORE.wPot + SCORE.wPos * q),
          d: {
            kind: 'pot',
            targetId,
            pocket,
            shot,
            tipName,
            powerLevel,
            potProb,
            posQuality: q,
            score: 0,
            ghost: hit ? hit.pos : ghostBall(obj, pocket),
            sim,
            stopZone: [end],
          },
        });
      }
    }
  }

  drafts.sort((a, b) => b.prelim - a.prelim);
  const out: Draft[] = [];
  for (const { d } of drafts.slice(0, MAX_REFINED)) {
    let qSum = d.posQuality;
    let scratchRisk = false;
    for (const f of PERTURB) {
      const sim = simulate(layout.balls, { ...d.shot, speed: d.shot.speed * f }, { cloth });
      if (sim.cueScratched) scratchRisk = true;
      else d.stopZone.push(cuePos(sim)!);
      qSum += isLast ? (sim.cueScratched ? 0 : 1) : leaveQuality(sim, layout.mode, targetId, d.pocket!);
    }
    d.posQuality = isLast && !scratchRisk ? 1 : qSum / (1 + PERTURB.length);
    let score = d.potProb * (SCORE.wPot + SCORE.wPos * d.posQuality);
    if (d.tipName === 'center') score += SCORE.bonusCenter;
    if (d.powerLevel === 2 || d.powerLevel === 3) score += SCORE.bonusMidPower;
    if (d.powerLevel === 4) score -= SCORE.penHighPower;
    if (d.powerLevel === 5) score -= SCORE.penMaxPower;
    if (d.tipName === 'left' || d.tipName === 'right') score -= SCORE.penSide;
    if (d.sim.cueTouched.length > 1) score -= SCORE.penExtraContact;
    if (nearRail(d.stopZone[0])) score -= SCORE.penNearRail;
    if (scratchRisk) score *= SCORE.scratchPerturbFactor;
    d.score = score;
    out.push(d);
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function pickDistinct(cands: Draft[], max: number): Draft[] {
  const chosen: Draft[] = [];
  for (const c of cands) {
    if (chosen.length >= max) break;
    if (chosen.length > 0 && c.score < chosen[0].score - SCORE.maxScoreGap) break;
    const clash = chosen.some((o) => o.pocket === c.pocket && dist(o.stopZone[0], c.stopZone[0]) < SCORE.diversityDist);
    if (!clash) chosen.push(c);
  }
  return chosen;
}

const SAFETY_FULLNESS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];

function bestSafety(layout: Layout, targetId: number, cloth: ClothSpeed): Draft | null {
  const cue = layout.balls.find((b) => b.id === 0)!.pos;
  const obj = layout.balls.find((b) => b.id === targetId)!.pos;
  const toObj = sub(obj, cue);
  const d = Math.hypot(toObj.x, toObj.y);
  if (d < 1e-6) return null;
  const px = -toObj.y / d;
  const py = toObj.x / d;
  let best: Draft | null = null;
  for (const f of SAFETY_FULLNESS) {
    const aim = { x: obj.x + px * f * 2 * R, y: obj.y + py * f * 2 * R };
    const dir = angleOf(sub(aim, cue));
    for (const powerLevel of [1, 2, 3] as PowerLevel[]) {
      const shot: Shot = { dir, speed: POWER_SPEEDS[powerLevel - 1], tip: TIPS.center };
      const sim = simulate(layout.balls, shot, { cloth });
      if (sim.firstContact !== targetId || sim.cueScratched) continue;
      if (!(sim.railAfterContact || sim.pocketed.length > 0)) continue;
      const cueEnd = cuePos(sim);
      const objEnd = sim.final.find((b) => b.id === targetId);
      if (!cueEnd || !objEnd) continue;
      const hidden = !pathClear(cueEnd, objEnd.pos, sim.final, [0, targetId]);
      const apart = dist(cueEnd, objEnd.pos);
      // The opponent's best direct pot from the leave counts against it.
      const leave = bestPotProbability({ mode: layout.mode, balls: sim.final }, targetId);
      const score = 0.6 * (hidden ? 1 : 0) + 0.4 * Math.min(1, apart / 2) - 0.5 * (hidden ? 0 : leave);
      if (!best || score > best.score) {
        best = {
          kind: 'safety',
          targetId,
          shot,
          tipName: 'center',
          powerLevel,
          potProb: 0,
          posQuality: hidden ? 1 : 0,
          score,
          // For a safety, `ghost` marks the ball being played off.
          ghost: { x: obj.x, y: obj.y },
          sim,
          stopZone: [cueEnd],
        };
      }
    }
  }
  return best;
}

function bestKick(layout: Layout, targetId: number, cloth: ClothSpeed): Draft | null {
  const cue = layout.balls.find((b) => b.id === 0)!.pos;
  const STEP = 1;
  let best: { level: PowerLevel; rails: number; width: number; mid: number } | null = null;
  for (const level of [3, 2] as PowerLevel[]) {
    const speed = POWER_SPEEDS[level - 1];
    const rails: number[] = [];
    for (let a = 0; a < 360; a += STEP) {
      const s = firstContactState(layout.balls, { dir: (a * Math.PI) / 180, speed, tip: TIPS.high }, { cloth });
      rails.push(s.firstContact === targetId && s.cushionsBefore > 0 ? s.cushionsBefore : 0);
    }
    // Widest run of consecutive directions that reach the ball off the same number of rails.
    const n = rails.length;
    for (let i = 0; i < n; i++) {
      if (rails[i] === 0 || rails[(i + n - 1) % n] === rails[i]) continue;
      let w = 1;
      while (w < n && rails[(i + w) % n] === rails[i]) w++;
      const cand = { level, rails: rails[i], width: w, mid: i + (w - 1) / 2 };
      if (!best || cand.rails < best.rails || (cand.rails === best.rails && cand.width > best.width)) best = cand;
    }
  }
  if (!best) return null;
  const shot: Shot = { dir: (best.mid * STEP * Math.PI) / 180, speed: POWER_SPEEDS[best.level - 1], tip: TIPS.high };
  const sim = simulate(layout.balls, shot, { cloth });
  if (sim.firstContact !== targetId) return null;
  const end = cuePos(sim);
  return {
    kind: 'kick',
    targetId,
    shot,
    tipName: 'high',
    powerLevel: best.level,
    potProb: 0,
    posQuality: 0,
    score: 0,
    ghost: null,
    sim,
    stopZone: end ? [end] : [cue],
  };
}

/** Suggest up to three ways to play the lowest ball on the table. */
export function advise(layout: Layout, opts: AdviseOptions): AdviceResult {
  if (!layout.balls.some((b) => b.id === 0)) return { status: 'no-cue' };
  const targetId = targetBallId(layout);
  if (targetId === null) return { status: 'no-target' };
  const { cloth } = opts;

  let pots = potCandidates(layout, targetId, ['center', 'high', 'low'], cloth);
  const bestPot = () => pots.reduce((m, p) => Math.max(m, p.potProb), 0);
  if (bestPot() < SCORE.safetyThreshold) {
    pots = pots.concat(potCandidates(layout, targetId, ['left', 'right'], cloth)).sort((a, b) => b.score - a.score);
  }
  let chosen = pickDistinct(pots, 3);

  if (bestPot() < SCORE.safetyThreshold) {
    const safety = bestSafety(layout, targetId, cloth);
    if (safety) chosen = chosen.slice(0, 2).concat(safety);
    else if (chosen.length === 0) {
      const kick = bestKick(layout, targetId, cloth);
      if (kick) chosen = [kick];
    }
  }

  const nextId = nextBallId(layout, targetId);
  const suggestions: Suggestion[] = chosen.map((d) => ({ ...d, text: explain(d, nextId) }));
  return { status: 'ok', targetId, suggestions };
}

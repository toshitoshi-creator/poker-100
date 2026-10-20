import { createDeck, shuffle } from './deck';
import { compareHands, evaluateBest } from './handEvaluator';
import type { Rng } from './rng';
import type { Card } from './types';

/**
 * Chen-formula preflop score mapped to a rough heads-up equity (0.3–0.85).
 * Cheap and deterministic; good enough for a prototype opponent.
 */
export function preflopEquity([a, b]: readonly [Card, Card]): number {
  const hi = Math.max(a.rank, b.rank);
  const lo = Math.min(a.rank, b.rank);
  const points = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let score: number;
  if (hi === lo) {
    score = Math.max(5, points(hi) * 2);
  } else {
    score = points(hi);
    if (a.suit === b.suit) score += 2;
    const gap = hi - lo - 1;
    score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && hi < 12) score += 1;
  }
  return Math.min(0.85, Math.max(0.3, 0.3 + (0.55 * Math.ceil(score)) / 20));
}

/**
 * Monte Carlo equity against `opponents` random hands, using only what this
 * player can see (own hole cards + visible board). Never peeks at other hands.
 */
export function estimateEquity(hole: readonly Card[], board: readonly Card[], rng: Rng, opponents = 1, samples = 60): number {
  const known = new Set([...hole, ...board].map((c) => c.id));
  const pool = createDeck().filter((c) => !known.has(c.id));
  const need = 5 - board.length;
  let score = 0;
  for (let i = 0; i < samples; i++) {
    const s = shuffle(pool, rng);
    const fullBoard = [...board, ...s.slice(0, need)];
    const mine = evaluateBest([...hole, ...fullBoard]);
    let best = 1; // 1 = winning, fractional on ties, 0 = beaten
    let ties = 0;
    for (let o = 0; o < opponents && best > 0; o++) {
      const villain = s.slice(need + o * 2, need + o * 2 + 2);
      const cmp = compareHands(mine, evaluateBest([...villain, ...fullBoard]));
      if (cmp < 0) best = 0;
      else if (cmp === 0) ties++;
    }
    score += best === 0 ? 0 : 1 / (1 + ties);
  }
  return score / samples;
}

/** Heads-up preflop equity scaled to several opponents (each extra opponent cuts it). */
function preflopMultiway(e: number, opponents: number): number {
  return Math.pow(e, 1 + (opponents - 1) * 0.6);
}

export interface AiContext {
  hole: readonly [Card, Card];
  /** Visible board (0, 3, 4 or 5 cards). */
  board: readonly Card[];
  /** Other players still in the hand. */
  opponents: number;
  /** Total chips in the pot (all streets). */
  pot: number;
  toCall: number;
  stack: number;
  /** Legal raise-to range this decision; null when raising is not allowed. */
  raise: { min: number; max: number } | null;
  /** Current highest bet this street. */
  currentBet: number;
  rng: Rng;
}

export type AiDecision = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; to: number };

export function decide(ctx: AiContext): AiDecision {
  const n = Math.max(1, ctx.opponents);
  const eq = ctx.board.length === 0 ? preflopMultiway(preflopEquity(ctx.hole), n) : estimateEquity(ctx.hole, ctx.board, ctx.rng, n);
  // 1.0 = a fair share of the pot among the players still in.
  const strength = eq * (n + 1);
  const r = ctx.rng();
  const raiseTo = (fraction: number): AiDecision => {
    if (!ctx.raise) return ctx.toCall > 0 ? { type: 'call' } : { type: 'check' };
    const want = ctx.currentBet + Math.round((ctx.pot + ctx.toCall) * fraction);
    const to = Math.min(ctx.raise.max, Math.max(ctx.raise.min, want));
    // Close to all-in anyway: just shove.
    return { type: 'raise', to: to >= ctx.raise.max * 0.8 ? ctx.raise.max : to };
  };

  if (ctx.toCall === 0) {
    if (strength > 1.7) return raiseTo(r < 0.5 ? 0.75 : 0.5);
    if (strength > 1.2 && r < 0.45) return raiseTo(0.5);
    if (r < 0.07) return raiseTo(0.5); // bluff
    return { type: 'check' };
  }

  const potOdds = ctx.toCall / (ctx.pot + ctx.toCall);
  const allIn = ctx.toCall >= ctx.stack;
  if (!allIn && strength > 2.1 && r < 0.55) return raiseTo(1);
  const need = allIn ? potOdds + 0.05 : potOdds * 1.1;
  if (eq >= need) return { type: 'call' };
  return r < 0.04 ? { type: 'call' } : { type: 'fold' }; // occasional hero call
}

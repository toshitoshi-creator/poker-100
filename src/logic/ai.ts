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
 * Monte Carlo equity against one random hand, using only what this player
 * can see (own hole cards + visible board). Never peeks at the other hand.
 */
export function estimateEquity(hole: readonly Card[], board: readonly Card[], rng: Rng, samples = 120): number {
  const known = new Set([...hole, ...board].map((c) => c.id));
  const pool = createDeck().filter((c) => !known.has(c.id));
  let score = 0;
  for (let i = 0; i < samples; i++) {
    const s = shuffle(pool, rng);
    const villain = s.slice(0, 2);
    const fullBoard = [...board, ...s.slice(2, 2 + (5 - board.length))];
    const cmp = compareHands(evaluateBest([...hole, ...fullBoard]), evaluateBest([...villain, ...fullBoard]));
    score += cmp > 0 ? 1 : cmp === 0 ? 0.5 : 0;
  }
  return score / samples;
}

export interface AiContext {
  hole: readonly [Card, Card];
  board: readonly Card[];
  /** Total chips in the pot before this decision. */
  pot: number;
  stack: number;
  /** The most anyone can still bet (smaller of the two stacks). */
  maxBet: number;
  rng: Rng;
}

function equity(ctx: AiContext): number {
  return ctx.board.length === 0 ? preflopEquity(ctx.hole) : estimateEquity(ctx.hole, ctx.board, ctx.rng);
}

/** First to act after a check: returns a bet amount, or 0 to check. */
export function decideOpen(ctx: AiContext): number {
  if (ctx.maxBet <= 0) return 0;
  const e = equity(ctx);
  const r = ctx.rng();
  const size = (f: number) => Math.min(ctx.maxBet, Math.max(1, Math.round(ctx.pot * f)));
  if (e > 0.72) return r < 0.5 ? size(1) : size(0.5);
  if (e > 0.55) return r < 0.6 ? size(0.5) : 0;
  if (r < 0.12) return size(0.5); // bluff
  return 0;
}

/** Facing a bet of `toCall` (already included in `pot`): call or fold. */
export function decideFacing(ctx: AiContext, toCall: number): 'call' | 'fold' {
  const e = equity(ctx);
  const r = ctx.rng();
  const potOdds = toCall / (ctx.pot + toCall);
  const allIn = toCall >= ctx.stack;
  const need = allIn ? potOdds + 0.05 : potOdds * 1.05 - 0.03;
  if (e >= need) return 'call';
  return r < 0.08 ? 'call' : 'fold'; // occasional hero call
}

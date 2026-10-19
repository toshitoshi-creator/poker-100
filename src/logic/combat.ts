import { HandCategory, type HandResult } from './handEvaluator';

/**
 * Extra damage the showdown winner deals on top of taking the pot.
 * It is burned from the loser's HP (not transferred), so strong hands hit
 * harder without inflating stacks.
 */
export const HAND_BONUS: Record<HandCategory, number> = {
  [HandCategory.HighCard]: 0,
  [HandCategory.OnePair]: 0,
  [HandCategory.TwoPair]: 3,
  [HandCategory.ThreeOfAKind]: 5,
  [HandCategory.Straight]: 8,
  [HandCategory.Flush]: 10,
  [HandCategory.FullHouse]: 14,
  [HandCategory.FourOfAKind]: 22,
  [HandCategory.StraightFlush]: 32,
  [HandCategory.RoyalFlush]: 50,
};

/** 0 (weak) … 4 (legendary). Drives how loud the presentation is. */
export type EffectTier = 0 | 1 | 2 | 3 | 4;

export function effectTier(category: HandCategory): EffectTier {
  if (category >= HandCategory.StraightFlush) return 4;
  if (category >= HandCategory.FullHouse) return 3;
  if (category >= HandCategory.Straight) return 2;
  if (category >= HandCategory.TwoPair) return 1;
  return 0;
}

export function handBonus(winner: HandResult): number {
  return HAND_BONUS[winner.category];
}

/** Forced bet both players post every round; rises every 4 rounds. */
export function anteFor(round: number): number {
  return 2 + 2 * Math.floor((Math.max(1, round) - 1) / 4);
}

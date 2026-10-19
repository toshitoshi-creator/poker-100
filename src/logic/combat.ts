import { HandCategory, type HandResult } from './handEvaluator';

/** Base damage dealt by the winning hand. */
export const BASE_DAMAGE: Record<HandCategory, number> = {
  [HandCategory.HighCard]: 8,
  [HandCategory.OnePair]: 12,
  [HandCategory.TwoPair]: 18,
  [HandCategory.ThreeOfAKind]: 24,
  [HandCategory.Straight]: 30,
  [HandCategory.Flush]: 34,
  [HandCategory.FullHouse]: 42,
  [HandCategory.FourOfAKind]: 60,
  [HandCategory.StraightFlush]: 80,
  [HandCategory.RoyalFlush]: 100,
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

/** Damage = base of winner's hand + 3 per category the winner is above the loser. */
export function calculateDamage(winner: HandResult, loser: HandResult): number {
  const gap = Math.max(0, winner.category - loser.category);
  return BASE_DAMAGE[winner.category] + gap * 3;
}

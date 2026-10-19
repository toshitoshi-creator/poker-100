import type { Card, Rank } from './types';

export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

export interface HandInfo {
  en: string;
  ja: string;
}

export const HAND_INFO: Record<HandCategory, HandInfo> = {
  [HandCategory.HighCard]: { en: 'HIGH CARD', ja: 'ハイカード' },
  [HandCategory.OnePair]: { en: 'ONE PAIR', ja: 'ワンペア' },
  [HandCategory.TwoPair]: { en: 'TWO PAIR', ja: 'ツーペア' },
  [HandCategory.ThreeOfAKind]: { en: 'THREE OF A KIND', ja: 'スリーカード' },
  [HandCategory.Straight]: { en: 'STRAIGHT', ja: 'ストレート' },
  [HandCategory.Flush]: { en: 'FLUSH', ja: 'フラッシュ' },
  [HandCategory.FullHouse]: { en: 'FULL HOUSE', ja: 'フルハウス' },
  [HandCategory.FourOfAKind]: { en: 'FOUR OF A KIND', ja: 'フォーカード' },
  [HandCategory.StraightFlush]: { en: 'STRAIGHT FLUSH', ja: 'ストレートフラッシュ' },
  [HandCategory.RoyalFlush]: { en: 'ROYAL FLUSH', ja: 'ロイヤルフラッシュ' },
};

export interface HandResult {
  category: HandCategory;
  /** [category, ...tiebreak ranks]; compare lexicographically. */
  score: number[];
  /** The 5 cards that make the hand, ordered by importance. */
  cards: Card[];
}

function compareScore(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** 1 if a wins, -1 if b wins, 0 for a split pot. */
export function compareHands(a: HandResult, b: HandResult): -1 | 0 | 1 {
  return compareScore(a.score, b.score) as -1 | 0 | 1;
}

/** Returns the high card of a straight in these 5 distinct-or-not ranks, or 0. */
function straightHigh(ranksDesc: readonly Rank[]): number {
  const uniq = [...new Set(ranksDesc)];
  if (uniq.length !== 5) return 0;
  if ((uniq[0] as number) - (uniq[4] as number) === 4) return uniq[0] as number;
  // Wheel: A-2-3-4-5
  if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) return 5;
  return 0;
}

export function evaluateFive(cards: readonly Card[]): HandResult {
  if (cards.length !== 5) throw new Error('evaluateFive needs exactly 5 cards');
  const sorted = [...cards].sort((x, y) => y.rank - x.rank);
  const ranks = sorted.map((c) => c.rank);
  const flush = sorted.every((c) => c.suit === sorted[0]!.suit);
  const sHigh = straightHigh(ranks);

  // Group by rank, ordered by (count desc, rank desc)
  const counts = new Map<Rank, Card[]>();
  for (const c of sorted) counts.set(c.rank, [...(counts.get(c.rank) ?? []), c]);
  const groups = [...counts.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const shape = groups.map((g) => g[1].length).join('');
  const groupRanks = groups.map((g) => g[0] as number);
  const groupedCards = groups.flatMap((g) => g[1]);

  const straightCards = () =>
    sHigh === 5 ? [...sorted.slice(1), sorted[0]!] : sorted; // wheel: ace plays low

  if (flush && sHigh) {
    const category = sHigh === 14 ? HandCategory.RoyalFlush : HandCategory.StraightFlush;
    return { category, score: [category, sHigh], cards: straightCards() };
  }
  if (shape === '41') return { category: HandCategory.FourOfAKind, score: [7, ...groupRanks], cards: groupedCards };
  if (shape === '32') return { category: HandCategory.FullHouse, score: [6, ...groupRanks], cards: groupedCards };
  if (flush) return { category: HandCategory.Flush, score: [5, ...ranks], cards: sorted };
  if (sHigh) return { category: HandCategory.Straight, score: [4, sHigh], cards: straightCards() };
  if (shape === '311') return { category: HandCategory.ThreeOfAKind, score: [3, ...groupRanks], cards: groupedCards };
  if (shape === '221') return { category: HandCategory.TwoPair, score: [2, ...groupRanks], cards: groupedCards };
  if (shape === '2111') return { category: HandCategory.OnePair, score: [1, ...groupRanks], cards: groupedCards };
  return { category: HandCategory.HighCard, score: [0, ...ranks], cards: sorted };
}

/** Best 5-card hand out of 5–7 cards (checks all combinations, max 21). */
export function evaluateBest(cards: readonly Card[]): HandResult {
  if (cards.length < 5 || cards.length > 7) throw new Error('evaluateBest needs 5 to 7 cards');
  let best: HandResult | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const r = evaluateFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (!best || compareScore(r.score, best.score) > 0) best = r;
          }
  return best!;
}

export type Suit = 's' | 'h' | 'd' | 'c';
/** 2..14 (11=J, 12=Q, 13=K, 14=A) */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
  /** Unique within a 52 card deck, e.g. "As", "Td", "2c". */
  readonly id: string;
}

export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const SUIT_SYMBOL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export function rankLabel(rank: Rank): string {
  switch (rank) {
    case 14:
      return 'A';
    case 13:
      return 'K';
    case 12:
      return 'Q';
    case 11:
      return 'J';
    case 10:
      return '10';
    default:
      return String(rank);
  }
}

export function isRed(suit: Suit): boolean {
  return suit === 'h' || suit === 'd';
}

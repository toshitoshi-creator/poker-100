import { RANKS, SUITS, rankLabel, type Card, type Rank, type Suit } from './types';
import type { Rng } from './rng';

export function makeCard(rank: Rank, suit: Suit): Card {
  const r = rank === 10 ? 'T' : rankLabel(rank);
  return { rank, suit, id: `${r}${suit}` };
}

/** Parse "As", "Td", "9h" … (handy for tests). */
export function parseCard(id: string): Card {
  const map: Record<string, Rank> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
  const r = id.slice(0, -1);
  const s = id.slice(-1) as Suit;
  const rank = (map[r] ?? Number(r)) as Rank;
  if (!RANKS.includes(rank) || !SUITS.includes(s)) throw new Error(`Invalid card: ${id}`);
  return makeCard(rank, s);
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(makeCard(rank, suit));
  return deck;
}

/** Fisher–Yates. Returns a new array; input is not mutated. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export function draw(deck: readonly Card[], count: number): { cards: Card[]; rest: Card[] } {
  if (count > deck.length) throw new Error(`Cannot draw ${count} from ${deck.length} cards`);
  return { cards: deck.slice(0, count), rest: deck.slice(count) };
}

export function assertUnique(cards: readonly Card[]): void {
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c.id)) throw new Error(`Duplicate card: ${c.id}`);
    seen.add(c.id);
  }
}

import { assertUnique, createDeck, draw, shuffle } from './deck';
import type { Rng } from './rng';
import type { Card } from './types';

export interface HoldemDeal {
  player: [Card, Card];
  opponent: [Card, Card];
  /** flop = [0..2], turn = [3], river = [4] */
  board: [Card, Card, Card, Card, Card];
}

/** Deal one heads-up Texas Hold'em hand from a fresh shuffled 52 card deck. */
export function dealHoldem(rng: Rng): HoldemDeal {
  let deck = shuffle(createDeck(), rng);
  const take = (n: number) => {
    const r = draw(deck, n);
    deck = r.rest;
    return r.cards;
  };
  // Alternate hole cards like a real dealer: P, O, P, O
  const [p0, o0, p1, o1] = take(4) as [Card, Card, Card, Card];
  take(1); // burn
  const flop = take(3);
  take(1); // burn
  const turn = take(1);
  take(1); // burn
  const river = take(1);
  const deal: HoldemDeal = {
    player: [p0, p1],
    opponent: [o0, o1],
    board: [...flop, ...turn, ...river] as HoldemDeal['board'],
  };
  assertUnique([...deal.player, ...deal.opponent, ...deal.board]);
  return deal;
}

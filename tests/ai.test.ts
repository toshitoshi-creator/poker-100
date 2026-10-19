import { decideFacing, decideOpen, estimateEquity, preflopEquity } from '../src/logic/ai';
import { parseCard } from '../src/logic/deck';
import { mulberry32 } from '../src/logic/rng';
import type { Card } from '../src/logic/types';

const cards = (s: string) => s.split(' ').map(parseCard);
const hole = (s: string) => cards(s) as [Card, Card];

describe('opponent AI', () => {
  it('ranks premium hands above trash preflop', () => {
    expect(preflopEquity(hole('As Ah'))).toBeGreaterThan(preflopEquity(hole('Ks Qs')));
    expect(preflopEquity(hole('Ks Qs'))).toBeGreaterThan(preflopEquity(hole('7c 2d')));
  });

  it('estimates flop equity from visible cards only', () => {
    const nuts = estimateEquity(cards('As Ah'), cards('Ad Ac 7h'), mulberry32(1));
    const air = estimateEquity(cards('2c 3d'), cards('Ad Kc 9h'), mulberry32(1));
    expect(nuts).toBeGreaterThan(0.95);
    expect(air).toBeLessThan(0.3);
  });

  it('is deterministic for the same rng seed', () => {
    const ctx = () => ({ hole: hole('Jh Th'), board: cards('9h 8c 2d'), pot: 20, stack: 60, maxBet: 60, rng: mulberry32(9) });
    expect(decideOpen(ctx())).toBe(decideOpen(ctx()));
    expect(decideFacing(ctx(), 10)).toBe(decideFacing(ctx(), 10));
  });

  it('calls with the nuts and folds air to a big bet', () => {
    const base = { pot: 40, stack: 60, maxBet: 60 };
    expect(decideFacing({ ...base, hole: hole('As Ah'), board: cards('Ad Ac 7h'), rng: mulberry32(2) }, 30)).toBe('call');
    let folds = 0;
    for (let s = 0; s < 20; s++)
      if (decideFacing({ ...base, hole: hole('2c 3d'), board: cards('Ad Kc 9h'), rng: mulberry32(s) }, 40) === 'fold') folds++;
    expect(folds).toBeGreaterThan(15);
  });
});

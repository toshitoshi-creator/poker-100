import { decide, estimateEquity, preflopEquity } from '../src/logic/ai';
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

  it('estimates equity from visible cards only, lower against more opponents', () => {
    const nuts = estimateEquity(cards('As Ah'), cards('Ad Ac 7h'), mulberry32(1));
    const air = estimateEquity(cards('2c 3d'), cards('Ad Kc 9h'), mulberry32(1));
    expect(nuts).toBeGreaterThan(0.95);
    expect(air).toBeLessThan(0.3);
    const vs1 = estimateEquity(cards('Qs Qh'), cards('8d 5c 2h'), mulberry32(3), 1, 200);
    const vs4 = estimateEquity(cards('Qs Qh'), cards('8d 5c 2h'), mulberry32(3), 4, 200);
    expect(vs4).toBeLessThan(vs1);
  });

  it('is deterministic for the same rng seed', () => {
    const ctx = () => ({
      hole: hole('Jh Th'),
      board: cards('9h 8c 2d'),
      opponents: 2,
      pot: 20,
      toCall: 6,
      stack: 60,
      raise: { min: 12, max: 66 },
      currentBet: 6,
      rng: mulberry32(9),
    });
    expect(decide(ctx())).toEqual(decide(ctx()));
  });

  it('never raises outside the legal range and folds air to a big bet', () => {
    let folds = 0;
    for (let s = 0; s < 30; s++) {
      const d = decide({
        hole: hole('2c 3d'),
        board: cards('Ad Kc 9h'),
        opponents: 3,
        pot: 40,
        toCall: 40,
        stack: 60,
        raise: { min: 80, max: 100 },
        currentBet: 40,
        rng: mulberry32(s),
      });
      if (d.type === 'raise') expect(d.to).toBeGreaterThanOrEqual(80);
      if (d.type === 'raise') expect(d.to).toBeLessThanOrEqual(100);
      if (d.type === 'fold') folds++;
    }
    expect(folds).toBeGreaterThan(20);
  });
});

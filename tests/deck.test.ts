import { assertUnique, createDeck, draw, parseCard, shuffle } from '../src/logic/deck';
import { dealHoldem } from '../src/logic/dealer';
import { mulberry32 } from '../src/logic/rng';

describe('deck', () => {
  it('has 52 unique cards', () => {
    const d = createDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d.map((c) => c.id)).size).toBe(52);
  });

  it('shuffle is deterministic per seed and keeps every card', () => {
    const a = shuffle(createDeck(), mulberry32(7)).map((c) => c.id);
    const b = shuffle(createDeck(), mulberry32(7)).map((c) => c.id);
    const c = shuffle(createDeck(), mulberry32(8)).map((c) => c.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect([...a].sort()).toEqual(createDeck().map((x) => x.id).sort());
  });

  it('draw refuses to over-draw', () => {
    expect(() => draw(createDeck(), 53)).toThrow();
  });

  it('assertUnique catches duplicates', () => {
    expect(() => assertUnique([parseCard('As'), parseCard('As')])).toThrow(/Duplicate/);
  });

  it('dealHoldem never repeats a card (1000 seeds)', () => {
    for (let s = 0; s < 1000; s++) {
      const d = dealHoldem(mulberry32(s));
      const ids = [...d.player, ...d.opponent, ...d.board].map((c) => c.id);
      expect(new Set(ids).size).toBe(9);
    }
  });
});

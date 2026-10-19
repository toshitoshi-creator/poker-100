import { BASE_DAMAGE, calculateDamage, effectTier } from '../src/logic/combat';
import { createGame, resolveRound, TOTAL_PLAYERS, type GameState } from '../src/logic/game';
import { HandCategory } from '../src/logic/handEvaluator';
import { applyDamage } from '../src/logic/hp';

function playOut(seed: number, maxRounds = 500): GameState[] {
  const states = [createGame(seed)];
  while (states.at(-1)!.status === 'playing' && states.length < maxRounds) states.push(resolveRound(states.at(-1)!));
  return states;
}

describe('hp', () => {
  it('clamps at 0 and flags elimination', () => {
    const f = { id: 'x', name: 'x', hp: 10, maxHp: 80 };
    const r = applyDamage(f, 25);
    expect(r.fighter.hp).toBe(0);
    expect(r.change).toEqual({ before: 10, after: 0, lost: 10, eliminated: true });
    expect(f.hp).toBe(10); // input not mutated
  });

  it('ignores negative damage', () => {
    expect(applyDamage({ id: 'x', name: 'x', hp: 10, maxHp: 10 }, -5).fighter.hp).toBe(10);
  });
});

describe('combat', () => {
  it('stronger hands deal more and get a louder tier', () => {
    const cats = Object.values(HandCategory).filter((v): v is HandCategory => typeof v === 'number');
    for (let i = 1; i < cats.length; i++) {
      expect(BASE_DAMAGE[cats[i]!]).toBeGreaterThan(BASE_DAMAGE[cats[i - 1]!]);
      expect(effectTier(cats[i]!)).toBeGreaterThanOrEqual(effectTier(cats[i - 1]!));
    }
    expect(effectTier(HandCategory.RoyalFlush)).toBe(4);
  });

  it('adds a bonus for the category gap', () => {
    const w = { category: HandCategory.Flush, score: [], cards: [] };
    const l = { category: HandCategory.OnePair, score: [], cards: [] };
    expect(calculateDamage(w, l)).toBe(BASE_DAMAGE[HandCategory.Flush] + 4 * 3);
  });
});

describe('resolveRound', () => {
  it('is reproducible from the seed', () => {
    expect(playOut(12345)).toEqual(playOut(12345));
    expect(playOut(1).map((s) => s.lastRound?.deal)).not.toEqual(playOut(2).map((s) => s.lastRound?.deal));
  });

  it('does not mutate the input state', () => {
    const s = createGame(9);
    const snapshot = JSON.stringify(s);
    resolveRound(s);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('keeps every invariant across many full games', () => {
    for (let seed = 0; seed < 60; seed++) {
      const states = playOut(seed);
      const end = states.at(-1)!;
      expect(end.status).not.toBe('playing');
      for (let i = 1; i < states.length; i++) {
        const prev = states[i - 1]!;
        const s = states[i]!;
        const r = s.lastRound!;
        expect(s.round).toBe(prev.round + 1);
        expect(s.survivors).toBeLessThanOrEqual(prev.survivors);
        expect(s.survivors).toBeGreaterThanOrEqual(1);
        expect(r.survivors.before).toBe(prev.survivors);
        expect(r.player.before).toEqual(prev.player);
        expect(r.opponent.before).toEqual(prev.opponent);
        if (r.winner === 'tie') expect(r.attack).toBeNull();
        if (r.attack) {
          expect(r.attack.target).not.toBe(r.attack.attacker);
          expect(r.attack.hp.after).toBe(Math.max(0, r.attack.hp.before - r.attack.damage));
        }
        expect(s.player.hp).toBeGreaterThanOrEqual(0);
      }
      if (end.status === 'won') expect(end.survivors).toBe(1);
      if (end.status === 'lost') expect(end.player.hp).toBe(0);
    }
  });

  it('is a no-op once the game is over', () => {
    const end = playOut(3).at(-1)!;
    expect(resolveRound(end)).toBe(end);
  });

  it('starts with 100 survivors', () => {
    expect(createGame(1).survivors).toBe(TOTAL_PLAYERS);
  });
});

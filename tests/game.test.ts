import { anteFor, effectTier, HAND_BONUS } from '../src/logic/combat';
import { createGame, legalActions, playerAct, startHand, TOTAL_PLAYERS, type GameState } from '../src/logic/game';
import { HandCategory } from '../src/logic/handEvaluator';
import { autoplay } from './helpers/autoplay';

const total = (s: GameState) => s.player.hp + s.opponent.hp + (s.hand ? s.hand.committed.player + s.hand.committed.opponent : 0);

describe('rules', () => {
  it('ante rises every 4 rounds', () => {
    expect([1, 4, 5, 8, 9, 13].map(anteFor)).toEqual([2, 2, 4, 4, 6, 8]);
  });

  it('stronger hands deal more bonus damage and get a louder tier', () => {
    const cats = Object.values(HandCategory).filter((v): v is HandCategory => typeof v === 'number');
    for (let i = 1; i < cats.length; i++) {
      expect(HAND_BONUS[cats[i]!]).toBeGreaterThanOrEqual(HAND_BONUS[cats[i - 1]!]);
      expect(effectTier(cats[i]!)).toBeGreaterThanOrEqual(effectTier(cats[i - 1]!));
    }
  });

  it('startHand posts antes and waits for the player', () => {
    const s = startHand(createGame(1));
    expect(s.hand!.committed).toEqual({ player: 2, opponent: 2 });
    expect(s.player.hp).toBe(98);
    expect(s.hand!.facing).toBe(0);
    expect(s.lastEvents.map((e) => e.t)).toEqual(['start']);
    expect(startHand(s)).toBe(s); // cannot start twice
  });

  it('offers check / bets when not facing, fold / call when facing', () => {
    const s = startHand(createGame(1));
    expect(legalActions(s).map((a) => a.type + (a.type === 'bet' ? `:${a.size}` : ''))).toEqual([
      'check',
      'bet:half',
      'bet:pot',
      'bet:allin',
    ]);
    const facing = { ...s, hand: { ...s.hand!, facing: 10 } };
    expect(legalActions(facing).map((a) => a.type)).toEqual(['fold', 'call']);
  });

  it('ignores illegal or stale actions', () => {
    const s = startHand(createGame(1));
    expect(playerAct(s, { type: 'call' })).toBe(s);
    expect(playerAct(createGame(1), { type: 'check' })).toEqual(createGame(1));
  });

  it('folding hands the pot to the other side, no bonus', () => {
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const r = playerAct(startHand(createGame(seed)), { type: 'check' });
      if (!r.hand || r.hand.facing === 0) continue; // opponent checked back
      found = true;
      const f = playerAct(r, { type: 'fold' });
      expect(f.lastRound!.endedBy).toBe('fold');
      expect(f.lastRound!.winner).toBe('opponent');
      expect(f.lastRound!.bonus).toBe(0);
      expect(f.opponent.hp).toBe(r.opponent.hp + r.hand.committed.player + r.hand.committed.opponent);
    }
    expect(found).toBe(true);
  });
});

describe('full games (random player policy)', () => {
  const seeds = Array.from({ length: 25 }, (_, i) => i + 1);

  it('is reproducible from the seed and the actions', () => {
    expect(autoplay(12345)).toEqual(autoplay(12345));
  });

  it('keeps every invariant', () => {
    for (const seed of seeds) {
      const states = autoplay(seed);
      for (let i = 1; i < states.length; i++) {
        const prev = states[i - 1]!;
        const s = states[i]!;
        expect(s.player.hp).toBeGreaterThanOrEqual(0);
        expect(s.opponent.hp).toBeGreaterThanOrEqual(0);
        expect(s.survivors).toBeLessThanOrEqual(prev.survivors);
        if (s.hand) {
          // Mid-hand: chips only move between stacks and the pot.
          expect(total(s)).toBe(total(prev));
          expect(s.hand.log.at(-1)).toBe(s.lastEvents.at(-1));
        } else if (s.lastRound && s.lastRound.round === s.round) {
          const r = s.lastRound;
          expect(s.lastEvents.at(-1)!.t).toBe('award');
          // Only the hand bonus leaves the table (KO'd opponents are replaced).
          const after = r.player.after.hp + r.opponent.after.hp;
          const before = r.player.before.hp + r.opponent.before.hp;
          expect(after).toBe(before - r.bonus);
          if (r.endedBy === 'fold') expect(r.featuredHand).toBeNull();
          if (r.winner === 'tie') expect(r.bonus).toBe(0);
          if (r.eliminated) expect(r[r.eliminated].after.hp).toBe(0);
          expect(s.lastLog[0]!.t).toBe('start');
        }
      }
      const end = states.at(-1)!;
      if (end.status === 'won') expect(end.survivors).toBe(1);
      if (end.status === 'lost') expect(end.player.hp).toBe(0);
    }
  });

  it('every game eventually ends', () => {
    for (const seed of seeds) expect(autoplay(seed, 2000).at(-1)!.status).not.toBe('playing');
  });

  it('starts with 100 survivors', () => {
    expect(createGame(1).survivors).toBe(TOTAL_PLAYERS);
  });
});

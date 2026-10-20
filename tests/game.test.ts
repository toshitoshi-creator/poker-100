import { anteFor, effectTier, HAND_BONUS } from '../src/logic/combat';
import {
  aliveSeats,
  createGame,
  legalActions,
  playerAct,
  startHand,
  TABLE_SIZE,
  TOTAL_PLAYERS,
  type GameState,
} from '../src/logic/game';
import { HandCategory } from '../src/logic/handEvaluator';
import { autoplay } from './helpers/autoplay';

const tableChips = (s: GameState) =>
  s.seats.reduce((a, f) => a + (f?.hp ?? 0), 0) + (s.hand ? s.hand.committed.reduce((a, b) => a + b, 0) : 0);

describe('rules', () => {
  it('big blind rises every 4 hands', () => {
    expect([1, 4, 5, 8, 9, 13].map(anteFor)).toEqual([2, 2, 4, 4, 6, 8]);
  });

  it('stronger hands deal more bonus damage and get a louder tier', () => {
    const cats = Object.values(HandCategory).filter((v): v is HandCategory => typeof v === 'number');
    for (let i = 1; i < cats.length; i++) {
      expect(HAND_BONUS[cats[i]!]).toBeGreaterThanOrEqual(HAND_BONUS[cats[i - 1]!]);
      expect(effectTier(cats[i]!)).toBeGreaterThanOrEqual(effectTier(cats[i - 1]!));
    }
  });

  it('seats six players: you at seat 0 plus five from the 100', () => {
    const g = createGame(1);
    expect(g.seats).toHaveLength(TABLE_SIZE);
    expect(g.seats.every(Boolean)).toBe(true);
    expect(g.seats[0]!.seat).toBe(g.roster.you);
    expect(new Set(g.seats.map((f) => f!.seat)).size).toBe(TABLE_SIZE);
  });

  it('startHand posts blinds, deals every seat and stops on your turn (or finishes the hand)', () => {
    for (let seed = 1; seed < 20; seed++) {
      const s = startHand(createGame(seed));
      const start = (s.hand?.log ?? s.lastLog)[0]!;
      expect(start.t).toBe('start');
      if (start.t !== 'start') continue;
      expect(start.blinds.map((b) => b.kind)).toEqual(['sb', 'bb']);
      expect(start.blinds[1]!.amount).toBe(2);
      if (s.hand) {
        expect(s.hand.toAct).toBe(0);
        expect(s.hand.deal.hole.every(Boolean)).toBe(true);
        expect(legalActions(s).length).toBeGreaterThan(0);
      }
      expect(startHand(s)).toBe(s.hand ? s : s); // cannot start twice mid-hand
    }
  });

  it('ignores illegal or stale actions', () => {
    const g = createGame(1);
    expect(playerAct(g, { type: 'check' })).toBe(g);
    let s = startHand(g);
    for (let seed = 2; !s.hand; seed++) s = startHand(createGame(seed));
    const illegal = legalActions(s).some((a) => a.type === 'check') ? { type: 'call' as const } : { type: 'check' as const };
    expect(playerAct(s, illegal)).toBe(s);
  });

  it('folding preflop costs only what you put in', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = startHand(createGame(seed));
      if (!s.hand || !legalActions(s).some((a) => a.type === 'fold')) continue;
      const put = s.hand.committed[0]!;
      const f = playerAct(s, { type: 'fold' });
      const r = f.lastRound!;
      expect(r.after[0]!.hp).toBe(r.before[0]!.hp - put);
      expect(r.bonus[0]).toBe(0);
      return;
    }
    throw new Error('no seed where you could fold preflop');
  });
});

describe('full games (random player policy)', () => {
  const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
  const games = seeds.map((seed) => autoplay(seed));

  it('is reproducible from the seed and the actions', () => {
    expect(autoplay(12345, 60)).toEqual(autoplay(12345, 60));
  });

  it('keeps every invariant', () => {
    for (const states of games) {
      for (let i = 1; i < states.length; i++) {
        const prev = states[i - 1]!;
        const s = states[i]!;
        for (const f of s.seats) if (f) expect(f.hp).toBeGreaterThanOrEqual(0);
        expect(s.survivors).toBeLessThanOrEqual(prev.survivors);
        expect(aliveSeats(s.roster).length).toBe(s.survivors);
        if (s.hand) {
          // Mid-hand: chips only move between stacks and the pot.
          const start = s.hand.log[0]!;
          if (start.t !== 'start') throw new Error('log must begin with start');
          expect(tableChips(s)).toBe(start.seats.reduce((a, f) => a + (f?.hp ?? 0), 0));
          expect(s.hand.toAct).toBe(0);
        } else if (s.lastRound?.round === s.round) {
          const r = s.lastRound;
          const before = r.before.reduce((a, f) => a + (f?.hp ?? 0), 0);
          const after = r.after.reduce((a, f) => a + (f?.hp ?? 0), 0);
          const burned = r.bonus.reduce((a, b) => a + b, 0);
          // Only the hand bonus leaves the table.
          expect(after).toBe(before - burned);
          expect(r.pots.reduce((a, p) => a + p.amount, 0)).toBe(r.committed.reduce((a, b) => a + b, 0));
          expect(r.payout.reduce((a, b) => a + b, 0)).toBe(r.committed.reduce((a, b) => a + b, 0));
          if (r.endedBy === 'fold') expect(burned).toBe(0);
          for (const seat of r.eliminated) expect(s.roster.out[r.after[seat]!.seat]).toBe(r.round);
          // Bonus only hits players who showed down and lost.
          r.bonus.forEach((b, seat) => b > 0 && expect(r.showdown).toContain(seat));
          // Refilled seats are alive and unique.
          if (s.status === 'playing') {
            const ids = s.seats.filter(Boolean).map((f) => f!.seat);
            expect(new Set(ids).size).toBe(ids.length);
            ids.forEach((id) => expect(s.roster.out[id]).toBeNull());
          }
        }
      }
      const end = states.at(-1)!;
      if (end.status === 'won') expect(end.survivors).toBe(1);
      if (end.status === 'lost') expect(end.seats[0]!.hp).toBe(0);
    }
  });

  it('every game eventually ends', () => {
    for (const seed of seeds.slice(0, 6)) expect(autoplay(seed, 3000).at(-1)!.status).not.toBe('playing');
  });

  it('starts with 100 survivors', () => {
    expect(createGame(1).survivors).toBe(TOTAL_PLAYERS);
  });
});

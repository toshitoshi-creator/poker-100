import { anteFor, effectTier, foldPenalty, HAND_BONUS } from '../src/logic/combat';
import {
  aliveSeats,
  createGame,
  legalActions,
  playerAct,
  startHand,
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

  it('heads-up by default; six-max on request; you at seat 0, the rest from the 100', () => {
    expect(createGame(1).seats).toHaveLength(2);
    for (const size of [2, 6] as const) {
      const g = createGame(1, size);
      expect(g.seats).toHaveLength(size);
      expect(g.seats.every(Boolean)).toBe(true);
      expect(g.seats[0]!.seat).toBe(g.roster.you);
      expect(new Set(g.seats.map((f) => f!.seat)).size).toBe(size);
    }
  });

  it('heads-up: the button posts the small blind and acts first preflop', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = startHand(createGame(seed, 2));
      const log = s.hand?.log ?? s.lastLog;
      const start = log[0]!;
      if (start.t !== 'start') throw new Error('start first');
      const sb = start.blinds.find((b) => b.kind === 'sb')!;
      expect(sb.seat).toBe(start.button);
      const first = log.find((e) => e.t === 'act');
      if (first && first.t === 'act') expect(first.seat).toBe(start.button);
      else expect(s.hand?.toAct).toBe(start.button);
    }
  });

  it('startHand posts blinds, deals every seat and stops on your turn (or finishes the hand)', () => {
    for (let seed = 1; seed < 20; seed++) {
      const s = startHand(createGame(seed, seed % 2 ? 2 : 6));
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

  it('folding costs what you put in plus the fold penalty', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = startHand(createGame(seed));
      const fold = s.hand && legalActions(s).find((a) => a.type === 'fold');
      if (!s.hand || !fold) continue;
      const put = s.hand.committed[0]!;
      expect(fold.penalty).toBe(foldPenalty(s.hand.bb));
      const f = playerAct(s, { type: 'fold' });
      const r = f.lastRound!;
      expect(r.penalty[0]).toBe(foldPenalty(2));
      expect(r.after[0]!.hp).toBe(r.before[0]!.hp - put - foldPenalty(2));
      expect(r.bonus[0]).toBe(0);
      return;
    }
    throw new Error('no seed where you could fold preflop');
  });

  it('folding every hand is no longer a way to climb the ranking', () => {
    for (const size of [2, 6] as const) {
      let s = createGame(11, size);
      while (s.status === 'playing') {
        if (!s.hand) s = startHand(s);
        else s = playerAct(s, legalActions(s).some((a) => a.type === 'fold') ? { type: 'fold' } : { type: 'check' });
      }
      expect(s.status).toBe('lost');
      expect(s.survivors).toBeGreaterThan(50); // knocked out early, far from the top
    }
  });

  it('a fold penalty that empties your HP knocks you out', () => {
    for (let seed = 1; seed < 60; seed++) {
      const g = createGame(seed);
      let s = startHand({ ...g, seats: g.seats.map((f, i) => (i === 0 ? { ...f!, hp: 6 } : f)) });
      if (!s.hand || !legalActions(s).some((a) => a.type === 'fold')) continue;
      s = playerAct(s, { type: 'fold' });
      expect(s.seats[0]!.hp).toBe(0);
      expect(s.status).toBe('lost');
      return;
    }
    throw new Error('no fold spot found');
  });
});

describe('full games (random player policy, both table sizes)', () => {
  const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
  const games = seeds.map((seed) => autoplay(seed, 300, undefined, seed % 2 ? 2 : 6));

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
          // Mid-hand: chips only move between stacks and the pot, minus fold damage.
          const burned = s.hand.penalty.reduce((a, b) => a + b, 0);
          expect(tableChips(s)).toBe(start.seats.reduce((a, f) => a + (f?.hp ?? 0), 0) - burned);
          expect(s.hand.toAct).toBe(0);
        } else if (s.lastRound?.round === s.round) {
          const r = s.lastRound;
          const before = r.before.reduce((a, f) => a + (f?.hp ?? 0), 0);
          const after = r.after.reduce((a, f) => a + (f?.hp ?? 0), 0);
          const burned = r.bonus.reduce((a, b) => a + b, 0) + r.penalty.reduce((a, b) => a + b, 0);
          // Only the hand bonus and fold damage leave the table.
          expect(after).toBe(before - burned);
          // Every fold costs the penalty (unless the folder had less HP left).
          r.penalty.forEach((p) => expect(p).toBeLessThanOrEqual(foldPenalty(anteFor(r.round))));
          expect(r.pots.reduce((a, p) => a + p.amount, 0)).toBe(r.committed.reduce((a, b) => a + b, 0));
          expect(r.payout.reduce((a, b) => a + b, 0)).toBe(r.committed.reduce((a, b) => a + b, 0));
          if (r.endedBy === 'fold') expect(r.bonus.reduce((a, b) => a + b, 0)).toBe(0);
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
    for (const seed of seeds.slice(0, 6)) expect(autoplay(seed, 3000, undefined, seed % 2 ? 2 : 6).at(-1)!.status).not.toBe('playing');
  });

  it('starts with 100 survivors', () => {
    expect(createGame(1).survivors).toBe(TOTAL_PLAYERS);
  });
});

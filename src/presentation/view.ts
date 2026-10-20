import type { Fighter } from '../logic/hp';
import type { GameEvent, GameState, RoundResult } from '../logic/game';
import type { Phase } from './store';

/**
 * What the table looks like after a prefix of a hand's event log.
 * Pure: the Director snaps to these between animations, so any interruption
 * (skip, rapid taps, replay) lands on a well-defined picture. Arrays are per seat.
 */
export interface TableView {
  round: number;
  dealt: boolean;
  boardShown: number;
  revealed: boolean[];
  folded: boolean[];
  seats: (Fighter | null)[];
  hp: number[];
  /** Chips in front of each seat this street. */
  bets: number[];
  /** Chips already gathered in the middle. */
  pot: number;
  survivors: number;
  button: number;
  say: string[];
  phase: Phase;
  result: RoundResult | null;
}

const blank = <T,>(n: number, v: T) => Array.from({ length: n }, () => v);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function base(seats: (Fighter | null)[], round: number, survivors: number, button: number): TableView {
  return {
    round,
    dealt: false,
    boardShown: 0,
    revealed: blank(seats.length, false),
    folded: blank(seats.length, false),
    seats,
    hp: seats.map((f) => f?.hp ?? 0),
    bets: blank(seats.length, 0),
    pot: 0,
    survivors,
    button,
    say: blank(seats.length, ''),
    phase: 'idle',
    result: null,
  };
}

/** The table before any hand (nothing dealt). */
export function idleView(g: GameState): TableView {
  return base(g.seats, g.round, g.survivors, g.button);
}

const SAY = { fold: 'フォールド', check: 'チェック', call: 'コール', bet: 'ベット', raise: 'レイズ' } as const;

export function reduceView(v: TableView, e: GameEvent): TableView {
  switch (e.t) {
    case 'start': {
      const next = base(e.seats, e.round, e.survivors, e.button);
      for (const b of e.blinds) {
        next.hp[b.seat]! -= b.amount;
        next.bets[b.seat] = b.amount;
        next.say[b.seat] = b.kind === 'sb' ? 'SB' : 'BB';
      }
      next.hp = [...next.hp];
      next.dealt = true;
      next.revealed = next.revealed.map((_, i) => i === 0);
      next.phase = 'preflop';
      return next;
    }
    case 'act': {
      const hp = [...v.hp];
      const bets = [...v.bets];
      const say = [...v.say];
      const folded = [...v.folded];
      hp[e.seat]! -= e.amount;
      bets[e.seat] = e.to;
      say[e.seat] = e.allIn ? 'オールイン' : e.kind === 'bet' || e.kind === 'raise' ? `${SAY[e.kind]} ${e.to}` : SAY[e.kind];
      if (e.kind === 'fold') folded[e.seat] = true;
      return { ...v, hp, bets, say, folded };
    }
    case 'street':
      return {
        ...v,
        pot: v.pot + sum(v.bets),
        bets: v.bets.map(() => 0),
        boardShown: e.street === 'flop' ? 3 : e.street === 'turn' ? 4 : 5,
        phase: e.street,
        say: v.say.map((s, i) => (v.folded[i] ? s : '')),
      };
    case 'showdown':
      return {
        ...v,
        pot: v.pot + sum(v.bets),
        bets: v.bets.map(() => 0),
        revealed: v.revealed.map((r, i) => r || e.seats.includes(i)),
        phase: 'showdown',
        say: v.say.map((s, i) => (v.folded[i] ? s : '')),
      };
    case 'award':
      return {
        ...v,
        hp: e.result.after.map((f) => f?.hp ?? 0),
        seats: e.result.after,
        pot: 0,
        bets: v.bets.map(() => 0),
        survivors: e.result.survivors.after,
        phase: 'result',
        result: e.result,
      };
  }
}

/** View after the first `n` events of a hand log (n = 0: just before the deal). */
export function viewAt(log: readonly GameEvent[], n: number): TableView {
  const start = log[0];
  if (!start || start.t !== 'start') throw new Error('hand log must begin with start');
  let v = base(start.seats, start.round - 1, start.survivors, start.button);
  for (let i = 0; i < n; i++) v = reduceView(v, log[i]!);
  return v;
}

/** Before the very first hand the 100-player lobby is on screen instead of the table. */
export function isLobby(v: TableView): boolean {
  return v.round === 0 && !v.dealt;
}

/** The log currently on the table: the hand in progress, else the last finished one. */
export function currentLog(g: GameState): GameEvent[] {
  return g.hand?.log ?? g.lastLog;
}

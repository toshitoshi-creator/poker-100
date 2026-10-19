import type { GameEvent, GameState, RoundResult, Side } from '../logic/game';
import type { Phase } from './store';

/**
 * What the table looks like after a prefix of a hand's event log.
 * Pure: the Director snaps to these between animations, so any interruption
 * (skip, rapid taps, replay) lands on a well-defined picture.
 */
export interface TableView {
  round: number;
  dealt: boolean;
  boardShown: number;
  oppRevealed: boolean;
  folded: Side | null;
  playerHp: number;
  opponentHp: number;
  pot: number;
  survivors: number;
  say: Record<Side, string>;
  phase: Phase;
  result: RoundResult | null;
}

const SILENT = { player: '', opponent: '' };

/** The table before any hand (or between hands, nothing on it). */
export function idleView(g: GameState): TableView {
  return {
    round: g.round,
    dealt: false,
    boardShown: 0,
    oppRevealed: false,
    folded: null,
    playerHp: g.player.hp,
    opponentHp: g.opponent.hp,
    pot: 0,
    survivors: g.survivors,
    say: SILENT,
    phase: 'idle',
    result: null,
  };
}

export function reduceView(v: TableView, e: GameEvent): TableView {
  switch (e.t) {
    case 'start':
      return {
        round: e.round,
        dealt: true,
        boardShown: 0,
        oppRevealed: false,
        folded: null,
        playerHp: e.player.hp - e.ante,
        opponentHp: e.opponent.hp - e.ante,
        pot: e.ante * 2,
        survivors: e.survivors,
        say: SILENT,
        phase: 'preflop',
        result: null,
      };
    case 'check':
      return { ...v, say: { ...v.say, [e.side]: 'チェック' } };
    case 'bet': {
      const key = e.side === 'player' ? 'playerHp' : 'opponentHp';
      const text = e.allIn ? 'オールイン' : e.kind === 'call' ? 'コール' : `ベット ${e.amount}`;
      return { ...v, [key]: v[key] - e.amount, pot: v.pot + e.amount, say: { ...v.say, [e.side]: text } };
    }
    case 'fold':
      return { ...v, folded: e.side, say: { ...v.say, [e.side]: 'フォールド' } };
    case 'street':
      return { ...v, boardShown: 3, phase: 'flop', say: SILENT };
    case 'runout':
      return { ...v, boardShown: 5, phase: 'river', say: SILENT };
    case 'showdown':
      return { ...v, oppRevealed: true, phase: 'showdown' };
    case 'award':
      return {
        ...v,
        playerHp: e.result.player.after.hp,
        opponentHp: e.result.opponent.after.hp,
        pot: 0,
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
  let v: TableView = {
    round: start.round - 1,
    dealt: false,
    boardShown: 0,
    oppRevealed: false,
    folded: null,
    playerHp: start.player.hp,
    opponentHp: start.opponent.hp,
    pot: 0,
    survivors: start.survivors,
    say: SILENT,
    phase: 'idle',
    result: null,
  };
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

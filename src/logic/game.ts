import { decideFacing, decideOpen, type AiContext } from './ai';
import { anteFor, effectTier, handBonus, type EffectTier } from './combat';
import { dealHoldem, type HoldemDeal } from './dealer';
import { compareHands, evaluateBest, type HandResult } from './handEvaluator';
import type { Fighter } from './hp';
import { shuffle } from './deck';
import { deriveSeed, mulberry32, randInt } from './rng';

export const TOTAL_PLAYERS = 100;
export const PLAYER_MAX_HP = 100;
export const OPPONENT_MAX_HP = 80;

export type Side = 'player' | 'opponent';
export type GameStatus = 'playing' | 'won' | 'lost';
/** Betting happens twice: after the hole cards and after the flop. */
export type Street = 'preflop' | 'flop';
export type BetSize = 'half' | 'pot' | 'allin';

export type PlayerAction = { type: 'check' } | { type: 'bet'; size: BetSize } | { type: 'call' } | { type: 'fold' };
export type LegalAction = PlayerAction & { amount: number };

const other = (s: Side): Side => (s === 'player' ? 'opponent' : 'player');

/** What happened, in order. The presentation replays these; logic never waits for it. */
export type GameEvent =
  | {
      t: 'start';
      round: number;
      ante: number;
      /** Fighters before the ante was posted. */
      player: Fighter;
      opponent: Fighter;
      survivors: number;
    }
  | { t: 'check'; side: Side }
  | { t: 'bet'; side: Side; amount: number; kind: 'bet' | 'call'; allIn: boolean }
  | { t: 'fold'; side: Side }
  | { t: 'street' }
  | { t: 'runout'; from: 0 | 3 }
  | { t: 'showdown' }
  | { t: 'award'; result: RoundResult };

export interface HandState {
  round: number;
  seed: number;
  deal: HoldemDeal;
  street: Street;
  /** Chips each side has put in the pot this hand (ante included). */
  committed: Record<Side, number>;
  /** Amount the player must call; 0 means the player may check or bet. */
  facing: number;
  /** Increments per AI decision, so each one gets its own deterministic rng. */
  decisions: number;
  log: GameEvent[];
}

/** Everything about a finished hand, decided before any animation runs. */
export interface RoundResult {
  round: number;
  seed: number;
  deal: HoldemDeal;
  endedBy: 'fold' | 'showdown';
  folder: Side | null;
  playerHand: HandResult;
  opponentHand: HandResult;
  winner: Side | 'tie';
  /** Winner's hand at showdown (player's on a tie); null when someone folded. */
  featuredHand: HandResult | null;
  tier: EffectTier;
  pot: number;
  committed: Record<Side, number>;
  /** Extra damage from the winning hand, burned from the loser. */
  bonus: number;
  eliminated: Side | null;
  player: { before: Fighter; after: Fighter };
  opponent: { before: Fighter; after: Fighter };
  /** `fallen`: every seat eliminated this round (this table's loser included). */
  survivors: { before: number; after: number; othersEliminated: number; fallen: number[] };
  statusAfter: GameStatus;
}

/** All 100 seats. `out[i]` is the round seat i was eliminated in, or null while alive. */
export interface Roster {
  you: number;
  out: (number | null)[];
}

export const seatName = (seat: number) => `No.${String(seat + 1).padStart(3, '0')}`;

export function aliveSeats(r: Roster): number[] {
  const a: number[] = [];
  r.out.forEach((o, i) => o === null && a.push(i));
  return a;
}

export interface GameState {
  seed: number;
  roster: Roster;
  round: number;
  player: Fighter;
  opponent: Fighter;
  survivors: number;
  status: GameStatus;
  /** Hand in progress, waiting for the player's action. */
  hand: HandState | null;
  lastRound: RoundResult | null;
  /** Full event log of the last finished hand (for replay). */
  lastLog: GameEvent[];
  /** Events produced by the most recent step (what the presentation should play). */
  lastEvents: GameEvent[];
}

function makeOpponent(seed: number, round: number, roster: Roster): Fighter {
  const rng = mulberry32(deriveSeed(seed, round, 0xa11ce));
  const pool = aliveSeats(roster).filter((i) => i !== roster.you);
  const seat = pool[Math.floor(rng() * pool.length)] ?? (roster.you + 1) % TOTAL_PLAYERS;
  return { id: `seat-${seat}`, name: seatName(seat), seat, hp: OPPONENT_MAX_HP, maxHp: OPPONENT_MAX_HP };
}

export function createGame(seed: number): GameState {
  const s = seed >>> 0;
  const you = randInt(mulberry32(deriveSeed(s, 0x5ea7)), 0, TOTAL_PLAYERS - 1);
  const roster: Roster = { you, out: Array.from({ length: TOTAL_PLAYERS }, () => null) };
  return {
    seed: s,
    roster,
    round: 0,
    player: { id: 'you', name: 'YOU', seat: you, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP },
    opponent: makeOpponent(s, 0, roster),
    survivors: TOTAL_PLAYERS,
    status: 'playing',
    hand: null,
    lastRound: null,
    lastLog: [],
    lastEvents: [],
  };
}

/** Mutable scratch copy used inside one pure step. */
interface Work {
  state: GameState;
  hand: HandState;
  hp: Record<Side, number>;
  events: GameEvent[];
}

const potOf = (h: HandState) => h.committed.player + h.committed.opponent;

function pay(w: Work, side: Side, amount: number, kind: 'bet' | 'call') {
  const amt = Math.min(amount, w.hp[side]);
  w.hp[side] -= amt;
  w.hand = { ...w.hand, committed: { ...w.hand.committed, [side]: w.hand.committed[side] + amt } };
  w.events.push({ t: 'bet', side, amount: amt, kind, allIn: w.hp[side] === 0 });
}

function aiContext(w: Work): AiContext {
  const visible = w.hand.street === 'preflop' ? [] : w.hand.deal.board.slice(0, 3);
  const rng = mulberry32(deriveSeed(w.hand.seed, 0xd0, w.hand.decisions));
  w.hand = { ...w.hand, decisions: w.hand.decisions + 1 };
  return {
    hole: w.hand.deal.opponent,
    board: visible,
    pot: potOf(w.hand),
    stack: w.hp.opponent,
    maxBet: Math.min(w.hp.opponent, w.hp.player),
    rng,
  };
}

/** Start the next hand: deal (all cards fixed by the seed), post antes. */
export function startHand(state: GameState): GameState {
  if (state.status !== 'playing' || state.hand) return state;
  const round = state.round + 1;
  const seed = deriveSeed(state.seed, round);
  const deal = dealHoldem(mulberry32(seed));
  const ante = Math.min(anteFor(round), state.player.hp, state.opponent.hp);
  const start: GameEvent = { t: 'start', round, ante, player: state.player, opponent: state.opponent, survivors: state.survivors };
  const w: Work = {
    state: { ...state, round },
    hand: { round, seed, deal, street: 'preflop', committed: { player: ante, opponent: ante }, facing: 0, decisions: 0, log: [] },
    hp: { player: state.player.hp - ante, opponent: state.opponent.hp - ante },
    events: [start],
  };
  // Someone is all-in from the ante alone: no decisions left.
  if (w.hp.player === 0 || w.hp.opponent === 0) return runout(w);
  return pause(w);
}

export function legalActions(state: GameState): LegalAction[] {
  const h = state.hand;
  if (!h) return [];
  const stack = state.player.hp;
  if (h.facing > 0) {
    return [
      { type: 'fold', amount: 0 },
      { type: 'call', amount: Math.min(h.facing, stack) },
    ];
  }
  const out: LegalAction[] = [{ type: 'check', amount: 0 }];
  const max = Math.min(stack, state.opponent.hp);
  if (max <= 0) return out;
  const pot = potOf(h);
  const half = Math.min(max, Math.max(1, Math.ceil(pot / 2)));
  const full = Math.min(max, pot);
  if (half < max) out.push({ type: 'bet', size: 'half', amount: half });
  if (full > half && full < max) out.push({ type: 'bet', size: 'pot', amount: full });
  out.push({ type: 'bet', size: 'allin', amount: max });
  return out;
}

function sameAction(a: PlayerAction, b: PlayerAction): boolean {
  return a.type === b.type && (a.type !== 'bet' || (b.type === 'bet' && a.size === b.size));
}

/**
 * Apply the player's action, let the opponent respond, and advance as far as
 * possible without another player decision. Illegal or stale actions are no-ops.
 */
export function playerAct(state: GameState, action: PlayerAction): GameState {
  const h = state.hand;
  if (!h || state.status !== 'playing') return state;
  const legal = legalActions(state).find((l) => sameAction(l, action));
  if (!legal) return state;
  const w: Work = { state, hand: { ...h }, hp: { player: state.player.hp, opponent: state.opponent.hp }, events: [] };

  switch (legal.type) {
    case 'fold':
      w.events.push({ t: 'fold', side: 'player' });
      return settle(w, 'player');
    case 'call':
      pay(w, 'player', legal.amount, 'call');
      w.hand = { ...w.hand, facing: 0 };
      return closeStreet(w);
    case 'check': {
      w.events.push({ t: 'check', side: 'player' });
      const bet = decideOpen(aiContext(w));
      if (bet > 0) {
        pay(w, 'opponent', bet, 'bet');
        w.hand = { ...w.hand, facing: bet };
        return pause(w);
      }
      w.events.push({ t: 'check', side: 'opponent' });
      return closeStreet(w);
    }
    case 'bet': {
      pay(w, 'player', legal.amount, 'bet');
      const reply = decideFacing(aiContext(w), legal.amount);
      if (reply === 'fold') {
        w.events.push({ t: 'fold', side: 'opponent' });
        return settle(w, 'opponent');
      }
      pay(w, 'opponent', legal.amount, 'call');
      return closeStreet(w);
    }
  }
}

function closeStreet(w: Work): GameState {
  if (w.hand.street === 'preflop' && w.hp.player > 0 && w.hp.opponent > 0) {
    w.hand = { ...w.hand, street: 'flop', facing: 0 };
    w.events.push({ t: 'street' });
    return pause(w);
  }
  return runout(w);
}

function runout(w: Work): GameState {
  w.events.push({ t: 'runout', from: w.hand.street === 'preflop' ? 0 : 3 });
  w.events.push({ t: 'showdown' });
  return settle(w, null);
}

/** Hand continues: store progress and wait for the player. */
function pause(w: Work): GameState {
  const log = [...w.hand.log, ...w.events];
  return {
    ...w.state,
    player: { ...w.state.player, hp: w.hp.player },
    opponent: { ...w.state.opponent, hp: w.hp.opponent },
    hand: { ...w.hand, log },
    lastEvents: w.events,
  };
}

function settle(w: Work, folder: Side | null): GameState {
  const { state, hand } = w;
  const start = (hand.log[0] ?? w.events[0]) as Extract<GameEvent, { t: 'start' }>;
  const pot = potOf(hand);
  const playerHand = evaluateBest([...hand.deal.player, ...hand.deal.board]);
  const opponentHand = evaluateBest([...hand.deal.opponent, ...hand.deal.board]);
  const hp = { ...w.hp };

  let winner: Side | 'tie';
  let bonus = 0;
  if (folder) {
    winner = other(folder);
    hp[winner] += pot;
  } else {
    const cmp = compareHands(playerHand, opponentHand);
    winner = cmp > 0 ? 'player' : cmp < 0 ? 'opponent' : 'tie';
    if (winner === 'tie') {
      hp.player += hand.committed.player;
      hp.opponent += hand.committed.opponent;
    } else {
      hp[winner] += pot;
      const loser = other(winner);
      bonus = Math.min(hp[loser], handBonus(winner === 'player' ? playerHand : opponentHand));
      hp[loser] -= bonus;
    }
  }
  const featuredHand = folder ? null : winner === 'opponent' ? opponentHand : playerHand;
  const grow = (f: Fighter, v: number): Fighter => ({ ...f, hp: v, maxHp: Math.max(f.maxHp, v) });
  const player = grow(state.player, hp.player);
  const opponent = grow(state.opponent, hp.opponent);
  const eliminated: Side | null = player.hp === 0 ? 'player' : opponent.hp === 0 ? 'opponent' : null;

  // This table's loser, then up to 3 eliminations at other tables.
  const out = [...state.roster.out];
  const fallen: number[] = [];
  if (eliminated) {
    const seat = eliminated === 'player' ? state.roster.you : state.opponent.seat;
    out[seat] = hand.round;
    fallen.push(seat);
  }
  const rng = mulberry32(deriveSeed(hand.seed, 0x07e5));
  const others = aliveSeats(state.roster).filter((i) => i !== state.roster.you && i !== state.opponent.seat);
  const othersEliminated = Math.min(others.length, randInt(rng, 0, 3));
  for (const seat of shuffle(others, rng).slice(0, othersEliminated)) {
    out[seat] = hand.round;
    fallen.push(seat);
  }
  const roster: Roster = { ...state.roster, out };
  const survivorsAfter = aliveSeats(roster).length;
  const status: GameStatus = eliminated === 'player' ? 'lost' : survivorsAfter <= 1 ? 'won' : 'playing';

  const result: RoundResult = {
    round: hand.round,
    seed: hand.seed,
    deal: hand.deal,
    endedBy: folder ? 'fold' : 'showdown',
    folder,
    playerHand,
    opponentHand,
    winner,
    featuredHand,
    tier: featuredHand ? effectTier(featuredHand.category) : 0,
    pot,
    committed: hand.committed,
    bonus,
    eliminated,
    player: { before: start.player, after: player },
    opponent: { before: start.opponent, after: opponent },
    survivors: { before: state.survivors, after: survivorsAfter, othersEliminated, fallen },
    statusAfter: status,
  };
  const events: GameEvent[] = [...w.events, { t: 'award', result }];

  return {
    ...state,
    roster,
    player,
    // A knocked-out opponent is replaced by the next challenger.
    opponent: eliminated === 'opponent' && status === 'playing' ? makeOpponent(state.seed, hand.round, roster) : opponent,
    survivors: survivorsAfter,
    status,
    hand: null,
    lastRound: result,
    lastLog: [...hand.log, ...events],
    lastEvents: events,
  };
}

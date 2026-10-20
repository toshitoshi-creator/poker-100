import { decide } from './ai';
import { anteFor, effectTier, foldPenalty, handBonus, type EffectTier } from './combat';
import { assertUnique, createDeck, shuffle } from './deck';
import { compareHands, evaluateBest, type HandResult } from './handEvaluator';
import type { Fighter } from './hp';
import { deriveSeed, mulberry32, randInt } from './rng';
import type { Card } from './types';

export const TOTAL_PLAYERS = 100;
/** Players per table: heads-up (default) or six-max. Seat 0 is always you; seats go clockwise. */
export type TableSize = 2 | 6;
export const TABLE_SIZES: readonly TableSize[] = [2, 6];
export const DEFAULT_TABLE_SIZE: TableSize = 2;
/** Largest table the UI has to lay out. */
export const MAX_TABLE_SIZE = 6;
export const START_HP = 100;
/** A player who sits down mid-game brings this much HP (they survived elsewhere). */
export const NEWCOMER_HP: [number, number] = [60, 120];
/** At most this many bets/raises per street, so all-AI pots always terminate. */
export const MAX_RAISES = 4;

export type GameStatus = 'playing' | 'won' | 'lost';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type RaiseSize = 'half' | 'pot' | 'allin';

export type PlayerAction = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; size: RaiseSize };
/** `amount`: chips this action puts in. `to`: the seat's street bet afterwards. */
/** `penalty`: fold damage (fold only). */
export type LegalAction = PlayerAction & { amount: number; to: number; penalty?: number };

export interface TableDeal {
  /** Hole cards by table seat (null = empty seat). */
  hole: ([Card, Card] | null)[];
  /** flop = [0..2], turn = [3], river = [4] */
  board: Card[];
}

/** What happened, in order. The presentation replays these; logic never waits for it. */
export type GameEvent =
  | {
      t: 'start';
      round: number;
      button: number;
      /** Fighters at the table before the blinds. */
      seats: (Fighter | null)[];
      /** Seats filled by newcomers since the previous hand. */
      joined: number[];
      blinds: { seat: number; amount: number; kind: 'sb' | 'bb' }[];
      survivors: number;
    }
  | {
      t: 'act';
      seat: number;
      kind: 'fold' | 'check' | 'call' | 'bet' | 'raise';
      amount: number;
      to: number;
      allIn: boolean;
      /** Fold damage burned from the seat (fold only). */
      penalty?: number;
    }
  | { t: 'street'; street: Exclude<Street, 'preflop'> }
  | { t: 'showdown'; seats: number[] }
  | { t: 'award'; result: RoundResult };

export interface HandState {
  round: number;
  seed: number;
  deal: TableDeal;
  street: Street;
  button: number;
  bb: number;
  inHand: boolean[];
  /** Chips each seat has put in this hand. */
  committed: number[];
  /** Fold damage taken this hand (burned, not in the pot). */
  penalty: number[];
  /** Chips each seat has put in this street. */
  streetBet: number[];
  /** Has acted since the last bet/raise. */
  acted: boolean[];
  currentBet: number;
  minRaise: number;
  raises: number;
  toAct: number;
  /** Increments per AI decision, so each one gets its own deterministic rng. */
  decisions: number;
  log: GameEvent[];
}

export interface Pot {
  amount: number;
  eligible: number[];
  winners: number[];
}

/** Everything about a finished hand, decided before any animation runs. */
export interface RoundResult {
  round: number;
  seed: number;
  deal: TableDeal;
  button: number;
  endedBy: 'fold' | 'showdown';
  /** Seats that reached showdown (empty when everyone else folded). */
  showdown: number[];
  /** Best hand per seat that reached showdown. */
  hands: (HandResult | null)[];
  pots: Pot[];
  /** Chips each seat collected from the pots. */
  payout: number[];
  committed: number[];
  /** The hand that won the main pot (null when won by folds). */
  featuredSeat: number;
  featuredHand: HandResult | null;
  tier: EffectTier;
  /** Hand-bonus damage taken per seat (burned, not transferred). */
  bonus: number[];
  /** Fold damage taken per seat (burned). */
  penalty: number[];
  /** Table seats knocked out this hand. */
  eliminated: number[];
  /** Fighters before the blinds / after the hand (before refills). */
  before: (Fighter | null)[];
  after: (Fighter | null)[];
  survivors: { before: number; after: number; othersEliminated: number; fallen: number[] };
  statusAfter: GameStatus;
}

/** All 100 players. `out[i]` is the round player i was eliminated in, or null while alive. */
export interface Roster {
  you: number;
  out: (number | null)[];
}

export interface GameState {
  seed: number;
  roster: Roster;
  round: number;
  /** Table seats; seats[0] is you. */
  seats: (Fighter | null)[];
  button: number;
  /** Seats refilled after the last hand (announced by the next start event). */
  joined: number[];
  survivors: number;
  status: GameStatus;
  /** Hand in progress, waiting for your action. */
  hand: HandState | null;
  lastRound: RoundResult | null;
  /** Full event log of the last finished hand (for replay). */
  lastLog: GameEvent[];
  /** Events produced by the most recent step (what the presentation should play). */
  lastEvents: GameEvent[];
}

export const seatName = (rosterIndex: number) => `No.${String(rosterIndex + 1).padStart(3, '0')}`;

export function aliveSeats(r: Roster): number[] {
  const a: number[] = [];
  r.out.forEach((o, i) => o === null && a.push(i));
  return a;
}

export const you = (g: GameState): Fighter => g.seats[0]!;

const nextSeat = (n: number, from: number, ok: (i: number) => boolean): number => {
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (ok(i)) return i;
  }
  return -1;
};

function newcomer(rosterIndex: number, hp: number): Fighter {
  return { id: `p${rosterIndex}`, name: seatName(rosterIndex), seat: rosterIndex, hp, maxHp: hp };
}

/** Fill empty table seats with living players who are not seated yet. */
function refill(seats: (Fighter | null)[], roster: Roster, rng: () => number, hp: () => number): number[] {
  const seated = new Set(seats.filter(Boolean).map((f) => f!.seat));
  const pool = shuffle(
    aliveSeats(roster).filter((i) => !seated.has(i) && i !== roster.you),
    rng,
  );
  const joined: number[] = [];
  for (let s = 1; s < seats.length; s++) {
    if (seats[s] || !pool.length) continue;
    seats[s] = newcomer(pool.shift()!, hp());
    joined.push(s);
  }
  return joined;
}

export function createGame(seed: number, tableSize: TableSize = DEFAULT_TABLE_SIZE): GameState {
  const s = seed >>> 0;
  const rng = mulberry32(deriveSeed(s, 0x5ea7));
  const youIdx = randInt(rng, 0, TOTAL_PLAYERS - 1);
  const roster: Roster = { you: youIdx, out: Array.from({ length: TOTAL_PLAYERS }, () => null) };
  const seats: (Fighter | null)[] = Array.from({ length: tableSize }, () => null);
  seats[0] = { id: 'you', name: 'YOU', seat: youIdx, hp: START_HP, maxHp: START_HP };
  refill(seats, roster, rng, () => START_HP);
  return {
    seed: s,
    roster,
    round: 0,
    seats,
    button: randInt(rng, 0, tableSize - 1),
    joined: [],
    survivors: TOTAL_PLAYERS,
    status: 'playing',
    hand: null,
    lastRound: null,
    lastLog: [],
    lastEvents: [],
  };
}

// ---- one pure step works on a mutable scratch copy ----------------------

interface Work {
  state: GameState;
  hand: HandState;
  hp: number[];
  events: GameEvent[];
}

const potOf = (h: HandState) => h.committed.reduce((a, b) => a + b, 0);
const canAct = (w: Work, i: number) => w.hand.inHand[i]! && w.hp[i]! > 0;

function clone(h: HandState): HandState {
  return {
    ...h,
    inHand: [...h.inHand],
    committed: [...h.committed],
    streetBet: [...h.streetBet],
    acted: [...h.acted],
    penalty: [...h.penalty],
  };
}

function pay(w: Work, i: number, amount: number): number {
  const amt = Math.max(0, Math.min(amount, w.hp[i]!));
  w.hp[i] = w.hp[i]! - amt;
  w.hand.committed[i] = w.hand.committed[i]! + amt;
  w.hand.streetBet[i] = w.hand.streetBet[i]! + amt;
  return amt;
}

/** Legal raise-to range for seat i, or null if raising is not allowed. */
function raiseRange(w: Work, i: number): { min: number; max: number } | null {
  const h = w.hand;
  const toCall = h.currentBet - h.streetBet[i]!;
  if (h.raises >= MAX_RAISES || w.hp[i]! <= toCall) return null;
  // No point raising beyond what anyone else still in can match.
  const others = h.inHand.map((on, j) => (on && j !== i ? h.streetBet[j]! + w.hp[j]! : 0));
  const cap = Math.min(h.streetBet[i]! + w.hp[i]!, Math.max(...others));
  if (cap <= h.currentBet) return null;
  const min = Math.min(cap, h.currentBet === 0 ? h.bb : h.currentBet + h.minRaise);
  return { min, max: cap };
}

function legalFor(w: Work, i: number): LegalAction[] {
  const h = w.hand;
  const toCall = h.currentBet - h.streetBet[i]!;
  const sb = h.streetBet[i]!;
  const out: LegalAction[] = [];
  if (toCall > 0) {
    out.push({ type: 'fold', amount: 0, to: sb, penalty: Math.min(w.hp[i]!, foldPenalty(h.bb)) });
    const amt = Math.min(toCall, w.hp[i]!);
    out.push({ type: 'call', amount: amt, to: sb + amt });
  } else {
    out.push({ type: 'check', amount: 0, to: sb });
  }
  const range = raiseRange(w, i);
  if (range) {
    const base = potOf(h) + toCall;
    const clamp = (x: number) => Math.min(range.max, Math.max(range.min, x));
    const half = clamp(h.currentBet + Math.ceil(base / 2));
    const pot = clamp(h.currentBet + base);
    if (half < range.max) out.push({ type: 'raise', size: 'half', amount: half - sb, to: half });
    if (pot > half && pot < range.max) out.push({ type: 'raise', size: 'pot', amount: pot - sb, to: pot });
    out.push({ type: 'raise', size: 'allin', amount: range.max - sb, to: range.max });
  }
  return out;
}

function work(state: GameState): Work {
  return { state, hand: clone(state.hand!), hp: state.seats.map((f) => f?.hp ?? 0), events: [] };
}

export function legalActions(state: GameState): LegalAction[] {
  if (!state.hand || state.hand.toAct !== 0) return [];
  return legalFor(work(state), 0);
}

function apply(w: Work, i: number, kind: 'fold' | 'check' | 'call' | 'raise', to = 0) {
  const h = w.hand;
  if (kind === 'fold') {
    h.inHand[i] = false;
    const penalty = Math.min(w.hp[i]!, foldPenalty(h.bb));
    w.hp[i] = w.hp[i]! - penalty;
    h.penalty[i] = h.penalty[i]! + penalty;
    w.events.push({ t: 'act', seat: i, kind: 'fold', amount: 0, to: h.streetBet[i]!, allIn: false, penalty });
  } else if (kind === 'check') {
    w.events.push({ t: 'act', seat: i, kind: 'check', amount: 0, to: h.streetBet[i]!, allIn: false });
  } else if (kind === 'call') {
    const amt = pay(w, i, h.currentBet - h.streetBet[i]!);
    w.events.push({ t: 'act', seat: i, kind: 'call', amount: amt, to: h.streetBet[i]!, allIn: w.hp[i] === 0 });
  } else {
    const wasBet = h.currentBet === 0;
    const amt = pay(w, i, to - h.streetBet[i]!);
    const now = h.streetBet[i]!;
    if (now > h.currentBet) {
      h.minRaise = Math.max(h.minRaise, now - h.currentBet);
      h.currentBet = now;
      h.raises++;
      h.acted = h.acted.map((a, j) => j === i || !canAct(w, j) ? a : false);
    }
    w.events.push({ t: 'act', seat: i, kind: wasBet ? 'bet' : 'raise', amount: amt, to: now, allIn: w.hp[i] === 0 });
  }
  h.acted[i] = true;
}

function aiAct(w: Work, i: number) {
  const h = w.hand;
  const visible = h.street === 'preflop' ? 0 : h.street === 'flop' ? 3 : h.street === 'turn' ? 4 : 5;
  const rng = mulberry32(deriveSeed(h.seed, 0xd0, h.decisions++));
  const toCall = h.currentBet - h.streetBet[i]!;
  const d = decide({
    hole: h.deal.hole[i]!,
    board: h.deal.board.slice(0, visible),
    opponents: h.inHand.filter((on, j) => on && j !== i).length,
    pot: potOf(h),
    toCall,
    stack: w.hp[i]!,
    raise: raiseRange(w, i),
    currentBet: h.currentBet,
    foldCost: Math.min(w.hp[i]!, foldPenalty(h.bb)),
    rng,
  });
  if (d.type === 'raise') apply(w, i, 'raise', d.to);
  else if (d.type === 'check' && toCall > 0) apply(w, i, 'fold');
  else if (d.type === 'call' && toCall === 0) apply(w, i, 'check');
  else apply(w, i, d.type);
}

function roundComplete(w: Work): boolean {
  const h = w.hand;
  return h.inHand.every((on, i) => !on || w.hp[i] === 0 || (h.acted[i] && h.streetBet[i] === h.currentBet));
}

const NEXT: Record<Street, Exclude<Street, 'preflop'> | null> = { preflop: 'flop', flop: 'turn', turn: 'river', river: null };

function nextStreet(w: Work, street: Exclude<Street, 'preflop'>) {
  const h = w.hand;
  h.street = street;
  h.streetBet = h.streetBet.map(() => 0);
  h.acted = h.acted.map(() => false);
  h.currentBet = 0;
  h.minRaise = h.bb;
  h.raises = 0;
  w.events.push({ t: 'street', street });
  h.toAct = nextSeat(h.inHand.length, h.button, (i) => canAct(w, i));
}

/** Run AI turns until it is your move or the hand is over. */
function advance(w: Work): GameState {
  for (let guard = 0; guard < 500; guard++) {
    const h = w.hand;
    const live = h.inHand.flatMap((on, i) => (on ? [i] : []));
    if (live.length === 1) return settle(w);
    if (roundComplete(w)) {
      const withChips = live.filter((i) => w.hp[i]! > 0);
      const next = NEXT[h.street];
      if (!next) return showdown(w);
      if (withChips.length <= 1) {
        // Nobody left to bet against: deal out the rest.
        for (let s: Exclude<Street, 'preflop'> | null = next; s; s = NEXT[s]) nextStreet(w, s);
        return showdown(w);
      }
      nextStreet(w, next);
      continue;
    }
    const i = h.toAct;
    if (!canAct(w, i) || (h.acted[i] && h.streetBet[i] === h.currentBet)) {
      h.toAct = nextSeat(h.inHand.length, i, (j) => canAct(w, j));
      continue;
    }
    if (i === 0) return pause(w);
    aiAct(w, i);
    h.toAct = nextSeat(h.inHand.length, i, (j) => canAct(w, j));
  }
  throw new Error('betting did not terminate');
}

/** Start the next hand: move the button, post blinds, deal (all cards fixed by the seed). */
export function startHand(state: GameState): GameState {
  if (state.status !== 'playing' || state.hand) return state;
  const occupied = (i: number) => !!state.seats[i] && state.seats[i]!.hp > 0;
  const players = state.seats.flatMap((f, i) => (f && f.hp > 0 ? [i] : []));
  if (players.length < 2) return state;
  const round = state.round + 1;
  const seed = deriveSeed(state.seed, round);
  const rng = mulberry32(seed);
  const n = state.seats.length;
  const button = nextSeat(n, state.button, occupied);
  const headsUp = players.length === 2;
  const sbSeat = headsUp ? button : nextSeat(n, button, occupied);
  const bbSeat = nextSeat(n, sbSeat, occupied);
  const bb = anteFor(round);
  const sbAmt = Math.max(1, Math.floor(bb / 2));

  let deck = shuffle(createDeck(), rng);
  const hole: ([Card, Card] | null)[] = Array.from({ length: n }, () => null);
  for (let k = 0, i = sbSeat; k < players.length; k++, i = nextSeat(n, i, occupied)) hole[i] = [deck[k]!, deck[k + players.length]!];
  deck = deck.slice(players.length * 2);
  const board = [deck[1]!, deck[2]!, deck[3]!, deck[5]!, deck[7]!]; // burn before flop, turn, river
  assertUnique([...hole.flatMap((h) => h ?? []), ...board]);

  const hand: HandState = {
    round,
    seed,
    deal: { hole, board },
    street: 'preflop',
    button,
    bb,
    inHand: hole.map(Boolean),
    committed: Array(n).fill(0),
    streetBet: Array(n).fill(0),
    acted: Array(n).fill(false),
    penalty: Array(n).fill(0),
    currentBet: 0,
    minRaise: bb,
    raises: 0,
    toAct: 0,
    decisions: 0,
    log: [],
  };
  const w: Work = { state: { ...state, round, button }, hand, hp: state.seats.map((f) => f?.hp ?? 0), events: [] };
  const sbPaid = pay(w, sbSeat, sbAmt);
  const bbPaid = pay(w, bbSeat, bb);
  hand.currentBet = Math.max(...hand.streetBet);
  hand.toAct = nextSeat(n, bbSeat, (i) => canAct(w, i));
  w.events.push({
    t: 'start',
    round,
    button,
    seats: state.seats,
    joined: state.joined,
    blinds: [
      { seat: sbSeat, amount: sbPaid, kind: 'sb' },
      { seat: bbSeat, amount: bbPaid, kind: 'bb' },
    ],
    survivors: state.survivors,
  });
  return advance(w);
}

/** Your decision. Stale or illegal actions (e.g. from a double tap) are no-ops. */
export function playerAct(state: GameState, action: PlayerAction): GameState {
  if (!state.hand || state.status !== 'playing' || state.hand.toAct !== 0) return state;
  const w = work(state);
  const legal = legalFor(w, 0).find((l) => l.type === action.type && (l.type !== 'raise' || (action.type === 'raise' && l.size === action.size)));
  if (!legal) return state;
  apply(w, 0, legal.type, legal.to);
  w.hand.toAct = nextSeat(w.hand.inHand.length, 0, (j) => canAct(w, j));
  return advance(w);
}

function pause(w: Work): GameState {
  return {
    ...w.state,
    seats: w.state.seats.map((f, i) => (f ? { ...f, hp: w.hp[i]! } : null)),
    hand: { ...w.hand, log: [...w.hand.log, ...w.events] },
    lastEvents: w.events,
  };
}

function showdown(w: Work): GameState {
  w.events.push({ t: 'showdown', seats: w.hand.inHand.flatMap((on, i) => (on ? [i] : [])) });
  return settle(w);
}

/** Split contributions into main and side pots. */
function buildPots(committed: number[], inHand: boolean[]): Pot[] {
  const levels = [...new Set(committed.filter((c, i) => inHand[i] && c > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const amount = committed.reduce((sum, c) => sum + Math.min(c, level) - Math.min(c, prev), 0);
    const eligible = committed.flatMap((c, i) => (inHand[i] && c >= level ? [i] : []));
    if (amount > 0) pots.push({ amount, eligible, winners: [] });
    prev = level;
  }
  // Folded players' chips above the top live level still belong to the last pot.
  const extra = committed.reduce((sum, c) => sum + Math.max(0, c - prev), 0);
  const last = pots[pots.length - 1];
  if (extra && last) last.amount += extra;
  return pots;
}

function settle(w: Work): GameState {
  const { state, hand } = w;
  const start = [...hand.log, ...w.events].find((e) => e.t === 'start') as Extract<GameEvent, { t: 'start' }>;
  const live = hand.inHand.flatMap((on, i) => (on ? [i] : []));
  const isShowdown = live.length > 1;
  const hands: (HandResult | null)[] = hand.deal.hole.map((h, i) =>
    isShowdown && hand.inHand[i] && h ? evaluateBest([...h, ...hand.deal.board]) : null,
  );
  const pots = buildPots(hand.committed, hand.inHand);
  const n = hand.inHand.length;
  const payout: number[] = Array(n).fill(0);
  for (const pot of pots) {
    let best: number[] = [];
    for (const i of pot.eligible) {
      if (!isShowdown) best = [i];
      else if (!best.length) best = [i];
      else {
        const c = compareHands(hands[i]!, hands[best[0]!]!);
        if (c > 0) best = [i];
        else if (c === 0) best.push(i);
      }
    }
    pot.winners = best;
    const share = Math.floor(pot.amount / best.length);
    best.forEach((i) => (payout[i] = payout[i]! + share));
    // Odd chip goes to the first winner left of the button.
    const odd = pot.amount - share * best.length;
    if (odd) {
      const k = nextSeat(n, hand.button, (i) => best.includes(i));
      payout[k] = payout[k]! + odd;
    }
  }
  const hp = w.hp.map((v, i) => v + payout[i]!);

  // Hand bonus: a unique best hand at showdown hits everyone else who showed down.
  const bonus: number[] = Array(n).fill(0);
  let featuredSeat = pots[0]?.winners[0] ?? live[0]!;
  let featuredHand: HandResult | null = null;
  if (isShowdown) {
    const ranked = [...live].sort((a, b) => compareHands(hands[b]!, hands[a]!));
    featuredSeat = ranked[0]!;
    featuredHand = hands[featuredSeat]!;
    const unique = compareHands(hands[ranked[0]!]!, hands[ranked[1]!]!) > 0;
    if (unique) {
      for (const j of ranked.slice(1)) {
        bonus[j] = Math.min(hp[j]!, handBonus(featuredHand));
        hp[j] = hp[j]! - bonus[j]!;
      }
    }
  }

  const after = state.seats.map((f, i) => (f ? { ...f, hp: hp[i]!, maxHp: Math.max(f.maxHp, hp[i]!) } : null));
  const eliminated = after.flatMap((f, i) => (f && f.hp === 0 ? [i] : []));

  // Roster: this table's knockouts, then up to 3 at other tables.
  const out = [...state.roster.out];
  const fallen: number[] = [];
  for (const i of eliminated) {
    out[after[i]!.seat] = hand.round;
    fallen.push(after[i]!.seat);
  }
  const rng = mulberry32(deriveSeed(hand.seed, 0x07e5));
  const seated = new Set(after.filter(Boolean).map((f) => f!.seat));
  const others = aliveSeats(state.roster).filter((r) => !seated.has(r));
  const othersEliminated = Math.min(others.length, randInt(rng, 0, 3));
  for (const r of shuffle(others, rng).slice(0, othersEliminated)) {
    out[r] = hand.round;
    fallen.push(r);
  }
  const roster: Roster = { ...state.roster, out };
  const survivorsAfter = aliveSeats(roster).length;
  const status: GameStatus = after[0]!.hp === 0 ? 'lost' : survivorsAfter <= 1 ? 'won' : 'playing';

  // Refill empty seats from living players elsewhere.
  const seats = after.map((f, i) => (i > 0 && f && f.hp === 0 ? null : f));
  const joined = status === 'playing' ? refill(seats, roster, rng, () => randInt(rng, NEWCOMER_HP[0], NEWCOMER_HP[1])) : [];

  const result: RoundResult = {
    round: hand.round,
    seed: hand.seed,
    deal: hand.deal,
    button: hand.button,
    endedBy: isShowdown ? 'showdown' : 'fold',
    showdown: isShowdown ? live : [],
    hands,
    pots,
    payout,
    committed: hand.committed,
    featuredSeat,
    featuredHand,
    tier: featuredHand ? effectTier(featuredHand.category) : 0,
    bonus,
    penalty: hand.penalty,
    eliminated,
    before: start.seats,
    after,
    survivors: { before: state.survivors, after: survivorsAfter, othersEliminated, fallen },
    statusAfter: status,
  };
  const events: GameEvent[] = [...w.events, { t: 'award', result }];
  return {
    ...state,
    roster,
    seats,
    joined,
    survivors: survivorsAfter,
    status,
    hand: null,
    lastRound: result,
    lastLog: [...hand.log, ...events],
    lastEvents: events,
  };
}

import { calculateDamage, effectTier, type EffectTier } from './combat';
import { dealHoldem, type HoldemDeal } from './dealer';
import { compareHands, evaluateBest, type HandResult } from './handEvaluator';
import { applyDamage, type Fighter, type HpChange } from './hp';
import { deriveSeed, mulberry32, randInt } from './rng';

export const TOTAL_PLAYERS = 100;
export const PLAYER_MAX_HP = 100;
export const OPPONENT_MAX_HP = 80;

export type Side = 'player' | 'opponent';
export type GameStatus = 'playing' | 'won' | 'lost';

export interface AttackResult {
  attacker: Side;
  target: Side;
  damage: number;
  hp: HpChange;
}

/** Everything that happened in one round, fixed before any animation starts. */
export interface RoundResult {
  round: number;
  /** Seed for this round; presentation may reuse it for cosmetic randomness. */
  seed: number;
  deal: HoldemDeal;
  playerHand: HandResult;
  opponentHand: HandResult;
  winner: Side | 'tie';
  /** The hand that "won" the round (player's on a tie) and its strength tier. */
  featuredHand: HandResult;
  tier: EffectTier;
  attack: AttackResult | null;
  /** Snapshot of both fighters before/after (opponent is the one fought this round). */
  player: { before: Fighter; after: Fighter };
  opponent: { before: Fighter; after: Fighter };
  survivors: { before: number; after: number; othersEliminated: number };
  statusAfter: GameStatus;
}

export interface GameState {
  seed: number;
  round: number;
  player: Fighter;
  opponent: Fighter;
  survivors: number;
  status: GameStatus;
  lastRound: RoundResult | null;
}

function makeOpponent(seed: number, round: number): Fighter {
  const rng = mulberry32(deriveSeed(seed, round, 0xa11ce));
  const no = randInt(rng, 2, TOTAL_PLAYERS);
  return { id: `opp-${round}-${no}`, name: `No.${String(no).padStart(3, '0')}`, hp: OPPONENT_MAX_HP, maxHp: OPPONENT_MAX_HP };
}

export function createGame(seed: number): GameState {
  return {
    seed: seed >>> 0,
    round: 0,
    player: { id: 'you', name: 'YOU', hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP },
    opponent: makeOpponent(seed >>> 0, 0),
    survivors: TOTAL_PLAYERS,
    status: 'playing',
    lastRound: null,
  };
}

/**
 * Pure: resolves one complete round (deal → hands → attack → HP → eliminations)
 * and returns the next state. Same state in → same state out.
 */
export function resolveRound(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  const round = state.round + 1;
  const seed = deriveSeed(state.seed, round);
  const rng = mulberry32(seed);

  const deal = dealHoldem(rng);
  const playerHand = evaluateBest([...deal.player, ...deal.board]);
  const opponentHand = evaluateBest([...deal.opponent, ...deal.board]);
  const cmp = compareHands(playerHand, opponentHand);
  const winner: Side | 'tie' = cmp > 0 ? 'player' : cmp < 0 ? 'opponent' : 'tie';

  let player = state.player;
  let opponent = state.opponent;
  let attack: AttackResult | null = null;
  if (winner !== 'tie') {
    const [w, l] = winner === 'player' ? [playerHand, opponentHand] : [opponentHand, playerHand];
    const damage = calculateDamage(w, l);
    if (winner === 'player') {
      const r = applyDamage(opponent, damage);
      opponent = r.fighter;
      attack = { attacker: 'player', target: 'opponent', damage, hp: r.change };
    } else {
      const r = applyDamage(player, damage);
      player = r.fighter;
      attack = { attacker: 'opponent', target: 'player', damage, hp: r.change };
    }
  }
  const featuredHand = winner === 'opponent' ? opponentHand : playerHand;

  // Other tables keep playing: up to 3 eliminations elsewhere each round.
  const others = Math.max(0, state.survivors - 2);
  const othersEliminated = Math.min(others, randInt(rng, 0, 3));
  const opponentOut = opponent.hp === 0;
  const playerOut = player.hp === 0;
  const survivorsAfter = state.survivors - othersEliminated - (opponentOut ? 1 : 0) - (playerOut ? 1 : 0);

  const status: GameStatus = playerOut ? 'lost' : survivorsAfter <= 1 ? 'won' : 'playing';

  const result: RoundResult = {
    round,
    seed,
    deal,
    playerHand,
    opponentHand,
    winner,
    featuredHand,
    tier: effectTier(featuredHand.category),
    attack,
    player: { before: state.player, after: player },
    opponent: { before: state.opponent, after: opponent },
    survivors: { before: state.survivors, after: survivorsAfter, othersEliminated },
    statusAfter: status,
  };

  return {
    ...state,
    round,
    player,
    // A knocked-out opponent is replaced by the next challenger.
    opponent: opponentOut && status === 'playing' ? makeOpponent(state.seed, round) : opponent,
    survivors: survivorsAfter,
    status,
    lastRound: result,
  };
}

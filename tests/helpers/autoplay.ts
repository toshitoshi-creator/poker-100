import { createGame, legalActions, playerAct, startHand, type GameState, type PlayerAction } from '../../src/logic/game';
import { mulberry32 } from '../../src/logic/rng';

/** Deterministic "player" that picks random legal actions. */
export function randomPolicy(seed: number) {
  const rng = mulberry32(seed ^ 0xbeef);
  return (s: GameState): PlayerAction => {
    const legal = legalActions(s);
    const a = legal[Math.floor(rng() * legal.length)]!;
    return a.type === 'bet' ? { type: 'bet', size: a.size } : ({ type: a.type } as PlayerAction);
  };
}

/** Every intermediate state of a game, until it ends or maxSteps. */
export function autoplay(seed: number, maxSteps = 400, policy = randomPolicy(seed)): GameState[] {
  const states = [createGame(seed)];
  for (let i = 0; i < maxSteps; i++) {
    const s = states.at(-1)!;
    if (s.status !== 'playing') break;
    states.push(s.hand ? playerAct(s, policy(s)) : startHand(s));
  }
  return states;
}

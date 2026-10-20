import { createGame, legalActions, playerAct, startHand, type GameState, type PlayerAction, type TableSize } from '../../src/logic/game';
import { mulberry32 } from '../../src/logic/rng';

/** Deterministic "player" that picks random legal actions (folds less often than it could). */
export function randomPolicy(seed: number) {
  const rng = mulberry32(seed ^ 0xbeef);
  return (s: GameState): PlayerAction => {
    const legal = legalActions(s).filter((a) => a.type !== 'fold' || rng() < 0.4);
    const pick = legal.length ? legal : legalActions(s);
    const a = pick[Math.floor(rng() * pick.length)]!;
    return a.type === 'raise' ? { type: 'raise', size: a.size } : ({ type: a.type } as PlayerAction);
  };
}

/** Every intermediate state of a game, until it ends or maxSteps. */
export function autoplay(seed: number, maxSteps = 300, policy = randomPolicy(seed), tableSize?: TableSize): GameState[] {
  const states = [createGame(seed, tableSize)];
  for (let i = 0; i < maxSteps; i++) {
    const s = states.at(-1)!;
    if (s.status !== 'playing') break;
    states.push(s.hand ? playerAct(s, policy(s)) : startHand(s));
  }
  return states;
}

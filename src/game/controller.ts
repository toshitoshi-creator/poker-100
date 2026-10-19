import { createGame, legalActions, playerAct, startHand, type GameState, type LegalAction, type PlayerAction } from '../logic/game';
import type { Presenter } from '../presentation/director';

/**
 * Owns the authoritative GameState. Every action is synchronous and resolves
 * logic first; the presenter only ever displays already-decided events, so
 * no animation (finished, skipped or interrupted) can affect the game state.
 */
export class GameController {
  private state: GameState;
  private presenter: Presenter | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(seed: number) {
    this.state = createGame(seed);
  }

  getState = (): GameState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  attach(presenter: Presenter | null): void {
    this.presenter = presenter;
  }

  legal(): LegalAction[] {
    return legalActions(this.state);
  }

  /** Start the next hand. A running presentation is fast-forwarded first. */
  deal(): boolean {
    return this.step(startHand);
  }

  /** Player decision. Stale or illegal actions (e.g. from a double tap) are ignored. */
  act(action: PlayerAction): boolean {
    return this.step((s) => playerAct(s, action));
  }

  skip(): void {
    this.presenter?.skip();
  }

  /** Re-run the last finished hand's presentation. Game state is untouched. */
  replay(): void {
    if (this.state.hand || this.state.lastLog.length === 0) return;
    this.presenter?.play(this.state.lastLog, 0);
  }

  reset(seed: number): void {
    this.presenter?.reset();
    this.state = createGame(seed);
    this.emit();
  }

  private step(fn: (s: GameState) => GameState): boolean {
    if (this.presenter?.isPlaying()) this.presenter.skip();
    const next = fn(this.state);
    if (next === this.state) return false;
    this.state = next;
    this.emit();
    return true;
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

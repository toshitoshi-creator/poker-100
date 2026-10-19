import { createGame, resolveRound, type GameState, type RoundResult } from '../logic/game';
import type { Presenter } from '../presentation/director';

/**
 * Owns the authoritative GameState. Every action is synchronous and resolves
 * logic first; the presenter only ever displays already-decided results, so
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

  /**
   * Resolve the next round. If a presentation is running it is skipped first,
   * so rapid taps simply fast-forward. The caller (UI) plays the new round
   * once it has rendered it.
   */
  deal(): RoundResult | null {
    if (this.presenter?.isPlaying()) this.presenter.skip();
    if (this.state.status !== 'playing') return null;
    this.state = resolveRound(this.state);
    this.emit();
    return this.state.lastRound;
  }

  skip(): void {
    this.presenter?.skip();
  }

  /** Re-run the last round's presentation. Game state is untouched. */
  replay(): void {
    const last = this.state.lastRound;
    if (last) this.presenter?.play(last);
  }

  reset(seed: number): void {
    this.presenter?.reset();
    this.state = createGame(seed);
    this.emit();
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

import { useSyncExternalStore } from 'react';

/** Small external store so 60fps HP tweens only re-render the subscribers. */
export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const k in patch) if (!Object.is(state[k], patch[k])) changed = true;
      if (!changed) return;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<T, S>(store: Store<T>, select: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

export type Phase = 'idle' | 'deal' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'result';

/** What the screen currently shows. Driven by the Director; never read by game logic. Arrays are per table seat. */
export interface PresentationState {
  phase: Phase;
  hp: number[];
  /** Chips in front of each seat this street. */
  bets: number[];
  say: string[];
  pot: number;
  survivors: number;
  button: number;
  /** Seat whose action is being shown (-1 = none). */
  active: number;
  /** Round id currently on screen (0 = none yet). */
  round: number;
  playing: boolean;
  /** The 100-player overview: lobby before the first hand, open when the player checks standings. */
  arena: 'hidden' | 'lobby' | 'open';
}

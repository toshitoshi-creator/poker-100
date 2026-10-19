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

export type Phase = 'idle' | 'deal' | 'flop' | 'turn' | 'river' | 'showdown' | 'attack' | 'result';

/** What the screen currently shows. Driven by the Director; never read by game logic. */
export interface PresentationState {
  phase: Phase;
  playerHp: number;
  opponentHp: number;
  survivors: number;
  /** Round id currently on screen (0 = none yet). */
  round: number;
  playing: boolean;
  /** True once the round's result has been fully shown (or skipped). */
  settled: boolean;
}

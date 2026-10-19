/**
 * Sound effects are referenced by id only. Nothing is bundled yet: register a
 * player per id (e.g. from soundMap) and the Director's cues start making noise.
 */
export type SoundId =
  | 'deal'
  | 'flip'
  | 'reveal'
  | 'handMinor'
  | 'handMajor'
  | 'handLegendary'
  | 'attack'
  | 'hit'
  | 'ko'
  | 'win'
  | 'lose';

export type SoundPlayer = (opts: { volume: number }) => void;

export interface SoundBus {
  play(id: SoundId, volume?: number): void;
  register(id: SoundId, player: SoundPlayer): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}

export function createSoundBus(): SoundBus {
  const players = new Map<SoundId, SoundPlayer>();
  let muted = false;
  return {
    play(id, volume = 1) {
      if (muted) return;
      try {
        players.get(id)?.({ volume });
      } catch {
        // A broken sound must never break the presentation.
      }
    },
    register(id, player) {
      players.set(id, player);
    },
    setMuted(m) {
      muted = m;
    },
    isMuted: () => muted,
  };
}

/** Helper for later: register sounds from URLs via HTMLAudioElement. */
export function registerAudioFiles(bus: SoundBus, files: Partial<Record<SoundId, string>>): void {
  for (const [id, url] of Object.entries(files) as [SoundId, string][]) {
    const base = new Audio(url);
    base.preload = 'auto';
    bus.register(id, ({ volume }) => {
      const a = base.cloneNode() as HTMLAudioElement;
      a.volume = Math.min(1, Math.max(0, volume));
      void a.play().catch(() => undefined);
    });
  }
}

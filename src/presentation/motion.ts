export interface MotionProfile {
  reduced: boolean;
  /** Global playback speed multiplier (timeline.timeScale). */
  speed: number;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export function watchReducedMotion(cb: (reduced: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const h = () => cb(mq.matches);
  mq.addEventListener?.('change', h);
  return () => mq.removeEventListener?.('change', h);
}

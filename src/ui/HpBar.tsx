import { useStore, type PresentationState, type Store } from '../presentation/store';
import type { Side } from '../logic/game';

interface Props {
  side: Side;
  max: number;
  store: Store<PresentationState>;
}

/** Number and bar are derived from the same store value, so they never drift. */
export function HpBar({ side, max, store }: Props) {
  const hp = useStore(store, (s) => (side === 'player' ? s.playerHp : s.opponentHp));
  const ratio = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  const level = ratio > 0.5 ? 'ok' : ratio > 0.25 ? 'warn' : 'danger';
  return (
    <div className={`hp hp--${level}`} data-hp={side}>
      <div className="hp-track">
        <div className="hp-lag" style={{ transform: `scaleX(${ratio})` }} />
        <div className="hp-fill" style={{ transform: `scaleX(${ratio})` }} />
      </div>
      <span className="hp-num" aria-label={`HP ${hp} / ${max}`}>
        <b data-testid={`hp-${side}`}>{hp}</b>/{max}
      </span>
    </div>
  );
}

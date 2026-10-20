import { useStore, type PresentationState, type Store } from '../presentation/store';

interface Props {
  seat: number;
  max: number;
  store: Store<PresentationState>;
}

/** HP is also your chip stack. Number and bar come from the same store value, so they never drift. */
export function HpBar({ seat, max, store }: Props) {
  const hp = useStore(store, (s) => s.hp[seat] ?? 0);
  const cap = Math.max(max, hp);
  const ratio = cap > 0 ? Math.max(0, Math.min(1, hp / cap)) : 0;
  const level = ratio > 0.5 ? 'ok' : ratio > 0.25 ? 'warn' : 'danger';
  return (
    <div className={`hp hp--${level}`} data-hp={seat}>
      <div className="hp-track">
        <div className="hp-lag" style={{ transform: `scaleX(${ratio})` }} />
        <div className="hp-fill" style={{ transform: `scaleX(${ratio})` }} />
      </div>
      <span className="hp-num" aria-label={`HP ${hp}`}>
        <b data-testid={`hp-${seat}`}>{hp}</b>
        <small>HP</small>
      </span>
    </div>
  );
}

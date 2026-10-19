import { TOTAL_PLAYERS } from '../logic/game';
import { useStore, type Phase, type PresentationState, type Store } from '../presentation/store';

const STEPS: { key: Phase[]; label: string }[] = [
  { key: ['deal'], label: 'PRE' },
  { key: ['flop'], label: 'FLOP' },
  { key: ['turn'], label: 'TURN' },
  { key: ['river'], label: 'RIVER' },
  { key: ['showdown', 'attack', 'result'], label: 'SHOW' },
];

export function Hud({ store }: { store: Store<PresentationState> }) {
  const survivors = useStore(store, (s) => s.survivors);
  const round = useStore(store, (s) => s.round);
  const phase = useStore(store, (s) => s.phase);
  const activeIdx = STEPS.findIndex((s) => s.key.includes(phase));
  return (
    <header className="hud">
      <div className="hud-survivors">
        <span className="hud-cap">生存者</span>
        <b data-testid="survivors">{survivors}</b>
        <span className="hud-cap">/{TOTAL_PLAYERS}</span>
      </div>
      <ol className="hud-steps">
        {STEPS.map((s, i) => (
          <li key={s.label} className={i === activeIdx ? 'is-active' : i < activeIdx ? 'is-done' : ''}>
            {s.label}
          </li>
        ))}
      </ol>
      <div className="hud-round">R{round}</div>
    </header>
  );
}

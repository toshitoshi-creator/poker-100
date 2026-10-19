import { TOTAL_PLAYERS } from '../logic/game';
import { useStore, type Phase, type PresentationState, type Store } from '../presentation/store';

const STEPS: { key: Phase[]; label: string }[] = [
  { key: ['deal', 'preflop'], label: 'PRE' },
  { key: ['flop'], label: 'FLOP' },
  { key: ['turn'], label: 'TURN' },
  { key: ['river'], label: 'RIVER' },
  { key: ['showdown', 'result'], label: 'SHOW' },
];

interface Props {
  store: Store<PresentationState>;
  speed: number;
  muted: boolean;
  onSpeed(): void;
  onMute(): void;
}

export function Hud({ store, speed, muted, onSpeed, onMute }: Props) {
  const survivors = useStore(store, (s) => s.survivors);
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
      <div className="hud-mini">
        <button className="btn btn--mini" onClick={onSpeed} aria-label="再生速度">
          ×{speed}
        </button>
        <button className="btn btn--mini" onClick={onMute} aria-label={muted ? '音をオン' : '音をオフ'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
    </header>
  );
}

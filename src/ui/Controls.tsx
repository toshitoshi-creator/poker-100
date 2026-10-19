interface Props {
  playing: boolean;
  canDeal: boolean;
  canReplay: boolean;
  dealLabel: string;
  speed: number;
  muted: boolean;
  onDeal(): void;
  onSkip(): void;
  onReplay(): void;
  onSpeed(): void;
  onMute(): void;
}

export function Controls(p: Props) {
  return (
    <nav className="controls">
      <button className="btn btn--ghost" onClick={p.onReplay} disabled={!p.canReplay || p.playing}>
        ↺ リプレイ
      </button>
      {p.playing ? (
        <button className="btn btn--primary" onClick={p.onSkip}>
          ⏭ スキップ
        </button>
      ) : (
        <button className="btn btn--primary" onClick={p.onDeal} disabled={!p.canDeal}>
          {p.dealLabel}
        </button>
      )}
      <div className="controls-mini">
        <button className="btn btn--mini" onClick={p.onSpeed} aria-label="再生速度">
          ×{p.speed}
        </button>
        <button className="btn btn--mini" onClick={p.onMute} aria-label={p.muted ? '音をオン' : '音をオフ'}>
          {p.muted ? '🔇' : '🔊'}
        </button>
      </div>
    </nav>
  );
}

import type { LegalAction, PlayerAction } from '../logic/game';

interface Props {
  mode: 'idle' | 'playing' | 'decide' | 'over';
  legal: LegalAction[];
  dealLabel: string;
  canReplay: boolean;
  onDeal(): void;
  onSkip(): void;
  onReplay(): void;
  onAct(a: PlayerAction): void;
}

function label(a: LegalAction): [string, string] {
  switch (a.type) {
    case 'check':
      return ['チェック', 'HPを賭けない'];
    case 'call':
      return ['コール', `HP ${a.amount}`];
    case 'fold':
      return ['フォールド', '降りる'];
    case 'bet':
      return [a.size === 'half' ? 'ベット ½' : a.size === 'pot' ? 'ポット' : 'オールイン', `HP ${a.amount}`];
  }
}

function toAction(a: LegalAction): PlayerAction {
  return a.type === 'bet' ? { type: 'bet', size: a.size } : ({ type: a.type } as PlayerAction);
}

export function Controls(p: Props) {
  if (p.mode === 'over') return <nav className="controls" />;
  if (p.mode === 'playing') {
    return (
      <nav className="controls">
        <button className="btn btn--primary btn--wide" data-testid="primary" onClick={p.onSkip}>
          ⏭ スキップ
        </button>
      </nav>
    );
  }
  if (p.mode === 'decide') {
    return (
      <nav className={`controls controls--actions n${p.legal.length}`}>
        {p.legal.map((a) => {
          const [main, sub] = label(a);
          const kind = a.type === 'fold' ? 'danger' : a.type === 'check' ? 'ghost' : a.type === 'bet' && a.size === 'allin' ? 'allin' : 'primary';
          return (
            <button
              key={a.type + (a.type === 'bet' ? a.size : '')}
              className={`btn btn--${kind} btn--action`}
              data-testid={`act-${a.type}${a.type === 'bet' ? `-${a.size}` : ''}`}
              onClick={() => p.onAct(toAction(a))}
            >
              <span>{main}</span>
              <small>{sub}</small>
            </button>
          );
        })}
      </nav>
    );
  }
  return (
    <nav className="controls">
      <button className="btn btn--ghost" onClick={p.onReplay} disabled={!p.canReplay}>
        ↺ リプレイ
      </button>
      <button className="btn btn--primary btn--wide" data-testid="primary" onClick={p.onDeal}>
        {p.dealLabel}
      </button>
    </nav>
  );
}

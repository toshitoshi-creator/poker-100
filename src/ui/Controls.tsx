import type { LegalAction, PlayerAction } from '../logic/game';

interface Props {
  mode: 'idle' | 'playing' | 'decide' | 'wait' | 'over';
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
      return ['フォールド', a.penalty ? `ダメージ ${a.penalty}` : '降りる'];
    case 'raise':
      return [a.size === 'half' ? '½ポット' : a.size === 'pot' ? 'ポット' : 'オールイン', `HP ${a.amount}`];
  }
}

function toAction(a: LegalAction): PlayerAction {
  return a.type === 'raise' ? { type: 'raise', size: a.size } : ({ type: a.type } as PlayerAction);
}

export function Controls(p: Props) {
  if (p.mode === 'over' || p.mode === 'wait') return <nav className="controls" />;
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
          const kind =
            a.type === 'fold' ? 'danger' : a.type === 'check' ? 'ghost' : a.type === 'raise' && a.size === 'allin' ? 'allin' : 'primary';
          const id = a.type === 'raise' ? `act-raise-${a.size}` : `act-${a.type}`;
          return (
            <button key={id} className={`btn btn--${kind} btn--action`} data-testid={id} onClick={() => p.onAct(toAction(a))}>
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

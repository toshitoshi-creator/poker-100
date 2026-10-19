import { forwardRef } from 'react';
import { anteFor } from '../logic/combat';
import type { GameState } from '../logic/game';
import { HAND_INFO } from '../logic/handEvaluator';
import { CHIP_POOL, PARTICLE_POOL } from '../presentation/director';
import { useStore, type PresentationState, type Store } from '../presentation/store';
import { CardView, EmptySlot } from './CardView';
import { Seat } from './Seat';

interface Props {
  game: GameState;
  store: Store<PresentationState>;
}

function Pot({ store, ante }: { store: Store<PresentationState>; ante: number }) {
  const pot = useStore(store, (s) => s.pot);
  return (
    <div className="pot" data-pot>
      <span className="pot-cap">POT</span>
      <b data-testid="pot">{pot}</b>
      <span className="pot-ante">参加費 {ante}</span>
    </div>
  );
}

/** Pure layout. All motion is applied by the Director through data-* hooks. */
export const Table = forwardRef<HTMLDivElement, Props>(function Table({ game, store }, ref) {
  // During a hand: its cards. Between hands: the finished hand stays on the table.
  const result = game.hand ? null : game.lastRound;
  const deal = game.hand?.deal ?? result?.deal ?? null;
  const round = game.hand?.round ?? result?.round ?? 0;
  const opponent = result ? result.opponent.after : game.opponent;
  const player = game.player;
  const ante = anteFor(game.hand ? game.hand.round : game.round + 1);

  let banner: { ja: string; en: string; sub: string } | null = null;
  if (result) {
    const name = result.winner === 'player' ? 'YOU' : opponent.name;
    const gain = result.winner === 'tie' ? 0 : result.pot - result.committed[result.winner];
    const take = result.winner === 'tie' ? 'DRAW · 引き分け' : `${name} WIN · +${gain} HP`;
    if (result.featuredHand) {
      const info = HAND_INFO[result.featuredHand.category];
      banner = { ja: info.ja, en: info.en, sub: result.bonus > 0 ? `${take} · 役ボーナス ${result.bonus}` : take };
    } else {
      banner = { ja: 'フォールド', en: 'FOLD', sub: take };
    }
  }
  const tier = result?.tier ?? 0;

  return (
    <div className="stage" data-stage ref={ref}>
      <Seat side="opponent" fighter={opponent} deal={deal} round={round} result={result} store={store} />

      <section className="board-area">
        <div className="table-center">
          <div className="deck" data-deck aria-label="山札">
            <div className="deck-card" />
            <div className="deck-card" />
            <div className="deck-card" />
          </div>
          <Pot store={store} ante={ante} />
        </div>
        <div className="board" key={round}>
          {deal
            ? deal.board.map((c, i) => <CardView key={c.id} card={c} slot={`b${i}`} />)
            : Array.from({ length: 5 }, (_, i) => <EmptySlot key={i} />)}
        </div>
      </section>

      <Seat side="player" fighter={player} deal={deal} round={round} result={result} store={store} />

      <div className="fx-layer" aria-hidden>
        <div className="flash" data-flash />
        <div className={`projectile tier-${tier}`} data-projectile />
        {Array.from({ length: PARTICLE_POOL }, (_, i) => (
          <div key={i} className={`particle tier-${tier}`} data-particle />
        ))}
        {Array.from({ length: CHIP_POOL }, (_, i) => (
          <div key={`c${i}`} className="chip" data-chip />
        ))}
      </div>

      <div className={`banner tier-${tier}`} data-banner role="status">
        {banner && (
          <>
            <div className="banner-ja">{banner.ja}</div>
            <div className="banner-en">{banner.en}</div>
            <div className="banner-sub">{banner.sub}</div>
          </>
        )}
      </div>
    </div>
  );
});

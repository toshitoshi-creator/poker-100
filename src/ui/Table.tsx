import { forwardRef } from 'react';
import type { GameState } from '../logic/game';
import { HAND_INFO } from '../logic/handEvaluator';
import { PARTICLE_POOL } from '../presentation/director';
import type { PresentationState, Store } from '../presentation/store';
import { CardView, EmptySlot } from './CardView';
import { Seat } from './Seat';

interface Props {
  game: GameState;
  store: Store<PresentationState>;
}

/** Pure layout. All motion is applied by the Director through data-* hooks. */
export const Table = forwardRef<HTMLDivElement, Props>(function Table({ game, store }, ref) {
  const round = game.lastRound;
  const opponent = round ? round.opponent.before : game.opponent;
  const player = round ? round.player.before : game.player;
  const featured = round?.featuredHand;
  const banner = round && featured ? HAND_INFO[featured.category] : null;
  const sub = !round
    ? ''
    : round.winner === 'tie'
      ? 'DRAW · SPLIT'
      : `${round.winner === 'player' ? 'YOU' : opponent.name} WIN · ${round.attack?.damage ?? 0} DMG`;

  return (
    <div className="stage" data-stage ref={ref}>
      <Seat side="opponent" fighter={opponent} round={round} store={store} />

      <section className="board-area">
        <div className="deck" data-deck aria-label="山札">
          <div className="deck-card" />
          <div className="deck-card" />
          <div className="deck-card" />
        </div>
        <div className="board" key={round?.round ?? 0}>
          {round
            ? round.deal.board.map((c, i) => <CardView key={c.id} card={c} slot={`b${i}`} />)
            : Array.from({ length: 5 }, (_, i) => <EmptySlot key={i} />)}
        </div>
      </section>

      <Seat side="player" fighter={player} round={round} store={store} />

      <div className="fx-layer" aria-hidden>
        <div className="flash" data-flash />
        <div className={`projectile tier-${round?.tier ?? 0}`} data-projectile />
        {Array.from({ length: PARTICLE_POOL }, (_, i) => (
          <div key={i} className={`particle tier-${round?.tier ?? 0}`} data-particle />
        ))}
      </div>

      <div className={`banner tier-${round?.tier ?? 0}`} data-banner role="status">
        {banner && (
          <>
            <div className="banner-ja">{banner.ja}</div>
            <div className="banner-en">{banner.en}</div>
            <div className="banner-sub">{sub}</div>
          </>
        )}
      </div>
    </div>
  );
});

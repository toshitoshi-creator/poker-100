import { anteFor } from '../logic/combat';
import type { GameState } from '../logic/game';
import { HAND_INFO } from '../logic/handEvaluator';
import { CHIP_POOL, PARTICLE_POOL, PROJECTILE_POOL } from '../presentation/director';
import { useStore, type PresentationState, type Store } from '../presentation/store';
import { CardView, EmptySlot } from './CardView';
import { Seat } from './Seat';

interface Props {
  game: GameState;
  store: Store<PresentationState>;
  yourTurn: boolean;
}

function Pot({ store, bb }: { store: Store<PresentationState>; bb: number }) {
  const pot = useStore(store, (s) => s.pot);
  return (
    <div className="pot" data-pot>
      <span className="pot-cap">POT</span>
      <b data-testid="pot">{pot}</b>
      <span className="pot-ante">
        ブラインド {Math.max(1, Math.floor(bb / 2))}/{bb}
      </span>
    </div>
  );
}

/** Pure layout. All motion is applied by the Director through data-* hooks. */
export function Table({ game, store, yourTurn }: Props) {
  // During a hand: its cards. Between hands: the finished hand stays on the table.
  const result = game.hand ? null : game.lastRound;
  const deal = game.hand?.deal ?? result?.deal ?? null;
  const round = game.hand?.round ?? result?.round ?? 0;
  const seats = result ? result.after : game.seats;
  const bb = anteFor(game.hand ? game.hand.round : game.round + 1);
  const name = (i: number) => (i === 0 ? 'YOU' : seats[i]?.name ?? '');

  let banner: { ja: string; en: string; sub: string } | null = null;
  if (result) {
    const winners = result.payout.flatMap((p, i) => (p > 0 ? [i] : []));
    const main = result.pots[0]?.winners ?? [];
    const take =
      main.length > 1
        ? `SPLIT · ${main.map(name).join(' / ')}`
        : `${name(result.featuredSeat)} WIN · +${result.payout[result.featuredSeat] ?? 0} HP`;
    const burned = result.bonus.reduce((a, b) => a + b, 0);
    if (result.featuredHand) {
      const info = HAND_INFO[result.featuredHand.category];
      banner = { ja: info.ja, en: info.en, sub: burned ? `${take} · 役ボーナス ${burned}` : take };
    } else {
      banner = { ja: 'フォールド', en: 'FOLD', sub: `${name(winners[0] ?? 0)} WIN · +${result.payout[winners[0] ?? 0] ?? 0} HP` };
    }
  }
  const tier = result?.tier ?? 0;
  const seat = (i: number) => (
    <Seat
      key={i}
      seat={i}
      fighter={seats[i] ?? null}
      hole={deal?.hole[i] ?? null}
      round={round}
      result={result}
      store={store}
      yourTurn={i === 0 && yourTurn}
    />
  );

  return (
    <div className="stage" data-stage>
      <div className="ring ring--top">{[2, 3, 4].map(seat)}</div>
      <section className="felt">
        <div className="felt-center">
          <div className="deck" data-deck aria-label="山札">
            <div className="deck-card" />
            <div className="deck-card" />
            <div className="deck-card" />
          </div>
          <Pot store={store} bb={bb} />
        </div>
        <div className="board" key={round}>
          {deal
            ? deal.board.map((c, i) => <CardView key={c.id} card={c} slot={`b${i}`} />)
            : Array.from({ length: 5 }, (_, i) => <EmptySlot key={i} />)}
        </div>
      </section>
      <div className="ring ring--mid">
        {seat(1)}
        {seat(5)}
      </div>
      {seat(0)}

      <div className="fx-layer" aria-hidden>
        <div className="flash" data-flash />
        {Array.from({ length: PROJECTILE_POOL }, (_, i) => (
          <div key={`p${i}`} className={`projectile tier-${tier}`} data-projectile />
        ))}
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
}

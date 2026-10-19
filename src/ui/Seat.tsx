import type { Fighter } from '../logic/hp';
import type { RoundResult, Side } from '../logic/game';
import { HAND_INFO } from '../logic/handEvaluator';
import type { PresentationState, Store } from '../presentation/store';
import { CardView, EmptySlot } from './CardView';
import { HpBar } from './HpBar';

interface Props {
  side: Side;
  fighter: Fighter;
  round: RoundResult | null;
  store: Store<PresentationState>;
}

export function Seat({ side, fighter, round, store }: Props) {
  const prefix = side === 'player' ? 'p' : 'o';
  const hole = round ? (side === 'player' ? round.deal.player : round.deal.opponent) : null;
  const hand = round ? (side === 'player' ? round.playerHand : round.opponentHand) : null;
  const isTarget = round?.attack?.target === side;
  const winner = round?.winner === side;
  return (
    <section className={`seat seat--${side}`} data-seat={side}>
      <div className="seat-info">
        <div className="avatar" data-avatar={side}>
          <span className="avatar-icon" aria-hidden>
            {side === 'player' ? '★' : '☠'}
          </span>
          <span className="avatar-name">{fighter.name}</span>
        </div>
        <HpBar side={side} max={fighter.maxHp} store={store} />
      </div>
      <div className="hole" key={round?.round ?? 0}>
        {hole ? hole.map((c, i) => <CardView key={c.id} card={c} slot={`${prefix}${i}`} />) : [<EmptySlot key="a" />, <EmptySlot key="b" />]}
      </div>
      <div className={`hand-label${winner ? ' is-winner' : ''}`} data-label={side}>
        {hand ? HAND_INFO[hand.category].ja : ''}
      </div>
      <div className="dmg-pop" data-dmg={side}>
        {isTarget ? `-${round!.attack!.damage}` : ''}
      </div>
      <div className="ko-stamp" data-ko={side}>
        脱落
      </div>
    </section>
  );
}

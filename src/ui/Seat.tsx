import type { Fighter } from '../logic/hp';
import type { HoldemDeal } from '../logic/dealer';
import type { RoundResult, Side } from '../logic/game';
import { HAND_INFO } from '../logic/handEvaluator';
import { useStore, type PresentationState, type Store } from '../presentation/store';
import { CardView, EmptySlot } from './CardView';
import { HpBar } from './HpBar';

interface Props {
  side: Side;
  fighter: Fighter;
  deal: HoldemDeal | null;
  round: number;
  result: RoundResult | null;
  store: Store<PresentationState>;
}

function Bubble({ side, store }: { side: Side; store: Store<PresentationState> }) {
  const text = useStore(store, (s) => (side === 'player' ? s.sayPlayer : s.sayOpponent));
  if (!text) return null;
  return (
    <span key={text} className="say" data-testid={`say-${side}`}>
      {text}
    </span>
  );
}

export function Seat({ side, fighter, deal, round, result, store }: Props) {
  const prefix = side === 'player' ? 'p' : 'o';
  const hole = deal ? (side === 'player' ? deal.player : deal.opponent) : null;
  const hand = result && (side === 'player' ? result.playerHand : result.opponentHand);
  const winner = result?.winner === side;
  const loser = result && result.winner !== 'tie' && !winner;
  const gain = !result ? 0 : result.winner === 'tie' ? result.committed[side] : winner ? result.pot : 0;
  return (
    <section className={`seat seat--${side}`} data-seat={side}>
      <div className="seat-info">
        <div className="avatar" data-avatar={side}>
          <span className="avatar-icon" aria-hidden>
            {side === 'player' ? '★' : '☠'}
          </span>
          <span className="avatar-name">{fighter.name}</span>
          <Bubble side={side} store={store} />
        </div>
        <HpBar side={side} max={fighter.maxHp} store={store} />
      </div>
      <div className="hole" key={round}>
        {hole ? hole.map((c, i) => <CardView key={c.id} card={c} slot={`${prefix}${i}`} />) : [<EmptySlot key="a" />, <EmptySlot key="b" />]}
      </div>
      <div className={`hand-label${winner ? ' is-winner' : ''}`} data-label={side}>
        {hand && result?.endedBy === 'showdown' ? HAND_INFO[hand.category].ja : ''}
      </div>
      <div className="dmg-pop" data-dmg={side}>
        {loser && result.bonus > 0 ? `-${result.bonus}` : ''}
      </div>
      <div className="gain-pop" data-gain={side}>
        {gain > 0 ? `+${gain}` : ''}
      </div>
      <div className="ko-stamp" data-ko={side}>
        脱落
      </div>
    </section>
  );
}
